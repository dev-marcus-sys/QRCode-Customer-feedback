/**
 * 簡潔結構化日誌。原則：只記操作摘要與案號，不落客戶內容全文（PII）。
 */
'use strict';

function ts() {
  return new Date().toISOString();
}

function write(level, module, msg) {
  const line = `${ts()} [${level}] [${module}] ${msg}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
}

const logger = {
  info: (module, msg) => write('INFO', module, msg),
  warn: (module, msg) => write('WARN', module, msg),
  error: (module, msg) => write('ERROR', module, msg),
};

module.exports = logger;
