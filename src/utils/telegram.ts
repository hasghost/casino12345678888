export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        openTelegramLink: (url: string) => void;
        openLink: (url: string) => void;
        sendData: (data: string) => void;
        HapticFeedback?: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
        initData: string;
        initDataUnsafe?: {
          query_id?: string;
          user?: TelegramUser;
          auth_date?: number;
          hash?: string;
          start_param?: string;
        };
        platform?: string;
        version?: string;
        isExpanded?: boolean;
      };
    };
  }
}

export function initTelegramApp() {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    try {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
      if (typeof tg.setHeaderColor === 'function') {
        tg.setHeaderColor('#090c15');
      }
      if (typeof tg.setBackgroundColor === 'function') {
        tg.setBackgroundColor('#090c15');
      }
    } catch (e) {
      console.warn('Telegram WebApp init error:', e);
    }
  }
}

export function isInsideTelegram(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.Telegram?.WebApp?.initData);
}

export function getTelegramUser(): TelegramUser {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp?.initDataUnsafe?.user) {
    return window.Telegram.WebApp.initDataUnsafe.user;
  }

  // Fallback to real owner ID from bot configuration when previewing outside Telegram
  return {
    id: 7505000952,
    username: 'winer404',
    first_name: 'Admin',
  };
}

export function triggerHaptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' | 'selection') {
  if (typeof window === 'undefined' || !window.Telegram?.WebApp?.HapticFeedback) return;
  try {
    const haptic = window.Telegram.WebApp.HapticFeedback;
    if (type === 'success' || type === 'error' || type === 'warning') {
      haptic.notificationOccurred(type);
    } else if (type === 'selection') {
      haptic.selectionChanged();
    } else {
      haptic.impactOccurred(type);
    }
  } catch (e) {
    // Ignore if not supported on platform
  }
}

export function openExternalUrl(url: string) {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    if (url.startsWith('https://t.me/') && typeof window.Telegram.WebApp.openTelegramLink === 'function') {
      window.Telegram.WebApp.openTelegramLink(url);
      return;
    }
    if (typeof window.Telegram.WebApp.openLink === 'function') {
      window.Telegram.WebApp.openLink(url);
      return;
    }
  }
  // Safe navigation fallback without window.open
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
}
