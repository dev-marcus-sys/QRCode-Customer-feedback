#!/bin/bash
R=/home/devusr/qr-feedback
B=$R/backend
export PATH=/home/devusr/node20/bin:$PATH
echo "=== restart app ==="
cd "$R"
kill $(cat qr.pid) 2>/dev/null; sleep 1
bash ./start.sh
sleep 6
cd "$B"
echo "=== listen 3100 ==="
(ss -ltn | grep 3100) || echo "NOT LISTENING"
echo "=== health ==="
curl -s http://localhost:3100/api/v1/health; echo
echo "=== insert test email (PENDING) ==="
node -e "const D=require('better-sqlite3');const db=new D('./data/qr_feedback.sqlite');db.prepare(\"INSERT INTO email_outbox (case_id,template,recipient,lang,subject,body,status) VALUES (?,?,?,?,?,?,?)\").run('TEST','test','sysalert@synergis.com.hk','zh-Hant','SMTP 測試','這是一封 QR 意見系統的 SMTP 測試信件。','PENDING');console.log('inserted test row')"
echo "=== wait 18s for email worker ==="
sleep 18
echo "=== test row status ==="
node -e "const D=require('better-sqlite3');const db=new D('./data/qr_feedback.sqlite');const r=db.prepare(\"SELECT status,error,sent_at FROM email_outbox WHERE template='test' ORDER BY outbox_id DESC LIMIT 1\").get();console.log(JSON.stringify(r))"
echo "=== email_outbox stats ==="
node -e "const D=require('better-sqlite3');const db=new D('./data/qr_feedback.sqlite');console.log(JSON.stringify(db.prepare(\"SELECT status,COUNT(*) c FROM email_outbox GROUP BY status\").all()))"
echo "PART2 DONE"
