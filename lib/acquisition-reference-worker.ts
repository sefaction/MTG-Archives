import { Prisma, type PrismaClient } from "@prisma/client";
import { acquisitionReferenceLineageInputSchema } from "./acquisition-reference-lineage";
import { currentAcquisitionReferenceParents, type AcquisitionReferenceVersions } from "./acquisition-reference-jobs";
import { AcquisitionJobSupersededError, type ClaimedAcquisitionJob } from "./acquisition-jobs";
import { readAcquisitionPhotoBytes } from "./acquisition-files";
import { acquisitionNativeReferenceInput } from "./acquisition-image-input";
import { nativeSchema, type RecognitionSnapshot } from "./acquisition-recognition-worker";
import type { AcquisitionNativeStream } from "./acquisition-native-stream";
import { sameAcquisitionManualRegion } from "./acquisition-manual-region";
import { combineAcquisitionReferenceReadings } from "./acquisition-reference-text";
import { ACQUISITION_TEXT_RESOLVER_VERSION } from "./acquisition-recognition";
import { ACQUISITION_FOOTER_PARSER_VERSION } from "./acquisition-footer";

// One call to the existing prepared native stream, within its caller's ordinary
// 45s processing/90s lease bounds. No additional whole-photo fallback or label,
// human card ID, Inventory/candidate write, upsample or native model is introduced.
// Dispatch stays disabled until downstream catalogue/UI qualification completes.
export async function recognizeAcquisitionReferenceRefinement(db: PrismaClient,
  job: ClaimedAcquisitionJob, signal: AbortSignal, snapshot: RecognitionSnapshot,
  versions: AcquisitionReferenceVersions, nativeWorker: Pick<AcquisitionNativeStream,"request">,
): Promise<Prisma.InputJsonObject> {
  const input=acquisitionReferenceLineageInputSchema.parse(job.input);
  if(snapshot.digest!==versions.catalog)throw new AcquisitionJobSupersededError("Reference catalog snapshot changed");
  const parents=await currentAcquisitionReferenceParents(db,job,versions);
  if(!parents||signal.aborted)throw new AcquisitionJobSupersededError("Reference parents superseded");
  const primary=nativeSchema.parse((parents[0].output as {native:unknown}).native);
  const bytes=await readAcquisitionPhotoBytes(input.photoId,"raw",input.digest);
  signal.throwIfAborted();
  const started=performance.now();
  const native=nativeSchema.parse(await nativeWorker.request(acquisitionNativeReferenceInput(bytes,input.reference.region),signal));
  if(native.photoDigest!==input.digest||native.descriptor!==versions.model||
      native.geometry.method!=="reference-anchor-region-v1"||native.geometry.status!=="PROPOSED"||
      native.geometry.boundaryVerified!==false||native.geometry.manualRegion!=null||
      !sameAcquisitionManualRegion(native.geometry.referenceRegion,input.reference.region))
    throw new AcquisitionJobSupersededError("Reference observation identity changed");
  signal.throwIfAborted();
  if(!await currentAcquisitionReferenceParents(db,job,versions))
    throw new AcquisitionJobSupersededError("Reference parents superseded during native work");
  const proposals=combineAcquisitionReferenceReadings(snapshot.index,primary,native);
  return { version:1,photoId:input.photoId,manualAnalysis:null,referenceRefinement:input,
    primaryObservation:{jobId:input.parents.recognitionJobId,outputHash:input.parents.recognitionOutputHash},
    native,proposals,versions:{model:versions.model,catalog:snapshot.digest,index:snapshot.digest,
      footerParser:ACQUISITION_FOOTER_PARSER_VERSION,textResolver:ACQUISITION_TEXT_RESOLVER_VERSION},
    execution:"CPU",refinementExecution:{inferenceRequests:1,milliseconds:Math.round(performance.now()-started)},
    catalog:{status:"CHECKING",printingCoverage:"UNRESOLVED"},
  } as unknown as Prisma.InputJsonObject;
}
