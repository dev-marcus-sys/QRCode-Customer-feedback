/**
 * 啟動入口。
 */
'use strict';
require('dotenv').config();
const { createApp } = require('./app');
const { startSlaScheduler, startWeeklyScheduler } = require('./scheduler');
const logger = require('./utils/logger');

const port = Number(process.env.PORT) || 3000;

const app = createApp();
app.listen(port, () => {
  logger.info('server', `QRCode 客戶意見反饋骨架已啟動 http://localhost:${port}/api/v1`);
  startSlaScheduler();
  startWeeklyScheduler();
});
