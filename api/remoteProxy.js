// The browser's VNC client (noVNC) speaks WebSocket, and VNC servers usually listen on a
// plain ws:// websockify port. The preview is served over https, so a direct ws:// connection
// would be blocked as mixed content. This upgrades `/api/remote/socket?target=<ws url>` and
// pipes it to the VNC endpoint, keeping the session same-origin.
import { WebSocket, WebSocketServer } from 'ws';

const SOCKET_PATH = '/api/remote/socket';

function reject(socket, status, message) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: ${message.length}\r\n\r\n${message}`);
  socket.destroy();
}

export function attachRemoteProxy(server, { path = SOCKET_PATH } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    let request;
    try {
      request = new URL(req.url, 'http://localhost');
    } catch {
      reject(socket, '400 Bad Request', 'Invalid request URL');
      return;
    }
    if (request.pathname !== path) return;

    let target;
    try {
      target = new URL(request.searchParams.get('target') || '');
    } catch {
      reject(socket, '400 Bad Request', 'Invalid target');
      return;
    }
    if (target.protocol !== 'ws:' && target.protocol !== 'wss:') {
      reject(socket, '400 Bad Request', 'Target must be a ws:// or wss:// URL');
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      const upstream = new WebSocket(target.toString(), {
        headers: { Origin: `${target.protocol === 'wss:' ? 'https' : 'http'}://${target.host}` },
        perMessageDeflate: false,
      });

      const close = () => {
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close();
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
      };

      // The VNC client starts talking as soon as its socket opens, which can be before the
      // upstream connection is ready — hold those frames until it is.
      const pending = [];

      client.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        else if (upstream.readyState === WebSocket.CONNECTING) pending.push([data, isBinary]);
      });
      upstream.on('open', () => {
        for (const [data, isBinary] of pending.splice(0)) {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        }
      });
      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      });

      upstream.on('error', (err) => {
        console.error(`remote desktop proxy: ${target.host} — ${err.message}`);
        close();
      });
      upstream.on('close', close);
      client.on('close', close);
      client.on('error', close);
    });
  });

  return wss;
}
