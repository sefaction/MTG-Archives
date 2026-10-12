import { proposeOrientedAcquisitionPrintings, type createAcquisitionRecognitionIndex,
  type RecognitionProposal, type RecognitionText } from "./acquisition-recognition";
import { combineAcquisitionPhotoText, type AcquisitionPhotoText } from "./acquisition-photo-text";

type Reading = { orientations: { rotationDegrees: number; text: RecognitionText }[];
  photoText?: AcquisitionPhotoText };

// Each native frame/direction resolves independently. A title from the full
// original must never lend apparent agreement to a different inferred footer.
// The caller retains the primary job and exact output hash as durable provenance.
export function combineAcquisitionReferenceReadings(
  index: ReturnType<typeof createAcquisitionRecognitionIndex>, primary: Reading, refined: Reading,
) {
  const first = combineAcquisitionPhotoText(index,
    proposeOrientedAcquisitionPrintings(index, primary.orientations), primary.photoText);
  const second = proposeOrientedAcquisitionPrintings(index, refined.orientations);
  const union = new Map<string, RecognitionProposal>();
  for (const [result, origin] of [[second, "REFERENCE_OCR_OBSERVATION"],
    [first, "PRIMARY_OCR_OBSERVATION"]] as const) {
    for (const proposal of result.proposals) {
      const prior = union.get(proposal.card.id);
      union.set(proposal.card.id, { ...proposal, reasons: [...new Set([
        ...(prior?.reasons ?? []), ...proposal.reasons, origin,
        "REFERENCE_ANCHOR_INFERRED", "REVIEW_REQUIRED",
      ])].filter(reason => reason !== "STRONG_EXACT_PRINTING") });
    }
  }
  const disagreement = first.proposals.length > 0 && second.proposals.length > 0 &&
    !first.proposals.some(p => second.proposals.some(q => q.card.id === p.card.id));
  const proposals = [...union.values()];
  return { ...second,
    status: first.status === "CONFLICT" || second.status === "CONFLICT" || disagreement
      ? "CONFLICT" : proposals.length ? "REVIEW_REQUIRED" : "NO_MATCH",
    automaticAcceptance: false,
    orientation: { status: "UNRESOLVED", rotationDegrees: null },
    evidence: {
      setCodes: [...new Set([...first.evidence.setCodes, ...second.evidence.setCodes])],
      collectors: [...new Set([...first.evidence.collectors, ...second.evidence.collectors])],
      languages: [...new Set([...first.evidence.languages, ...second.evidence.languages])],
    },
    totalProposals: proposals.length, truncated: first.truncated || second.truncated || proposals.length > 12,
    proposals: proposals.slice(0,12),
  };
}
