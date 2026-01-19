import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * 深度链接监听器
 * 用于处理从 Phantom 钱包返回的回调
 */
export class DeepLinkListener {
  private static listeners: Array<(url: string) => void> = [];

  static initialize() {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    // 监听应用通过深度链接打开
    App.addListener('appUrlOpen', (data: { url: string }) => {
      console.log('🔗 Deep link received:', data.url);

      // 通知所有监听器
      this.listeners.forEach(listener => listener(data.url));
    });
  }

  /**
   * 添加深度链接监听器
   */
  static onAppOpen(callback: (url: string) => void) {
    this.listeners.push(callback);
  }

  /**
   * 移除深度链接监听器
   */
  static removeListener(callback: (url: string) => void) {
    this.listeners = this.listeners.filter(listener => listener !== callback);
  }
}
