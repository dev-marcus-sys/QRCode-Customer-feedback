import os, paramiko, io

host=os.environ['SSH_HOST']; port=int(os.environ['SSH_PORT'])
user=os.environ['SSH_USER']; pw=os.environ['SSH_PASS']

ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, port=port, username=user, password=pw, timeout=20)
sftp=ssh.open_sftp()

start_sh = r'''#!/bin/sh
# QR Feedback 服務啟動腳本（開機自啟 / watchdog 共用）
export PATH=/home/devusr/node20/bin:$PATH
cd /home/devusr/qr-feedback/backend
# 等待系統基本就緒（磁碟/網路），避免過早啟動
sleep 5
nohup /home/devusr/node20/bin/node src/server.js >> /home/devusr/qrfb_server.log 2>&1 &
echo $! > /home/devusr/qr-feedback/qr.pid
'''

watchdog_sh = r'''#!/bin/sh
# 看門狗：若 QR Feedback 服務未運行則重新啟動（無 sudo 也能崩潰自愈）
pgrep -f "node src/server.js" >/dev/null 2>&1 || /home/devusr/qr-feedback/start.sh
'''

for name, content in (('start.sh', start_sh), ('watchdog.sh', watchdog_sh)):
    remote = '/home/devusr/qr-feedback/' + name
    sftp.putfo(io.BytesIO(content.encode()), remote)
    sftp.chmod(remote, 0o755)
    print('WROTE', remote)

sftp.close()

# 語法檢查
for name in ('start.sh', 'watchdog.sh'):
    stdin, stdout, stderr = ssh.exec_command('sh -n /home/devusr/qr-feedback/%s && echo OK_%s' % (name, name))
    print(name, '->', stdout.read().decode().strip(), stderr.read().decode().strip())

# 寫入 crontab（去重：先移除舊的 qr-feedback 相關行，再追加）
cron_cmd = """( crontab -l 2>/dev/null | grep -v 'qr-feedback' ; cat <<'EOF'
@reboot /home/devusr/qr-feedback/start.sh >> /home/devusr/qrfb_reboot.log 2>&1
* * * * * /home/devusr/qr-feedback/watchdog.sh >> /home/devusr/qrfb_watchdog.log 2>&1
EOF
) | crontab -
"""
stdin, stdout, stderr = ssh.exec_command(cron_cmd, timeout=30)
print('CRON_OUT', stdout.read().decode().strip())
print('CRON_ERR', stderr.read().decode().strip())

# 驗證
stdin, stdout, stderr = ssh.exec_command(
    'echo "=== crontab ==="; crontab -l; echo "=== files ==="; ls -l /home/devusr/qr-feedback/start.sh /home/devusr/qr-feedback/watchdog.sh; echo "=== current svc ==="; pgrep -af "node src/server.js"', timeout=30)
print(stdout.read().decode())
print(stderr.read().decode())
ssh.close()
