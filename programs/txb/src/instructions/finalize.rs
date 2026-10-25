use anchor_lang::prelude::*;

use crate::constants::BET_SEED;
use crate::error::ErrorCode;
use crate::instructions::settle::apply_claimable;
use crate::payout::compute_claimable;
use crate::state::{Bet, BetFinalized, BetStatus};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct Finalize<'info> {
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

pub fn handle_finalize(ctx: Context<Finalize>, bet_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.bet.bet_id == bet_id, ErrorCode::BetIdMismatch);

    let (outcomes, extra_pot, dispute_refundable) = {
        let bet = &ctx.accounts.bet;
        match bet.status {
            BetStatus::Disputable => {
                require!(now >= bet.dispute_deadline, ErrorCode::TooEarly);
                (bet.outcomes, 0, false)
            }
            BetStatus::Disputed => match bet.majority_outcomes() {
                Some(decided) => {
                    let count = bet.participant_count as usize;
                    let upheld = decided[..count] == bet.outcomes[..count];
                    let refundable = !upheld;
                    let extra = if refundable { 0 } else { bet.dispute_deposit };
                    (decided, extra, refundable)
                }
                None => {
                    require!(now >= bet.dispute_deadline, ErrorCode::VotesPending);
                    return err!(ErrorCode::NoMajority);
                }
            },
            _ => return err!(ErrorCode::BadStatus),
        }
    };

    let bet = &mut ctx.accounts.bet;
    let count = bet.participant_count as usize;
    bet.outcomes = outcomes;
    bet.dispute_refundable = dispute_refundable;
    let amounts = compute_claimable(
        bet.bet_type,
        bet.stake_amount,
        count,
        &bet.outcomes,
        extra_pot,
    )?;
    apply_claimable(bet, amounts);
    emit!(BetFinalized {
        bet: bet.key(),
        dispute_refundable,
    });
    Ok(())
}
