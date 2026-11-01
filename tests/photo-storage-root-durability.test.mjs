import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { constants } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import ts from 'typescript';
import { z } from 'zod';

const source = fs.readFileSync(new URL('../lib/acquisition-files.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('actual-photo-files.ts', source, ts.ScriptTarget.Latest, true);
const actual = ['filePath', 'readChecked', 'writeAcquisitionPhotoBytes'].map(name => {
  const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, 'Complete actual function: ' + name);
  return ts.transpileModule(node.getText(tree).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}).join('\n');
const digestOf = bytes => createHash('sha256').update(bytes).digest('hex');
const fault = code => Object.assign(new Error('Controlled storage-root barrier'), { code });

// Real owned files and complete production functions. Windows models only Linux
// directory descriptors; actual Linux runs open, sync and close real descriptors.
async function fixture(work, { variant = 'raw', platform = 'linux' } = {}) {
  const parent = path.resolve('.local-data');
  await fsp.mkdir(parent, { recursive: true });
  const root = await fsp.mkdtemp(path.join(parent, 'photo-root-sync-'));
  const directory = path.join(root, 'acquisition-v1');
  const id = randomUUID(), bytes = Buffer.from('Immutable original with a durable containing directory');
  const file = path.join(directory, id + (variant === 'raw' ? '.original' : '.preview.jpg'));
  const neighbor = path.join(root, 'neighbor.original'), neighborBytes = Buffer.from('Unrelated protected original');
  await fsp.writeFile(neighbor, neighborBytes);
  assert.equal(fs.existsSync(directory), false, 'First publication creates the photo directory');
  let failures = new Map();
  const events = [];
  const realHandles = { root: 0, child: 0 };
  function step(name) { events.push(name); if (failures.has(name)) throw failures.get(name); }
  const context = {
    Buffer, AggregateError, Error, constants, path, z, randomUUID,
    PHOTO_MAX_BYTES: 10 * 1024 * 1024, photoDigest: digestOf,
    process: { platform, env: { UPLOADS_DATA_PATH: root } },
    mkdir: fsp.mkdir, lstat: fsp.lstat, realpath: fsp.realpath, statfs: fsp.statfs,
    open: async (target, flags, mode) => {
      if (flags === 'r' && (target === directory || target === root)) {
        const role = target === root ? 'root' : 'child';
        step(role + '-open');
        const handle = process.platform === 'win32' ? undefined : await fsp.open(target, flags);
        if (handle) realHandles[role]++;
        return {
          sync: async () => { step(role + '-sync'); await handle?.sync(); },
          close: async () => { await handle?.close(); step(role + '-close'); },
        };
      }
      if (flags !== 'wx') return fsp.open(target, flags, mode);
      step('photo-open');
      const handle = await fsp.open(target, flags, mode);
      return {
        writeFile: async value => { step('photo-write'); await handle.writeFile(value); },
        sync: async () => { step('photo-sync'); await handle.sync(); },
        close: async () => { await handle.close(); step('photo-close'); },
      };
    },
    link: async (...args) => { step('photo-link'); return fsp.link(...args); },
    unlink: async target => { step('photo-unlink'); return fsp.unlink(target); },
  };
  const write = vm.runInNewContext(actual + '\nwriteAcquisitionPhotoBytes', context);
  const api = {
    events, realHandles, bytes,
    faults: value => { failures = value; },
    attempt: async () => {
      try { await write(id, bytes, variant, digestOf(bytes)); return { failed: false }; }
      catch (error) { return { failed: true, error }; }
    },
    intact: async () => {
      assert.deepEqual(await fsp.readFile(file), bytes);
      assert.deepEqual(await fsp.readFile(neighbor), neighborBytes);
      return { inode: (await fsp.lstat(file)).ino, parts: (await fsp.readdir(directory)).filter(n => n.endsWith('.part')) };
    },
  };
  try { await work(api); }
  finally {
    const exact = path.resolve(root);
    assert.ok(exact.startsWith(parent + path.sep) && path.basename(exact).startsWith('photo-root-sync-'));
    await fsp.rm(exact, { recursive: true, force: true });
  }
}

for (const variant of ['raw', 'preview']) for (const stage of ['open', 'sync', 'close']) {
  test(`${variant} first publication and existing retry refuse persistent storage-root ${stage} failure`, () => fixture(async f => {
    const error = fault('EIO'); f.faults(new Map([['root-' + stage, error]]));
    const first = await f.attempt();
    assert.equal(first.failed, true, 'A failed parent barrier must prevent acknowledgement');
    assert.equal(first.error, error);
    const before = await f.intact(); assert.deepEqual(before.parts, []);
    const retry = await f.attempt(); assert.equal(retry.failed, true); assert.equal(retry.error, error);
    assert.deepEqual(await f.intact(), before, 'Retry preserves exact immutable file and neighbor');
    f.faults(new Map());
    assert.equal((await f.attempt()).failed, false);
    assert.deepEqual(await f.intact(), before);
    assert.equal(f.events.filter(x => x === 'photo-write').length, 1, 'Recovery never rewrites existing bytes');
    assert.equal(f.events.filter(x => x === 'root-open').length, 3, 'Every retry repeats the root barrier');
    assert.equal(f.events.filter(x => x === 'child-sync').length, 3);
  }, { variant }));
}

test('child, root and temporary cleanup failures retain all causes in operation order', () => fixture(async f => {
  const causes = [fault('ENOSPC'), fault('EIO'), fault('EDQUOT'), fault('EACCES'), fault('EPERM')];
  f.faults(new Map([['child-sync', causes[0]], ['child-close', causes[1]], ['root-sync', causes[2]], ['root-close', causes[3]], ['photo-unlink', causes[4]]]));
  const result = await f.attempt(); assert.equal(result.failed, true);
  assert.ok(result.error instanceof AggregateError);
  assert.deepEqual(result.error.errors, causes); assert.equal(result.error.cause, causes[0]); assert.equal(result.error.code, 'ENOSPC');
  assert.equal((await f.intact()).parts.length, 1);
  f.faults(new Map()); assert.equal((await f.attempt()).failed, false);
  assert.equal(f.events.filter(x => x === 'photo-write').length, 1);
}));

for (const value of [undefined, null, false, 0]) test(`falsy storage-root sync failure ${String(value)} cannot acknowledge`, () => fixture(async f => {
  f.faults(new Map([['root-sync', value]]));
  const result = await f.attempt(); assert.equal(result.failed, true); assert.equal(result.error, value);
  assert.deepEqual((await f.intact()).parts, []);
  assert.ok(f.events.includes('root-close'), 'Closing is independent of a failed sync');
}));

test('Windows publication and retry retain existing no-directory-sync behavior', () => fixture(async f => {
  f.faults(new Map([['root-open', fault('EIO')], ['child-open', fault('EIO')]]));
  assert.equal((await f.attempt()).failed, false); const first = await f.intact();
  assert.equal((await f.attempt()).failed, false); assert.deepEqual(await f.intact(), first);
  assert.equal(f.events.some(x => x.startsWith('root-') || x.startsWith('child-')), false);
  assert.equal(f.events.filter(x => x === 'photo-write').length, 1);
}, { platform: 'win32' }));

test('real Linux parent and child descriptors are synced again for an existing file', {
  skip: process.platform === 'win32' ? 'Real directory descriptors run in Linux qualification' : false,
}, () => fixture(async f => {
  assert.equal((await f.attempt()).failed, false); const first = await f.intact();
  assert.equal((await f.attempt()).failed, false); assert.deepEqual(await f.intact(), first);
  assert.deepEqual(f.realHandles, { root: 2, child: 2 });
}));
