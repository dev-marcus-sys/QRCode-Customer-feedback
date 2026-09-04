import { Autocomplete, TextField } from '@mui/material';

export interface OptionItem {
  code: string;
  label: string;
}

interface OptionSelectProps {
  label: string;
  value: string;
  options: OptionItem[];
  onChange: (v: string) => void;
  disabled?: boolean;
  width?: number;
}

/** 單選篩選下拉（含「全部」選項） */
export function OptionSelect({ label, value, options, onChange, disabled, width }: OptionSelectProps) {
  const current = options.find((o) => o.code === value) || null;
  return (
    <Autocomplete
      size="small"
      sx={{ minWidth: width || 150 }}
      disabled={disabled}
      options={options}
      getOptionLabel={(o) => o.label}
      value={current}
      onChange={(_, v) => onChange(v ? v.code : '')}
      renderInput={(params) => <TextField {...params} label={label} placeholder="全部" />}
      isOptionEqualToValue={(o, v) => !v || o.code === v.code}
    />
  );
}
