import { forwardRef, useState } from 'react';
import { TextField, IconButton, InputAdornment, Tooltip } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

type PasswordFieldProps = React.ComponentProps<typeof TextField>;

/** 密碼輸入框：右側眼睛圖示可切換明碼／遮罩顯示。 */
export const PasswordField = forwardRef<HTMLDivElement, PasswordFieldProps>(
  (props, ref) => {
    const [visible, setVisible] = useState(false);
    const { InputProps, ...rest } = props;
    return (
      <TextField
        {...rest}
        ref={ref}
        type={visible ? 'text' : 'password'}
        InputProps={{
          ...InputProps,
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={visible ? '隱藏密碼' : '顯示密碼'}>
                <IconButton
                  aria-label={visible ? '隱藏密碼' : '顯示密碼'}
                  onClick={() => setVisible((v) => !v)}
                  onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
                  edge="end"
                  size="small"
                  tabIndex={-1}
                >
                  {visible ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        }}
      />
    );
  }
);

PasswordField.displayName = 'PasswordField';
