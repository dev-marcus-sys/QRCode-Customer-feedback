import os, paramiko, time

host = os.environ['SSH_HOST']; port = int(os.environ['SSH_PORT'])
user = os.environ['SSH_USER']; pw = os.environ['SSH_PASS']

ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, port=port, username=user, password=pw, timeout=20)
sftp = ssh.open_sftp()

ENV = '/home/devusr/qr-feedback/backend/.env'
with sftp.open(ENV) as f:
    content = f.read().decode('utf-8')

if 'APP_ENV' in content:
    print('APP_ENV already present in .env:')
    for line in content.splitlines():
        if line.strip().startswith('APP_ENV'):
            print('   ', line)
else:
    with sftp.open(ENV, 'a') as f:
        f.write('\n# 執行環境標籤（頁面底部環境條：本機 / 測試 / 正式）\nAPP_ENV=test\n')
    print('APP_ENV=test appended to', ENV)
sftp.close()

print('--- stopping node src/server.js ---')
ssh.exec_command("pkill -f 'node src/server.js' || true")
time.sleep(2)

print('--- starting via start.sh ---')
ssh.exec_command('sh /home/devusr/qr-feedback/start.sh')
time.sleep(7)

print('--- health (expect environment.key=test) ---')
_, stdout, stderr = ssh.exec_command('curl -s -m 8 http://127.0.0.1:3100/api/v1/health')
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())
ssh.close()
