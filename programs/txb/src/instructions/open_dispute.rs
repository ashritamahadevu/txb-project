use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{BET_SEED, CONFIG_SEED, VAULT_SEED};
use crate::error::ErrorCode;
use crate::state::{Bet, BetStatus, Config, DisputeOpened};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct OpenDispute<'info> {
    #[account(mut)]
    pub disputer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: PDA seed. Matched against the creator stored on the bet.
    #[account(constraint = creator.key() == bet.creator @ ErrorCode::Unauthorized)]
    pub creator: UncheckedAccount<'info>,
    #[account(
        mut,
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
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = disputer,
    )]
    pub disputer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_open_dispute(ctx: Context<OpenDispute>, bet_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.bet.bet_id == bet_id, ErrorCode::BetIdMismatch);
    require!(
        ctx.accounts.bet.status == BetStatus::Disputable,
        ErrorCode::BadStatus
    );
    require!(
        now < ctx.accounts.bet.dispute_deadline,
        ErrorCode::DisputeWindowClosed
    );
    require!(
        ctx.accounts.bet.dispute_deposit == 0,
        ErrorCode::AlreadyDisputed
    );

    let amount = ctx.accounts.bet.required_dispute_deposit;
    let decimals = ctx.accounts.usdc_mint.decimals;
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.disputer_token.to_account_info(),
        mint: ctx.accounts.usdc_mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.disputer.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts),
        amount,
        decimals,
    )?;

    let disputer = ctx.accounts.disputer.key();
    let bet = &mut ctx.accounts.bet;
    bet.status = BetStatus::Disputed;
    bet.disputer = disputer;
    bet.dispute_deposit = amount;
    emit!(DisputeOpened {
        bet: bet.key(),
        disputer,
        deposit: amount,
    });
    Ok(())
}
