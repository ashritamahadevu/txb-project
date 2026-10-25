use anchor_lang::prelude::*;

use crate::constants::{BET_SEED, OUTCOME_FAIL, OUTCOME_SUCCESS};
use crate::error::ErrorCode;
use crate::state::{Bet, BetStatus, JudgeVoted};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct JudgeVote<'info> {
    pub judge: Signer<'info>,
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

pub fn handle_judge_vote(ctx: Context<JudgeVote>, bet_id: u64, outcomes: Vec<u8>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let judge = ctx.accounts.judge.key();
    let bet = &mut ctx.accounts.bet;
    require!(bet.bet_id == bet_id, ErrorCode::BetIdMismatch);
    require!(bet.status == BetStatus::Disputed, ErrorCode::BadStatus);
    require!(now < bet.dispute_deadline, ErrorCode::DisputeWindowClosed);
    let index = bet.judge_index(&judge).ok_or(ErrorCode::NotAJudge)?;
    require!(!bet.judge_voted[index], ErrorCode::AlreadyVoted);
    let count = bet.participant_count as usize;
    require!(outcomes.len() == count, ErrorCode::BadOutcome);
    for (seat, outcome) in outcomes.iter().enumerate() {
        require!(
            *outcome == OUTCOME_SUCCESS || *outcome == OUTCOME_FAIL,
            ErrorCode::BadOutcome
        );
        bet.judge_votes[index][seat] = *outcome;
    }
    bet.judge_voted[index] = true;
    emit!(JudgeVoted {
        bet: bet.key(),
        judge,
    });
    Ok(())
}
