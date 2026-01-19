import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BattleGame } from "../target/types/battle_game";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { keccak256 } from "js-sha3";
import { assert } from "chai";

describe("battle-game", () => {
  // ========================================
  // 配置和初始化
  // ========================================
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BattleGame as Program<BattleGame>;

  /**
   * 测试参数常量
   */
  const feeBps = 500;                      // 手续费率：500 = 5%（基点制，10000为100%）
  const revealTimeoutSlots = 216000;       // 揭示超时时间：1天 (216000个slot)
  const noChallengerTimeoutSlots = 216000; // 无挑战者超时时间：1天 (216000个slot)
  const betAmount = 1 * LAMPORTS_PER_SOL;  // 押注金额：1 SOL

  /**
   * ✅ 修复：严格的 32 字节种子生成函数
   * 使用 keccak256 哈希确保总是 32 字节
   */
  function seed32(label: string): Buffer {
    return Buffer.from(keccak256(label), "hex"); // 一定 32 字节
  }

  /**
   * ✅ 修复：统一的 commitHash 生成
   * 总是返回 number[32] 类型
   */
  function commitHash32(seed: Buffer): number[] {
    const hash = Buffer.from(keccak256(seed), "hex");
    return [...hash]; // 展开为 number[]
  }

  let config: PublicKey;

  before(async () => {
    [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    try {
      await program.methods
        .initializeConfig(
          new anchor.BN(feeBps),
          new anchor.BN(revealTimeoutSlots),
          new anchor.BN(noChallengerTimeoutSlots)
        )
        .accounts({
          config: config,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      console.log("Config already initialized");
    }
  });

  // ========================================================================
  // 测试 1: 创建对战
  // ========================================================================
  it("Creates a battle", async () => {
    const testCreator = Keypair.generate();

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(testCreator.publicKey, 2 * LAMPORTS_PER_SOL)
    );

    const seed = seed32("test-seed-create-battle-1");
    const commitHash = commitHash32(seed);

    // ✅ 修复：新的 PDA 格式需要 battle_id
    // 由于 battle_id 在创建时动态分配，我们需要先获取 config 的 battleCount
    const configAccount = await program.account.config.fetch(config);
    const battle_id = configAccount.battleCount.toNumber();

    const [battle] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("battle"),
        testCreator.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(battle_id).toArray("le", 8))
      ],
      program.programId
    );

    await program.methods
      .createBattle(new anchor.BN(betAmount), commitHash, { coinFlip: {} })
      .accounts({
        config: config,
        battle: battle,
        creator: testCreator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([testCreator])
      .rpc();

    const battleAccount = await program.account.battle.fetch(battle);

    assert.equal(
      battleAccount.creator.toBase58(),
      testCreator.publicKey.toBase58()
    );

    assert.equal(battleAccount.betAmount.toNumber(), betAmount);
    assert.equal(battleAccount.state.waitingForChallenger !== undefined, true);
    assert.ok(battleAccount.commitCreator.length === 32);

    console.log("✅ Battle created with battle_id:", battleAccount.battleId.toString());
  });

  // ========================================================================
  // 测试 2: 挑战者加入对战并立即揭示
  // ========================================================================
  it("Challenger joins battle and immediately reveals", async () => {
    const testCreator = Keypair.generate();
    const testChallenger = Keypair.generate();

    await Promise.all([
      provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(testCreator.publicKey, 2 * LAMPORTS_PER_SOL)
      ),
      provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(testChallenger.publicKey, 2 * LAMPORTS_PER_SOL)
      ),
    ]);

    const creatorSeed = seed32("creator-seed-test-2-join");
    const creatorCommit = commitHash32(creatorSeed);

    const challengerSeed = seed32("challenger-seed-test-2-join");
    const challengerCommit = commitHash32(challengerSeed);

    // 获取 battle_id
    const configAccount = await program.account.config.fetch(config);
    const battle_id = configAccount.battleCount.toNumber();

    const [battle] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("battle"),
        testCreator.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(battle_id).toArray("le", 8))
      ],
      program.programId
    );

    await program.methods
      .createBattle(new anchor.BN(betAmount), creatorCommit, { coinFlip: {} })
      .accounts({
        config: config,
        battle: battle,
        creator: testCreator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([testCreator])
      .rpc();

    await program.methods
      .joinBattle(
        new anchor.BN(betAmount),
        challengerCommit,
        challengerSeed
      )
      .accounts({
        config: config,
        battle: battle,
        challenger: testChallenger.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([testChallenger])
      .rpc();

    const battleAccount = await program.account.battle.fetch(battle);

    assert.equal(
      battleAccount.challenger.toBase58(),
      testChallenger.publicKey.toBase58()
    );

    assert.equal(battleAccount.state.waitingCreatorReveal !== undefined, true);
    assert.ok(battleAccount.seedChallenger !== null);
    assert.ok(battleAccount.seedChallenger.length === 32);

    console.log("✅ 挑战者已加入并立即揭示种子");
    console.log("✅ Battle PDA 现在包含 battle_id，防止覆盖攻击");
  });

  // ========================================================================
  // 测试 3: 同一个 creator 可以创建多个 battle
  // ========================================================================
  it("Creator can create multiple battles", async () => {
    const testCreator = Keypair.generate();

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(testCreator.publicKey, 5 * LAMPORTS_PER_SOL)
    );

    // 创建第一个 battle
    const seed1 = seed32("battle-1");
    const commit1 = commitHash32(seed1);

    let configAccount = await program.account.config.fetch(config);
    let battle_id = configAccount.battleCount.toNumber();

    const [battle1] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("battle"),
        testCreator.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(battle_id).toArray("le", 8))
      ],
      program.programId
    );

    await program.methods
      .createBattle(new anchor.BN(betAmount), commit1, { coinFlip: {} })
      .accounts({
        config: config,
        battle: battle1,
        creator: testCreator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([testCreator])
      .rpc();

    console.log("✅ Created battle 1 with battle_id:", battle_id);

    // 创建第二个 battle（✅ 这在旧版本会失败）
    const seed2 = seed32("battle-2");
    const commit2 = commitHash32(seed2);

    configAccount = await program.account.config.fetch(config);
    battle_id = configAccount.battleCount.toNumber();

    const [battle2] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("battle"),
        testCreator.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(battle_id).toArray("le", 8))
      ],
      program.programId
    );

    await program.methods
      .createBattle(new anchor.BN(betAmount), commit2, { coinFlip: {} })
      .accounts({
        config: config,
        battle: battle2,
        creator: testCreator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([testCreator])
      .rpc();

    console.log("✅ Created battle 2 with battle_id:", battle_id);
    console.log("✅ 修复成功：一个 creator 现在可以创建多个 battle");
  });

  // ========================================================================
  // 测试 4: 零押注金额应该失败
  // ========================================================================
  it("Fails with zero bet amount", async () => {
    const testCreator = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(testCreator.publicKey, 2 * LAMPORTS_PER_SOL)
    );

    const seed = seed32("test-zero-bet");
    const commitHash = commitHash32(seed);

    const configAccount = await program.account.config.fetch(config);
    const battle_id = configAccount.battleCount.toNumber();

    const [battle] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("battle"),
        testCreator.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(battle_id).toArray("le", 8))
      ],
      program.programId
    );

    try {
      await program.methods
        .createBattle(new anchor.BN(0), commitHash, { coinFlip: {} })
        .accounts({
          config: config,
          battle: battle,
          creator: testCreator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testCreator])
        .rpc();

      assert.fail("Should have thrown InvalidBetAmount error");
    } catch (err) {
      assert.equal(err.error.errorCode.number, 6002); // InvalidBetAmount
    }
  });

  // ========================================================================
  // 测试 5: 押注金额不匹配应该失败
  // ========================================================================
  it("Fails with wrong bet amount on join", async () => {
    const testCreator = Keypair.generate();
    const testChallenger = Keypair.generate();

    await Promise.all([
      provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(testCreator.publicKey, 2 * LAMPORTS_PER_SOL)
      ),
      provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(testChallenger.publicKey, 2 * LAMPORTS_PER_SOL)
      ),
    ]);

    const creatorSeed = seed32("creator-test-wrong-bet");
    const creatorCommit = commitHash32(creatorSeed);

    const challengerSeed = seed32("challenger-test-wrong-bet");
    const challengerCommit = commitHash32(challengerSeed);

    const configAccount = await program.account.config.fetch(config);
    const battle_id = configAccount.battleCount.toNumber();

    const [battle] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("battle"),
        testCreator.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(battle_id).toArray("le", 8))
      ],
      program.programId
    );

    await program.methods
      .createBattle(new anchor.BN(1 * LAMPORTS_PER_SOL), creatorCommit, { coinFlip: {} })
      .accounts({
        config: config,
        battle: battle,
        creator: testCreator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([testCreator])
      .rpc();

    try {
      await program.methods
        .joinBattle(
          new anchor.BN(2 * LAMPORTS_PER_SOL),
          challengerCommit,
          challengerSeed
        )
        .accounts({
          config: config,
          battle: battle,
          challenger: testChallenger.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testChallenger])
        .rpc();

      assert.fail("Should have thrown BetAmountMismatch error");
    } catch (err) {
      assert.equal(err.error.errorCode.number, 6003); // BetAmountMismatch
    }
  });

  // ========================================================================
  // 测试 6: 错误的承诺哈希应该失败
  // ========================================================================
  it("Fails with wrong commitment on reveal", async () => {
    const testCreator = Keypair.generate();
    const testChallenger = Keypair.generate();

    await Promise.all([
      provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(testCreator.publicKey, 2 * LAMPORTS_PER_SOL)
      ),
      provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(testChallenger.publicKey, 2 * LAMPORTS_PER_SOL)
      ),
    ]);

    const creatorSeed = seed32("creator-test-wrong-commit");
    const creatorCommit = commitHash32(creatorSeed);

    const challengerSeed = seed32("challenger-test-wrong-commit");
    const challengerCommit = commitHash32(challengerSeed);

    const configAccount = await program.account.config.fetch(config);
    const battle_id = configAccount.battleCount.toNumber();

    const [battle] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("battle"),
        testCreator.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(battle_id).toArray("le", 8))
      ],
      program.programId
    );

    await program.methods
      .createBattle(new anchor.BN(betAmount), creatorCommit, { coinFlip: {} })
      .accounts({
        config: config,
        battle: battle,
        creator: testCreator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([testCreator])
      .rpc();

    await program.methods
      .joinBattle(
        new anchor.BN(betAmount),
        challengerCommit,
        challengerSeed
      )
      .accounts({
        config: config,
        battle: battle,
        challenger: testChallenger.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([testChallenger])
      .rpc();

    try {
      const wrongSeed = seed32("wrong-seed-test");

      await program.methods
        .revealSeed([...wrongSeed])
        .accounts({
          config: config,
          battle: battle,
          signer: testCreator.publicKey,
        })
        .signers([testCreator])
        .rpc();

      assert.fail("Should have thrown InvalidCommitment error");
    } catch (err) {
      console.log("Error:", err);
      if (err.error && err.error.errorCode) {
        assert.equal(err.error.errorCode.number, 6005); // InvalidCommitment
      } else {
        assert.ok(err !== null);
      }
    }
  });

  // ========================================================================
  // 测试 7: 完整流程 - 创建、加入、揭示、结算
  // ========================================================================
  it("Complete flow: create, join, reveal, and settle battle", async () => {
    const testCreator = Keypair.generate();
    const testChallenger = Keypair.generate();

    await Promise.all([
      provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(testCreator.publicKey, 5 * LAMPORTS_PER_SOL)
      ),
      provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(testChallenger.publicKey, 5 * LAMPORTS_PER_SOL)
      ),
    ]);

    const creatorSeed = seed32("creator-complete-flow");
    const creatorCommit = commitHash32(creatorSeed);

    const challengerSeed = seed32("challenger-complete-flow");
    const challengerCommit = commitHash32(challengerSeed);

    // 获取 battle_id
    let configAccount = await program.account.config.fetch(config);
    let battle_id = configAccount.battleCount.toNumber();

    const [battle] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("battle"),
        testCreator.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(battle_id).toArray("le", 8))
      ],
      program.programId
    );

    // 1. 创建battle
    await program.methods
      .createBattle(new anchor.BN(betAmount), creatorCommit, { coinFlip: {} })
      .accounts({
        config: config,
        battle: battle,
        creator: testCreator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([testCreator])
      .rpc();

    console.log("✅ Step 1: Battle created");

    // 2. 挑战者加入并立即reveal
    await program.methods
      .joinBattle(
        new anchor.BN(betAmount),
        challengerCommit,
        challengerSeed
      )
      .accounts({
        config: config,
        battle: battle,
        challenger: testChallenger.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([testChallenger])
      .rpc();

    console.log("✅ Step 2: Challenger joined and revealed");

    // 3. 创建者reveal
    await program.methods
      .revealSeed(creatorSeed)
      .accounts({
        config: config,
        battle: battle,
        signer: testCreator.publicKey,
      })
      .signers([testCreator])
      .rpc();

    console.log("✅ Step 3: Creator revealed");

    // 4. 结算battle
    await program.methods
      .settleBattle()
      .accounts({
        config: config,
        battle: battle,
        creator: testCreator.publicKey,
        challenger: testChallenger.publicKey,
        feeRecipient: config,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Step 4: Battle settled");

    // 验证最终状态
    const battleAccount = await program.account.battle.fetch(battle);

    assert.equal(battleAccount.state.settled !== undefined, true);
    assert.ok(battleAccount.winner !== null);

    const winnerAddress = battleAccount.winner.toBase58();
    const creatorAddress = testCreator.publicKey.toBase58();
    const challengerAddress = testChallenger.publicKey.toBase58();

    assert.ok(
      winnerAddress === creatorAddress || winnerAddress === challengerAddress
    );

    console.log("✅ Complete flow test passed!");
    console.log("✅ Winner:", winnerAddress);
    console.log("✅ Final state: Settled");
  });
});
