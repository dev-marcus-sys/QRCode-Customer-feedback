'use strict';
/**
 * SMTP 傳送器（個案管理系統實際寄信）。
 * 使用 nodemailer 的 SMTP transport 連線到內部 relay。
 * 環境變數（見 .env.example）：
 *   SMTP_HOST / SMTP_PORT（預設 25，明文、無 TLS）
 *   SMTP_USER / SMTP_PASS（內部 relay 通常不需，留空即可）
 *   MAIL_FROM（預設 sysalert@synergis.com.hk）
 */
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

let _transport;

function getTransport() {
  if (_transport) return _transport;
  const port = Number(process.env.SMTP_PORT) || 25;
  const opts = {
    host: process.env.SMTP_HOST,
    port,
    secure: false,        // port 25 為明文
    ignoreTLS: true,      // 內部 relay 不升級 TLS
    pool: true,
    maxConnections: 3,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  };
  // 若 relay 需帳密，於 .env 設定 SMTP_USER/SMTP_PASS 後取消下一行註解：
  // if (process.env.SMTP_USER) opts.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  _transport = nodemailer.createTransport(opts);
  return _transport;
}

/** 傳送單封郵件。body 含 HTML 標籤時以 html 傳送，否則以純文字。 */
async function sendEmail({ to, subject, body, from }) {
  const mailFrom = from || process.env.MAIL_FROM || 'sysalert@synergis.com.hk';
  const isHtml = /<[a-z][\s\S]*>/i.test(body || '');
  return getTransport().sendMail({
    from: mailFrom,
    to,
    subject,
    text: body,
    html: isHtml ? body : undefined,
  });
}

module.exports = { sendEmail, getTransport };
