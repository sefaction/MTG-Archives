import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'js-yaml';

const read = path => readFileSync(path, 'utf8');
const hybrid = load(read('docker-compose.unraid.hybrid.yml'));
const flat = load(read('docker-compose.unraid.flat.yml'));

test('production hybrid is opt-in and disables automatic confirmation at its actual catalog owner', () => {
  assert.equal(flat.services['acquisition-visual-worker'], undefined);
  assert.equal(flat.services['acquisition-printing-worker'], undefined);
  for (const name of ['web', 'acquisition-catalog-worker']) {
    assert.equal(hybrid.services[name].environment.ACQUISITION_VISUAL_ENABLED, '1');
    assert.equal(hybrid.services[name].environment.ACQUISITION_PRINTING_ENABLED, '1');
  }
  const local = load(read('docker-compose.printing.local.yml'));
  assert.equal(local.services['acquisition-catalog-worker'].environment.ACQUISITION_PRINTING_ENABLED, '1');
});

test('production inference uses only existing read-only assets and the isolated database network', () => {
  assert.equal(flat.networks['acquisition-internal'].internal, true);
  for (const name of ['acquisition-visual-worker', 'acquisition-printing-worker']) {
    const worker = hybrid.services[name];
    assert.equal(worker.image, '${ACQUISITION_VISUAL_IMAGE:-ghcr.io/sefaction/mtg-archives-visual:${IMAGE_TAG:-main}}');
    assert.equal(worker.pull_policy, 'always');
    assert.deepEqual(worker.networks, ['acquisition-internal']);
    assert.equal(worker.ports, undefined);
    assert.equal(worker.build, undefined);
    assert.equal(worker.privileged, undefined);
    assert.equal(worker.cpus, 1);
    assert.equal(worker.pids_limit, 128);
    assert.equal(worker.depends_on.web.condition, 'service_healthy');
    assert.deepEqual(Object.keys(worker.environment).sort(), ['DATABASE_URL', 'UPLOADS_DATA_PATH']);
    for (const mount of worker.volumes) {
      assert.equal(mount.type, 'bind');
      assert.equal(mount.read_only, true);
      assert.equal(mount.bind.create_host_path, false);
      assert.match(mount.source, /\$\{[A-Z_]+:\?/);
    }
    assert.ok(worker.volumes.some(v => v.target === '/visual/index'));
    assert.ok(worker.volumes.some(v => v.target === '/visual/references'));
  }
  assert.equal(hybrid.services['acquisition-visual-worker'].mem_limit, '3g');
  assert.equal(hybrid.services['acquisition-printing-worker'].mem_limit, '1g');
  assert.ok(hybrid.services['acquisition-visual-worker'].volumes.some(v => v.target === '/visual/models'));
  assert.ok(!hybrid.services['acquisition-printing-worker'].volumes.some(v => v.target === '/visual/models'));
  assert.deepEqual(hybrid.services['acquisition-printing-worker'].entrypoint,
    ['node', 'node_modules/tsx/dist/cli.mjs', 'scripts/acquisition-printing-worker.ts']);
});

test('the published visual image uses the canonical recipe and offline prepublication smoke gate', () => {
  const workflow = load(read('.github/workflows/docker-publish.yml'));
  const job = workflow.jobs.web;
  const visual = job.strategy.matrix.include.find(row => row.component === 'visual');
  assert.equal(visual.image, 'sefaction/mtg-archives-visual');
  assert.equal(visual.dockerfile, './tools/acquisition-runtime/Dockerfile.visual');
  const smokeIndex = job.steps.findIndex(step => step.name === 'Verify offline visual and printing runtime imports and symbol assets');
  assert.ok(smokeIndex > 0);
  assert.match(job.steps[smokeIndex].if, /matrix.component == 'visual'/);
  assert.match(job.steps[smokeIndex].run, /--network none --user 65534:65534/);
  assert.match(job.steps[smokeIndex].run, /import torch, torchvision, visual, printing_worker/);
  assert.match(job.steps[smokeIndex].run, /verified_assets\(symbol_asset_root\(\)\)/);
  assert.ok(smokeIndex < job.steps.findIndex(step => step.name === 'Recheck branch head immediately before publication'));
});
