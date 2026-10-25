use anchor_lang::prelude::*;

use crate::constants::{MAX_PARTICIPANTS, OUTCOME_FAIL, OUTCOME_SUCCESS};
use crate::error::ErrorCode;
use crate::state::BetType;

/// Split `total` across `count` seats. The earliest seats receive the
/// leftover base units from integer division, one each, until the
/// remainder is gone.
pub fn split_even(total: u64, count: usize) -> Result<[u64; MAX_PARTICIPANTS]> {
    require!(count > 0, ErrorCode::InvalidParticipantCount);
    let count_u64 = u64::try_from(count).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let share = total
        .checked_div(count_u64)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let remainder = total
        .checked_rem(count_u64)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let mut amounts = [0u64; MAX_PARTICIPANTS];
    for (index, amount) in amounts.iter_mut().enumerate().take(count) {
        let bonus = u64::from((index as u64) < remainder);
        *amount = share
            .checked_add(bonus)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    Ok(amounts)
}

pub fn compute_claimable(
    bet_type: BetType,
    stake: u64,
    count: usize,
    outcomes: &[u8],
    extra_pot: u64,
) -> Result<[u64; MAX_PARTICIPANTS]> {
    require!(
        count > 0 && count <= MAX_PARTICIPANTS,
        ErrorCode::InvalidParticipantCount
    );
    require!(outcomes.len() >= count, ErrorCode::BadOutcome);
    for outcome in &outcomes[..count] {
        require!(
            *outcome == OUTCOME_SUCCESS || *outcome == OUTCOME_FAIL,
            ErrorCode::BadOutcome
        );
    }

    let count_u64 = u64::try_from(count).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let stake_pot = stake
        .checked_mul(count_u64)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let total = stake_pot
        .checked_add(extra_pot)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let winner_indexes: Vec<usize> = (0..count)
        .filter(|index| outcomes[*index] == OUTCOME_SUCCESS)
        .collect();

    let refund_everyone = match bet_type {
        BetType::HeadToHead => {
            require!(count == 2, ErrorCode::InvalidParticipantCount);
            winner_indexes.len() != 1
        }
        BetType::Pool => winner_indexes.is_empty() || winner_indexes.len() == count,
    };

    if refund_everyone {
        return split_even(total, count);
    }

    if bet_type == BetType::HeadToHead {
        let mut amounts = [0u64; MAX_PARTICIPANTS];
        let winner = winner_indexes[0];
        amounts[winner] = total;
        return Ok(amounts);
    }

    let loser_count = count - winner_indexes.len();
    let loser_count_u64 = u64::try_from(loser_count).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let loser_pot = stake
        .checked_mul(loser_count_u64)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_add(extra_pot)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let winner_count_u64 =
        u64::try_from(winner_indexes.len()).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let share = loser_pot
        .checked_div(winner_count_u64)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let remainder = loser_pot
        .checked_rem(winner_count_u64)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let mut amounts = [0u64; MAX_PARTICIPANTS];
    for (order, index) in winner_indexes.into_iter().enumerate() {
        let bonus = u64::from((order as u64) < remainder);
        amounts[index] = stake
            .checked_add(share)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_add(bonus)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    Ok(amounts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn head_to_head_winner_takes_the_pot() {
        let amounts = compute_claimable(
            BetType::HeadToHead,
            5,
            2,
            &[OUTCOME_SUCCESS, OUTCOME_FAIL],
            0,
        )
        .unwrap();
        assert_eq!(&amounts[..2], &[10, 0]);
    }

    #[test]
    fn head_to_head_tie_refunds_and_gives_dust_to_the_earliest_seat() {
        let amounts = compute_claimable(
            BetType::HeadToHead,
            5,
            2,
            &[OUTCOME_SUCCESS, OUTCOME_SUCCESS],
            1,
        )
        .unwrap();
        assert_eq!(&amounts[..2], &[6, 5]);
        assert_eq!(amounts.iter().sum::<u64>(), 11);
    }

    #[test]
    fn pool_splits_loser_stakes_and_assigns_remainder_to_earliest_winners() {
        // Four participants, stake 10. One fails. Loser pot is 10.
        // Three winners: share 3, remainder 1. First winner gets the extra unit.
        let amounts = compute_claimable(
            BetType::Pool,
            10,
            4,
            &[
                OUTCOME_SUCCESS,
                OUTCOME_FAIL,
                OUTCOME_SUCCESS,
                OUTCOME_SUCCESS,
            ],
            0,
        )
        .unwrap();
        assert_eq!(&amounts[..4], &[14, 0, 13, 13]);
        assert_eq!(amounts.iter().sum::<u64>(), 40);
    }

    #[test]
    fn pool_refunds_when_everyone_fails() {
        let amounts = compute_claimable(
            BetType::Pool,
            10,
            3,
            &[OUTCOME_FAIL, OUTCOME_FAIL, OUTCOME_FAIL],
            0,
        )
        .unwrap();
        assert_eq!(&amounts[..3], &[10, 10, 10]);
    }

    #[test]
    fn forfeited_deposit_is_included_in_the_winner_pot() {
        let amounts =
            compute_claimable(BetType::Pool, 10, 2, &[OUTCOME_SUCCESS, OUTCOME_FAIL], 3).unwrap();
        assert_eq!(&amounts[..2], &[23, 0]);
    }
}
