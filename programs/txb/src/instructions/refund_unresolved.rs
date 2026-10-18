use anchor_lang::prelude::*;

use crate::constants::BET_SEED;
use crate::error::ErrorCode;
use crate::instructions::settle::apply_claimable;
use crate::state::{Bet, BetRefunded, BetStatus};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct RefundUnresolved<'info> {
    pub payer: Signer<'info>,
    /// CHECK: PDA seed. Matched against the creator stored on the bet.
    #[account(constraint = creator.key() == bet.creator @ ErrorCode::Unauthorized)]
    pub creator: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [BET_SEED, creator.key().as_ref(), &bet_id.to_le_bytes()],
        bump = bet.bump,
    )]
    pub bet: Account<'info, Bet>,
}

/// Reporter never submitted a result. Anyone can refund stakes after the
/// period end plus the dispute window stored on the bet.
pub fn handle_refund_unresolved(ctx: Context<RefundUnresolved>, bet_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let bet = &mut ctx.accounts.bet;
    require!(bet.bet_id == bet_id, ErrorCode::BetIdMismatch);
    require!(bet.status == BetStatus::Active, ErrorCode::BadStatus);
    let grace_end = bet
        .period_end
        .checked_add(bet.dispute_window_seconds)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(now >= grace_end, ErrorCode::TooEarly);

    let count = bet.participant_count as usize;
    let mut amounts = [0u64; crate::constants::MAX_PARTICIPANTS];
    for amount in amounts.iter_mut().take(count) {
        *amount = bet.stake_amount;
    }
    apply_claimable(bet, amounts);
    emit!(BetRefunded { bet: bet.key() });
    Ok(())
}
