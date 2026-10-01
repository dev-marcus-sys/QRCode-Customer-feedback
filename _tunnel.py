import os, socket, select, socketserver, threading, paramiko, sys

SERVER = '11.0.11.211'
SSH_PORT = 2233
USER = 'devusr'
PASS = os.environ.get('TUNNEL_PASS', 'DEV@cce55')
LOCAL_PORT = 18080
REMOTE_HOST = '127.0.0.1'
REMOTE_PORT = 8080

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(SERVER, port=SSH_PORT, username=USER, password=PASS, timeout=20)
transport = client.get_transport()
transport.set_keepalive(30)
print('SSH tunnel up: localhost:%d -> %s:%d' % (LOCAL_PORT, REMOTE_HOST, REMOTE_PORT), flush=True)

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            chan = transport.open_channel('direct-tcpip', (REMOTE_HOST, REMOTE_PORT), self.request.getpeername())
        except Exception:
            self.request.close(); return
        if chan is None:
            self.request.close(); return
        while True:
            r, w, x = select.select([self.request, chan], [], [], 60)
            if not r: continue
            if self.request in r:
                data = self.request.recv(16384)
                if not data: break
                chan.sendall(data)
            if chan in r:
                data = chan.recv(16384)
                if not data: break
                self.request.sendall(data)
        try: chan.close()
        except Exception: pass
        self.request.close()

class TS(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

srv = TS(('127.0.0.1', LOCAL_PORT), Handler)
print('READY', flush=True)
srv.serve_forever()
