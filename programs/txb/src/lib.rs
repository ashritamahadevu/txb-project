pub mod constants;
pub mod error;
pub mod instructions;
pub mod payout;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("GVfgvXJs5GKw3WPRHJPQrfNWsp9gvbxxKT32tJqTA6e8");

#[program]
pub mod txb {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        reporter: Pubkey,
        dispute_window_seconds: i64,
        dispute_deposit: u64,
    ) -> Result<()> {
        instructions::initialize_config::handle_initialize_config(
            ctx,
            reporter,
            dispute_window_seconds,
            dispute_deposit,
        )
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        reporter: Pubkey,
        dispute_window_seconds: i64,
        dispute_deposit: u64,
        new_admin: Pubkey,
    ) -> Result<()> {
        instructions::update_config::handle_update_config(
            ctx,
            reporter,
            dispute_window_seconds,
            dispute_deposit,
            new_admin,
        )
    }

    pub fn create_bet(ctx: Context<CreateBet>, bet_id: u64, args: CreateBetArgs) -> Result<()> {
        instructions::create_bet::handle_create_bet(ctx, bet_id, args)
    }

    pub fn join_and_deposit(ctx: Context<JoinAndDeposit>, bet_id: u64) -> Result<()> {
        instructions::join_and_deposit::handle_join_and_deposit(ctx, bet_id)
    }

    pub fn start_bet(ctx: Context<StartBet>, bet_id: u64) -> Result<()> {
        instructions::start_bet::handle_start_bet(ctx, bet_id)
    }

    pub fn cancel_and_refund<'a>(ctx: Context<'a, CancelAndRefund<'a>>, bet_id: u64) -> Result<()> {
        instructions::cancel_and_refund::handle_cancel_and_refund(ctx, bet_id)
    }

    pub fn submit_result(
        ctx: Context<SubmitResult>,
        bet_id: u64,
        outcomes: Vec<u8>,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        instructions::submit_result::handle_submit_result(ctx, bet_id, outcomes, evidence_hash)
    }

    pub fn open_dispute(ctx: Context<OpenDispute>, bet_id: u64) -> Result<()> {
        instructions::open_dispute::handle_open_dispute(ctx, bet_id)
    }

    pub fn judge_vote(ctx: Context<JudgeVote>, bet_id: u64, outcomes: Vec<u8>) -> Result<()> {
        instructions::judge_vote::handle_judge_vote(ctx, bet_id, outcomes)
    }

    pub fn finalize(ctx: Context<Finalize>, bet_id: u64) -> Result<()> {
        instructions::finalize::handle_finalize(ctx, bet_id)
    }

    pub fn refund_unresolved(ctx: Context<RefundUnresolved>, bet_id: u64) -> Result<()> {
        instructions::refund_unresolved::handle_refund_unresolved(ctx, bet_id)
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>, bet_id: u64) -> Result<()> {
        instructions::claim_refund::handle_claim_refund(ctx, bet_id)
    }

    pub fn claim(ctx: Context<Claim>, bet_id: u64) -> Result<()> {
        instructions::claim::handle_claim(ctx, bet_id)
    }

    pub fn claim_dispute_deposit(ctx: Context<ClaimDisputeDeposit>, bet_id: u64) -> Result<()> {
        instructions::claim_dispute_deposit::handle_claim_dispute_deposit(ctx, bet_id)
    }
}
