use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::constants::{BET_SEED, CONFIG_SEED, VAULT_SEED};
use crate::error::ErrorCode;
use crate::instructions::settle::bet_signer_seeds;
use crate::state::{Bet, BetCancelled, BetStatus, Config};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct CancelAndRefund<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: PDA seed. Matched against the creator stored on the bet.
    #[account(constraint = creator.key() == bet.creator @ ErrorCode::Unauthorized)]
    pub creator: UncheckedAccount<'info>,
    #[account(
        mut,
        close = payer,
        seeds = [BET_SEED, creator.key().as_ref(), &bet_id.to_le_bytes()],
        bump = bet.bump,
    )]
    pub bet: Account<'info, Bet>,
    #[account(
        mut,
        seeds = [VAULT_SEED, bet.key().as_ref()],
        bump = bet.vault_bump,
        token::mint = usdc_mint,
        token::authority = bet,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_cancel_and_refund<'a>(
    ctx: Context<'a, CancelAndRefund<'a>>,
    bet_id: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.bet.bet_id == bet_id, ErrorCode::BetIdMismatch);
    require!(
        ctx.accounts.bet.status == BetStatus::Funding,
        ErrorCode::BadStatus
    );
    require!(now > ctx.accounts.bet.start_deadline, ErrorCode::TooEarly);

    let count = ctx.accounts.bet.participant_count as usize;
    require!(
        ctx.remaining_accounts.len() == count,
        ErrorCode::BadTokenAccount
    );
    let stake = ctx.accounts.bet.stake_amount;
    let decimals = ctx.accounts.usdc_mint.decimals;
    let mint_key = ctx.accounts.usdc_mint.key();

    for index in 0..count {
        let participant = ctx.accounts.bet.participants[index];
        let token_account = &ctx.remaining_accounts[index];
        let expected = get_associated_token_address(&participant, &mint_key);
        require_keys_eq!(token_account.key(), expected, ErrorCode::BadTokenAccount);
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            to: token_account.to_account_info(),
            authority: ctx.accounts.bet.to_account_info(),
        };
        let creator = ctx.accounts.bet.creator;
        let bet_id_bytes = ctx.accounts.bet.bet_id.to_le_bytes();
        let bump = [ctx.accounts.bet.bump];
        let seeds = bet_signer_seeds(&creator, &bet_id_bytes, &bump);
        let signer = [&seeds[..]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, &signer),
            stake,
            decimals,
        )?;
    }

    ctx.accounts.vault.reload()?;
    require!(
        ctx.accounts.vault.amount == 0,
        ErrorCode::ArithmeticOverflow
    );

    let creator = ctx.accounts.bet.creator;
    let bet_id_bytes = ctx.accounts.bet.bet_id.to_le_bytes();
    let bump = [ctx.accounts.bet.bump];
    let seeds = bet_signer_seeds(&creator, &bet_id_bytes, &bump);
    let signer = [&seeds[..]];
    let close_accounts = CloseAccount {
        account: ctx.accounts.vault.to_account_info(),
        destination: ctx.accounts.payer.to_account_info(),
        authority: ctx.accounts.bet.to_account_info(),
    };
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        close_accounts,
        &signer,
    ))?;

    emit!(BetCancelled {
        bet: ctx.accounts.bet.key(),
    });
    Ok(())
}
