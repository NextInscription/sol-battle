import { Connection, PublicKey } from '@solana/web3.js';
import { PROGRAM_ID } from '@/config/network';

const PROGRAM_ID_PUBKEY = new PublicKey(PROGRAM_ID);

export async function debugBattleAccount(battlePda: string) {
  const connection = new Connection('https://api.devnet.solana.com');

  try {
    const accountInfo = await connection.getAccountInfo(new PublicKey(battlePda));
    if (!accountInfo) {
      console.log('Battle not found');
      return;
    }

    const data = accountInfo.data as Buffer;
    let offset = 8; // Skip discriminator

    // battle_id (8 bytes)
    const battleId = data.readBigUInt64LE(offset);
    offset += 8;

    // creator (32 bytes)
    const creator = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    console.log('Creator:', creator.toBase58());

    // challenger tag (1 byte)
    const challengerTag = data.readUInt8(offset);
    offset += 1;
    let challenger = null;
    if (challengerTag !== 0) {
      challenger = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;
      console.log('Challenger:', challenger.toBase58());
    } else {
      console.log('Challenger: None');
    }

    // bet_amount (8 bytes)
    const betAmount = data.readBigUInt64LE(offset);
    offset += 8;
    console.log('Bet Amount:', betAmount.toString(), 'lamports');

    // Skip commits and seeds (32 bytes each)
    offset += 32; // commit_creator
    const commitChallengerTag = data.readUInt8(offset);
    offset += 1;
    if (commitChallengerTag !== 0) offset += 32;

    const seedCreatorTag = data.readUInt8(offset);
    offset += 1;
    console.log('Seed Creator Tag:', seedCreatorTag);

    const seedChallengerTag = data.readUInt8(offset);
    offset += 1;
    console.log('Seed Challenger Tag:', seedChallengerTag);

    // Skip game_type (1 byte)
    offset += 1;

    // state (1 byte)
    const stateTag = data.readUInt8(offset);
    offset += 1;
    const states = ['WaitingForChallenger', 'WaitingCreatorReveal', 'BothRevealed', 'Settled'];
    console.log('State:', states[stateTag] || 'Unknown');

    // winner tag (1 byte)
    const winnerTag = data.readUInt8(offset);
    offset += 1;
    if (winnerTag !== 0) {
      const winner = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;
      console.log('Winner:', winner.toBase58());
      console.log('Winner == Creator?', winner.toBase58() === creator.toBase58());
      console.log('Winner == Challenger?', challenger && winner.toBase58() === challenger.toBase58());
    } else {
      console.log('Winner: None');
    }

  } catch (error) {
    console.error('Error debugging battle:', error);
  }
}
