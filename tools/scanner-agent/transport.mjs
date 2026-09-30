import { createHash, randomUUID } from 'node:crypto';
import { readFile, open, readdir, lstat, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function localBase(value) {
  const base = new URL(value);
  if (base.origin !== 'http://127.0.0.1:13001' || base.pathname !== '/' || base.search || base.hash)
    throw new Error('Qualification transport is restricted to the local Docker app');
  return base;
}
export async function sessionInstruction(baseUrl, sessionId, cookie, fetcher = fetch) {
  const base = localBase(baseUrl);
  if (!uuid.test(sessionId) || !cookie) throw new Error('Authenticated existing session required');
  const response = await fetcher(new URL(`/api/acquisition/${sessionId}`, base), {
    headers: {Cookie:cookie}, redirect:'error', signal:AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error('Session unavailable');
  const progress = await response.json();
  if (progress.id !== sessionId || progress.phase !== 'CAPTURING' || !progress.destinationCurrent)
    throw new Error('Session is not accepting capture');
  const remaining = progress.availableSlots;
  if (remaining !== null && (!Number.isSafeInteger(remaining) || remaining <= 0))
    throw new Error('Session has no available capture slots');
  // Pass through server authority; no inventory query or local capacity formula.
  return {version:1,sessionId,sessionRevision:progress.revision,
    sessionPhysicalTarget:remaining,targetEvidence:'existing acquisition availableSlots',
    automaticPhysicalEnforcement:'UNSUPPORTED',imageStopBudget:null};
}
async function json(file) { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
async function writeOnce(file, data) {
  const temporary = `${file}.${randomUUID()}.pending`;
  const stream = await open(temporary, 'wx');
  try { await stream.writeFile(JSON.stringify(data, null, 2)); await stream.sync(); }
  finally { await stream.close(); }
  try { await link(temporary, file); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  finally { await unlink(temporary); }
  const actual = await json(file);
  if (JSON.stringify(actual) !== JSON.stringify(data)) throw new Error('Transport identity conflict');
}
export async function auditRun(directory) {
  const run = await json(path.join(directory, 'run.json'));
  if (!uuid.test(run.request.runId) || run.version !== 1) throw new Error('Invalid spool run');
  const files = await readdir(directory);
  const artifacts = [];
  for (const name of files.filter(n => uuid.test(n.slice(0, -5)) && n.endsWith('.json'))) {
    const artifact = await json(path.join(directory, name));
    if (artifact.id !== name.slice(0, -5) || artifact.fileName !== `${artifact.id}.png` ||
        !Number.isSafeInteger(artifact.sequence) || artifact.sequence < 1)
      throw new Error('Invalid artifact identity');
    const file = path.join(directory, artifact.fileName);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe spool artifact');
    const bytes = await readFile(file);
    if (bytes.length !== artifact.bytes || sha(bytes) !== artifact.sha256) throw new Error('Spool integrity failure');
    artifacts.push(artifact);
  }
  artifacts.sort((a, b) => a.sequence - b.sequence);
  if (artifacts.some((a, i) => a.sequence !== i + 1)) throw new Error('Missing or duplicate transfer sequence');
  const unjournaled = files.filter(n => n.endsWith('.png') && !artifacts.some(a => a.fileName === n));
  const journalText = await readFile(path.join(directory, 'events.jsonl'), 'utf8');
  // A partial last line is interruption evidence, never silently discarded.
  let events;
  try { events = journalText.trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch { throw new Error('Interrupted event journal requires reconciliation'); }
  if (events.some((e, i) => e.sequence !== i + 1)) throw new Error('Broken event sequence');
  const received = events.filter(e => e.kind === 'ImageReceived');
  if (received.length !== artifacts.length || received.some((e, i) => e.evidence.sha256 !== artifacts[i].sha256 || e.evidence.id !== artifacts[i].id))
    throw new Error('Image/journal reconciliation required');
  return { run, artifacts, unjournaled, events, completed: events.at(-1)?.kind === 'AcquisitionCompleted' };
}

// Bounded local qualification transport, no new service or authentication scheme.
// Operator reconciles actual physical fronts first; duplex is NEVER auto-paired.
// Existing server owns owner/destination/capacity and all processing/commit rules.
export async function deliver(directory, plan, cookie, fetcher = fetch) {
  const base = localBase(plan.baseUrl);
  if (!cookie || !uuid.test(plan.sessionId) || !Array.isArray(plan.physicalFronts) ||
      !plan.physicalFronts.length || plan.physicalFronts.some(id => !uuid.test(id)) ||
      new Set(plan.physicalFronts).size !== plan.physicalFronts.length ||
      plan.operatorReconciledPhysicalFronts !== true)
    throw new Error('Authenticated session and explicit physical-front reconciliation required');
  const audit = await auditRun(directory);
  if (!audit.completed || audit.unjournaled.length) throw new Error('Reconcile incomplete run before intake');
  const call = async (route, init = {}) => {
    const response = await fetcher(new URL(route, base), {
      ...init, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Cookie: cookie, Origin: base.origin, ...init.headers }
    });
    if (!response.ok) throw new Error(`Existing acquisition endpoint rejected intake (${response.status}); originals retained`);
    return response.json();
  };
  // Durable binding prevents a transport retry creating a second batch/ownership.
  await writeOnce(path.join(directory, 'delivery-binding.json'), {
    version: 1, baseUrl: base.origin, sessionId: plan.sessionId,
    physicalFronts: plan.physicalFronts, operatorReconciledPhysicalFronts: true
  });
  const progress = await call(`/api/acquisition/${plan.sessionId}`);
  if (progress.id !== plan.sessionId) throw new Error('Session identity mismatch');
  const receipts = [];
  for (const id of plan.physicalFronts) {
    const artifact = audit.artifacts.find(a => a.id === id);
    if (!artifact) throw new Error('Chosen front is not in this run');
    // The same request/upload keys and original generation survive lost ACKs.
    const reserved = await call(`/api/acquisition/${plan.sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reserve', requestKey: id })
    });
    if (!uuid.test(reserved.slot?.id)) throw new Error('Invalid slot response');
    const bytes = await readFile(path.join(directory, artifact.fileName));
    if (sha(bytes) !== artifact.sha256) throw new Error('Spool changed during delivery');
    const params = new URLSearchParams({ slot: reserved.slot.id, key: id, generation: '0' });
    const receipt = await call(`/api/acquisition/${plan.sessionId}/photos?${params}`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes
    });
    if (!receipt.ready || receipt.digest !== artifact.sha256 || !uuid.test(receipt.id))
      throw new Error('Server did not acknowledge these exact bytes');
    const record = { runId: audit.run.request.runId, artifactId: id, sessionId: plan.sessionId,
      slotId: reserved.slot.id, photoId: receipt.id, sha256: artifact.sha256 };
    await writeOnce(path.join(directory, `${id}.receipt.json`), record);
    receipts.push(record);
  }
  return { receipts, retainedUnmappedArtifacts: audit.artifacts.filter(a => !plan.physicalFronts.includes(a.id)).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [, , command, directory, planFile] = process.argv;
    if (command === 'audit') {
      const result = await auditRun(directory);
      console.log(JSON.stringify({ runId: result.run.request.runId, images: result.artifacts.length,
        unjournaled: result.unjournaled, completed: result.completed, physicalCount: 'UNKNOWN' }));
    } else if (command === 'instruction') {
      console.log(JSON.stringify(await sessionInstruction('http://127.0.0.1:13001',directory,process.env.MTG_SCANNER_COOKIE)));
    } else if (command === 'deliver') {
      console.log(JSON.stringify(await deliver(directory, await json(planFile), process.env.MTG_SCANNER_COOKIE)));
    } else throw new Error('Use audit <spool-run>, instruction <session-id>, or deliver <spool-run> <private-plan.json>');
  } catch (error) {
    // Filesystem/system errors can contain absolute private spool paths.
    console.error(error.code ? `Transport failed (${error.code}); private paths omitted` : error.message);
    process.exitCode = 1;
  }
}
