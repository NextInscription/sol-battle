/**
 * Network configuration
 * Modify these values when deploying to different environments
 */

// Solana cluster RPC endpoint
export const RPC_ENDPOINT = import.meta.env.VITE_RPC_ENDPOINT || 'https://api.testnet.solana.com';

// Program ID (should match your deployed program)
export const PROGRAM_ID = import.meta.env.VITE_PROGRAM_ID || 'FzPt8DvFfzG9GUA56Yp22DCPgj8qgm6McCVRKoVYyADK';

// Environment: 'localnet' | 'devnet' | 'testnet' | 'mainnet'
export const NETWORK = import.meta.env.VITE_NETWORK || 'testnet';

// Connection configuration
export const COMMITMENT = 'confirmed' as const;
