use anchor_lang::prelude::*;

use crate::constants::{BET_SEED, MAX_PARTICIPANTS};
use crate::error::ErrorCode;
use crate::instructions::settle::apply_claimable;
use crate::state::{Bet, BetRefunded};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct ClaimRefund<'info> {
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

/// Judges missed the deadline or split without a majority. Stakes go back
/// to participants and the dispute deposit goes back to the challenger.
pub fn handle_claim_refund(ctx: Context<ClaimRefund>, bet_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let bet = &mut ctx.accounts.bet;
    require!(bet.bet_id == bet_id, ErrorCode::BetIdMismatch);
    require!(
        bet.status == crate::state::BetStatus::Disputed,
        ErrorCode::BadStatus
    );
    require!(now >= bet.dispute_deadline, ErrorCode::TooEarly);
    require!(bet.majority_outcomes().is_none(), ErrorCode::BadStatus);

    let count = bet.participant_count as usize;
    let mut amounts = [0u64; MAX_PARTICIPANTS];
    for amount in amounts.iter_mut().take(count) {
        *amount = bet.stake_amount;
    }
    bet.dispute_refundable = true;
    apply_claimable(bet, amounts);
    emit!(BetRefunded { bet: bet.key() });
    Ok(())
}
