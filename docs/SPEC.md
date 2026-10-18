# TxB spec

Devnet prototype. Habits only. No fee sponsorship. No platform fee.

## Product loop

1. A person signs in by signing `TxB wants you to sign in\nWallet: <pubkey>\nNonce: <nonce>`, then confirms they are 18 or older.
2. They create a circle or join with an invite code. Roles are `owner`, `member`, and `judge`. One person can hold more than one role.
3. They open a habit bet. Head to head needs exactly two participants. A pool needs two to ten. Judges, when set, are circle members who are not participants, and the count is one or three.
4. Participants deposit USDC into a program-owned vault. The bet starts when every seat is filled and before the start deadline. After the deadline, anyone can cancel and refund.
5. During the period, a participant uploads a photo. The API strips metadata, stores the bytes off-chain, and keeps a sha256 plus a perceptual hash.
6. After the period, an authorized reporter submits one success or fail byte per participant and an evidence hash. A dispute window opens.
7. A member may challenge by posting the dispute deposit. Judges vote once each. A strict majority decides. If the majority matches the reporter, the deposit is added to the pot. If it overturns the reporter, the disputer claims the deposit back. If no majority forms before the deadline, everyone is refunded their stake and the disputer claims the deposit.
8. If nobody disputes, anyone can finalize after the window and each participant claims. If a bet is still active after the period plus the dispute window, anyone can refund the stakes.
9. The last claim closes the vault and the bet account. Rent goes to the closer.

Solana programs do not run on a timer. Every time-gated instruction is callable by anyone once the Clock sysvar says the deadline has passed.

## On-chain accounts

| Account | Seeds | Role |
| --- | --- | --- |
| Config | `["config"]` | Admin, reporter, USDC mint, dispute window, dispute deposit |
| Bet | `["bet", creator, bet_id_le]` | Goal hash, period, status, stake, participants, judges, result |
| Vault | `["vault", bet]` | USDC token account. Authority is the bet PDA |

Participants live on the bet account. The cap is 10 participants and 3 judges, so the account size is fixed. The category byte must be `0` (habit).

Statuses: `Funding`, `Active`, `Disputable`, `Disputed`, `Claimable`, `Closed`.

Outcomes: `0` pending, `1` success, `2` fail.

## Instructions

`initialize_config`, `update_config`, `create_bet`, `join_and_deposit`, `start_bet`, `cancel_and_refund`, `submit_result`, `open_dispute`, `judge_vote`, `finalize`, `refund_unresolved`, `claim_refund`, `claim`, `claim_dispute_deposit`.

`submit_result` requires the reporter stored on config. Admin can rotate the reporter, the admin, the window, and the deposit. The window must be greater than zero and at most seven days. Stake and dispute deposit must be greater than zero. Both are snapshotted onto the bet at creation.

## Payouts

Head to head, exactly one success: that person takes the stake pot plus any forfeited dispute deposit. Both the same outcome: the pot is split, and leftover base units go to the earliest seats.

Pool, everyone succeeds or everyone fails: each person is refunded their stake. Otherwise each winner receives their own stake plus an even share of the loser pot and any forfeited deposit. Leftover base units go to the earliest winners in participant order.

Claims transfer to the caller's associated USDC account, creating it in the same transaction when it is missing. The caller pays the rent and the network fee.

## Off-chain habit rule

A participant succeeds when the number of unflagged proofs inside the bet window is at least `proofsRequired`. Flagged proofs (perceptual hash within distance 8 of an earlier proof in the same circle) do not count. The evidence digest is a canonical JSON list of photo hashes and capture times.

The social bet status (`active`, then `resolved`) is the app mirror. `onChainBetId` and `onChainBetAddress` are optional until a client submits the matching transactions. The program is the source of truth for funds.

## Photo storage

Uploads are re-encoded to JPEG without metadata, resized to fit inside 1600 pixels, and written under `backend/uploads`. The public URL is `/uploads/<file>`. Location data is not kept. A report flag is stored on the proof. Judges are expected to read the photo and the hash together; the image itself is never an account field.

## What this version does not do

- It does not sponsor fees or create a relayer.
- It does not mint badges.
- It does not call Strava, GitHub, or Switchboard.
- It does not wire Phantom in the browser preview. The device key is only for the Expo web preview.
- It does not take a platform fee. A disclosed fee would be a later `finalize` change.
