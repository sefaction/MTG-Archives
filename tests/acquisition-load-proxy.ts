/** Fixed TCP ingress for an otherwise internal-only local load-test network.
 * The browser/database host clients retain their original protocol and guards.
 * This program has no request-controlled destination or outbound fetch path. */
export const acquisitionLoadProxyProgram = String.raw`
const net = require('node:net');
const sockets = new Set();
const servers = [];
for (const [listen, host, port] of [[8080, 'web', 3000], [15432, 'postgres', 5432]]) {
  const server = net.createServer(client => {
    const upstream = net.connect({host, port});
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('error', () => { client.destroy(); upstream.destroy(); });
      socket.on('close', () => sockets.delete(socket));
    }
    client.on('close', () => upstream.destroy());
    // Normal EOF must let the client drain queued response bytes. A truncated
    // upstream connection still fails the downstream connection visibly.
    upstream.on('close', hadError => { if (hadError || !upstream.readableEnded) client.destroy(); });
    client.pipe(upstream).pipe(client);
  });
  server.on('error', () => process.exit(1));
  server.listen(listen, '0.0.0.0', () => console.log(JSON.stringify({event:'isolated-load-proxy-ready', listen, host, port})));
  servers.push(server);
}
process.on('SIGTERM', () => {
  for (const socket of sockets) socket.destroy();
  let pending = servers.length;
  for (const server of servers) server.close(() => { if (--pending === 0) process.exit(0); });
});
`;
