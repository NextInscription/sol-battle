import { Connection, PublicKey, TransactionInstruction, SystemProgram, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import { keccak256 } from 'js-sha3';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';

import { PROGRAM_ID } from '@/config/network';
import { textToUint8Array } from './battles';

const PROGRAM_ID_PUBKEY = new PublicKey(PROGRAM_ID);

/**
 * Generate a proper random seed (32 bytes)
 */
export function generateRandomSeed(): Uint8Array {
  const seed = new Uint8Array(32);
  const randomValues = new Array(32);
  for (let i = 0; i < 32; i++) {
    randomValues[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < 32; i++) {
    seed[i] = randomValues[i];
  }
  return seed;
}

/**
 * Get discriminator for "join_battle" instruction
 */
function getJoinBattleDiscriminator(): Uint8Array {
  return new Uint8Array([126, 0, 69, 130, 127, 145, 54, 100]);
}

/**
 * Join a battle using Mobile Wallet Adapter
 * Challenger joins AND reveals immediately
 * Assumes wallet is already connected via WalletContext
 */
export async function joinBattleMobile(
  connection: Connection,
  publicKey: PublicKey,
  battlePda: string,
  betAmountSol: number,
  authToken: string | null
): Promise<{ signature: string; seed: Uint8Array }> {
  // 1. 生成种子
  const seed = generateRandomSeed();

  // 2. 计算承诺哈希
  const seedHash = keccak256(seed);
  const commitHash = new Uint8Array(seedHash.match(/[\da-f]{2}/gi)!.map(h => parseInt(h, 16)));

  // 3. 获取 config 账户
  const [configPda] = PublicKey.findProgramAddressSync(
    [textToUint8Array('config')],
    PROGRAM_ID_PUBKEY
  );

  // 4. 转换押注金额为 lamports
  const betAmountLamports = Math.floor(betAmountSol * 1e9);

  // 5. 构建 join_battle 指令数据
  const data = new Uint8Array(8 + 8 + 32 + 32);

  // discriminator (8 bytes)
  const discriminator = getJoinBattleDiscriminator();
  data.set(discriminator, 0);

  // bet_amount (u64 LE, 8 bytes)
  const betAmountView = new DataView(data.buffer);
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(betAmountLamports), true);
  for (let i = 0; i < 8; i++) {
    data[8 + i] = new Uint8Array(view.buffer)[i];
  }

  // commit_hash (32 bytes)
  data.set(commitHash, 16);

  // seed (32 bytes)
  data.set(seed, 48);

  // 6. 构建指令
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(battlePda), isSigner: false, isWritable: true },
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID_PUBKEY,
    data: data,
  });

  // 7. 获取最新 blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // 8. 构建版本化交易
  const transactionMessage = new TransactionMessage({
    payerKey: publicKey,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  const transaction = new VersionedTransaction(transactionMessage);

  // 9. 使用钱包签名并发送交易 (传入 authToken 以复用已有会话)
  const signatures = await transact(
    { auth_token: authToken || undefined },
    async (wallet) => {
      const txSignatures = await wallet.signAndSendTransactions({
        transactions: [transaction],
      });
      return txSignatures;
    }
  );

  return { signature: signatures[0], seed };
}
