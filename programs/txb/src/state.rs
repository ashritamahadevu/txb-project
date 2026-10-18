use anchor_lang::prelude::*;

use crate::constants::MAX_PARTICIPANTS;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub reporter: Pubkey,
    pub usdc_mint: Pubkey,
    pub dispute_window_seconds: i64,
    pub dispute_deposit: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Bet {
    pub creator: Pubkey,
    pub bet_id: u64,
    pub bet_type: BetType,
    pub status: BetStatus,
    pub category: u8,
    pub stake_amount: u64,
    pub goal_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub start_deadline: i64,
    pub period_end: i64,
    /// Copied from config at creation so a later admin change cannot
    /// shorten or lengthen a bet that is already open.
    pub dispute_window_seconds: i64,
    pub dispute_deadline: i64,
    pub required_dispute_deposit: u64,
    pub required_participants: u8,
    pub participant_count: u8,
    pub judge_count: u8,
    pub participants: [Pubkey; MAX_PARTICIPANTS],
    pub deposited: [bool; MAX_PARTICIPANTS],
    pub outcomes: [u8; MAX_PARTICIPANTS],
    pub claimable: [u64; MAX_PARTICIPANTS],
    pub claimed: [bool; MAX_PARTICIPANTS],
    pub judges: [Pubkey; 3],
    pub judge_voted: [bool; 3],
    pub judge_votes: [[u8; MAX_PARTICIPANTS]; 3],
    pub disputer: Pubkey,
    pub dispute_deposit: u64,
    pub dispute_refundable: bool,
    pub dispute_claimed: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BetType {
    HeadToHead,
    Pool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BetStatus {
    Funding,
    Active,
    Disputable,
    Disputed,
    Claimable,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateBetArgs {
    pub bet_type: BetType,
    pub stake_amount: u64,
    pub goal_hash: [u8; 32],
    pub category: u8,
    pub start_deadline: i64,
    pub period_end: i64,
    pub required_participants: u8,
    pub judges: Vec<Pubkey>,
}

impl Bet {
    pub fn participant_index(&self, wallet: &Pubkey) -> Option<usize> {
        let count = self.participant_count as usize;
        self.participants[..count]
            .iter()
            .position(|key| key == wallet)
    }

    pub fn judge_index(&self, wallet: &Pubkey) -> Option<usize> {
        let count = self.judge_count as usize;
        self.judges[..count].iter().position(|key| key == wallet)
    }

    pub fn all_participants_claimed(&self) -> bool {
        let count = self.participant_count as usize;
        (0..count).all(|index| self.claimed[index])
    }

    pub fn dispute_settled(&self) -> bool {
        self.dispute_deposit == 0 || !self.dispute_refundable || self.dispute_claimed
    }

    pub fn ready_to_close(&self) -> bool {
        self.status == BetStatus::Claimable
            && self.all_participants_claimed()
            && self.dispute_settled()
    }

    /// A strict majority of submitted judge ballots. Ties and missing votes
    /// return none so the timeout refund can run.
    pub fn majority_outcomes(&self) -> Option<[u8; MAX_PARTICIPANTS]> {
        let need = (self.judge_count / 2) + 1;
        let count = self.participant_count as usize;
        for i in 0..self.judge_count as usize {
            if !self.judge_voted[i] {
                continue;
            }
            let mut tally = 0u8;
            for j in 0..self.judge_count as usize {
                if self.judge_voted[j]
                    && self.judge_votes[j][..count] == self.judge_votes[i][..count]
                {
                    tally = tally.saturating_add(1);
                }
            }
            if tally >= need {
                return Some(self.judge_votes[i]);
            }
        }
        None
    }
}

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub reporter: Pubkey,
    pub usdc_mint: Pubkey,
}

#[event]
pub struct BetCreated {
    pub bet: Pubkey,
    pub creator: Pubkey,
    pub bet_id: u64,
    pub bet_type: BetType,
    pub stake_amount: u64,
    pub category: u8,
}

#[event]
pub struct Deposited {
    pub bet: Pubkey,
    pub participant: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BetStarted {
    pub bet: Pubkey,
}

#[event]
pub struct ResultSubmitted {
    pub bet: Pubkey,
    pub evidence_hash: [u8; 32],
    pub dispute_deadline: i64,
}

#[event]
pub struct DisputeOpened {
    pub bet: Pubkey,
    pub disputer: Pubkey,
    pub deposit: u64,
}

#[event]
pub struct JudgeVoted {
    pub bet: Pubkey,
    pub judge: Pubkey,
}

#[event]
pub struct BetFinalized {
    pub bet: Pubkey,
    pub dispute_refundable: bool,
}

#[event]
pub struct Claimed {
    pub bet: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BetCancelled {
    pub bet: Pubkey,
}

#[event]
pub struct BetRefunded {
    pub bet: Pubkey,
}
