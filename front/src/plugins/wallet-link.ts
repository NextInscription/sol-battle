import { registerPlugin } from '@capacitor/core';

export interface WalletLinkPlugin {
  openPhantom(options: { url: string }): Promise<void>;
}

const WalletLink = registerPlugin<WalletLinkPlugin>('WalletLink');

export async function openPhantomWallet(url: string): Promise<void> {
  return WalletLink.openPhantom({ url });
}
