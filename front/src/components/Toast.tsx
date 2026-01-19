import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
}

export default function Toast({ message, type = 'info', duration = 5000, onClose }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onClose?.(), 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const styles = {
    success: {
      bg: 'bg-green-500/90',
      icon: 'check_circle',
      border: 'border-green-400',
    },
    error: {
      bg: 'bg-red-500/90',
      icon: 'error',
      border: 'border-red-400',
    },
    warning: {
      bg: 'bg-yellow-500/90',
      icon: 'warning',
      border: 'border-yellow-400',
    },
    info: {
      bg: 'bg-blue-500/90',
      icon: 'info',
      border: 'border-blue-400',
    },
  };

  const style = styles[type];

  return (
    <div
      className={`fixed top-4 right-4 z-50 max-w-md transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
    >
      <div
        className={`${style.bg} backdrop-blur-md border-2 ${style.border} rounded-xl p-4 shadow-2xl flex items-start gap-3`}
      >
        <span className="material-symbols-outlined text-white text-xl shrink-0">
          {style.icon}
        </span>
        <div className="flex-1">
          <p className="text-white text-sm font-medium leading-relaxed whitespace-pre-wrap">
            {message}
          </p>
        </div>
        <button
          onClick={() => {
            setVisible(false);
            setTimeout(() => onClose?.(), 300);
          }}
          className="text-white/80 hover:text-white transition-colors shrink-0"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
  );
}

