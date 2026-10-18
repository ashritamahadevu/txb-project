use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{BET_SEED, CONFIG_SEED, VAULT_SEED};
use crate::error::ErrorCode;
use crate::state::{Bet, BetStatus, Config, Deposited};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct JoinAndDeposit<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
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
        token::authority = participant,
    )]
    pub participant_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_join_and_deposit(ctx: Context<JoinAndDeposit>, bet_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let participant = ctx.accounts.participant.key();
    require!(ctx.accounts.bet.bet_id == bet_id, ErrorCode::BetIdMismatch);
    require!(
        ctx.accounts.bet.status == BetStatus::Funding,
        ErrorCode::BadStatus
    );
    require!(
        now <= ctx.accounts.bet.start_deadline,
        ErrorCode::DeadlinePassed
    );
    require!(
        ctx.accounts.bet.participant_count < ctx.accounts.bet.required_participants,
        ErrorCode::BetFull
    );
    require!(
        ctx.accounts.bet.participant_index(&participant).is_none(),
        ErrorCode::AlreadyJoined
    );
    require!(
        ctx.accounts.bet.judge_index(&participant).is_none(),
        ErrorCode::JudgeCannotParticipate
    );

    let amount = ctx.accounts.bet.stake_amount;
    let decimals = ctx.accounts.usdc_mint.decimals;
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.participant_token.to_account_info(),
        mint: ctx.accounts.usdc_mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.participant.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts),
        amount,
        decimals,
    )?;

    let bet = &mut ctx.accounts.bet;
    let index = bet.participant_count as usize;
    bet.participants[index] = participant;
    bet.deposited[index] = true;
    bet.participant_count = bet
        .participant_count
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    emit!(Deposited {
        bet: bet.key(),
        participant,
        amount,
    });
    Ok(())
}
