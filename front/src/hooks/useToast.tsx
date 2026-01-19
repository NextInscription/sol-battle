import { createRoot } from 'react-dom/client';
import Toast from '../components/Toast';
import type { ToastType } from '../components/Toast';

let toastId = 0;

export const useToast = () => {
  const show = (message: string, type: ToastType = 'info', duration: number = 5000) => {
    toastId++;

    // 创建 toast 容器
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none';
      document.body.appendChild(container);
    }

    // 创建 toast 元素
    const toastElement = document.createElement('div');
    toastElement.className = 'pointer-events-auto';
    container.appendChild(toastElement);

    // 渲染 Toast 组件
    const root = createRoot(toastElement);
    root.render(
      <Toast
        message={message}
        type={type}
        duration={duration}
        onClose={() => {
          root.unmount();
          toastElement.remove();
        }}
      />
    );
  };

  return {
    success: (message: string, duration?: number) => show(message, 'success', duration),
    error: (message: string, duration?: number) => show(message, 'error', duration),
    warning: (message: string, duration?: number) => show(message, 'warning', duration),
    info: (message: string, duration?: number) => show(message, 'info', duration),
  };
};
