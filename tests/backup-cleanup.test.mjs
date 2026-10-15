import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/backup.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('backup.ts', source, ts.ScriptTarget.Latest, true);
const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'createBackup');
assert.ok(fn, 'Exercise the complete actual backup workflow, including its cleanup');
const code = ts.transpileModule(fn.getText(tree).replace(/^export\s+/, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

async function exercise(faults = new Map()) {
  const calls = [], manifest = { included: { appdata: false }, test: 'fixed-manifest' };
  const step = name => { calls.push(name); if (faults.has(name)) throw faults.get(name); };
  const context = {
    AggregateError, Error, process: { env: { DATABASE_URL: 'fixed-owned-control' } },
    loadEnvFile() {}, parseDatabaseUrl: () => ({ schema: 'public' }), buildPgEnv: () => ({}),
    assertMatchingDumpClient: async () => step('client'),
    resolve: x => x, getApplicationBackupDir: () => '/owned-backups',
    mkdir: async () => {}, timestampForFilename: () => 'fixed',
    mkdtemp: async () => '/owned-workspace', tmpdir: () => '/tmp', join: path.posix.join,
    beginCorrectionBackup: async () => { step('guard'); return { release: async () => step('release') }; },
    runCommand: async name => step(name),
    prepareAppdataArchive: async () => { step('appdata'); return []; },
    buildManifest: async () => manifest, writeFile: async () => {}, restoreReadme: () => 'fixed',
    stat: async () => ({ size: 42 }), applyRetention: async () => step('retention'),
    rm: async file => { assert.equal(file, '/owned-workspace'); step('workspace'); },
    DB_DUMP_FILENAME: 'database.dump', MANIFEST_FILENAME: 'manifest.json',
    RESTORE_README_FILENAME: 'README.txt', APPDATA_ARCHIVE_FILENAME: 'appdata.tar.gz',
    BACKUP_PREFIX: 'backup-', BACKUP_SUFFIX: '.tar.gz',
  };
  let value, failed = false, error;
  try { value = await vm.runInNewContext(code + '\ncreateBackup()', context); }
  catch (cause) { failed = true; error = cause; }
  return { calls, value, failed, error, manifest };
}

test('actual backup retains workflow, guard release and workspace failure in order', async () => {
  const failures = [Error('dump'), Error('release'), Error('workspace')];
  const result = await exercise(new Map([['pg_dump', failures[0]], ['release', failures[1]], ['workspace', failures[2]]]));
  assert.equal(result.failed, true);
  assert.ok(result.error instanceof AggregateError);
  assert.deepEqual(result.error.errors, failures);
  assert.equal(result.error.cause, failures[0]);
  assert.ok(result.error.message.startsWith(failures[0].message));
  assert.deepEqual(result.calls, ['client', 'guard', 'pg_dump', 'release', 'workspace']);
});

for (const failedStep of ['guard', 'pg_dump', 'appdata', 'tar', 'retention', 'release', 'workspace']) {
  test('actual backup preserves a lone ' + failedStep + ' failure identity and attempts remaining cleanup', async () => {
    const failure = Error(failedStep), result = await exercise(new Map([[failedStep, failure]]));
    assert.equal(result.failed, true);
    assert.equal(result.error, failure);
    assert.ok(result.calls.includes('workspace'));
    if (failedStep !== 'guard') assert.ok(result.calls.includes('release'));
    else assert.equal(result.calls.includes('release'), false);
  });
}

test('successful workflow still fails when both cleanup actions fail', async () => {
  const failures = [Error('release'), Error('workspace')];
  const result = await exercise(new Map([['release', failures[0]], ['workspace', failures[1]]]));
  assert.equal(result.failed, true);
  assert.ok(result.error instanceof AggregateError);
  assert.deepEqual(result.error.errors, failures);
  assert.equal(result.error.cause, failures[0]);
  assert.ok(result.calls.includes('retention'));
});

for (const falsy of [undefined, null, false, 0, '']) {
  test('actual backup retains a falsy workflow throw: ' + String(falsy), async () => {
    const cleanup = Error('release'), result = await exercise(new Map([['pg_dump', falsy], ['release', cleanup]]));
    assert.equal(result.failed, true);
    assert.ok(result.error instanceof AggregateError);
    assert.deepEqual(result.error.errors, [falsy, cleanup]);
    assert.equal(result.error.cause, falsy);
    const alone = await exercise(new Map([['pg_dump', falsy]]));
    assert.equal(alone.failed, true);
    assert.equal(alone.error, falsy);
  });
}

test('actual successful backup returns the same completed archive only after both cleanup actions', async () => {
  const result = await exercise();
  assert.equal(result.failed, false);
  assert.equal(result.value.path, '/owned-backups/backup-fixed.tar.gz');
  assert.equal(result.value.sizeBytes, 42);
  assert.equal(result.value.manifest, result.manifest);
  assert.deepEqual(result.calls, ['client', 'guard', 'pg_dump', 'appdata', 'tar', 'retention', 'release', 'workspace']);
});
