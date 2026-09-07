/**
 * Express 應用組裝。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { initDatabase } = require('./db/connection');
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

  app.get('/api/v1/health', (req, res) => ok(res, { status: 'ok', db: !!db }));
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

  // Production：若存在前端建置產物則托管靜態檔並提供 SPA fallback（React Router 深鏈）
  if (fs.existsSync(INDEX_HTML)) {
    app.use(express.static(FRONTEND_DIST));
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
