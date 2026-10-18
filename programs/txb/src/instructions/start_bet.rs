use anchor_lang::prelude::*;

use crate::constants::BET_SEED;
use crate::error::ErrorCode;
use crate::state::{Bet, BetStarted, BetStatus};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct StartBet<'info> {
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

pub fn handle_start_bet(ctx: Context<StartBet>, bet_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let bet = &mut ctx.accounts.bet;
    require!(bet.bet_id == bet_id, ErrorCode::BetIdMismatch);
    require!(bet.status == BetStatus::Funding, ErrorCode::BadStatus);
    require!(now <= bet.start_deadline, ErrorCode::DeadlinePassed);
    require!(
        bet.participant_count == bet.required_participants,
        ErrorCode::BetFull
    );
    bet.status = BetStatus::Active;
    emit!(BetStarted { bet: bet.key() });
    Ok(())
}
