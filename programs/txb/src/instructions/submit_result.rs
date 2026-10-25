use anchor_lang::prelude::*;

use crate::constants::{BET_SEED, CONFIG_SEED, OUTCOME_FAIL, OUTCOME_SUCCESS};
use crate::error::ErrorCode;
use crate::state::{Bet, BetStatus, Config, ResultSubmitted};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct SubmitResult<'info> {
    pub reporter: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = reporter)]
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
}

pub fn handle_submit_result(
    ctx: Context<SubmitResult>,
    bet_id: u64,
    outcomes: Vec<u8>,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let bet = &mut ctx.accounts.bet;
    require!(bet.bet_id == bet_id, ErrorCode::BetIdMismatch);
    require!(bet.status == BetStatus::Active, ErrorCode::BadStatus);
    require!(now >= bet.period_end, ErrorCode::TooEarly);
    let count = bet.participant_count as usize;
    require!(outcomes.len() == count, ErrorCode::BadOutcome);
    for (index, outcome) in outcomes.iter().enumerate() {
        require!(
            *outcome == OUTCOME_SUCCESS || *outcome == OUTCOME_FAIL,
            ErrorCode::BadOutcome
        );
        bet.outcomes[index] = *outcome;
    }
    bet.evidence_hash = evidence_hash;
    bet.dispute_deadline = now
        .checked_add(bet.dispute_window_seconds)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    bet.status = BetStatus::Disputable;
    let bet_key = bet.key();
    let dispute_deadline = bet.dispute_deadline;
    emit!(ResultSubmitted {
        bet: bet_key,
        evidence_hash,
        dispute_deadline,
    });
    Ok(())
}
