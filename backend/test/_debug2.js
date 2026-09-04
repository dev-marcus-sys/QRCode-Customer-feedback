'use strict';
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const { initDatabase } = require('../src/db/connection');
const { createApp } = require('../src/app');

const tmp = path.join(__dirname, `._dbg2_${Date.now()}.db`);
process.env.DB_PATH = tmp;
const db = initDatabase();
const app = createApp();

(async () => {
  const lr = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'Admin@2026' });
  console.log('login status', lr.status, 'hasToken', !!(lr.body.data && lr.body.data.accessToken));
  const tok = lr.body.data.accessToken;
  console.log('token head', tok.slice(0, 24));
  const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tok}`);
  console.log('ME status', me.status, 'user', JSON.stringify(me.body.data && me.body.data.username), 'permsHasUserCreate', !!(me.body.data && me.body.data.permissions && me.body.data.permissions.includes('user:create')));
  const g = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${tok}`);
  console.log('GET /users status', g.status, 'total', g.body.data && g.body.data.total);
  const p = await request(app).post('/api/v1/users').set('Authorization', `Bearer ${tok}`).send({ username: 'tmpuser', fullName: '臨時人員', estateCode: 'ALL', roles: ['ESTATE_STAFF'] });
  console.log('POST /users status', p.status, JSON.stringify(p.body).slice(0, 200));
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
})();
