import os, json, paramiko, time

LOCAL = r'c:\Users\606610\CodeBuddy\QRCode 客戶意見反饋'
REMOTE_BASE = '/home/devusr/qr-feedback'

_creds_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_creds.json')
if os.path.exists(_creds_file):
    with open(_creds_file, encoding='utf-8') as _f:
        _c = json.load(_f)
else:
    _c = {k: os.environ[k] for k in ('SSH_HOST', 'SSH_PORT', 'SSH_USER', 'SSH_PASS')}
host = _c['SSH_HOST'].strip(); port = int(str(_c['SSH_PORT']).strip())
user = _c['SSH_USER'].strip(); pw = _c['SSH_PASS']

# 要同步的根目錄（相對 LOCAL）
SYNC_DIRS = ['backend', 'frontend', 'docs']

# 排除：目錄
EXC_DIRS = {'node_modules', 'dist', 'data', '.git', 'coverage', '.cache'}
# 排除：檔案（名稱或後綴）
EXC_FILES = {'.env'}
EXC_SUFFIX = ('.log', '.err', '.out', '.local', '.tsbuildinfo', '.db', '.mjs')
EXC_NAME_PREFIX = ('vite.config.ts.timestamp-', '._')

def skip_file(name):
    if name in EXC_FILES:
        return True
    if name.endswith(EXC_SUFFIX):
        return True
    for p in EXC_NAME_PREFIX:
        if name.startswith(p):
            return True
    return False

def collect(local_root):
    out = []
    for root, dirs, files in os.walk(local_root):
        dirs[:] = [d for d in dirs if d not in EXC_DIRS]
        for n in files:
            if skip_file(n):
                continue
            lp = os.path.join(root, n)
            rp = os.path.join(REMOTE_BASE, os.path.relpath(lp, LOCAL)).replace('\\', '/')
            out.append((lp, rp))
    return out

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, port=port, username=user, password=pw, timeout=20)
sftp = c.open_sftp()

files = []
for d in SYNC_DIRS:
    files += collect(os.path.join(LOCAL, d))

ok = 0; fail = 0
for lp, rp in files:
    try:
        d = os.path.dirname(rp)
        try:
            sftp.stat(d)
        except IOError:
            sftp.mkdir(d)
        sftp.put(lp, rp)
        ok += 1
    except Exception as e:
        fail += 1
        print('FAIL', rp, e)
sftp.close()
print(f'UPLOAD ok={ok} fail={fail}')

# 遠端：安裝 / 建置 / 確保 APP_ENV=test / 重啟 / health
script = r'''
export PATH=/home/devusr/node20/bin:$PATH
set -e
echo "== backend npm ci =="
cd /home/devusr/qr-feedback/backend && npm ci --no-audit --no-fund
echo "== frontend npm ci + build =="
cd /home/devusr/qr-feedback/frontend && npm ci --no-audit --no-fund && npm run build
echo "== ensure APP_ENV=test =="
grep -q '^APP_ENV=' /home/devusr/qr-feedback/backend/.env || echo 'APP_ENV=test' >> /home/devusr/qr-feedback/backend/.env
echo "== restart =="
pkill -f 'node src/server.js' || true
sleep 2
sh /home/devusr/qr-feedback/start.sh
sleep 9
echo "HEALTH: $(curl -s -m8 http://127.0.0.1:3100/api/v1/health)"
'''
stdin, stdout, stderr = c.exec_command(script, timeout=1200)
_out = stdout.read().decode('utf-8', 'replace')
_err = stderr.read().decode('utf-8', 'replace')
print(_out.encode('cp950', 'replace').decode('cp950'))
print('ERR:', _err.encode('cp950', 'replace').decode('cp950'))
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '_deploy_last.log'), 'w', encoding='utf-8') as _lf:
    _lf.write(_out + '\n---ERR---\n' + _err)
c.close()
