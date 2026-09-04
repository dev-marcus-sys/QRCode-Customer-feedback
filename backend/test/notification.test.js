'use strict';
process.env.DB_PATH = ':memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { applySchema } = require('../src/db/connection');
const { ensureDefaults } = require('../src/db/ensureDefaults');
const notif = require('../src/services/notificationService');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  // eslint-disable-next-line global-require
  const { seed } = require('../db/seed');
  seed(db);
  ensureDefaults(db);
  return db;
}

function uid(db, username) {
  return db.prepare('SELECT user_id FROM sys_user WHERE username = ?').get(username).user_id;
}

test('notifyUser：站內＋電郵雙通道；停用用戶不回寫', () => {
  const db = freshDb();
  const staffId = uid(db, 'chng_staff'); // seed 提供 email
  const id1 = notif.notifyUser(db, { userId: staffId, notifType: 'REMINDER', title: '臨期提醒', body: '請於期限內回應', refId: 'CASE1' });
  assert.ok(id1);
  const row = db.prepare('SELECT channel AS c, is_read AS r FROM notification WHERE notif_id = ?').get(id1);
  assert.equal(row.c, 'BOTH');
  assert.equal(row.r, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM email_outbox').get().c, 1);
  // 停用用戶／不存在用戶不回寫
  db.prepare("UPDATE sys_user SET is_active = 0 WHERE user_id = ?").run(staffId);
  assert.equal(notif.notifyUser(db, { userId: staffId, notifType: 'CASE', title: 'x', body: 'y' }), null);
});

test('通知中心：列表／未讀數／單筆已讀／全部已讀（僅本人）', () => {
  const db = freshDb();
  const staffId = uid(db, 'chng_staff');
  const otherId = uid(db, 'chng_sup');
  notif.notifyUser(db, { userId: staffId, notifType: 'REMINDER', title: 'A', body: 'a', refId: 'C1' });
  notif.notifyUser(db, { userId: staffId, notifType: 'ESCALATION', title: 'B', body: 'b', refId: 'C2' });
  notif.notifyUser(db, { userId: otherId, notifType: 'CASE', title: 'C', body: 'c', refId: 'C3' });
  assert.equal(notif.unreadCount(db, staffId), 2);
  const page1 = notif.listNotifications(db, staffId, { pageSize: 1 });
  assert.equal(page1.total, 2);
  assert.equal(page1.items.length, 1);
  assert.equal(page1.items[0].isRead, false);
  const firstId = page1.items[0].notifId;
  // 標記他人通知失敗
  assert.equal(notif.markRead(db, otherId, firstId), false);
  assert.equal(notif.markRead(db, staffId, firstId), true);
  assert.equal(notif.unreadCount(db, staffId), 1);
  notif.markAllRead(db, staffId);
  assert.equal(notif.unreadCount(db, staffId), 0);
  assert.equal(notif.listNotifications(db, staffId, { unreadOnly: true }).total, 0);
  // 他人通知不受影響
  assert.equal(notif.unreadCount(db, otherId), 1);
});

test('reviewersForCase：含同屋苑主管＋客服主管＋管理員，排除操作者', () => {
  const db = freshDb();
  const staffId = uid(db, 'chng_staff');
  const ids = notif.reviewersForCase(db, 'CHNG', staffId).map((r) => r.userId);
  assert.ok(ids.includes(uid(db, 'chng_sup')));
  assert.ok(ids.includes(uid(db, 'cc_sup')));
  assert.ok(ids.includes(uid(db, 'admin')));
  assert.ok(!ids.includes(staffId));
});
