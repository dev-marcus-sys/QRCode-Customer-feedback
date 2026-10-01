#!/bin/bash
set -e
B=/home/devusr/qr-feedback/backend
export PATH=/home/devusr/node20/bin:$PATH
echo "=== install nodemailer ==="
cd "$B" && npm install nodemailer 2>&1 | tail -6
node -e "require('nodemailer');console.log('nodemailer OK')"
echo "=== ALTER email_outbox add sent_at/error ==="
node -e "const D=require('better-sqlite3');const db=new D('$B/data/qr_feedback.sqlite');const cols=db.prepare('PRAGMA table_info(email_outbox)').all().map(r=>r.name);for(const c of [['sent_at','ALTER TABLE email_outbox ADD COLUMN sent_at TEXT'],['error','ALTER TABLE email_outbox ADD COLUMN error TEXT']]){if(!cols.includes(c[0])){db.prepare(c[1]).run();console.log('added',c[0])}else console.log('exists',c[0])};console.log('ALTER done')"
echo "=== append SMTP to .env ==="
node -e "const fs=require('fs');const p='$B/.env';let s=fs.readFileSync(p,'utf8');if(s.includes('SMTP_HOST')){console.log('SMTP present')}else{fs.appendFileSync(p,'\n# SMTP (added for email sending)\nSMTP_HOST=11.0.1.130\nSMTP_PORT=25\nSMTP_USER=\nSMTP_PASS=\nMAIL_FROM=sysalert@synergis.com.hk\nEMAIL_SCAN_INTERVAL_MS=15000\n');console.log('SMTP appended')}"
echo "=== clear stale PENDING (test env) ==="
node -e "const D=require('better-sqlite3');const db=new D('$B/data/qr_feedback.sqlite');const n=db.prepare(\"DELETE FROM email_outbox WHERE status='PENDING'\").run();console.log('cleared',n.changes)"
echo "PART1 DONE"
