import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  getAcquisitionCardReview,
  getAcquisitionProgress,
  saveAcquisitionReview,
  searchAcquisitionPrintings,
  type AcquisitionActor,
} from "../lib/acquisition-store";
import {
  completeAcquisitionJob,
  type ClaimedAcquisitionJob,
} from "../lib/acquisition-jobs";
import { enqueueReadyRecognition } from "../lib/acquisition-recognition-worker";

export async function verifyAcquisitionReview(
  db: PrismaClient,
  actor: AcquisitionActor,
  stranger: AcquisitionActor,
  sessionId: string,
  photoId: string,
  catalog: string,
  model: string,
) {
  const card = await db.card.create({
    data: {
      scryfallId: randomUUID(),
      name: "Review fixture",
      setCode: "rfx",
      collectorNumber: "123a",
      typeLine: "Creature",
      rarity: "common",
      lang: "en",
      finishes: ["nonfoil", "foil"],
      digital: false,
    },
  });
  const stockBefore = await db.inventoryItem.aggregate({
    _count: { _all: true },
    _sum: { quantity: true },
  });
  try {
    let state = await getAcquisitionCardReview(db, actor, sessionId, photoId);
    assert.deepEqual(state.defaults, { finish: "UNKNOWN", condition: null });
    await assert.rejects(
      getAcquisitionCardReview(db, stranger, sessionId, photoId),
      /unavailable/,
    );
    await assert.rejects(
      saveAcquisitionReview(db, stranger, sessionId, {
        action: "defaults",
        revision: 0,
        defaults: { finish: "NONFOIL", condition: "NM" },
      }),
      /unavailable/,
    );
    await saveAcquisitionReview(db, actor, sessionId, {
      action: "defaults",
      revision: 0,
      defaults: { finish: "NONFOIL", condition: "NM" },
    });
    await assert.rejects(
      saveAcquisitionReview(db, actor, sessionId, {
        action: "defaults",
        revision: 0,
        defaults: { finish: "FOIL", condition: "HP" },
      }),
      /defaults changed/,
    );
    state = await getAcquisitionCardReview(db, actor, sessionId, photoId);
    assert.deepEqual(state.defaults, { finish: "NONFOIL", condition: "NM" });
    assert.equal(state.review, null);
    assert.equal(
      (
        await searchAcquisitionPrintings(db, actor, sessionId, {
          query: "",
          set: "RFX",
          number: "00123a",
        })
      )[0].id,
      card.id,
    );
    await assert.rejects(
      searchAcquisitionPrintings(db, stranger, sessionId, {
        query: "Review",
        set: "",
        number: "",
      }),
      /unavailable/,
    );
    let unauthorizedLookup = false;
    await assert.rejects(
      searchAcquisitionPrintings(
        db,
        stranger,
        sessionId,
        { query: "Missing fixture printing", set: "", number: "" },
        async () => {
          unauthorizedLookup = true;
          throw new Error("Unauthorized lookup ran");
        },
      ),
      /unavailable/,
    );
    assert.equal(unauthorizedLookup, false);
    const decision = {
      cardId: card.id,
      language: "en",
      finish: "NONFOIL",
      condition: "LP",
    };
    const input = {
      action: "accept",
      photoId,
      revision: state.revision,
      decision,
    };
    const accepted = await Promise.all([
      saveAcquisitionReview(db, actor, sessionId, input),
      saveAcquisitionReview(db, actor, sessionId, input),
    ]);
    assert.equal(accepted.filter((r) => "replay" in r && r.replay).length, 1);
    await saveAcquisitionReview(db, actor, sessionId, {
      action: "defaults",
      revision: 1,
      defaults: { finish: "FOIL", condition: "HP" },
    });
    state = await getAcquisitionCardReview(db, actor, sessionId, photoId);
    assert.equal(state.review?.condition, "LP");
    assert.equal(state.review?.finish, "NONFOIL");
    assert.equal(
      (
        await getAcquisitionProgress(db, actor, sessionId)
      ).photoPreparation.filter((p) => p.status === "COMPLETE").length,
      2,
    );
    for (const invalid of [
      { ...decision, finish: "ETCHED" },
      { ...decision, language: "fr" },
      { ...decision, cardId: "missing" },
    ])
      await assert.rejects(
        saveAcquisitionReview(db, actor, sessionId, {
          ...input,
          revision: state.revision,
          decision: invalid,
        }),
        /Choose/,
      );
    const races = await Promise.allSettled(
      ["NM", "MP"].map((condition) =>
        saveAcquisitionReview(db, actor, sessionId, {
          ...input,
          revision: state.revision,
          decision: { ...decision, condition },
        }),
      ),
    );
    assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
    state = await getAcquisitionCardReview(db, actor, sessionId, photoId);
    const fault = db.$extends({
      query: {
        acquisitionCommand: {
          async create() {
            throw new Error("injected review audit failure");
          },
        },
      },
    }) as unknown as PrismaClient;
    await assert.rejects(
      saveAcquisitionReview(fault, actor, sessionId, {
        ...input,
        revision: state.revision,
        decision: { ...decision, condition: "DMG" },
      }),
      /injected/,
    );
    assert.deepEqual(
      await getAcquisitionCardReview(db, actor, sessionId, photoId),
      state,
    );
    await saveAcquisitionReview(db, actor, sessionId, {
      action: "pending",
      photoId,
      revision: state.revision,
    });
    state = await getAcquisitionCardReview(db, actor, sessionId, photoId);
    assert.equal(state.review, null);
    assert.equal(
      (await getAcquisitionProgress(db, actor, sessionId)).session.candidates
        .length,
      2,
    );
    assert.equal(
      await enqueueReadyRecognition(db, catalog, model),
      1,
      "cleared review uses its current revision for reprocessing",
    );
    const canonical = await db.acquisitionProcessingJob.findFirstOrThrow({
      where: { artifact: { sourceId: photoId }, stage: "photo-canonical-v1" },
    });
    const running = await db.acquisitionProcessingJob.update({
      where: { id: canonical.id },
      data: {
        status: "RUNNING",
        candidateRevision: state.revision,
        leaseToken: "late-preview",
        leaseExpiresAt: new Date(Date.now() + 30000),
      },
    });
    await saveAcquisitionReview(db, actor, sessionId, {
      ...input,
      revision: state.revision,
    });
    assert.equal(
      await completeAcquisitionJob(
        db,
        running as ClaimedAcquisitionJob,
        canonical.output as Prisma.InputJsonObject,
      ),
      "COMPLETE",
    );
    assert.deepEqual(
      await db.inventoryItem.aggregate({
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      stockBefore,
    );
    console.log(
      "PASS: defaults, per-card override, printing validation, owner denial, replay, competing edits, atomic review history, pending conservation and preview/review separation",
    );
  } finally {
    await db.card.delete({ where: { id: card.id } });
  }
}
