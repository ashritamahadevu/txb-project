use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::constants::{BET_SEED, CONFIG_SEED, VAULT_SEED};
use crate::error::ErrorCode;
use crate::instructions::settle::{close_settled_bet, record_claim, transfer_from_vault};
use crate::state::{Bet, BetStatus, Config};

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct Claim<'info> {
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
        init_if_needed,
        payer = participant,
        associated_token::mint = usdc_mint,
        associated_token::authority = participant,
    )]
    pub participant_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim(ctx: Context<Claim>, bet_id: u64) -> Result<()> {
    require!(ctx.accounts.bet.bet_id == bet_id, ErrorCode::BetIdMismatch);
    require!(
        ctx.accounts.bet.status == BetStatus::Claimable,
        ErrorCode::BadStatus
    );
    let wallet = ctx.accounts.participant.key();
    let index = ctx
        .accounts
        .bet
        .participant_index(&wallet)
        .ok_or(ErrorCode::NothingToClaim)?;
    require!(!ctx.accounts.bet.claimed[index], ErrorCode::AlreadyClaimed);

    let amount = ctx.accounts.bet.claimable[index];
    let decimals = ctx.accounts.usdc_mint.decimals;
    ctx.accounts.bet.claimed[index] = true;
    ctx.accounts.bet.claimable[index] = 0;

    transfer_from_vault(
        &ctx.accounts.bet,
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.participant_ata.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        amount,
        decimals,
    )?;
    let bet_key = ctx.accounts.bet.key();
    record_claim(bet_key, wallet, amount);

    if ctx.accounts.bet.ready_to_close() {
        close_settled_bet(
            &ctx.accounts.bet,
            &mut ctx.accounts.vault,
            ctx.accounts.participant.to_account_info(),
            ctx.accounts.usdc_mint.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            decimals,
        )?;
    }
    Ok(())
}
