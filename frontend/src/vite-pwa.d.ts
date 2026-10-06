/// <reference types="vite/client" />

// 環境宣告：此環境下 TS 無法自動解析 vite-plugin-pwa 的子路徑與 virtual 模組，
// 故在此提供最小型別，避免建置期 tsc 報錯（不影響實際執行）。
declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | null) => void;
    onRegisterError?: (error: unknown) => void;
  }
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}

declare module 'vite-plugin-pwa/client' {
  export * from 'virtual:pwa-register';
}

declare module 'vite-plugin-pwa' {
  import type { Plugin } from 'vite';
  export interface VitePWAOptions {
    registerType?: 'autoUpdate' | 'prompt';
    includeAssets?: string[];
    manifest?: Record<string, unknown>;
    workbox?: Record<string, unknown>;
    devOptions?: { enabled?: boolean; [k: string]: unknown };
    injectRegister?: false | 'auto' | 'script' | 'inline' | null;
    [k: string]: unknown;
  }
  export function VitePWA(options?: VitePWAOptions): Plugin;
  export default VitePWA;
}
