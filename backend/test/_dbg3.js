'use strict';
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const { initDatabase } = require('../src/db/connection');
const { createApp } = require('../src/app');
const { isStrong } = require('../src/utils/password');

const tmp = path.join(__dirname, `._dbg3_${Date.now()}.db`);
process.env.DB_PATH = tmp;
const db = initDatabase();
const app = createApp();

(async () => {
  console.log('isStrong Admin@2027 =>', isStrong('Admin@2027'));
  const lr = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'Admin@2026' });
  const tok = lr.body.data.accessToken;
  console.log('login', lr.status);
  const r1 = await request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${tok}`).send({ newPassword: 'NewPwd@2026' });
  console.log('no-curr =>', r1.status, JSON.stringify(r1.body).slice(0,120));
  const r2 = await request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${tok}`).send({ currentPassword: 'Admin@2026', newPassword: 'Admin@2027' });
  console.log('correct =>', r2.status, JSON.stringify(r2.body).slice(0,120));
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
})();
