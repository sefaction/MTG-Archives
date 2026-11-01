import { getCurrentUser, isAdminModeEnabled } from "./auth";
import { isRetryableAcquisitionConflict } from "./acquisition-upload";
export async function acquisitionActor(request?: Request) {
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (!origin || new URL(origin).host !== host)
      throw new Error("Request origin unavailable");
  }
  const user = await getCurrentUser();
  if (!user) throw new Error("Login required");
  return { userId: user.id, adminMode: await isAdminModeEnabled(user) };
}
export function acquisitionError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const storageFull = code === "ENOSPC" || code === "EDQUOT";
  const unavailable = /unavailable|Login required|not accepting/.test(message);
  const safe =
    /^(Choose |Use |Photo |Capture |Retry |The file |Processing |Private photo |Request origin|Login required|Destination changed|Stale capture|Run cannot|Cannot |Too many)/.test(
      message,
    );
  return Response.json(
    {
      error: storageFull
        ? "Photo storage is full. Free storage space or ask the administrator, then retry."
        : safe
        ? message
        : "The scan request could not be completed. Refresh and retry.",
      ...(isRetryableAcquisitionConflict(error) ? { retryable: true } : {}),
    },
    {
      status: !storageFull && unavailable ? 403 : 409,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/** An interrupted commit has an unknown outcome, not a rejected preview.
 * Keep the browser's frozen request for explicit idempotent recovery. */
export function acquisitionCommitError(error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "P1017") {
    return Response.json(
      {error: "The database connection was interrupted. Wait a moment, then retry the same request."},
      {status: 503, headers: {"Cache-Control": "no-store"}},
    );
  }
  return acquisitionError(error);
}
export function acquisitionProgressDto(
  state: Awaited<
    ReturnType<typeof import("./acquisition-store").getAcquisitionProgress>
  >,
) {
  return {
    id: state.session.id,
    providerId: state.session.run.providerId,
    runId: state.session.run.runId,
    batchNumber: state.batchNumber,
    revision: state.revision,
    target: state.session.target,
    phase: state.session.phase,
    locationId: state.session.placement.locationId,
    section: state.session.placement.section,
    destinationCurrent: state.destinationCurrent,
    slots: state.slots,
    reservedSlots: state.reservedSlots,
    availableSlots: state.availableSlots,
    photoPreparation: state.photoPreparation,
    defaults: state.defaults,
    defaultsRevision: state.defaultsRevision,
    ...(state.correctionLibrary ? { correctionLibrary: state.correctionLibrary } : {}),
    reviewed: state.session.candidates.filter(
      (c) =>
        !c.excluded &&
        c.review?.cardId &&
        c.review.finish !== "UNKNOWN" &&
        c.review.condition &&
        c.review.language,
    ).length,
  };
}
