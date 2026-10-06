import { useEffect, useState } from 'react';
import { Snackbar, Button, Stack } from '@mui/material';
import { InstallMobile } from '@mui/icons-material';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * 後台 PWA 安裝引導：監聽 beforeinstallprompt，未安裝（非 standalone）時以置底 Snackbar 提示。
 * 已安裝或處於 standalone 模式則不顯示。
 */
export default function InstallPrompt(): JSX.Element | null {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setOpen(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt as EventListener);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt as EventListener);
  }, []);

  if (!deferred) return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setOpen(false);
  };

  return (
    <Snackbar
      open={open}
      onClose={() => setOpen(false)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ bottom: { xs: 'env(safe-area-inset-bottom, 0px)', sm: 24 } }}
      message="將後台安裝到主畫面，離線也能開啟"
      action={
        <Stack direction="row" spacing={1} alignItems="center">
          <Button color="inherit" size="small" onClick={install} startIcon={<InstallMobile />}>
            安裝
          </Button>
          <Button color="inherit" size="small" onClick={() => setOpen(false)}>
            關閉
          </Button>
        </Stack>
      }
    />
  );
}
