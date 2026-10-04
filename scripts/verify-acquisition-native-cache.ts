import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { acquisitionNativeEnvironment } from "../lib/acquisition-native-environment";

// Run inside the recognition image. Reproduce a root application creating its
// cache first, then exercise a real restricted child writing Paddle scratch.
assert.equal(process.platform, "linux");
assert.equal(process.getuid?.(), 0);
assert.ok(process.env.HOME);
const applicationCache = join(process.env.HOME, ".cache", "prisma");
mkdirSync(applicationCache, { recursive: true });
const marker = join(applicationCache, `native-cache-check-${randomUUID()}`);
writeFileSync(marker, "application cache", { flag: "wx" });
try {
  const evidence = JSON.parse(execFileSync("python", ["-c", `
import json, os, pathlib, tempfile
home = pathlib.Path(os.environ['HOME'])
cache = pathlib.Path(os.environ['PADDLE_PDX_CACHE_HOME']) / 'temp'
cache.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryFile(dir=cache) as scratch:
    scratch.write(b'native scratch')
    scratch.flush()
    scratch.seek(0)
    assert scratch.read() == b'native scratch'
print(json.dumps({'home': str(home), 'uid': os.getuid(), 'gid': os.getgid(),
                  'homeOwner': home.stat().st_uid, 'cacheOwner': cache.stat().st_uid}))
`], { ...acquisitionNativeEnvironment(), encoding: "utf8", timeout: 10000 }));
  assert.notEqual(evidence.home, process.env.HOME);
  assert.equal(evidence.uid, 65534);
  assert.equal(evidence.gid, 65534);
  assert.equal(evidence.homeOwner, 65534);
  assert.equal(evidence.cacheOwner, 65534);
  console.log("PASS: application cache creation leaves restricted native scratch writable");
} finally {
  unlinkSync(marker);
}
