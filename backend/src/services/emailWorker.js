'use strict';
/**
 * 郵件佇列處理器：掃描 email_outbox 中 status='PENDING' 的信並實際寄出。
 * 由 scheduler.startEmailScheduler 定時呼叫，亦可由管理介面「立即重發」直接呼叫。
 */
const { sendEmail } = require('./mailer');
const logger = require('../utils/logger');

const BATCH = 50;

/** 批次送出所有 PENDING 郵件；回傳處理統計。 */
async function processOutbox(db) {
  const rows = db.prepare(
    "SELECT outbox_id, recipient, subject, body FROM email_outbox WHERE status='PENDING' ORDER BY outbox_id ASC LIMIT ?"
  ).all(BATCH);
  if (!rows.length) return { processed: 0, sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await sendEmail({ to: r.recipient, subject: r.subject, body: r.body });
      db.prepare("UPDATE email_outbox SET status='SENT', sent_at=datetime('now'), error=NULL WHERE outbox_id=?").run(r.outbox_id);
      sent++;
    } catch (e) {
      const msg = String((e && e.message) || e);
      db.prepare("UPDATE email_outbox SET status='FAILED', error=? WHERE outbox_id=?").run(msg, r.outbox_id);
      failed++;
      logger.error('emailWorker', `send fail outbox_id=${r.outbox_id} to=${r.recipient}: ${msg}`);
    }
  }
  logger.info('emailWorker', `processed=${rows.length} sent=${sent} failed=${failed}`);
  return { processed: rows.length, sent, failed };
}

/** 立即重發單筆（管理介面「重發」按鈕）。 */
async function resendById(db, id) {
  const r = db.prepare(
    'SELECT outbox_id, recipient, subject, body FROM email_outbox WHERE outbox_id=?'
  ).get(Number(id));
  if (!r) return { ok: false, reason: 'not_found' };
  try {
    await sendEmail({ to: r.recipient, subject: r.subject, body: r.body });
    db.prepare("UPDATE email_outbox SET status='SENT', sent_at=datetime('now'), error=NULL WHERE outbox_id=?").run(r.outbox_id);
    return { ok: true, outboxId: r.outbox_id };
  } catch (e) {
    const msg = String((e && e.message) || e);
    db.prepare("UPDATE email_outbox SET status='FAILED', error=? WHERE outbox_id=?").run(msg, r.outbox_id);
    logger.error('emailWorker', `resend fail outbox_id=${r.outbox_id}: ${msg}`);
    return { ok: false, reason: msg };
  }
}

/** 將 FAILED 的滿意度調查信件重置為 PENDING 並立即重送。 */
async function resendFailedSurveys(db) {
  const rows = db.prepare(
    "SELECT outbox_id FROM email_outbox WHERE status='FAILED' AND template IN ('satisfaction_survey','satisfaction_survey_reminder') ORDER BY outbox_id ASC"
  ).all();
  for (const r of rows) {
    db.prepare("UPDATE email_outbox SET status='PENDING', error=NULL WHERE outbox_id=?").run(r.outbox_id);
  }
  const result = await processOutbox(db);
  return { reset: rows.length, ...result };
}

module.exports = { processOutbox, resendById, resendFailedSurveys };
