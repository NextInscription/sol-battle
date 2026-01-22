// Simple in-memory seed storage (seeds are lost when app restarts)
interface SeedData {
  seed: Uint8Array;
  timestamp: number;
}

const seedStorage = new Map<string, SeedData>();

export async function saveSeed(battlePda: string, seed: Uint8Array): Promise<void> {
  seedStorage.set(battlePda, {
    seed,
    timestamp: Date.now(),
  });
  console.log(`Seed saved for battle: ${battlePda.slice(0, 8)}...`);
}

export async function getSeed(battlePda: string): Promise<Uint8Array | null> {
  const data = seedStorage.get(battlePda);
  if (!data) {
    console.log(`No seed found for battle: ${battlePda.slice(0, 8)}...`);
    return null;
  }
  console.log(`Seed retrieved for battle: ${battlePda.slice(0, 8)}...`);
  return data.seed;
}

export async function removeSeed(battlePda: string): Promise<void> {
  seedStorage.delete(battlePda);
}

export async function clearOldSeeds(maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
  const now = Date.now();
  for (const [battlePda, data] of seedStorage.entries()) {
    if (now - data.timestamp > maxAge) {
      seedStorage.delete(battlePda);
    }
  }
}
