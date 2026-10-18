use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Signer is not allowed to perform this action")]
    Unauthorized,
    #[msg("Stake amount must be greater than zero")]
    InvalidStake,
    #[msg("Deadlines or the dispute window are invalid")]
    InvalidWindow,
    #[msg("Participant count is outside the allowed range for this bet type")]
    InvalidParticipantCount,
    #[msg("Judges must be a unique odd set of 1 or 3")]
    InvalidJudgeSet,
    #[msg("Only the habit category is enabled in this version")]
    UnsupportedCategory,
    #[msg("This bet is not accepting another participant")]
    BetFull,
    #[msg("Wallet has already joined this bet")]
    AlreadyJoined,
    #[msg("A judge cannot also be a participant on the bet")]
    JudgeCannotParticipate,
    #[msg("The deadline for this action has passed")]
    DeadlinePassed,
    #[msg("This action cannot be taken yet")]
    TooEarly,
    #[msg("The bet is not in the required status")]
    BadStatus,
    #[msg("Bet id does not match this account")]
    BetIdMismatch,
    #[msg("Each outcome must be success or fail")]
    BadOutcome,
    #[msg("A dispute is already open")]
    AlreadyDisputed,
    #[msg("The dispute window is closed")]
    DisputeWindowClosed,
    #[msg("Signer is not a judge on this bet")]
    NotAJudge,
    #[msg("Judge has already voted")]
    AlreadyVoted,
    #[msg("Judges have not reached a majority")]
    NoMajority,
    #[msg("Judges can still vote")]
    VotesPending,
    #[msg("This wallet has nothing left to claim")]
    NothingToClaim,
    #[msg("This share was already claimed")]
    AlreadyClaimed,
    #[msg("Token account does not belong to the expected participant")]
    BadTokenAccount,
    #[msg("Checked math overflowed")]
    ArithmeticOverflow,
}
