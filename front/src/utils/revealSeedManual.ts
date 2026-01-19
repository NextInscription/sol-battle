import { Connection, PublicKey, TransactionInstruction, Transaction } from '@solana/web3.js';

import { PROGRAM_ID } from '../config/network';
const PROGRAM_ID_PUBKEY = new PublicKey(PROGRAM_ID);

/**
 * Get discriminator for "reveal_seed" instruction
 * From IDL: [196, 119, 194, 112, 156, 211, 239, 105]
 */
function getRevealSeedDiscriminator(): Buffer {
  return Buffer.from([196, 119, 194, 112, 156, 211, 239, 105]);
}

/**
 * Reveal seed for creator (manual transaction building)
 */
export async function revealSeedManual(
  connection: Connection,
  publicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  battlePda: PublicKey,
  seed: Buffer
): Promise<string> {

  // 1. 获取 config 账户
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID_PUBKEY
  );

  // 2. 构建 reveal_seed 指令数据
  // 结构: discriminator(8) + seed(32)
  const data = Buffer.alloc(8 + 32);

  // 写入 discriminator
  const discriminator = getRevealSeedDiscriminator();
  discriminator.copy(data, 0);

  // 写入 seed (32 bytes)
  seed.copy(data, 8);

  // 3. 构建指令
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: battlePda, isSigner: false, isWritable: true },
      { pubkey: publicKey, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID_PUBKEY,
    data: data,
  });

  // 4. 创建交易
  const transaction = new Transaction();
  transaction.feePayer = publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  transaction.add(instruction);
  const signedTx = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signedTx.serialize());

  return signature;
}
