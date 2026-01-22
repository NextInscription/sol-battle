import { Connection, PublicKey } from '@solana/web3.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('FzPt8DvFfzG9GUA56Yp22DCPgj8qgm6McCVRKoVYyADK');

// Polyfill for Buffer.from in React Native
export function textToUint8Array(text: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(text);
}

/**
 * Format SOL amount with appropriate decimal places
 */
function formatSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol < 0.01) {
    return sol.toFixed(3); // 0.001, 0.002, etc.
  } else if (sol < 1) {
    return sol.toFixed(2); // 0.01, 0.10, etc.
  } else {
    return sol.toFixed(2); // 1.00, 2.00, etc.
  }
}
const SLOT_TIME_SECONDS = 0.4;

export type BattleState = 'WaitingForChallenger' | 'WaitingCreatorReveal' | 'BothRevealed' | 'Settled';

export type ActiveBattle = {
  battlePda: string;
  battleId: number;
  creator: string;
  challenger?: string;
  betAmountLamports: number;
  betAmountSol: string;
  gameType: 'CoinFlip';
  gameTypeDisplay: 'Flip Card Game';
  state: BattleState;
  stateDisplay: string;
  createdAtSlot: number;
  joinedAtSlot?: number;
  expiresAtSlot: number;
  expiresInSeconds: number;
  timeRemaining: string;
  gradient: string;
};

const gradients = [
  'linear-gradient(135deg, #101f22 0%, #1a3a40 100%)',
  'linear-gradient(135deg, #1a2527 0%, #0d3b43 100%)',
  'linear-gradient(135deg, #0f1718 0%, #1e4d56 100%)',
  'linear-gradient(135deg, #1a1f22 0%, #2a3a40 100%)',
  'linear-gradient(135deg, #0d1f22 0%, #1a4a40 100%)',
];

const getGradient = (index: number) => gradients[index % gradients.length];

/**
 * Format seconds to "Xd HHh MMm SSs" format
 */
export const formatTimeRemaining = (seconds: number): string => {
  if (seconds <= 0) return '0d 00h 00m 00s';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${days}d ${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
};

/**
 * Parse Battle account data from Buffer
 * Based on the IDL structure
 */
function parseBattleAccount(data: Buffer): any {
  let offset = 0;

  // Discriminator (8 bytes) - Anchor adds this for account identification
  offset += 8;

  // battle_id (u64 = 8 bytes, LE format)
  const battleId = data.readBigUInt64LE(offset);
  offset += 8;

  // creator (pubkey = 32 bytes)
  const creator = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // challenger (option pubkey = 1 byte tag + 32 bytes if present)
  const challengerTag = data.readUInt8(offset);
  offset += 1;
  let challenger = null;
  if (challengerTag !== 0) {
    challenger = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
  }

  // bet_amount (u64 = 8 bytes, LE format)
  const betAmount = data.readBigUInt64LE(offset);
  offset += 8;

  // commit_creator (array[u8, 32] = 32 bytes)
  offset += 32;

  // commit_challenger (option array[u8, 32] = 1 byte tag + 32 bytes if present)
  const commitChallengerTag = data.readUInt8(offset);
  offset += 1;
  if (commitChallengerTag !== 0) {
    offset += 32;
  }

  // seed_creator (option array[u8, 32] = 1 byte tag + 32 bytes if present)
  const seedCreatorTag = data.readUInt8(offset);
  offset += 1;
  if (seedCreatorTag !== 0) {
    offset += 32;
  }

  // seed_challenger (option array[u8, 32] = 1 byte tag + 32 bytes if present)
  const seedChallengerTag = data.readUInt8(offset);
  offset += 1;
  if (seedChallengerTag !== 0) {
    offset += 32;
  }

  // game_type (enum - Anchor uses 1 byte for the enum tag)
  offset += 1; // Skip game_type, only CoinFlip is supported
  const gameType = 'CoinFlip';

  // state (enum - Anchor uses 1 byte for the enum tag)
  const stateTag = data.readUInt8(offset);
  const stateStates = ['WaitingForChallenger', 'WaitingCreatorReveal', 'BothRevealed', 'Settled'];
  const state = stateStates[stateTag] || 'Settled';
  offset += 1;

  // winner (option pubkey = 1 byte tag + 32 bytes if present)
  const winnerTag = data.readUInt8(offset);
  offset += 1;
  if (winnerTag !== 0) {
    offset += 32;
  }

  // created_at_slot (u64 = 8 bytes, LE format)
  const createdAtSlot = Number(data.readBigUInt64LE(offset));
  offset += 8;

  // joined_at_slot (option u64 = 1 byte tag + 8 bytes if present)
  const joinedAtTag = data.readUInt8(offset);
  offset += 1;
  let joinedAtSlot = null;
  if (joinedAtTag !== 0) {
    joinedAtSlot = Number(data.readBigUInt64LE(offset));
    offset += 8;
  }

  // config_snapshot (struct)
  // fee_bps (u16 = 2 bytes, LE format)
  const feeBps = data.readUInt16LE(offset);
  offset += 2;

  // reveal_timeout_slots (u64 = 8 bytes, LE format)
  const revealTimeoutSlots = Number(data.readBigUInt64LE(offset));
  offset += 8;

  // no_challenger_timeout_slots (u64 = 8 bytes, LE format)
  const noChallengerTimeoutSlots = Number(data.readBigUInt64LE(offset));
  offset += 8;

  // bump (u8 = 1 byte)
  const bump = data.readUInt8(offset);
  offset += 1;

  return {
    battleId: Number(battleId),
    creator,
    challenger,
    betAmount: Number(betAmount),
    gameType,
    state,
    createdAtSlot,
    joinedAtSlot,
    revealTimeoutSlots,
    noChallengerTimeoutSlots,
    feeBps,
    bump,
  };
}

/**
 * Get all active battles (WaitingForChallenger or WaitingCreatorReveal)
 */
export async function getActiveBattles(
  connection: Connection
): Promise<ActiveBattle[]> {
  // 1. Get current slot
  const currentSlot = await connection.getSlot();

  // 2. Get all program accounts
  const accounts = await connection.getProgramAccounts(PROGRAM_ID);

  // Filter out config account (starts with 'config' seed)
  const [configAddress] = PublicKey.findProgramAddressSync(
    [textToUint8Array('config')],
    PROGRAM_ID
  );
  const battleAccounts = accounts.filter((acc) => !acc.pubkey.equals(configAddress));

  const result: ActiveBattle[] = [];

  for (let i = 0; i < battleAccounts.length; i++) {
    try {
      const { pubkey, account } = battleAccounts[i];
      const data = account.data as Buffer;

      const parsed = parseBattleAccount(data);

      // Only include active battles
      if (parsed.state !== 'WaitingForChallenger' && parsed.state !== 'WaitingCreatorReveal') {
        continue;
      }

      // Calculate expiration
      let expiresAtSlot: number;
      if (parsed.state === 'WaitingForChallenger') {
        expiresAtSlot = parsed.createdAtSlot + parsed.noChallengerTimeoutSlots;
      } else {
        // WaitingCreatorReveal
        if (!parsed.joinedAtSlot) continue;
        expiresAtSlot = parsed.joinedAtSlot + parsed.revealTimeoutSlots;
      }

      // Calculate remaining time
      const remainingSlots = expiresAtSlot - currentSlot;
      const remainingSeconds = Math.max(0, Math.floor(remainingSlots * SLOT_TIME_SECONDS));

      // Skip if already expired
      if (remainingSeconds <= 0) continue;

      // Format creator address
      const creatorShort = `${parsed.creator.toBase58().slice(0, 4)}...${parsed.creator.toBase58().slice(-4)}`;

      result.push({
        battlePda: pubkey.toBase58(),
        battleId: parsed.battleId,
        creator: creatorShort,
        challenger: parsed.challenger?.toBase58(),
        betAmountLamports: parsed.betAmount,
        betAmountSol: `${formatSol(parsed.betAmount)} SOL`,
        gameType: parsed.gameType as any,
        gameTypeDisplay: 'Flip Card Game', // Only CoinFlip is supported
        state: parsed.state as BattleState,
        stateDisplay: parsed.state === 'WaitingForChallenger' ? 'Waiting for Challenger' : 'Waiting Creator Reveal',
        createdAtSlot: parsed.createdAtSlot,
        joinedAtSlot: parsed.joinedAtSlot || undefined,
        expiresAtSlot,
        expiresInSeconds: remainingSeconds,
        timeRemaining: formatTimeRemaining(remainingSeconds),
        gradient: getGradient(i),
      });
    } catch (error) {
      console.error('Failed to parse battle:', error);
    }
  }

  return result;
}
