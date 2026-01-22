import { Connection, PublicKey, TransactionInstruction, Transaction, SystemProgram } from '@solana/web3.js';
import { keccak256 } from 'js-sha3';

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
 * Get discriminator for "join_battle" instruction from IDL
 * From IDL: [126, 0, 69, 130, 127, 145, 54, 100]
 */
function getJoinBattleDiscriminator(): Buffer {
  return Buffer.from([126, 0, 69, 130, 127, 145, 54, 100]);
}

/**
 * Join a battle on chain (manual transaction building)
 * Challenger joins AND reveals immediately
 */
export async function joinBattleManual(
  connection: Connection,
  publicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  battlePda: PublicKey,
  _betAmountSol: number, // Used for balance check in caller
  preGeneratedSeed?: Buffer
): Promise<{ signature: string; seed: Buffer; battlePda: PublicKey }> {

  // 1. 使用预生成的种子或生成新种子
  const seed = preGeneratedSeed || generateRandomSeed();

  // 2. 计算承诺哈希
  const commitHash = Buffer.from(keccak256(seed), 'hex');

  // 3. 获取 config 账户
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID_PUBKEY
  );

  // 4. 转换押注金额为 lamports
  const betAmountLamports = Math.floor(_betAmountSol * 1e9);

  // 5. 构建 join_battle 指令数据
  // 结构: discriminator(8) + bet_amount(8) + commit_hash(32) + seed(32)
  const data = Buffer.alloc(8 + 8 + 32 + 32);

  // 写入 discriminator
  const discriminator = getJoinBattleDiscriminator();
  discriminator.copy(data, 0);

  // 写入 bet_amount (u64 LE, 8 bytes)
  const betAmountBuffer = Buffer.alloc(8);
  betAmountBuffer.writeBigUInt64LE(BigInt(betAmountLamports));
  betAmountBuffer.copy(data, 8);

  // 写入 commit_hash (32 bytes)
  commitHash.copy(data, 16);

  // 写入 seed (32 bytes)
  seed.copy(data, 48);

  // 6. 构建指令
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

  // 7. 创建交易
  const transaction = new Transaction();
  transaction.feePayer = publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  transaction.add(instruction);
  const signedTx = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signedTx.serialize());

  return { signature, seed, battlePda };
}
