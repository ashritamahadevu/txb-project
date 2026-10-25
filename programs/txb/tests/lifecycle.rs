use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::AccountMeta, instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{
        get_spl_account, spl_token::state::Account as SplAccount, CreateAssociatedTokenAccount,
        CreateMint, MintTo, TOKEN_ID,
    },
    solana_clock::Clock,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const NOW: i64 = 1_700_000_000;
const WINDOW: i64 = 100;
const DEPOSIT: u64 = 1_000_000;

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    reporter: Keypair,
    mint: Pubkey,
    config: Pubkey,
}

fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar::<Clock>(&clock);
}

fn send(svm: &mut LiteSVM, payer: &Keypair, instruction: Instruction) {
    let blockhash = svm.latest_blockhash();
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[payer]).unwrap();
    if let Err(err) = svm.send_transaction(tx) {
        panic!("{}\n{}", err.err, err.meta.logs.join("\n"));
    }
}

fn send_expecting(svm: &mut LiteSVM, payer: &Keypair, instruction: Instruction, needle: &str) {
    let blockhash = svm.latest_blockhash();
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[payer]).unwrap();
    match svm.send_transaction(tx) {
        Ok(meta) => panic!("expected failure, logs:\n{}", meta.logs.join("\n")),
        Err(err) => {
            let logs = err.meta.logs.join("\n");
            assert!(
                logs.contains(needle),
                "logs did not contain {needle}:\n{logs}"
            );
        }
    }
}

fn load_bet(svm: &LiteSVM, address: &Pubkey) -> txb::Bet {
    let account = svm.get_account(address).expect("bet account");
    let mut data: &[u8] = &account.data;
    txb::Bet::try_deserialize(&mut data).unwrap()
}

fn token_balance(svm: &LiteSVM, ata: &Pubkey) -> u64 {
    get_spl_account::<SplAccount>(svm, ata).unwrap().amount
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/txb.so"));
    svm.add_program(txb::id(), bytes).unwrap();
    set_time(&mut svm, NOW);

    let admin = Keypair::new();
    let reporter = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&reporter.pubkey(), 2_000_000_000).unwrap();

    let admin_key = admin.pubkey();
    let mint = CreateMint::new(&mut svm, &admin)
        .authority(&admin_key)
        .decimals(6)
        .send()
        .unwrap_or_else(|err| panic!("{:?}\n{}", err.err, err.meta.logs.join("\n")));
    let (config, _) = Pubkey::find_program_address(&[txb::CONFIG_SEED], &txb::id());

    let ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::InitializeConfig {
            reporter: reporter.pubkey(),
            dispute_window_seconds: WINDOW,
            dispute_deposit: DEPOSIT,
        }
        .data(),
        txb::accounts::InitializeConfig {
            admin: admin.pubkey(),
            config,
            usdc_mint: mint,
            token_program: TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &admin, ix);

    Env {
        svm,
        admin,
        reporter,
        mint,
        config,
    }
}

fn fund(env: &mut Env, owner: &Pubkey, amount: u64) -> Pubkey {
    CreateAssociatedTokenAccount::new(&mut env.svm, &env.admin, &env.mint)
        .owner(owner)
        .send()
        .unwrap();
    let ata = anchor_spl::associated_token::get_associated_token_address(owner, &env.mint);
    MintTo::new(&mut env.svm, &env.admin, &env.mint, &ata, amount)
        .send()
        .unwrap();
    ata
}

fn user(env: &mut Env, amount: u64) -> (Keypair, Pubkey) {
    let keypair = Keypair::new();
    env.svm.airdrop(&keypair.pubkey(), 2_000_000_000).unwrap();
    let key = keypair.pubkey();
    let ata = fund(env, &key, amount);
    (keypair, ata)
}

fn bet_pda(creator: &Pubkey, bet_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[txb::BET_SEED, creator.as_ref(), &bet_id.to_le_bytes()],
        &txb::id(),
    )
    .0
}

fn vault_pda(bet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[txb::VAULT_SEED, bet.as_ref()], &txb::id()).0
}

fn create_bet(
    env: &mut Env,
    bet_id: u64,
    bet_type: txb::BetType,
    stake: u64,
    required: u8,
    judges: Vec<Pubkey>,
) -> Pubkey {
    let bet = bet_pda(&env.admin.pubkey(), bet_id);
    let vault = vault_pda(&bet);
    let ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::CreateBet {
            bet_id,
            args: txb::CreateBetArgs {
                bet_type,
                stake_amount: stake,
                goal_hash: [7u8; 32],
                category: txb::CATEGORY_HABIT,
                start_deadline: NOW + 1_000,
                period_end: NOW + 2_000,
                required_participants: required,
                judges,
            },
        }
        .data(),
        txb::accounts::CreateBet {
            creator: env.admin.pubkey(),
            config: env.config,
            bet,
            vault,
            usdc_mint: env.mint,
            token_program: TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &env.admin, ix);
    bet
}

fn join(env: &mut Env, bet_id: u64, bet: Pubkey, participant: &Keypair, ata: Pubkey) {
    let ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::JoinAndDeposit { bet_id }.data(),
        txb::accounts::JoinAndDeposit {
            participant: participant.pubkey(),
            config: env.config,
            creator: env.admin.pubkey(),
            bet,
            vault: vault_pda(&bet),
            participant_token: ata,
            usdc_mint: env.mint,
            token_program: TOKEN_ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, participant, ix);
}

fn start(env: &mut Env, bet_id: u64, bet: Pubkey) {
    let ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::StartBet { bet_id }.data(),
        txb::accounts::StartBet {
            payer: env.admin.pubkey(),
            creator: env.admin.pubkey(),
            bet,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &env.admin, ix);
}

fn submit(env: &mut Env, bet_id: u64, bet: Pubkey, outcomes: Vec<u8>) {
    let ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::SubmitResult {
            bet_id,
            outcomes,
            evidence_hash: [9u8; 32],
        }
        .data(),
        txb::accounts::SubmitResult {
            reporter: env.reporter.pubkey(),
            config: env.config,
            creator: env.admin.pubkey(),
            bet,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &env.reporter, ix);
}

fn finalize(env: &mut Env, bet_id: u64, bet: Pubkey) {
    let ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::Finalize { bet_id }.data(),
        txb::accounts::Finalize {
            payer: env.admin.pubkey(),
            creator: env.admin.pubkey(),
            bet,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &env.admin, ix);
}

fn claim(env: &mut Env, bet_id: u64, bet: Pubkey, participant: &Keypair, ata: Pubkey) {
    let ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::Claim { bet_id }.data(),
        txb::accounts::Claim {
            participant: participant.pubkey(),
            config: env.config,
            creator: env.admin.pubkey(),
            bet,
            vault: vault_pda(&bet),
            participant_ata: ata,
            usdc_mint: env.mint,
            token_program: TOKEN_ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, participant, ix);
}

#[test]
fn head_to_head_winner_takes_the_pot() {
    let mut env = setup();
    let (alice, alice_ata) = user(&mut env, 5_000_000);
    let (bob, bob_ata) = user(&mut env, 5_000_000);
    let judge = Keypair::new();
    let bet = create_bet(
        &mut env,
        1,
        txb::BetType::HeadToHead,
        1_000_000,
        2,
        vec![judge.pubkey()],
    );
    join(&mut env, 1, bet, &alice, alice_ata);
    join(&mut env, 1, bet, &bob, bob_ata);
    start(&mut env, 1, bet);

    set_time(&mut env.svm, NOW + 2_000);
    submit(
        &mut env,
        1,
        bet,
        vec![txb::OUTCOME_SUCCESS, txb::OUTCOME_FAIL],
    );
    set_time(&mut env.svm, NOW + 2_000 + WINDOW);
    finalize(&mut env, 1, bet);

    let state = load_bet(&env.svm, &bet);
    assert_eq!(state.claimable[0], 2_000_000);
    assert_eq!(state.claimable[1], 0);

    claim(&mut env, 1, bet, &alice, alice_ata);
    claim(&mut env, 1, bet, &bob, bob_ata);
    assert_eq!(token_balance(&env.svm, &alice_ata), 6_000_000);
    assert_eq!(token_balance(&env.svm, &bob_ata), 4_000_000);
    assert!(env.svm.get_account(&bet).is_none());
}

#[test]
fn pool_assigns_remainder_to_the_earliest_winners() {
    let mut env = setup();
    let judge = Keypair::new();
    let bet = create_bet(&mut env, 2, txb::BetType::Pool, 10, 4, vec![judge.pubkey()]);
    let mut people = Vec::new();
    for _ in 0..4 {
        people.push(user(&mut env, 100));
    }
    for (keypair, ata) in &people {
        join(&mut env, 2, bet, keypair, *ata);
    }
    start(&mut env, 2, bet);
    set_time(&mut env.svm, NOW + 2_000);
    submit(
        &mut env,
        2,
        bet,
        vec![
            txb::OUTCOME_SUCCESS,
            txb::OUTCOME_FAIL,
            txb::OUTCOME_SUCCESS,
            txb::OUTCOME_SUCCESS,
        ],
    );
    set_time(&mut env.svm, NOW + 2_000 + WINDOW);
    finalize(&mut env, 2, bet);
    let state = load_bet(&env.svm, &bet);
    assert_eq!(&state.claimable[..4], &[14, 0, 13, 13]);

    for (keypair, ata) in &people {
        claim(&mut env, 2, bet, keypair, *ata);
    }
    assert_eq!(token_balance(&env.svm, &people[0].1), 104);
    assert_eq!(token_balance(&env.svm, &people[1].1), 90);
    assert!(env.svm.get_account(&bet).is_none());
}

#[test]
fn overturned_dispute_returns_the_deposit() {
    let mut env = setup();
    let (alice, alice_ata) = user(&mut env, 5_000_000);
    let (bob, bob_ata) = user(&mut env, 5_000_000);
    let judge = Keypair::new();
    env.svm.airdrop(&judge.pubkey(), 1_000_000_000).unwrap();
    let bet = create_bet(
        &mut env,
        3,
        txb::BetType::HeadToHead,
        1_000_000,
        2,
        vec![judge.pubkey()],
    );
    join(&mut env, 3, bet, &alice, alice_ata);
    join(&mut env, 3, bet, &bob, bob_ata);
    start(&mut env, 3, bet);
    set_time(&mut env.svm, NOW + 2_000);
    submit(
        &mut env,
        3,
        bet,
        vec![txb::OUTCOME_SUCCESS, txb::OUTCOME_FAIL],
    );

    let dispute_ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::OpenDispute { bet_id: 3 }.data(),
        txb::accounts::OpenDispute {
            disputer: bob.pubkey(),
            config: env.config,
            creator: env.admin.pubkey(),
            bet,
            vault: vault_pda(&bet),
            disputer_token: bob_ata,
            usdc_mint: env.mint,
            token_program: TOKEN_ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &bob, dispute_ix);

    let vote_ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::JudgeVote {
            bet_id: 3,
            outcomes: vec![txb::OUTCOME_SUCCESS, txb::OUTCOME_SUCCESS],
        }
        .data(),
        txb::accounts::JudgeVote {
            judge: judge.pubkey(),
            creator: env.admin.pubkey(),
            bet,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &judge, vote_ix);
    finalize(&mut env, 3, bet);

    let state = load_bet(&env.svm, &bet);
    assert!(state.dispute_refundable);
    assert_eq!(state.claimable[0], 1_000_000);
    assert_eq!(state.claimable[1], 1_000_000);

    claim(&mut env, 3, bet, &alice, alice_ata);
    claim(&mut env, 3, bet, &bob, bob_ata);
    let deposit_ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::ClaimDisputeDeposit { bet_id: 3 }.data(),
        txb::accounts::ClaimDisputeDeposit {
            disputer: bob.pubkey(),
            config: env.config,
            creator: env.admin.pubkey(),
            bet,
            vault: vault_pda(&bet),
            disputer_ata: bob_ata,
            usdc_mint: env.mint,
            token_program: TOKEN_ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &bob, deposit_ix);
    assert_eq!(token_balance(&env.svm, &alice_ata), 5_000_000);
    assert_eq!(token_balance(&env.svm, &bob_ata), 5_000_000);
    assert!(env.svm.get_account(&bet).is_none());
}

#[test]
fn missed_judge_deadline_refunds_everyone() {
    let mut env = setup();
    let (alice, alice_ata) = user(&mut env, 2_000_000);
    let (bob, bob_ata) = user(&mut env, 3_000_000);
    let judge = Keypair::new();
    let bet = create_bet(
        &mut env,
        4,
        txb::BetType::HeadToHead,
        1_000_000,
        2,
        vec![judge.pubkey()],
    );
    join(&mut env, 4, bet, &alice, alice_ata);
    join(&mut env, 4, bet, &bob, bob_ata);
    start(&mut env, 4, bet);
    set_time(&mut env.svm, NOW + 2_000);
    submit(
        &mut env,
        4,
        bet,
        vec![txb::OUTCOME_FAIL, txb::OUTCOME_SUCCESS],
    );
    let dispute_ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::OpenDispute { bet_id: 4 }.data(),
        txb::accounts::OpenDispute {
            disputer: alice.pubkey(),
            config: env.config,
            creator: env.admin.pubkey(),
            bet,
            vault: vault_pda(&bet),
            disputer_token: alice_ata,
            usdc_mint: env.mint,
            token_program: TOKEN_ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &alice, dispute_ix);
    set_time(&mut env.svm, NOW + 2_000 + WINDOW);
    let refund_ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::ClaimRefund { bet_id: 4 }.data(),
        txb::accounts::ClaimRefund {
            payer: env.admin.pubkey(),
            creator: env.admin.pubkey(),
            bet,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &env.admin, refund_ix);
    claim(&mut env, 4, bet, &alice, alice_ata);
    claim(&mut env, 4, bet, &bob, bob_ata);
    let deposit_ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::ClaimDisputeDeposit { bet_id: 4 }.data(),
        txb::accounts::ClaimDisputeDeposit {
            disputer: alice.pubkey(),
            config: env.config,
            creator: env.admin.pubkey(),
            bet,
            vault: vault_pda(&bet),
            disputer_ata: alice_ata,
            usdc_mint: env.mint,
            token_program: TOKEN_ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &alice, deposit_ix);
    assert_eq!(token_balance(&env.svm, &alice_ata), 2_000_000);
    assert_eq!(token_balance(&env.svm, &bob_ata), 3_000_000);
}

#[test]
fn cancel_refunds_partial_funding() {
    let mut env = setup();
    let (alice, alice_ata) = user(&mut env, 4_000_000);
    let judge = Keypair::new();
    let bet = create_bet(
        &mut env,
        5,
        txb::BetType::HeadToHead,
        1_000_000,
        2,
        vec![judge.pubkey()],
    );
    join(&mut env, 5, bet, &alice, alice_ata);
    set_time(&mut env.svm, NOW + 1_001);
    let mut metas = txb::accounts::CancelAndRefund {
        payer: env.admin.pubkey(),
        config: env.config,
        creator: env.admin.pubkey(),
        bet,
        vault: vault_pda(&bet),
        usdc_mint: env.mint,
        token_program: TOKEN_ID,
    }
    .to_account_metas(None);
    metas.push(AccountMeta::new(alice_ata, false));
    let ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::CancelAndRefund { bet_id: 5 }.data(),
        metas,
    );
    send(&mut env.svm, &env.admin, ix);
    assert_eq!(token_balance(&env.svm, &alice_ata), 4_000_000);
    assert!(env.svm.get_account(&bet).is_none());
}

#[test]
fn unresolved_bet_refunds_after_the_grace_period() {
    let mut env = setup();
    let (alice, alice_ata) = user(&mut env, 2_000_000);
    let (bob, bob_ata) = user(&mut env, 2_000_000);
    let judge = Keypair::new();
    let bet = create_bet(
        &mut env,
        6,
        txb::BetType::Pool,
        500_000,
        2,
        vec![judge.pubkey()],
    );
    join(&mut env, 6, bet, &alice, alice_ata);
    join(&mut env, 6, bet, &bob, bob_ata);
    start(&mut env, 6, bet);
    set_time(&mut env.svm, NOW + 2_000 + WINDOW);
    let ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::RefundUnresolved { bet_id: 6 }.data(),
        txb::accounts::RefundUnresolved {
            payer: alice.pubkey(),
            creator: env.admin.pubkey(),
            bet,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &alice, ix);
    claim(&mut env, 6, bet, &alice, alice_ata);
    claim(&mut env, 6, bet, &bob, bob_ata);
    assert_eq!(token_balance(&env.svm, &alice_ata), 2_000_000);
    assert_eq!(token_balance(&env.svm, &bob_ata), 2_000_000);
    assert!(env.svm.get_account(&bet).is_none());
}

#[test]
fn a_judge_cannot_join_the_bet_they_judge() {
    let mut env = setup();
    let (alice, alice_ata) = user(&mut env, 2_000_000);
    let bet = create_bet(
        &mut env,
        7,
        txb::BetType::HeadToHead,
        1_000_000,
        2,
        vec![alice.pubkey()],
    );
    let ix = Instruction::new_with_bytes(
        txb::id(),
        &txb::instruction::JoinAndDeposit { bet_id: 7 }.data(),
        txb::accounts::JoinAndDeposit {
            participant: alice.pubkey(),
            config: env.config,
            creator: env.admin.pubkey(),
            bet,
            vault: vault_pda(&bet),
            participant_token: alice_ata,
            usdc_mint: env.mint,
            token_program: TOKEN_ID,
        }
        .to_account_metas(None),
    );
    send_expecting(
        &mut env.svm,
        &alice,
        ix,
        "A judge cannot also be a participant",
    );
}
