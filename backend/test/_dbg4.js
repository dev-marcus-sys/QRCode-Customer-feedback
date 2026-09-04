'use strict';
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const { initDatabase } = require('../src/db/connection');
const { createApp } = require('../src/app');

const tmp = path.join(__dirname, `._dbg4_${Date.now()}.db`);
process.env.DB_PATH = tmp;
const db = initDatabase();
const app = createApp();

(async () => {
  const lr = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'Admin@2026' });
  const tok = lr.body.data.accessToken;
  const dump = async (label, p) => { const r = await p; console.log(label, '=>', r.status, JSON.stringify(r.body).slice(0, 160)); return r; };
  await dump('1 create tmpuser', request(app).post('/api/v1/users').set('Authorization', `Bearer ${tok}`).send({ username: 'tmpuser', fullName: '臨時人員', estateCode: 'ALL', roles: ['ESTATE_STAFF'] }));
  await dump('2 change no-curr', request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${tok}`).send({ newPassword: 'NewPwd@2026' }));
  await dump('3 change wrong', request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${tok}`).send({ currentPassword: 'wrong', newPassword: 'NewPwd@2026' }));
  const r4 = await dump('4 change correct', request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${tok}`).send({ currentPassword: 'Admin@2026', newPassword: 'Admin@2027' }));
  console.log('   body keys', Object.keys(r4.body));
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
})();
