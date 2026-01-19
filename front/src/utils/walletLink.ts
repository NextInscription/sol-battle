import { Capacitor } from '@capacitor/core';

/**
 * 移动端钱包深度链接处理
 */
export class MobileWalletHandler {
  /**
   * 检测是否在移动端 Capacitor 环境中
   */
  static isMobile(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * 打开 Phantom 钱包进行连接
   */
  static async openPhantomWallet(dappUrl: string, redirectUrl: string): Promise<void> {
    if (!this.isMobile()) {
      // 非移动端，让默认的 wallet adapter 处理
      return;
    }

    // 构建 Phantom 移动端深度链接
    // 格式: https://phantom.app/ul/v1/connect?app_url=...&redirect_link=...
    const phantomUrl = new URL('https://phantom.app/ul/v1/connect');
    phantomUrl.searchParams.append('app_url', dappUrl);
    phantomUrl.searchParams.append('redirect_link', redirectUrl);

    // 使用 window.location 打开，这样会触发系统级别的 URL 处理
    // 从而唤起 Phantom 应用
    window.location.href = phantomUrl.toString();
  }

  /**
   * 处理从钱包应用返回的回调
   */
  static handleWalletCallback(callbackUrl: string): { params: Record<string, string> } {
    try {
      const url = new URL(callbackUrl);
      const params: Record<string, string> = {};

      // 解析所有查询参数
      url.searchParams.forEach((value, key) => {
        params[key] = value;
      });

      return { params };
    } catch (error) {
      console.error('Failed to parse callback URL:', error);
      return { params: {} };
    }
  }
}
