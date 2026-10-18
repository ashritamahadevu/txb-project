use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, TokenAccount, TransferChecked};

use crate::constants::BET_SEED;
use crate::error::ErrorCode;
use crate::state::{Bet, BetStatus, Claimed};

pub fn bet_signer_seeds<'a>(
    creator: &'a Pubkey,
    bet_id_bytes: &'a [u8; 8],
    bump: &'a [u8; 1],
) -> [&'a [u8]; 4] {
    [BET_SEED, creator.as_ref(), bet_id_bytes, bump]
}

pub fn transfer_from_vault<'info>(
    bet: &Account<'info, Bet>,
    vault: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let creator = bet.creator;
    let bet_id_bytes = bet.bet_id.to_le_bytes();
    let bump = [bet.bump];
    let seeds = bet_signer_seeds(&creator, &bet_id_bytes, &bump);
    let signer = [&seeds[..]];
    let cpi_accounts = TransferChecked {
        from: vault,
        mint,
        to: destination,
        authority: bet.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(token_program.key(), cpi_accounts, &signer);
    token_interface::transfer_checked(cpi_ctx, amount, decimals)
}

pub fn apply_claimable(bet: &mut Account<Bet>, amounts: [u64; crate::constants::MAX_PARTICIPANTS]) {
    bet.claimable = amounts;
    bet.claimed = [false; crate::constants::MAX_PARTICIPANTS];
    bet.status = BetStatus::Claimable;
}

/// Pay any leftover vault balance to `destination`, close the vault, then
/// close the bet. Caller has already checked `bet.ready_to_close()`.
pub fn close_settled_bet<'info>(
    bet: &Account<'info, Bet>,
    vault: &mut InterfaceAccount<'info, TokenAccount>,
    destination: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    decimals: u8,
) -> Result<()> {
    vault.reload()?;
    let leftover = vault.amount;
    if leftover > 0 {
        transfer_from_vault(
            bet,
            vault.to_account_info(),
            destination.clone(),
            mint,
            &token_program,
            leftover,
            decimals,
        )?;
        vault.reload()?;
    }
    require!(vault.amount == 0, ErrorCode::ArithmeticOverflow);

    let creator = bet.creator;
    let bet_id_bytes = bet.bet_id.to_le_bytes();
    let bump = [bet.bump];
    let seeds = bet_signer_seeds(&creator, &bet_id_bytes, &bump);
    let signer = [&seeds[..]];
    let close_accounts = CloseAccount {
        account: vault.to_account_info(),
        destination: destination.clone(),
        authority: bet.to_account_info(),
    };
    token_interface::close_account(CpiContext::new_with_signer(
        token_program.key(),
        close_accounts,
        &signer,
    ))?;
    bet.close(destination)?;
    Ok(())
}

pub fn record_claim(bet_key: Pubkey, wallet: Pubkey, amount: u64) {
    emit!(Claimed {
        bet: bet_key,
        wallet,
        amount,
    });
}
