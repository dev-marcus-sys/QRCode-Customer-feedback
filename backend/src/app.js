/**
 * Express 應用組裝。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { initDatabase, dbPath } = require('./db/connection');
const { ok, errorHandler, notFound } = require('./middlewares/error');
const logger = require('./utils/logger');
const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const caseRoutes = require('./routes/cases');
const qrRoutes = require('./routes/qr');
const systemRoutes = require('./routes/system');
const surveyRoutes = require('./routes/surveys');
const dashboardRoutes = require('./routes/dashboard');
const configRoutes = require('./routes/config');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const auditRoutes = require('./routes/audit');
const estateRoutes = require('./routes/estates');
const aiRoutes = require('./routes/ai');
const analyticsRoutes = require('./routes/analytics');
const emailAdminRoutes = require('./routes/emailAdmin');
const dbConsoleRoutes = require('./routes/dbConsole');

/** 前端建置產物目錄（production 模式由後端直接托管；不存在時退回純 API / dev proxy） */
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');
const INDEX_HTML = path.join(FRONTEND_DIST, 'index.html');

function createApp() {
  const db = initDatabase();
  const app = express();

  app.disable('x-powered-by');
  // 附件以 base64 JSON 上傳（F-004），上限 15MB 以容納 ≤10MB 檔案
  app.use(express.json({ limit: '15mb' }));

  // 簡易 dev CORS（Vite proxy 同源時不觸發；方便直接呼叫後端）
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept-Language');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  app.use((req, res, next) => {
    logger.info('http', `${req.method} ${req.originalUrl}`);
    next();
  });

  /** 執行環境標籤：優先取 APP_ENV（local/test/production），否則依 NODE_ENV 推斷 */
  function resolveEnv() {
    const map = {
      local: '本機開發 (localhost)',
      test: '測試環境',
      production: '正式環境 (真實環境)',
    };
    const raw = (process.env.APP_ENV || '').toLowerCase();
    if (map[raw]) return { key: raw, label: map[raw] };
    const isProd = process.env.NODE_ENV === 'production';
    return isProd ? { key: 'production', label: map.production } : { key: 'local', label: map.local };
  }

  app.get('/api/v1/health', (req, res) =>
    ok(res, { status: 'ok', db: !!db, environment: resolveEnv(), dbPath: dbPath() }));
  app.use('/api/v1/form', publicRoutes.formRouter);
  app.use('/api/v1', publicRoutes.publicRouter);
  app.use('/api/v1', authRoutes);
  app.use('/api/v1', systemRoutes);
  app.use('/api/v1/cases', caseRoutes);
  app.use('/api/v1/qr', qrRoutes);
  app.use('/api/v1/surveys', surveyRoutes);
  app.use('/api/v1/dashboard', dashboardRoutes);
  app.use('/api/v1/config', configRoutes);
  // F-010 用戶與權限管理
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/roles', roleRoutes);
  app.use('/api/v1/audit', auditRoutes);
  app.use('/api/v1/estates', estateRoutes);
  // M0 AI 診斷（AI-01 影子模式之設定現況／連線測試）
  app.use('/api/v1/ai', aiRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/v1/emails', emailAdminRoutes);
  app.use('/api/v1/db', dbConsoleRoutes);

  // Production：若存在前端建置產物則托管靜態檔並提供 SPA fallback（React Router 深鏈）
  if (fs.existsSync(INDEX_HTML)) {
    // 靜態托管前端建置產物；PWA manifest 需正確 MIME（application/manifest+json）以利安裝
    app.use(
      express.static(FRONTEND_DIST, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json');
          }
        },
      })
    );
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && req.accepts('html')) {
        return res.sendFile(INDEX_HTML);
      }
      return next();
    });
    logger.info('static', `serving frontend dist at ${FRONTEND_DIST}`);
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
