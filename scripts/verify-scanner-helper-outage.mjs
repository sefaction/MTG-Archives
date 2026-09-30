// Local Windows process integration: fixture source, no scanner or START.
import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const dotnet = process.env.MTG_SCANNER_DOTNET, dll = process.env.MTG_SCANNER_HELPER_DLL;
if (process.platform !== "win32" || process.env.MTG_LOCAL_PILOT_TEST !== "1" ||
    !dotnet || !dll || !path.isAbsolute(dotnet) || !path.isAbsolute(dll))
  throw new Error("Requires opted-in local Windows helper paths");
let agent = "", pulses = 0, polls = 0, child;
const server = http.createServer(async (request, response) => {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 65536) { response.writeHead(413).end(); return; }
  }
  const body = JSON.parse(text);
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/scanner-agent/pair") {
    agent = body.agentId;
    response.end(JSON.stringify({ version: 1, agentId: agent }));
  } else if (request.url === "/api/scanner-agent/pulse") {
    pulses++;
    response.statusCode = pulses === 1 ? 503 : pulses >= 3 ? 403 : 200;
    response.end(JSON.stringify({ version: 1, agentId: agent }));
  } else if (request.url === "/api/scanner-agent/runs") {
    polls++;
    // This server can never authorize acquisition. Even a buggy client can
    // only use the local fixture backend, not construct NAPS2.
    response.end(JSON.stringify({ version: 1, agentId: agent, run: null }));
  } else { response.writeHead(404).end("{}"); }
});
function run(args, input) {
  return new Promise((resolve, reject) => {
    const process = spawn(dotnet, [dll, ...args], { windowsHide: true,
      env: { ...globalThis.process.env, MTG_LOCAL_PILOT_TEST: "1" } });
    let output = "";
    process.stdout.on("data", bytes => { output += bytes; });
    process.stderr.resume(); process.stdin.end(input);
    const deadline = setTimeout(() => { process.kill(); reject(new Error("Owned helper command deadline")); }, 30000);
    process.once("error", error => { clearTimeout(deadline); reject(error); });
    process.once("exit", code => {
      clearTimeout(deadline);
      code === 0 ? resolve(output) : reject(new Error("Owned helper command failed"));
    });
  });
}
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const site = `http://127.0.0.1:${server.address().port}/`;
  await run(["connect", site, "--local"], `${randomUUID()}.${"A".repeat(43)}\n`);
  let log = "";
  await new Promise((resolve, reject) => {
    // No image is opened unless START exists; this server always returns null.
    child = spawn(dotnet, [dll, "fixture-server", agent, "no-start-fixture.png"], {
      windowsHide: true, env: { ...process.env, MTG_LOCAL_PILOT_TEST: "1" },
    });
    child.stdin.end(); child.stdout.on("data", bytes => { log += bytes; }); child.stderr.resume();
    const deadline = setTimeout(() => { child.kill(); reject(new Error("Helper recovery deadline exceeded")); }, 30000);
    child.once("error", error => { clearTimeout(deadline); reject(error); });
    child.once("exit", code => {
      clearTimeout(deadline);
      code === 0 ? resolve() : reject(new Error("Helper recovery command failed"));
    });
  });
  if (pulses !== 3 || polls !== 1 || !log.includes("Retrying.") || !log.includes("Background helper stopped"))
    throw new Error("Temporary retry or permanent stop did not occur");
  console.log(JSON.stringify({ passed: true, temporary503Retried: true, recoveredPolls: polls,
    permanent403Stopped: true, physicalScans: 0, inventoryChanges: 0 }));
} finally {
  if (child && child.exitCode === null) {
    child.kill(); await new Promise(resolve => child.once("exit", resolve));
  }
  if (agent) {
    await run(["forget", agent]);
    const root = path.resolve(process.env.LOCALAPPDATA, "MTGArchives", "ScannerAgent");
    const own = path.resolve(root, agent);
    if (path.dirname(own) !== root || !/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(agent))
      throw new Error("Owned cleanup identity rejected");
    fs.rmSync(own, { recursive: true, force: true });
  }
  await new Promise(resolve => server.close(resolve));
}
