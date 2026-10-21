// Hosted fixture transport only. The application stays on its internal bridge.
const net = require('node:net');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const [runId, webId, backendAddress, networkId] = process.argv.slice(2);
assert.equal(process.platform, 'linux');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.GITHUB_REPOSITORY, 'sefaction/MTG-Archives');
assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/qualification-inventory-delete-893');
assert.match(runId, /^[a-f0-9-]{36}$/);
assert.match(webId, /^[a-f0-9]{64}$/);
assert.match(networkId, /^[a-f0-9]{64}$/);
assert.equal(net.isIP(backendAddress), 4);
const inspect = (kind, id) => JSON.parse(cp.execFileSync('docker', [kind, 'inspect', id], {encoding:'utf8', timeout:10000}))[0];
const web = inspect('container', webId), network = inspect('network', networkId);
assert.equal(web.Id, webId); assert(web.State.Running);
assert.equal(web.Config.Labels['mtg-isolated-qualification'], runId);
assert.equal(network.Id, networkId); assert.equal(network.Internal, true);
assert.equal(network.Driver, 'bridge'); assert.equal(network.Scope, 'local');
assert.equal(network.Labels['mtg-isolated-qualification'], runId);
assert.equal(Object.keys(web.NetworkSettings.Networks).length, 1);
assert.equal(web.NetworkSettings.Networks[network.Name].NetworkID, networkId);
assert.equal(web.NetworkSettings.Networks[network.Name].IPAddress, backendAddress);
assert(network.Containers[webId]);
const sockets = new Set();
const server = net.createServer(client => {
  const upstream = net.connect({host:backendAddress, port:3000});
  for (const socket of [client, upstream]) {
    sockets.add(socket); socket.setTimeout(30000);
    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => {client.destroy(); upstream.destroy();});
    socket.on('close', () => sockets.delete(socket));
  }
  client.pipe(upstream); upstream.pipe(client);
});
server.maxConnections = 32;
server.on('error', error => {console.error(error.code); process.exitCode=1;});
server.listen(0, '127.0.0.1', () => {
  const {address, port} = server.address();
  assert.equal(address, '127.0.0.1');
  console.log(JSON.stringify({pid:process.pid, address, port, runId, webId, backendAddress, networkId}));
});
process.on('SIGTERM', () => {server.close(); for(const socket of sockets) socket.destroy();});
