'use strict';
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const { initDatabase } = require('../src/db/connection');
const { createApp } = require('../src/app');

const tmp = path.join(__dirname, `._dbg_${Date.now()}_${Math.floor(Math.random() * 1e6)}.db`);
process.env.DB_PATH = tmp;
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);

const db = initDatabase();
const app = createApp();

(async () => {
  for (const [u, p] of [['admin', 'Admin@2026'], ['chng_staff', 'ChngSt@2026'], ['chng_sup', 'CcSup@2026']]) {
    const r = await request(app).post('/api/v1/auth/login').send({ username: u, password: p });
    console.log('LOGIN', u, '=>', r.status, JSON.stringify(r.body).slice(0, 160));
  }
  // ESTATE_STAFF permissions
  const ls = await request(app).post('/api/v1/auth/login').send({ username: 'chng_staff', password: 'ChngSt@2026' });
  const tok = ls.body.data && ls.body.data.token;
  const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tok}`);
  console.log('ME chng_staff perms =>', JSON.stringify(me.body.data && me.body.data.permissions));
  const g = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${tok}`);
  console.log('GET /users chng_staff =>', g.status);
  // ADMIN list
  const la = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'Admin@2026' });
  const atok = la.body.data.token;
  const ga = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${atok}`);
  console.log('GET /users admin =>', ga.status, 'total=', ga.body.data && ga.body.data.total);
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
})();
