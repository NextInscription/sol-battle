import { useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { openPhantomWallet } from '../plugins/wallet-link';

/**
 * 移动端 Phantom 钱包连接按钮
 */
export function MobileWalletButton() {
  const { connected, publicKey } = useWallet();

  useEffect(() => {
    // 检查是否在移动端
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    // 监听从 Phantom 返回的回调
    const listener = App.addListener('appUrlOpen', (data: { url: string }) => {
      console.log('App opened with URL:', data.url);

      // 解析回调 URL
      try {
        const url = new URL(data.url);

        // 检查是否是 Phantom 的回调
        if (url.pathname === '/solana/wallet') {
          // 从参数中获取 phantom_encryption_public_key 和 nonce
          // 这些参数用于建立会话
          const sessionParams = url.searchParams.get('session');
          if (sessionParams) {
            console.log('Phantom session params:', sessionParams);
            // TODO: 使用 session 参数建立连接
          }
        }
      } catch (error) {
        console.error('Failed to parse callback URL:', error);
      }
    });

    return () => {
      listener.then((fn: { remove: () => void }) => fn.remove());
    };
  }, []);

  const handleConnect = async () => {
    try {
      // 构建回调 URL
      const redirectUrl = `${window.location.origin}/solana/wallet`;

      // 构建 Phantom 深度链接
      // Phantom 移动端使用 Universal Links 格式
      const phantomUrl = new URL('https://phantom.app/ul/v1/connect');
      phantomUrl.searchParams.append('dapp_encryption_public_key', 'your_public_key');
      phantomUrl.searchParams.append('nonce', 'your_nonce');
      phantomUrl.searchParams.append('redirect_link', redirectUrl);
      phantomUrl.searchParams.append('cluster', 'testnet');

      // 使用我们的自定义插件打开
      await openPhantomWallet(phantomUrl.toString());
    } catch (error) {
      console.error('Failed to connect to Phantom:', error);
    }
  };

  if (!Capacitor.isNativePlatform()) {
    return null; // 只在移动端显示
  }

  return (
    <button
      onClick={handleConnect}
      className="flex items-center gap-2 bg-[#AB9FF2] hover:bg-[#9689DB] text-white px-4 py-2 rounded-lg font-medium transition-colors"
    >
      <img src="/phantom-icon.png" alt="Phantom" className="w-5 h-5" />
      {connected ? (
        <span className="text-sm">
          {publicKey?.toString().slice(0, 4)}...{publicKey?.toString().slice(-4)}
        </span>
      ) : (
        <span className="text-sm">Connect Phantom</span>
      )}
    </button>
  );
}
