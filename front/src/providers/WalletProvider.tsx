import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TrustWalletAdapter,
} from '@solana/wallet-adapter-wallets';

import '@solana/wallet-adapter-react-ui/styles.css';
import { RPC_ENDPOINT } from '../config/network';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const endpoint = RPC_ENDPOINT;

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(), // 支持移动端深度链接
      new SolflareWalletAdapter(),
      new TrustWalletAdapter(), // 支持移动端
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
