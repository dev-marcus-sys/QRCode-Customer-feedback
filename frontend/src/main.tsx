import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import App from './App';
import { theme } from './theme';

ReactDOM.createRoot(document.getElementById('root')!).render(
  // NOTE: React.StrictMode 的雙重掛載會與 MUI 的 Popper/Slide 轉場（Menu/Popover/
  // Snackbar/Select）在 Vite HMR 熱重載時競爭，導致 "getBoundingClientRect of null"
  // 的開發期錯誤。正式建置（vite build）不會發生，這裡移除 StrictMode 以消除開發預覽的干擾。
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ThemeProvider>
);
