import { createTheme } from '@mui/material/styles';

export const PRIMARY = '#1a5aa6';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: PRIMARY, dark: '#0e3e75', light: '#4c8fd6' },
    secondary: { main: '#2e7d32' },
    background: { default: '#f4f6fa', paper: '#ffffff' },
    text: { primary: '#1f2937', secondary: '#6b7280' },
    error: { main: '#d32f2f' },
    warning: { main: '#ed6c02' },
    info: { main: '#1565c0' },
    success: { main: '#2e7d32' },
  },
  typography: {
    fontFamily: '"Noto Sans TC", "Noto Sans", "Microsoft JhengHei", "PingFang TC", sans-serif',
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    body1: { fontSize: 15 },
    body2: { fontSize: 14 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 500 } },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
  },
});
