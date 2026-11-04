# TxB

Friends stake USDC on each other's habits. A Solana program holds the stake. The app checks a photo, a dispute window lets the circle overrule the result, and each winner claims their share.

This repository is the devnet prototype: an Anchor program, a Node API, and an Expo app. The first version does not move mainnet funds.

## Decisions for this version

- Network is Solana devnet. Local program tests run in LiteSVM and never touch a cluster.
- The first goal category is habits, verified by an in-app photo.
- The app is mobile-first (Expo). The browser build is the preview used for the core loop.
- Users pay their own SOL network fees. TxB does not sponsor fees.
- Head-to-head and pool bets both use a claim model. Each person withdraws their own share.
- When a split leaves a remainder, the earliest participants receive one extra base unit each.
- There is no house edge and no platform fee.
- Photos stay off-chain. The result record stores a hash.
- You must confirm you are 18 or older before opening a bet.

This is not legal advice. Staking on an outcome can be regulated as gambling. Have a lawyer review the product before any real-money launch.

## Layout

| Path | What it is |
| --- | --- |
| `programs/txb` | Anchor program: escrow, disputes, claims |
| `idl/txb.json` | Generated IDL |
| `keys/txb-keypair.json` | Throwaway devnet program keypair |
| `backend` | API, Postgres schema, photo checks |
| `mobile` | Expo app (routes in `src/app`) |
| `docs/SPEC.md` | Account layout, payout rules, and API |

## Program

Program id: `GVfgvXJs5GKw3WPRHJPQrfNWsp9gvbxxKT32tJqTA6e8`

`keys/txb-keypair.json` is a throwaway key committed so a fresh clone can rebuild the same program id. Rotate it before any mainnet deploy. Do not fund it with real SOL beyond what a devnet airdrop costs.

Tests load an SBPF v2 binary because LiteSVM 0.10 rejects the v3 ELF that `anchor build` emits by default. Devnet builds should stay on v3. Run the suite with the v2 override:

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
ANCHOR_BUILD_SBF_ARCH=v2 anchor test
```

`Anchor.toml` sets `skip_local_validator = true`, so Anchor does not start surfpool. The script is `cargo test -- --test-threads=1`.

A devnet USDC mint often used by Circle is `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Confirm it before funding anything. Tests mint their own 6-decimal token inside LiteSVM. The config account stores whichever mint you pass to `initialize_config`.

## API

Postgres 16, role `txb`, password `txb`, database `txb`.

```bash
cd backend
cp .env.example .env
npm install
npx prisma db push
npm start
```

The API listens on port 4000. The demo reporter key is `dev-reporter` (`x-reporter-key`). `POST /v1/bets/:id/resolve` with `{ "early": true }` closes a period before `periodEnd`, and only that key is accepted. The same key on `POST /v1/bets/:id/dispute/close` ends the dispute window early. Sign-in is a Sign-In With Solana style message, verified with tweetnacl.

A bet takes `periodMinutes` (5 minutes through 90 days) or `periodHours`, and an optional `disputeWindowMinutes` (5 minutes through 7 days, default 1 day). Head to head is two people. A pool is two to ten, chosen with `participantIds`. Judges, when set, are one or three circle members who are not in the bet. `POST /v1/circles/:id/practice-partner` adds another practice partner, up to nine. After the reporter resolves a bet, a member can `POST /v1/bets/:id/dispute`, then `POST /v1/bets/:id/votes` with one success or fail per participant. A strict majority overturns or upholds the reporter. The circle owner can send `asUserId` to cast that ballot for a practice partner; the ballot is stored as a demo vote. `PATCH /v1/me` sets the display name. `POST /v1/me/wallet` changes the public key and returns a new session.

```bash
cd backend
DATABASE_URL=postgresql://txb:txb@localhost:5432/txb_test npm test
```

## App

```bash
cd mobile
npm install
npx expo start
```

`EXPO_PUBLIC_API_URL` defaults to `http://localhost:4000`. Phantom, Solflare, and Backpack are the wallets for a device build (Wallet Adapter on web, Mobile Wallet Adapter on Android). The browser preview keeps an ed25519 key on the device so the loop can be signed without a wallet extension. The Wallet screen shows that key and the display name, and can paste a different public key or generate a new device key.

In a circle you own, "Add a practice partner" adds a member with no device of their own, up to nine, so a bet can be opened from one browser. The names run "Practice partner", then "Practice partner 2".

## Demo walkthrough

Use one browser. Start the API, then from `mobile` run `npx expo start` and open the web preview.

1. Confirm you are 18 or older and continue. Create a circle.
2. Add a practice partner twice. The circle lists "Practice partner" and "Practice partner 2".
3. Open a habit bet. Select yourself and Practice partner. Leave Practice partner 2 unchecked so they can vote. Pick a period: 5 minutes, 1 day, 3 days, 1 week, 2 weeks, or a custom number of days. Leave judges unset. With three or more people selected, the bet is a pool (up to ten).
4. Open the bet, add a photo, then press "Close the period (devnet demo)". You succeeded. The practice partner who posted nothing failed. That is the reporter's result, and the dispute window is open.
5. Press "Open a dispute". For each person, choose success or fail, then press "Demo: vote as Practice partner 2". The ballot is labeled as a demo vote you cast for that practice partner.
6. One eligible voter is a strict majority, so the bet screen shows the final result immediately. Matching the reporter upholds it. Any difference overturns it, and the list shows the new outcome next to what the reporter said.
7. Press "Close dispute window (demo)" instead of opening a dispute and the reporter's result stands. To show a refund, assign three judges, cast only one of their votes, and close the window so no strict majority forms. A 5-minute dispute window is the short option if you would rather wait it out.

Wallet, in the header and on Circles, is the public key and display name. Saving a name updates the circle. Generating a device key signs this account in as that key. Pasting a public key switches the address and refreshes the session. Phone builds use Phantom, Solflare, or Backpack. This preview does not connect an extension.
