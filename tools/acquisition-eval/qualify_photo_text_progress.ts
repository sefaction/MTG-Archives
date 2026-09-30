// Opt-in, private, network-isolated native-image qualification. Fixed mounts
// are described in ACQUISITION_PHOTO_TEXT.md; no database or service writes.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {AcquisitionNativeStream} from "../../lib/acquisition-native-stream";
import {runAcquisitionNativeProcess} from "../../lib/acquisition-native-process";
import {nativeSchema} from "../../lib/acquisition-recognition-worker";
import {acquisitionNativePhotoInput} from "../../lib/acquisition-image-input";
import {createAcquisitionRecognitionIndex, proposeOrientedAcquisitionPrintings} from "../../lib/acquisition-recognition";
import {combineAcquisitionPhotoText, needsAcquisitionPhotoText, readAcquisitionPhotoText} from "../../lib/acquisition-photo-text";

async function main() {
  assert.equal(process.env.MTG_ACQUISITION_PHOTO_TEXT_PROGRESS_TEST, "1");
  const snapshot = readFileSync("/snapshot/recognition-snapshot.json");
  const index = createAcquisitionRecognitionIndex(JSON.parse(snapshot.toString("utf8")));
  const descriptor: any = await runAcquisitionNativeProcess("python",
    ["/app/tools/acquisition-runtime/recognize.py", "--describe"], Buffer.alloc(0), AbortSignal.timeout(30000));
  const worker = new AcquisitionNativeStream("python", ["/app/tools/acquisition-runtime/recognize.py", "--stream"]);
  const cases = [
    {file: "/phone/PXL_20260928_003443452.jpg", kind: "PHOTO", name: "Winter, Tormented Loner"},
    {file: "/additional/PXL_20260928_030544422.jpg", kind: "PHOTO", name: "Cunning Geysermage"},
    {file: "/phone/PXL_20260927_150825750.jpg", kind: "PHOTO", name: "Krosan Vorine"},
    {file: "/scans/scan-test.01.jpg", kind: "CARD_SCAN", name: "Steel Wrecking Ball"},
  ] as const;
  const report: any = {version: 1, scope: "REUSED_DEVELOPMENT_NATIVE_PROGRESS_NOT_INDEPENDENT_ACCURACY",
    descriptor: descriptor.digest, snapshotSha256: createHash("sha256").update(snapshot).digest("hex"),
    catalogCards: index.cards, passed: false, results: [],
    limits: ["Reused development inputs and ground truth", "Unchanged models and 45-second job/32-second fallback limits",
      "Separate forced interruption demonstrates transport recovery, not a reproduction or performance result"]};
  const save = () => writeFileSync("/output/report.json", JSON.stringify(report, null, 2) + "\n");
  try {
    for (const entry of cases) {
      const bytes = readFileSync(entry.file), digest = createHash("sha256").update(bytes).digest("hex");
      const started = Date.now(), signal = AbortSignal.timeout(45000);
      const progress: any[] = [];
      const request = (input: Buffer, attemptSignal: AbortSignal, onProgress?: (value: unknown) => void) =>
        worker.request(input, attemptSignal, onProgress && (value => {
          progress.push({milliseconds: Date.now() - started, value});
          onProgress(value);
        }));
      const native = nativeSchema.parse(await request(acquisitionNativePhotoInput(bytes, entry.kind), signal));
      assert.equal(native.photoDigest, digest); assert.equal(native.descriptor, descriptor.digest);
      const before = JSON.stringify(native), primary = proposeOrientedAcquisitionPrintings(index, native.orientations);
      const fallback = needsAcquisitionPhotoText(primary);
      const budget = Math.min(32000, 35000 - (Date.now() - started));
      const photoText = fallback ? await readAcquisitionPhotoText(request, bytes, entry.kind,
        {photoDigest: digest, descriptor: descriptor.digest}, signal, budget) : undefined;
      const proposals = combineAcquisitionPhotoText(index, primary, photoText);
      signal.throwIfAborted(); assert.equal(JSON.stringify(native), before);
      assert.ok(proposals.proposals.some(p => p.card.name === entry.name), "Expected name must be offered");
      if (fallback) { assert.ok(progress.length); assert.equal(proposals.automaticAcceptance, false); }
      report.results.push({case: entry.name, inputKind: entry.kind, photoDigest: digest, fallback,
        budgetMilliseconds: budget, elapsedMilliseconds: Date.now() - started, progress, native, primary,
        photoText, proposals, expectedNameOffered: true, nativePreserved: true});
      save(); console.log(JSON.stringify({case: entry.name, fallback, status: photoText?.status,
        progressReadings: progress.length, firstProgressMilliseconds: progress[0]?.milliseconds,
        milliseconds: Date.now() - started, expectedNameOffered: true}));
    }
    // Kill a real warm native process immediately after its first completed
    // direction. This deliberately tests failure recovery; ordinary cases
    // above retain their production budgets and remain separate observations.
    const entry = cases[0], bytes = readFileSync(entry.file);
    const digest = createHash("sha256").update(bytes).digest("hex"), progress: unknown[] = [];
    const interrupted = await readAcquisitionPhotoText((input, signal, onProgress) =>
      worker.request(input, signal, value => {
        progress.push(value); onProgress!(value); worker.close();
      }), bytes, entry.kind, {photoDigest: digest, descriptor: descriptor.digest}, AbortSignal.timeout(45000));
    assert.equal(progress.length, 1); assert.equal(interrupted.status, "PARTIAL");
    assert.equal(interrupted.reason, "WORKER_ERROR"); assert.equal(interrupted.readings.length, 1);
    assert.deepEqual(interrupted.readings, (progress[0] as any).photoText.readings);
    report.forcedInterruption = {scope: "CONTROLLED_NATIVE_TERMINATION_AFTER_COMPLETED_READING", progress, interrupted};
    // The next real native request must reopen cleanly with matching identity.
    const reopened = nativeSchema.parse(await worker.request(acquisitionNativePhotoInput(bytes, entry.kind), AbortSignal.timeout(45000)));
    assert.equal(reopened.photoDigest, digest); assert.equal(reopened.descriptor, descriptor.digest);
    report.reopenedAfterInterruption = true; report.passed = true; save();
  } finally {
    await worker.shutdown(); save();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
