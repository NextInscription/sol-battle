import { Connection, PublicKey, TransactionInstruction, Transaction, SystemProgram } from '@solana/web3.js';
import { keccak256 } from 'js-sha3';
import { BN } from '@coral-xyz/anchor';

import { PROGRAM_ID } from '../config/network';
const PROGRAM_ID_PUBKEY = new PublicKey(PROGRAM_ID);

/**
 * Generate a proper random seed (32 bytes)
 */
export function generateRandomSeed(): Buffer {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return Buffer.from(seed);
}

/**
 * Get discriminator for "create_battle" instruction from IDL
 * From IDL: [2, 249, 54, 216, 42, 99, 187, 102]
 */
function getCreateBattleDiscriminator(): Buffer {
  return Buffer.from([2, 249, 54, 216, 42, 99, 187, 102]);
}

/**
 * Create a battle on chain (manual transaction building)
 */
export async function createBattleManual(
  connection: Connection,
  publicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  gameType: 'coinFlip' | 'diceRoll',
  betAmountSol: number,
  preGeneratedSeed?: Buffer
): Promise<{ signature: string; seed: Buffer; battlePda: PublicKey }> {

  // 1. 使用预生成的种子或生成新种子
  const seed = preGeneratedSeed || generateRandomSeed();

  // 2. 计算承诺哈希
  const commitHash = Buffer.from(keccak256(seed), 'hex');

  // 3. 转换押注金额为 lamports
  const betAmountLamports = betAmountSol * 1e9;

  // 4. 获取 config 账户
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID_PUBKEY
  );

  // 5. 手动解析 config 获取 battle_count
  const configAccountInfo = await connection.getAccountInfo(configPda);
  if (!configAccountInfo) {
    throw new Error('Config account not found. Please initialize the program first.');
  }

  const configData = configAccountInfo.data;
  // Config 结构: discriminator(8) + authority(32) + fee_bps(2) + reveal_timeout(8) + no_challenger_timeout(8) + battle_count(8)
  const battleCountOffset = 8 + 32 + 2 + 8 + 8; // = 58
  const battleCount = new BN(configData.subarray(battleCountOffset, battleCountOffset + 8), 'le').toNumber();

  // 6. 计算 Battle PDA
  const [battlePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('battle'),
      publicKey.toBuffer(),
      Buffer.from(new BN(battleCount).toArray('le', 8)),
    ],
    PROGRAM_ID_PUBKEY
  );

  // 7. 构建 createBattle 指令数据
  // 结构: discriminator(8) + bet_amount(8) + commit_hash(32) + game_type(1)
  const data = Buffer.alloc(8 + 8 + 32 + 1);

  // 写入 discriminator
  const discriminator = getCreateBattleDiscriminator();
  discriminator.copy(data, 0);

  // 写入 bet_amount (u64 LE)
  const betAmountBuffer = Buffer.from(new BN(betAmountLamports).toArray('le', 8));
  betAmountBuffer.copy(data, 8);

  // 写入 commit_hash (32 bytes)
  commitHash.copy(data, 16);

  // 写入 game_type (0 = coinFlip, 1 = diceRoll)
  const gameTypeValue = gameType === 'coinFlip' ? 0 : 1;
  data.writeUInt8(gameTypeValue, 48);

  // 8. 构建指令
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: battlePda, isSigner: false, isWritable: true },
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID_PUBKEY,
    data: data,
  });

  // 9. 创建交易
  const transaction = new Transaction();
  transaction.feePayer = publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  transaction.add(instruction);
  const signedTx = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signedTx.serialize());

  return { signature, seed, battlePda };
}

export { PROGRAM_ID };
