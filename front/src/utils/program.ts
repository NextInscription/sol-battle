import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import idlJson from '../idl/battle_game.json';

const PROGRAM_ID = new PublicKey('FzPt8DvFfzG9GUA56Yp22DCPgj8qgm6McCVRKoVYyADK');

// Type assertion for IDL
const idl = idlJson as any;

/**
 * Get the Anchor Program instance (read-only)
 */
export function getProgram(connection: Connection, provider?: any): any {
  if (!provider) {
    // Create a dummy wallet for read-only operations
    const dummyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async () => {
        throw new Error('Read-only provider cannot sign');
      },
      signAllTransactions: async () => {
        throw new Error('Read-only provider cannot sign');
      },
    };

    // Create provider with proper options
    provider = new AnchorProvider(
      connection,
      dummyWallet as any,
      { commitment: 'confirmed' }
    );
  }

  // @ts-ignore - Anchor Program type compatibility issue
  return new Program(idl, PROGRAM_ID, provider);
}

/**
 * Get the Anchor Program instance with signing capability
 */
export function getProgramWithSigner(
  connection: Connection,
  publicKey: PublicKey,
  signTransaction: (tx: any) => Promise<any>,
  signAllTransactions: (txs: any[]) => Promise<any[]>
): any {
  const wallet = {
    publicKey,
    signTransaction,
    signAllTransactions,
  };

  const provider = new AnchorProvider(
    connection,
    wallet as any,
    { commitment: 'confirmed' }
  );

  // @ts-ignore - Anchor Program type compatibility issue
  return new Program(idl, PROGRAM_ID, provider);
}

export { PROGRAM_ID };
