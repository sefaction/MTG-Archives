import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acquisitionReviewEvidence,
  cropPoint,
} from "../lib/acquisition-review-evidence";

test("review evidence preserves both observations while withholding private runtime metadata", () => {
  const input = {
    native: {
      descriptorDetails: { privatePath: "must-not-leak" },
      geometry: {
        status: "PROPOSED",
        method: "full-frame",
        quad: [
          [10, 20],
          [210, 10],
          [230, 330],
          [0, 340],
        ],
        privateField: "omit",
      },
      orientations: [0, 180].map((rotationDegrees) => ({
        rotationDegrees,
        text: {
          title: [rotationDegrees ? "different direction" : "Saber Ants"],
          footer: [],
        },
        lines: [
          {
            text: "Saber",
            score: 0.99,
            polygon: [
              [10, 10],
              [50, 10],
              [50, 20],
              [10, 20],
            ],
          },
        ],
      })),
    },
    proposals: {
      orientation: { status: "UNRESOLVED", rotationDegrees: null },
      evidence: { setCodes: [], collectors: [], languages: [] },
    },
  };
  const evidence = acquisitionReviewEvidence(input)!;
  assert.equal(evidence.rotation, null);
  assert.equal(evidence.geometry.method, "full-frame");
  assert.deepEqual(evidence.readingZones.footer, { top: 1210, bottom: 1397 });
  assert.equal(evidence.observations.length, 2);
  assert.equal(evidence.observations[1].text.title[0], "different direction");
  assert.ok(!JSON.stringify(evidence).includes("private"));
  assert.equal(
    acquisitionReviewEvidence({
      ...input,
      native: {
        ...input.native,
        orientations: [
          {
            ...input.native.orientations[0],
            text: { title: ["x".repeat(2001)], footer: [] },
          },
        ],
      },
    }),
    null,
  );
  assert.equal(acquisitionReviewEvidence({ proposals: {} }), null);
  const current = {
    ...input,
    native: {
      ...input.native,
      readingZones: {
        title: { top: 0, bottom: 250 },
        footer: { top: 1270, bottom: 1397 },
      },
    },
  };
  assert.deepEqual(acquisitionReviewEvidence(current)?.readingZones.footer, {
    top: 1270,
    bottom: 1397,
  });
  assert.equal(
    acquisitionReviewEvidence({
      ...current,
      native: {
        ...current.native,
        readingZones: {
          ...current.native.readingZones,
          footer: { top: 1400, bottom: 1500 },
        },
      },
    }),
    null,
  );
});

test("inspection transform preserves all worker corners and portrait rotations", () => {
  for (const quad of [
    [
      [0, 0],
      [999, 0],
      [999, 1396],
      [0, 1396],
    ],
    [
      [30, 10],
      [700, 60],
      [820, 1200],
      [0, 1000],
    ],
    [
      [800, 20],
      [810, 1200],
      [20, 1190],
      [0, 0],
    ],
  ]) {
    for (const [i, [u, v]] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].entries()) {
      const actual = cropPoint(quad, u, v);
      assert.ok(Math.abs(actual[0] - quad[i][0]) < 1e-6);
      assert.ok(Math.abs(actual[1] - quad[i][1]) < 1e-6);
    }
  }
  assert.deepEqual(
    cropPoint(
      [
        [0, 0],
        [100, 0],
        [100, 200],
        [0, 200],
      ],
      0.5,
      0.5,
    ),
    [50, 100],
  );
});

test("failed localization remains available as evidence without fabricated crop or OCR", () => {
  const evidence = acquisitionReviewEvidence({
    native: { geometry: { status: "NEEDS_CROP" }, orientations: [] },
    proposals: { evidence: { setCodes: [], collectors: [], languages: [] } },
  });
  assert.equal(evidence?.geometry.status, "NEEDS_CROP");
  assert.equal(evidence?.geometry.quad, undefined);
  assert.deepEqual(evidence?.observations, []);
});
