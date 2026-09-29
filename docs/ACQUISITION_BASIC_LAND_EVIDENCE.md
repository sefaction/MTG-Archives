# Basic-land evidence ties

Issue [#485](https://github.com/sefaction/MTG-Archives/issues/485) follows the user's
review of #478/#481/#482/#484. These approved foundations are merged; broader
recognition [#463](https://github.com/sefaction/MTG-Archives/issues/463) remains open.

## Reproduction and correction

In the new Card scan sample, Mountain FIN 304 has readable title/collector text.
The OCR footer joins the language and artist (`FIN• ENRANDY GALLEGOS`), so the
strict parser does not establish set or language. Both independent DINO and SIFT
retrieval orders put FIN 304 first. Earlier title/collector ordering nevertheless
put CM2 304 and C17 304 ahead in arbitrary local Card ID order.

The candidate union now uses image support to order equally supported
title/collector candidates. Full set/collector/title evidence still has priority;
contradictions and alternatives remain visible. No set or language text is
invented, no candidate becomes a confirmed printing, and no native image/OCR
method, geometry, confidence threshold or model changes. Resolver generation v5
refreshes catalog proposals from saved native observations without repeating
photo acquisition or recognition. Human review and explicit Inventory commit
retain their existing fences.

## Evidence

All 67 playable samples were labelled before retrieval and first paired runtime
results were retained before deploying this change. The initial runtime was
58/67 correct first, 65 offered; the subsequent development replay is 61/67 first,
65 offered. The old policy reproduces every saved proposal order against the
frozen local-card projection; the new policy reuses only actually observed native
candidate evidence. Three Mountain results improve, covering two printings.
Repeated printings and unknown physical grouping prevent an independent-card
accuracy claim. All automatic proposal eligibility remains off.

Earlier development regressions retain all suggested expected printings:

| Sample | Previous first | Updated first | Offered |
| --- | ---: | ---: | ---: |
| Android originals (23) | 13 | 14 | 21 |
| Scanner originals (17) | 15 | 15 | 17 |
| Additional Android originals (28) | 27 | 27 | 27 |
| Earlier scanner batch (123 labelled of 124) after printing | 119 | 119 | 123 |

The current model-free guard reproduces the joined footer and preserves unknown
set/language. The optional real-photo browser case uses the retained FIN 304
bytes through normal Card scan ingestion, actual OCR/image/catalog/printing
workers, owner review and desktop/320px layouts, with zero Inventory writes:

```text
MTG_LOCAL_PILOT_TEST=1
MTG_ACQUISITION_NEW_SCANS_PATH=<private earlier scanner originals>
MTG_ACQUISITION_BASIC_LAND_SCAN_PATH=<private FIN 304 original>
PLAYWRIGHT_BASE_URL=http://127.0.0.1:13001
npx playwright test tests/ui/acquisition-printing.spec.ts --workers=1
```

The reusable [saved-runtime scorer](ACQUISITION_RUNTIME_EVALUATION.md) refuses
incomplete evaluation by default. The sanitized full initial/replay result file
is [playable-runtime-results.json](../tools/acquisition-eval/playable-runtime-results.json).
Originals, raw observations, labels and local IDs stay private. The disposable
core verifier's timeout fixture is explicitly made eligible to isolate handler
abort from Docker Desktop/database clock scheduling; production queue logic
is unchanged by that fixture correction.

Local acceptance passed: 27 focused guards, typecheck/ESLint, disposable
database/core verification (151.318 seconds with owned cleanup), and all five
real-worker browser cases (10.1 minutes through the normal shared queue).
FIN 304 ranked first with set/language still unknown, full frame retained,
desktop/320px screenshots inspected, failed-printing fallback preserved and
zero Inventory writes. The one-worker review images match 453 build inputs,
digest `46cd7e2c40fd901a7509a690c72d28254f3482f3b452e1b0018c73ed26656d8b`.

## Remaining recognition work

The new runtime detects four of four physical List stamps, but all four candidate
reference stamp states are UNKNOWN. Only two of the four PLST identities rank
first. Also, all 63 unstamped cases remain unreadable for absence, and two
Commander's Sphere printings are missing from the offered list. The tie fix does
not resolve these limits or enable automatic confirmation. Production and scanner
hardware are unchanged.
