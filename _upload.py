import os, paramiko, sys

LOCAL = r'c:\Users\606610\CodeBuddy\QRCode 客戶意見反饋'
REMOTE_BASE = '/home/devusr/qr-feedback'

host = os.environ['SSH_HOST']; port = int(os.environ['SSH_PORT'])
user = os.environ['SSH_USER']; pw = os.environ['SSH_PASS']

# 相對路徑（相對 LOCAL / REMOTE_BASE）
FILES = [
    r'backend/src/services/mailer.js',
    r'backend/src/services/emailWorker.js',
    r'backend/src/routes/emailAdmin.js',
    r'backend/src/scheduler.js',
    r'backend/src/server.js',
    r'backend/src/app.js',
    r'backend/db/schema.sql',
    r'backend/.env.example',
    r'backend/package.json',
    r'frontend/src/api/client.ts',
    r'frontend/src/App.tsx',
    r'frontend/src/admin/AdminNav.tsx',
    r'frontend/src/pages/admin/EmailDispatchPage.tsx',
    r'frontend/package.json',
    r'deploy_part1.sh',
    r'deploy_part2.sh',
]

def walk(local_dir, remote_dir, out):
    for root, _, names in os.walk(local_dir):
        for n in names:
            lp = os.path.join(root, n)
            rp = os.path.join(remote_dir, os.path.relpath(lp, local_dir)).replace('\\', '/')
            out.append((lp, rp))

# dist 整個目錄
dist_out = []
walk(os.path.join(LOCAL, 'frontend', 'dist'), REMOTE_BASE + '/frontend/dist', dist_out)

all_files = [(os.path.join(LOCAL, f), REMOTE_BASE + '/' + f.replace('\\', '/')) for f in FILES] + dist_out

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, port=port, username=user, password=pw, timeout=20)
sftp = c.open_sftp()
ok = 0; fail = 0
for lp, rp in all_files:
    try:
        d = os.path.dirname(rp)
        try: sftp.stat(d)
        except IOError:
            sftp.mkdir(d)
        sftp.put(lp, rp)
        ok += 1
        if ok % 50 == 0: print('uploaded', ok)
    except Exception as e:
        fail += 1
        print('FAIL', rp, e)
sftp.close(); c.close()
print(f'DONE ok={ok} fail={fail}')
