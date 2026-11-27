import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  createScannerPairing,
  claimScannerPairing,
  recordScannerPulse,
} from "../lib/scanner-store";
import {
  createScannerBatch,
  claimScannerRun,
  receiveScannerImage,
  finishScannerRun,
} from "../lib/scanner-runs";
import { scannerSiteEpoch } from "../lib/scanner-control-files";
import { scannerSecret } from "../lib/scanner-protocol";
import {
  COUNTED_SCANNER_DEVICE,
  COUNTED_SCANNER_BACKEND,
  countedScannerSettings,
} from "../lib/scanner-counted-profile";
import { confirmPairedScan } from "../lib/paired-scan-review";
import { recoverPairedScan } from "../lib/paired-scan-recovery";
import {
  readPairedScanBatch,
  searchPairedCatalog,
} from "../lib/paired-scan-service";
import { getAcquisitionBatchDashboard } from "../lib/acquisition-batch-dashboard";
import {
  saveAcquisitionReview,
  reviewAcquisitionCandidate,
} from "../lib/acquisition-store";
import {
  previewAcquisitionCommit,
  previewConfirmedAcquisitionCommit,
  commitAcquisitionCards,
} from "../lib/acquisition-commit-service";
import { resolvePairedCardIdentity } from "../lib/paired-scan-identities";
import { readScannerCapacity } from "../lib/scanner-capacity";
import { giveInventoryCard } from "../lib/card-handoffs";
import { handoffStamp } from "../lib/card-handoff-policy";
import { moveInventoryStorageBatch } from "../lib/inventory-storage-move";
import { purgeCommittedAcquisitionPhotos } from "../lib/acquisition-photo-retention";
import { readAcquisitionPhotoBytes } from "../lib/acquisition-files";
import { eligibleScannerOriginals } from "../lib/scanner-retention";
import { ensureCorrectionAccount } from "../lib/acquisition-correction-library";
import type { PairedDecision } from "../lib/paired-scan-policy";

/** Dedicated synthetic database only; no native backend is constructed. */
async function main() {
  const browserSeed = process.argv.includes("--seed-browser");
  const seed = process.argv.includes("--seed-review") || browserSeed,
    url = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.MTG_PAIRED_SCAN_FIXTURE, "1");
  assert.equal(
    url.pathname,
    seed ? "/paired_scan_review" : "/paired_scan_fixture",
  );
  assert(["paired-scan-db", "127.0.0.1", "localhost"].includes(url.hostname));
  const db = new PrismaClient();
  const tag = seed
      ? browserSeed
        ? "paired-browser-" + randomUUID()
        : "paired-review"
      : "paired-" + randomUUID(),
    actor = { userId: tag, adminMode: false },
    foreign = { userId: tag + "-other", adminMode: false };
  await mkdir(path.resolve(".local-data"), { recursive: true });
  const root =
    process.env.UPLOADS_DATA_PATH ??
    (await mkdtemp(path.resolve(".local-data/paired-private-")));
  process.env.UPLOADS_DATA_PATH = root;
  await mkdir(root, { recursive: true });
  try {
    for (const userId of [tag, foreign.userId]) {
      await db.player.create({
        data: { id: userId, name: userId, displayName: userId },
      });
      await db.user.create({
        data: {
          id: userId,
          username: userId,
          displayName: userId,
          playerId: userId,
          passwordHash: await bcrypt.hash("admin123", 4),
        },
      });
      await db.$transaction((tx) => ensureCorrectionAccount(tx, userId));
      await db.correctionLibraryAccount.update({
        where: { ownerPlayerId: userId },
        data: { sampleBasisPoints: 0 },
      });
    }
    const box = await db.inventoryLocation.create({
      data: {
        ownerPlayerId: tag,
        name: "Paired scans review",
        normalizedName: tag,
        type: "Box",
        storageLayout: {
          capacity: 100,
          sections: [{ name: "A", capacity: 100 }],
        },
      },
    });
    const otherBox = await db.inventoryLocation.create({
      data: {
        ownerPlayerId: tag,
        name: "Moved paired cards",
        normalizedName: tag + "-move",
        type: "Box",
        storageLayout: { capacity: 100, sections: [] },
      },
    });
    const source = {
      id: COUNTED_SCANNER_DEVICE,
      name: "Software fixture — no scanner",
      backend: COUNTED_SCANNER_BACKEND,
      source: "Twain",
      qualification: "KnownWorking",
    };
    const pair = await createScannerPairing(db, tag),
      agentId = randomUUID(),
      secret = scannerSecret(),
      token = `Bearer ${agentId}.${secret}`;
    await claimScannerPairing(db, {
      version: 1,
      pairCode: pair.code,
      agentId,
      secret,
      name: "Paired fixture",
    });
    const pulse = () =>
      recordScannerPulse(db, token, {
        version: 1,
        agentVersion: "0.5.0-native",
        devices: [source],
      });
    const epoch = await scannerSiteEpoch();
    await pulse();
    const catalogImage =
      "data:image/png;base64," +
      (
        await sharp({
          create: {
            width: 300,
            height: 420,
            channels: 3,
            background: "#c6a77a",
          },
        })
          .png()
          .toBuffer()
      ).toString("base64");
    const makeCard = async (name: string, number: string, layout = "token") =>
      db.card.create({
        data: {
          scryfallId: randomUUID(),
          name,
          setCode: "tst",
          collectorNumber: number,
          rarity: "common",
          typeLine: layout === "token" ? "Token Creature — " + name : "Card",
          layout,
          lang: "en",
          digital: false,
          finishes: ["nonfoil"],
          cardFaces:
            layout === "art_series"
              ? [
                  {
                    name,
                    type_line: "Card",
                    image_uris: { normal: catalogImage },
                  },
                  {
                    name,
                    type_line: "Card",
                    image_uris: { normal: catalogImage },
                  },
                ]
              : undefined,
          imageUri: catalogImage,
        },
      });
    const goblin = await makeCard("Goblin", "1"),
      treasure = await makeCard("Treasure", "2"),
      otherGoblin = await makeCard("Goblin", "3"),
      art = await makeCard("Island", "81", "art_series"),
      ordinary = await makeCard("Goblin", "9", "normal");
    async function batch(
      profile: "TOKEN" | "ART",
      sides: ("FRONT" | "BACK" | "UNKNOWN")[],
      paperCounts?: number[],
    ) {
      await pulse();
      const request = {
        requestKey: randomUUID(),
        agentId,
        deviceId: source.id,
        locationId: box.id,
        section: "A",
        quantity: Math.max(1, Math.ceil(sides.length / 2)),
        loadedCount: null,
        settings: { ...countedScannerSettings, duplex: true },
        scanProfile: profile,
        operatorLoadedBothSides: true,
      };
      const run = await createScannerBatch(db, actor, request, epoch),
        execution = {
          version: 1,
          runId: run.runId,
          epoch,
          executionId: randomUUID(),
        };
      await claimScannerRun(db, token, execution, epoch);
      const images = [];
      for (const [index, side] of sides.entries()) {
        const transfer = {
          ...execution,
          artifactId: randomUUID(),
          sequence: index + 1,
          timestamp: new Date().toISOString(),
          side,
          physicalBoundary: side === "UNKNOWN" ? "UNKNOWN" : "SCANNER_SHEET",
          ...(side === "UNKNOWN"
            ? {}
            : {
                sheet: {
                  version: 1,
                  documentNumber: 0,
                  paperCount: paperCounts?.[index] ?? Math.floor(index / 2) + 1,
                },
              }),
        };
        const label =
          profile === "ART"
            ? index % 2
              ? "Island art card reverse"
              : "Island art card artwork"
            : index % 2
              ? "Treasure"
              : "Goblin";
        const bytes = await sharp(
          Buffer.from(
            `<svg width="300" height="420"><rect width="300" height="420" fill="${index % 2 ? "#efe0b5" : "#a3c7c2"}"/><rect x="12" y="12" width="276" height="396" rx="15" fill="none" stroke="#222" stroke-width="8"/><text x="25" y="75" font-size="19">${label}</text><text x="25" y="340" font-size="17">SYNTHETIC REVIEW</text><text x="25" y="375" font-size="13">TST ${index + 1} / ${side}</text></svg>`,
          ),
        )
          .png()
          .toBuffer();
        const receipt = await receiveScannerImage(
          db,
          token,
          transfer,
          epoch,
          bytes,
          "image/png",
        );
        images.push({ transfer, bytes, receipt });
        assert.equal(
          (
            await receiveScannerImage(
              db,
              token,
              transfer,
              epoch,
              bytes,
              "image/png",
            )
          ).photoId,
          receipt.photoId,
        );
      }
      const broken =
        sides.some((s) => s === "UNKNOWN") ||
        sides.length % 2 !== 0 ||
        (new Set(paperCounts ?? []).size === 1 &&
          sides.filter((s) => s === "FRONT").length > 1);
      const outcome = {
        outcome: broken ? "ERROR" : "COMPLETED",
        imageCount: sides.length,
        elapsedMs: 1,
        knownPhysicalItems: null,
        sourceExhausted: "UNKNOWN",
        nativeError: broken
          ? { type: "FixturePairingUncertainty", nativeStatus: 0 }
          : null,
      };
      const finish = { ...execution, outcome };
      await finishScannerRun(db, token, finish, epoch);
      return { run, images, finish };
    }
    const tokenDecision: PairedDecision = {
      profile: "TOKEN",
      front: { cardId: goblin.id, face: 0 },
      back: { cardId: treasure.id, face: 0 },
    };
    const attributes = {
      language: "en",
      finish: "NONFOIL" as const,
      condition: "NM",
      openerPlayerId: null,
    };
    async function confirm(id: string, decision: PairedDecision, page = 0) {
      const s = await readPairedScanBatch(db, actor, id, page);
      assert(s.item?.sourceFingerprint);
      const input = {
        requestKey: randomUUID(),
        slotId: s.item.slotId,
        revision: s.item.revision,
        sourceFingerprint: s.item.sourceFingerprint,
        decision,
        attributes,
      };
      await confirmPairedScan(db, actor, id, input);
      assert.equal(
        (await confirmPairedScan(db, actor, id, input)).replay,
        true,
      );
      return input;
    }
    const first = await batch("TOKEN", ["BACK", "FRONT"]),
      firstId = first.run.sessionId;
    const tokenState = await readPairedScanBatch(db, actor, firstId);
    assert.equal(tokenState.total, 1);
    assert.equal(tokenState.repairSources.length, 2);
    assert.equal(tokenState.unresolvedImages, 0);
    await assert.rejects(readPairedScanBatch(db, foreign, firstId));
    await assert.rejects(
      confirmPairedScan(db, foreign, firstId, {
        requestKey: randomUUID(),
        slotId: tokenState.item!.slotId,
        revision: tokenState.item!.revision,
        sourceFingerprint: tokenState.item!.sourceFingerprint,
        decision: tokenDecision,
        attributes,
      }),
    );
    await assert.rejects(
      saveAcquisitionReview(db, actor, firstId, {
        action: "accept",
        photoId: first.images[0].receipt.photoId,
        revision: tokenState.item!.revision,
        decision: { ...attributes, cardId: goblin.id },
      }),
    );
    await assert.rejects(
      reviewAcquisitionCandidate(db, actor, firstId, 0, "invalid", 0, {
        ...attributes,
        cardId: goblin.id,
      }),
    );
    await assert.rejects(
      confirmPairedScan(db, actor, firstId, {
        requestKey: randomUUID(),
        slotId: tokenState.item!.slotId,
        revision: tokenState.item!.revision,
        sourceFingerprint: tokenState.item!.sourceFingerprint,
        decision: { ...tokenDecision, front: { cardId: ordinary.id, face: 0 } },
        attributes,
      }),
    );
    const confirmed = await confirm(firstId, tokenDecision);
    const preview = await previewConfirmedAcquisitionCommit(
      db,
      actor,
      firstId,
      { locationId: box.id, section: "A", excludedPhotoIds: [] },
    );
    assert.equal(preview.count, 1);
    assert.equal(preview.cards[0].photoId, first.images[1].receipt.photoId);
    await assert.rejects(
      previewAcquisitionCommit(db, actor, firstId, {
        locationId: box.id,
        section: "A",
        photoIds: first.images.map((i) => i.receipt.photoId),
      }),
    );
    const commit = {
      photoIds: preview.cards.map((c) => c.photoId),
      locationId: box.id,
      section: "A",
      requestKey: randomUUID(),
      previewToken: preview.token,
      overfillReason: null,
    };
    const result = await commitAcquisitionCards(db, actor, firstId, commit);
    assert.equal(result.count, 1);
    assert.equal(
      (await commitAcquisitionCards(db, actor, firstId, commit)).replay,
      true,
    );
    await assert.rejects(
      commitAcquisitionCards(db, actor, firstId, {
        ...commit,
        requestKey: randomUUID(),
      }),
    );
    const inventory = await db.inventoryItem.findUniqueOrThrow({
      where: { id: result.inventoryItemIds[0] },
      include: { card: { include: { applicationFaces: true } } },
    });
    assert.equal(inventory.quantity, 1);
    assert.equal(inventory.card.scryfallId, null);
    assert.equal(inventory.card.name, "Goblin // Treasure");
    assert.equal(inventory.card.applicationFaces.length, 2);
    assert.equal(inventory.card.prices, null);
    const [same, different] = await db.$transaction(async (tx) => [
      await resolvePairedCardIdentity(tx, {
        profile: "TOKEN",
        front: tokenDecision.back,
        back: tokenDecision.front,
      }),
      await resolvePairedCardIdentity(tx, {
        profile: "TOKEN",
        front: { cardId: otherGoblin.id, face: 0 },
        back: tokenDecision.back,
      }),
    ]);
    assert.equal(same.id, inventory.cardId);
    assert.notEqual(different.id, same.id);
    assert.equal(
      (await searchPairedCatalog(db, actor, firstId, "Treasure")).choices.some(
        (c) => c.cardId === treasure.id,
      ),
      true,
    );
    const dashboard = await getAcquisitionBatchDashboard(db, actor, {
      view: "all",
      q: "",
      page: 1,
    });
    assert.equal(dashboard.rows.find((r) => r.id === firstId)?.captured, 1);
    assert.equal(dashboard.rows.find((r) => r.id === firstId)?.added, 1);
    await moveInventoryStorageBatch(db, {
      actorUserId: tag,
      allowedOwnerId: tag,
      itemIds: [inventory.id],
      destinationLocationId: otherBox.id,
    });
    const moved = await db.inventoryItem.findUniqueOrThrow({
      where: { id: inventory.id },
    });
    assert.equal(moved.cardId, inventory.cardId);
    await giveInventoryCard(db, actor, {
      requestId: randomUUID(),
      inventoryItemId: moved.id,
      expectedStamp: handoffStamp(moved),
      quantity: 1,
      kind: "GIFT",
      recipient: { type: "ARCHIVE", playerId: foreign.userId },
    });
    const received = await db.inventoryItem.findFirstOrThrow({
      where: { currentOwnerId: foreign.userId, cardId: inventory.cardId },
    });
    assert.equal(received.quantity, 1);
    assert.equal(
      (
        await db.inventoryLocation.findUniqueOrThrow({
          where: { id: received.locationId! },
        })
      ).name,
      "Unassigned",
    );
    const artBatch = await batch("ART", ["FRONT", "BACK", "FRONT", "BACK"]);
    await confirm(artBatch.run.sessionId, {
      profile: "ART",
      cardId: art.id,
      artworkSide: "BACK",
      stamp: "GOLD_SIGNATURE",
    });
    await confirm(
      artBatch.run.sessionId,
      {
        profile: "ART",
        cardId: art.id,
        artworkSide: "FRONT",
        stamp: "UNSTAMPED",
      },
      1,
    );
    const artPreview = await previewConfirmedAcquisitionCommit(
      db,
      actor,
      artBatch.run.sessionId,
      { locationId: box.id, section: "A", excludedPhotoIds: [] },
    );
    assert.equal(artPreview.count, 2);
    const artResult = await commitAcquisitionCards(
      db,
      actor,
      artBatch.run.sessionId,
      {
        ...commit,
        photoIds: artPreview.cards.map((c) => c.photoId),
        previewToken: artPreview.token,
        requestKey: randomUUID(),
      },
    );
    const artCopies = await db.inventoryItem.findMany({
      where: { id: { in: artResult.inventoryItemIds } },
      include: { card: true },
    });
    assert.equal(new Set(artCopies.map((i) => i.cardId)).size, 2);
    assert(
      artCopies.every(
        (i) =>
          i.card.layout === "art_series" &&
          i.card.oracleId === null &&
          i.foilStatus === "NONFOIL",
      ),
    );
    const broken = await batch("TOKEN", ["UNKNOWN", "UNKNOWN"]),
      brokenId = broken.run.sessionId;
    const repairState = await readPairedScanBatch(db, actor, brokenId);
    assert.equal(repairState.unresolvedImages, 2);
    const front = repairState.repairSources[0],
      back = repairState.repairSources[1],
      stamp = (p: typeof front) => ({
        photoId: p.photoId,
        digest: p.digest,
        revision: p.revision,
      });
    const link = {
      action: "link",
      requestKey: randomUUID(),
      front: stamp(front),
      back: stamp(back),
      reason: "Checked opposite sides of the same physical item",
      samePhysicalItem: true,
    };
    await assert.rejects(recoverPairedScan(db, actor, brokenId, link));
    const settle = {
      action: "settle",
      requestKey: randomUUID(),
      transportAndHopperClear: true,
      reason: "Removed cards after fixture metadata error",
    };
    await recoverPairedScan(db, actor, brokenId, settle);
    await assert.rejects(recoverPairedScan(db, foreign, brokenId, link));
    await recoverPairedScan(db, actor, brokenId, link);
    assert.equal(
      (await recoverPairedScan(db, actor, brokenId, link)).replay,
      true,
    );
    const repaired = await readPairedScanBatch(db, actor, brokenId);
    assert.equal(repaired.total, 1);
    assert.equal(repaired.repairSources.length, 2);
    assert(repaired.item!.sourceFingerprint);
    for (const image of broken.images)
      assert.equal(
        (
          await receiveScannerImage(
            db,
            token,
            image.transfer,
            epoch,
            image.bytes,
            "image/png",
          )
        ).photoId,
        image.receipt.photoId,
      );
    await confirm(brokenId, tokenDecision);
    const beforeUnpair = await previewConfirmedAcquisitionCommit(
      db,
      actor,
      brokenId,
      { locationId: box.id, section: "A", excludedPhotoIds: [] },
    );
    const current = await readPairedScanBatch(db, actor, brokenId),
      unpair = {
        action: "unpair",
        requestKey: randomUUID(),
        source: {
          photoId: current.item!.photos[0].id,
          digest: current.item!.photos[0].digest,
          revision: current.item!.revision,
        },
      };
    await recoverPairedScan(db, actor, brokenId, unpair);
    await recoverPairedScan(db, actor, brokenId, unpair);
    await assert.rejects(
      commitAcquisitionCards(db, actor, brokenId, {
        ...commit,
        photoIds: beforeUnpair.cards.map((c) => c.photoId),
        previewToken: beforeUnpair.token,
        requestKey: randomUUID(),
      }),
    );
    const unpaired = await readPairedScanBatch(db, actor, brokenId);
    assert.equal(unpaired.total, 2);
    assert.equal(unpaired.unresolvedImages, 2);
    const relink = {
      ...link,
      requestKey: randomUUID(),
      front: stamp(unpaired.repairSources[0]),
      back: stamp(unpaired.repairSources[1]),
    };
    await recoverPairedScan(db, actor, brokenId, relink);
    await confirm(brokenId, tokenDecision);
    const pendingCapacity = await db.$transaction((tx) =>
      readScannerCapacity(tx, {
        locationId: box.id,
        section: "A",
        ownerPlayerId: tag,
      }),
    );
    assert.equal(pendingCapacity.pendingSection, 1);
    // Force both real Serializable transactions to see the source printing
    // before either shared identity exists. Retries must preserve both reviews.
    const concurrentBatches = [await batch("ART", ["FRONT", "BACK"])];
    concurrentBatches.push(await batch("ART", ["FRONT", "BACK"]));
    const concurrentInputs = await Promise.all(
      concurrentBatches.map(async (b) => {
        const state = await readPairedScanBatch(db, actor, b.run.sessionId);
        return {
          requestKey: randomUUID(),
          slotId: state.item!.slotId,
          revision: state.item!.revision,
          sourceFingerprint: state.item!.sourceFingerprint,
          decision: {
            profile: "ART",
            cardId: art.id,
            artworkSide: "FRONT",
            stamp: "GOLD_PLANESWALKER",
          },
          attributes,
        };
      }),
    );
    let atSource = 0,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sharedCreation = new Proxy(db, {
      get(target, property) {
        if (property === "$transaction")
          return (work: (tx: any) => Promise<unknown>, options: unknown) =>
            Reflect.apply(target.$transaction, target, [
              async (tx: any) =>
                work(
                  new Proxy(tx, {
                    get(current, key) {
                      if (key === "card")
                        return new Proxy(current.card, {
                          get(cards, operation) {
                            if (operation === "findMany")
                              return async (args: any) => {
                                const rows = await cards.findMany(args);
                                if (
                                  args.where?.id?.in?.length === 1 &&
                                  args.where.id.in[0] === art.id &&
                                  atSource < 2
                                ) {
                                  if (++atSource === 2) release();
                                  await gate;
                                }
                                return rows;
                              };
                            const value = Reflect.get(cards, operation);
                            return typeof value === "function"
                              ? value.bind(cards)
                              : value;
                          },
                        });
                      const value = Reflect.get(current, key);
                      return typeof value === "function"
                        ? value.bind(current)
                        : value;
                    },
                  }),
                ),
              options,
            ]);
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const concurrentResults = await Promise.all(
      concurrentBatches.map((b, i) =>
        confirmPairedScan(
          sharedCreation,
          actor,
          b.run.sessionId,
          concurrentInputs[i],
        ),
      ),
    );
    assert.equal(atSource, 2);
    assert.equal(concurrentResults[0].cardId, concurrentResults[1].cardId);
    assert.equal(
      await db.card.count({
        where: {
          applicationIdentityKind: "ART_GOLD_PLANESWALKER",
          applicationFaces: { some: { sourceCardId: art.id } },
        },
      }),
      1,
    );
    const cleanStatus = (
      await db.scannerRun.findUniqueOrThrow({ where: { id: first.run.runId } })
    ).status;
    await finishScannerRun(db, token, first.finish, epoch);
    assert.equal(
      (
        await db.scannerRun.findUniqueOrThrow({
          where: { id: first.run.runId },
        })
      ).status,
      cleanStatus,
    );
    const duplicate = await batch(
      "TOKEN",
      ["FRONT", "BACK", "FRONT"],
      [1, 1, 1],
    );
    assert.equal(
      await db.acquisitionPhoto.count({
        where: { run: { sessionId: duplicate.run.sessionId } },
      }),
      3,
    );
    assert.equal(
      (await readPairedScanBatch(db, actor, duplicate.run.sessionId))
        .unresolvedImages,
      1,
    );
    for (const image of duplicate.images)
      assert.equal(
        (
          await receiveScannerImage(
            db,
            token,
            image.transfer,
            epoch,
            image.bytes,
            "image/png",
          )
        ).photoId,
        image.receipt.photoId,
      );
    const age = new Date(Date.now() + 9 * 86400000);
    await pulse();
    assert.equal(
      (
        await eligibleScannerOriginals(
          db,
          token,
          {
            version: 1,
            runId: artBatch.run.runId,
            epoch,
            artifacts: artBatch.images.map((i) => ({
              artifactId: i.transfer.artifactId,
              photoId: i.receipt.photoId,
              digest: i.receipt.digest,
            })),
          },
          epoch,
          age,
        )
      ).eligible.length,
      0,
    );
    await purgeCommittedAcquisitionPhotos(db, age);
    assert.equal(
      (
        await db.card.findUniqueOrThrow({
          where: { id: artCopies[0].cardId },
          include: { applicationFaces: true },
        })
      ).applicationFaces.length,
      2,
    );
    for (const image of artBatch.images) {
      assert(
        (
          await db.acquisitionPhoto.findUniqueOrThrow({
            where: { id: image.receipt.photoId },
          })
        ).purgedAt,
      );
      await assert.rejects(
        readAcquisitionPhotoBytes(
          image.receipt.photoId,
          "raw",
          image.receipt.digest,
        ),
      );
    }
    assert.equal(
      (
        await eligibleScannerOriginals(
          db,
          token,
          {
            version: 1,
            runId: artBatch.run.runId,
            epoch,
            artifacts: artBatch.images.map((i) => ({
              artifactId: i.transfer.artifactId,
              photoId: i.receipt.photoId,
              digest: i.receipt.digest,
            })),
          },
          epoch,
          age,
        )
      ).eligible.length,
      4,
    );
    if (seed) {
      // Separate untouched human sample; database checks above never mutate it.
      await recoverPairedScan(db, actor, duplicate.run.sessionId, {
        ...settle,
        requestKey: randomUUID(),
      });
      const reviewToken = await batch("TOKEN", ["FRONT", "BACK"]),
        reviewArt = await batch("ART", ["BACK", "FRONT"]);
      const output = {
        user: tag,
        tokenBatch: reviewToken.run.sessionId,
        artBatch: reviewArt.run.sessionId,
        repairBatch: duplicate.run.sessionId,
        goblin: goblin.id,
        treasure: treasure.id,
        art: art.id,
      };
      await writeFile(
        path.join(
          root,
          browserSeed ? "browser-fixture.json" : "review-fixture.json",
        ),
        JSON.stringify(output, null, 2),
      );
      console.log(JSON.stringify(output));
    }
    console.log(
      "PASS paired PostgreSQL: actual duplex ingestion, canonical identities, art variants, source ownership, review bypass rejection, one-copy receipts/replay, moves/gifts, quarantine/repair/unpair, stale preview, capacity, summary, retention.",
    );
  } finally {
    await db.$disconnect();
  }
}
if (
  process.argv.includes("--run") ||
  process.argv.includes("--seed-review") ||
  process.argv.includes("--seed-browser")
)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
