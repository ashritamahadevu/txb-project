use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const BET_SEED: &[u8] = b"bet";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

pub const MAX_PARTICIPANTS: usize = 10;
pub const MAX_JUDGES: usize = 3;

/// First shipped goal category. Photo proof is checked off-chain; the
/// program only stores the category byte and the evidence hash.
pub const CATEGORY_HABIT: u8 = 0;

pub const OUTCOME_PENDING: u8 = 0;
pub const OUTCOME_SUCCESS: u8 = 1;
pub const OUTCOME_FAIL: u8 = 2;

pub const MAX_DISPUTE_WINDOW_SECONDS: i64 = 7 * 24 * 60 * 60;
