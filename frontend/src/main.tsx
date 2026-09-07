import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import App from './App';
import { theme } from './theme';

// TEMP DIAGNOSTIC（定位後即移除）：
// 捕捉 "getBoundingClientRect of null" 的真實來源，把原始 stack 丟回 window error，
// 讓預覽視窗回報時能帶上呼叫堆疊。僅開發環境、每次載入只回報一次。
if (import.meta.env.DEV) {
  window.addEventListener('error', (event) => {
    const err = event.error as (Error & { stack?: string }) | undefined;
    const w = window as unknown as Record<string, unknown>;
    if (err && /getBoundingClientRect/.test(err.message || '') && !w.__diagSent) {
      w.__diagSent = true;
      const stack = err.stack || '(no stack)';
      setTimeout(() => {
        throw new Error(`DIAG_ORIGIN_STACK >> ${stack}`);
      }, 0);
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
