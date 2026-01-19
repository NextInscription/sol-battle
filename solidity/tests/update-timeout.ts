import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BattleGame } from "../target/types/battle_game";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";

describe("Update Timeout Config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BattleGame as Program<BattleGame>;

  const feeBps = 500;
  const revealTimeoutSlots = 216000;       // 1天
  const noChallengerTimeoutSlots = 216000; // 1天

  it("Updates config to 1 day timeouts", async () => {
    const [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    console.log("当前配置值:");
    const currentConfig = await program.account.config.fetch(config);
    console.log("  revealTimeoutSlots:", currentConfig.revealTimeoutSlots.toString());
    console.log("  noChallengerTimeoutSlots:", currentConfig.noChallengerTimeoutSlots.toString());

    console.log("\n更新为 1 天超时 (216000 slots)...");

    // 使用 update_config 更新配置
    await program.methods
      .updateConfig(
        feeBps,
        new anchor.BN(revealTimeoutSlots),
        new anchor.BN(noChallengerTimeoutSlots)
      )
      .accounts({
        authority: provider.wallet.publicKey,
      })
      .rpc();

    console.log("✅ 配置已更新！");

    // 验证新配置
    const updatedConfig = await program.account.config.fetch(config);
    console.log("\n新配置值:");
    console.log("  feeBps:", updatedConfig.feeBps.toString());
    console.log("  revealTimeoutSlots:", updatedConfig.revealTimeoutSlots.toString());
    console.log("  noChallengerTimeoutSlots:", updatedConfig.noChallengerTimeoutSlots.toString());

    // 验证值
    assert.equal(updatedConfig.feeBps, feeBps);
    assert.equal(updatedConfig.revealTimeoutSlots.toNumber(), revealTimeoutSlots);
    assert.equal(updatedConfig.noChallengerTimeoutSlots.toNumber(), noChallengerTimeoutSlots);

    console.log("\n✅ 所有验证通过！");
    console.log("现在新的 battle 将使用 1 天超时时间。");
  });
});
