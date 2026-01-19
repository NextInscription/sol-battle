import { Connection, PublicKey, TransactionInstruction, Transaction } from '@solana/web3.js';

import { PROGRAM_ID } from '../config/network';
const PROGRAM_ID_PUBKEY = new PublicKey(PROGRAM_ID);

/**
 * Get discriminator for "settle_battle" instruction
 * From IDL: [4, 146, 32, 157, 82, 216, 214, 28]
 */
function getSettleBattleDiscriminator(): Buffer {
  return Buffer.from([4, 146, 32, 157, 82, 216, 214, 28]);
}

/**
 * Settle battle - calculate winner and distribute prize (manual transaction building)
 * Anyone can call this function
 */
export async function settleBattleManual(
  connection: Connection,
  publicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  battlePda: PublicKey,
  creatorPubkey: PublicKey,
  challengerPubkey: PublicKey
): Promise<string> {

  // 1. 获取 config 账户
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID_PUBKEY
  );

  // 2. 构建 settle_battle 指令数据
  // 结构: discriminator(8) + 无参数
  const data = Buffer.alloc(8);

  // 写入 discriminator
  const discriminator = getSettleBattleDiscriminator();
  discriminator.copy(data, 0);

  // 3. 构建指令
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: battlePda, isSigner: false, isWritable: true },
      { pubkey: creatorPubkey, isSigner: false, isWritable: true },
      { pubkey: challengerPubkey, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true }, // fee_recipient = config authority
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // System Program
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
