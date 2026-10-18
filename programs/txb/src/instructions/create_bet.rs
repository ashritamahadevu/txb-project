use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    BET_SEED, CATEGORY_HABIT, CONFIG_SEED, MAX_JUDGES, MAX_PARTICIPANTS, VAULT_SEED,
};
use crate::error::ErrorCode;
use crate::state::{Bet, BetCreated, BetStatus, BetType, Config, CreateBetArgs};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct CreateBet<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = creator,
        space = 8 + Bet::INIT_SPACE,
        seeds = [BET_SEED, creator.key().as_ref(), &bet_id.to_le_bytes()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    #[account(
        init,
        payer = creator,
        token::mint = usdc_mint,
        token::authority = bet,
        seeds = [VAULT_SEED, bet.key().as_ref()],
        bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_bet(ctx: Context<CreateBet>, bet_id: u64, args: CreateBetArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(args.stake_amount > 0, ErrorCode::InvalidStake);
    require!(
        args.category == CATEGORY_HABIT,
        ErrorCode::UnsupportedCategory
    );
    require!(
        args.start_deadline > now && args.period_end > args.start_deadline,
        ErrorCode::InvalidWindow
    );
    let judge_count = args.judges.len();
    require!(
        judge_count == 1 || judge_count == 3,
        ErrorCode::InvalidJudgeSet
    );
    require!(judge_count <= MAX_JUDGES, ErrorCode::InvalidJudgeSet);
    for (index, judge) in args.judges.iter().enumerate() {
        require!(*judge != Pubkey::default(), ErrorCode::InvalidJudgeSet);
        require!(
            !args.judges[..index].contains(judge),
            ErrorCode::InvalidJudgeSet
        );
    }
    match args.bet_type {
        BetType::HeadToHead => {
            require!(
                args.required_participants == 2,
                ErrorCode::InvalidParticipantCount
            );
        }
        BetType::Pool => {
            require!(
                args.required_participants >= 2
                    && (args.required_participants as usize) <= MAX_PARTICIPANTS,
                ErrorCode::InvalidParticipantCount
            );
        }
    }

    let bet = &mut ctx.accounts.bet;
    bet.creator = ctx.accounts.creator.key();
    bet.bet_id = bet_id;
    bet.bet_type = args.bet_type;
    bet.status = BetStatus::Funding;
    bet.category = args.category;
    bet.stake_amount = args.stake_amount;
    bet.goal_hash = args.goal_hash;
    bet.start_deadline = args.start_deadline;
    bet.period_end = args.period_end;
    bet.dispute_window_seconds = ctx.accounts.config.dispute_window_seconds;
    bet.required_dispute_deposit = ctx.accounts.config.dispute_deposit;
    bet.required_participants = args.required_participants;
    bet.judge_count = u8::try_from(judge_count).map_err(|_| ErrorCode::InvalidJudgeSet)?;
    for (index, judge) in args.judges.iter().enumerate() {
        bet.judges[index] = *judge;
    }
    bet.bump = ctx.bumps.bet;
    bet.vault_bump = ctx.bumps.vault;

    emit!(BetCreated {
        bet: bet.key(),
        creator: bet.creator,
        bet_id,
        bet_type: bet.bet_type,
        stake_amount: bet.stake_amount,
        category: bet.category,
    });
    Ok(())
}
