import os, paramiko, sys
host=os.environ['SSH_HOST']; port=int(os.environ['SSH_PORT'])
user=os.environ['SSH_USER']; pw=os.environ['SSH_PASS']
cmd=sys.argv[1] if len(sys.argv)>1 else 'echo hi'
timeout=int(os.environ.get('SSH_TIMEOUT','60'))
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, port=port, username=user, password=pw, timeout=20)
stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
sys.stdout.write(stdout.read().decode(errors='replace'))
err=stderr.read().decode(errors='replace')
if err.strip(): sys.stderr.write(err)
c.close()
