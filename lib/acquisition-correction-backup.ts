import { PrismaClient } from "@prisma/client";

/** Own client: command-line backup helpers must use their configured database,
 * rather than a previously imported application singleton. */
export async function beginCorrectionBackup() {
  const db = new PrismaClient();
  try {
    const guard = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(762881)`;
      const [present] = await tx.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema=current_schema() AND table_name LIKE 'Correction%' AND table_name<>'CorrectionDeletionTombstone') AS exists`;
      if (!present.exists) return null; // Archives predating the entire library.
      // A partially migrated or incompatible library fails the backup clearly.
      return tx.correctionBackupGuard.create({ data: {} });
    });
    return {
      id: guard?.id ?? null,
      async release() {
        try {
          if (guard) await db.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(762881)`;
            await tx.correctionBackupGuard.update({ where: { id: guard.id }, data: { releasedAt: new Date() } });
          });
        } finally { await db.$disconnect(); }
      },
    };
  } catch (error) { await db.$disconnect(); throw error; }
}

const ident = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `E'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
const table = (schema: string, name: string) => `${ident(schema)}.${ident(name)}`;

/** Preserve explicit owner removal intent before replacing the schema. It lives
 * only in this restore connection and rolls back with a failed replacement. */
export function buildCorrectionRemovalPrelude(schema: string) {
  const tombstones = table(schema, "CorrectionDeletionTombstone");
  return `DO ${literal(`BEGIN
CREATE TEMP TABLE correction_restore_removals ("ownerPlayerId" TEXT NOT NULL, "sourcePhotoId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL, PRIMARY KEY ("ownerPlayerId","sourcePhotoId")) ON COMMIT DROP;
IF to_regclass(${literal(tombstones)}) IS NOT NULL THEN
  INSERT INTO pg_temp.correction_restore_removals SELECT "ownerPlayerId","sourcePhotoId","deletedAt" FROM ${tombstones};
END IF;
END;`)};\n`;
}

export function buildCorrectionRestoreFence(schema: string) {
  const outbox = table(schema, "CorrectionCaptureOutbox"), accounts = table(schema, "CorrectionLibraryAccount"),
    guards = table(schema, "CorrectionBackupGuard"), tombstones = table(schema, "CorrectionDeletionTombstone"),
    examples = table(schema, "CorrectionExample"), events = table(schema, "CorrectionReviewEvent"),
    evidence = table(schema, "CorrectionEvidence"), pins = table(schema, "CorrectionRetentionPin");
  const body = `BEGIN
IF to_regclass(${literal(outbox)}) IS NOT NULL THEN
  UPDATE ${outbox} SET status='PENDING', "leaseToken"=NULL, "leaseExpiresAt"=NULL,
    "availableAt"=CURRENT_TIMESTAMP, "errorCode"='RESTORE_INTERRUPTED', "updatedAt"=CURRENT_TIMESTAMP WHERE status='RUNNING';
END IF;
IF to_regclass(${literal(accounts)}) IS NOT NULL THEN
  UPDATE ${accounts} SET "displayKey"=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
END IF;
IF to_regclass(${literal(guards)}) IS NOT NULL THEN
  UPDATE ${guards} SET "releasedAt"=CURRENT_TIMESTAMP WHERE "releasedAt" IS NULL;
END IF;
IF to_regclass('pg_temp.correction_restore_removals') IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM pg_temp.correction_restore_removals) THEN
    CREATE TABLE IF NOT EXISTS ${tombstones} ("ownerPlayerId" TEXT NOT NULL, "sourcePhotoId" TEXT NOT NULL,
      "deletedAt" TIMESTAMP(3) NOT NULL, PRIMARY KEY ("ownerPlayerId","sourcePhotoId"));
    INSERT INTO ${tombstones} AS current_removal SELECT * FROM pg_temp.correction_restore_removals
      ON CONFLICT ("ownerPlayerId","sourcePhotoId") DO UPDATE SET "deletedAt"=GREATEST(current_removal."deletedAt",EXCLUDED."deletedAt");
  END IF;
END IF;
IF to_regclass(${literal(tombstones)}) IS NOT NULL AND to_regclass(${literal(examples)}) IS NOT NULL THEN
  UPDATE ${examples} e SET "deletedAt"=t."deletedAt", "label"=NULL, "sourceMetadata"=NULL,
    "metadataBytes"=0, "firstEvidenceId"=NULL, "labelState"='REMOVED', "updatedAt"=CURRENT_TIMESTAMP
    FROM ${tombstones} t WHERE e."ownerPlayerId"=t."ownerPlayerId" AND e."sourcePhotoId"=t."sourcePhotoId";
  DELETE FROM ${events} e USING ${tombstones} t WHERE e."ownerPlayerId"=t."ownerPlayerId" AND e."sourcePhotoId"=t."sourcePhotoId";
  DELETE FROM ${evidence} e USING ${tombstones} t WHERE e."ownerPlayerId"=t."ownerPlayerId" AND e."sourcePhotoId"=t."sourcePhotoId";
  UPDATE ${pins} p SET "releasedAt"=CURRENT_TIMESTAMP FROM ${tombstones} t
    WHERE p."ownerPlayerId"=t."ownerPlayerId" AND p."photoId"=t."sourcePhotoId" AND p."releasedAt" IS NULL;
  UPDATE ${accounts} a SET "evidenceBytes"=
    COALESCE((SELECT SUM(bytes) FROM ${evidence} WHERE "ownerPlayerId"=a."ownerPlayerId"),0)+
    COALESCE((SELECT SUM(bytes) FROM ${events} WHERE "ownerPlayerId"=a."ownerPlayerId"),0)+
    COALESCE((SELECT SUM("metadataBytes") FROM ${examples} WHERE "ownerPlayerId"=a."ownerPlayerId"),0);
END IF;
END;`;
  return `DO ${literal(body)};\n`;
}
