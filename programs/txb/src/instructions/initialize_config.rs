use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::constants::{CONFIG_SEED, MAX_DISPUTE_WINDOW_SECONDS};
use crate::error::ErrorCode;
use crate::state::{Config, ConfigInitialized};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(
    ctx: Context<InitializeConfig>,
    reporter: Pubkey,
    dispute_window_seconds: i64,
    dispute_deposit: u64,
) -> Result<()> {
    require!(dispute_deposit > 0, ErrorCode::InvalidStake);
    require!(
        dispute_window_seconds > 0 && dispute_window_seconds <= MAX_DISPUTE_WINDOW_SECONDS,
        ErrorCode::InvalidWindow
    );
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.reporter = reporter;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.dispute_window_seconds = dispute_window_seconds;
    config.dispute_deposit = dispute_deposit;
    config.bump = ctx.bumps.config;
    emit!(ConfigInitialized {
        admin: config.admin,
        reporter,
        usdc_mint: config.usdc_mint,
    });
    Ok(())
}
