use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, MAX_DISPUTE_WINDOW_SECONDS};
use crate::error::ErrorCode;
use crate::state::Config;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

pub fn handle_update_config(
    ctx: Context<UpdateConfig>,
    reporter: Pubkey,
    dispute_window_seconds: i64,
    dispute_deposit: u64,
    new_admin: Pubkey,
) -> Result<()> {
    require!(dispute_deposit > 0, ErrorCode::InvalidStake);
    require!(
        dispute_window_seconds > 0 && dispute_window_seconds <= MAX_DISPUTE_WINDOW_SECONDS,
        ErrorCode::InvalidWindow
    );
    let config = &mut ctx.accounts.config;
    config.reporter = reporter;
    config.dispute_window_seconds = dispute_window_seconds;
    config.dispute_deposit = dispute_deposit;
    config.admin = new_admin;
    Ok(())
}
