# Recognition method reassessment

Development comparison, 2026-09-27. Tracking: [#463](https://github.com/sefaction/MTG-Archives/issues/463), within acquisition recognition #307.

## Decision

The present PaddleOCR title/footer path is insufficient on the expanded phone
corpus. Do not promote the experimental larger-footer patch as the solution.
Continue with image and text candidate retrieval together, followed by separate
exact-print verification. Prioritize card localization and discriminating footer,
stamp and treatment evidence. Similar artwork alone cannot confirm a printing.

The VGG16 image method is the strongest **first-ranked printing** result in this
bounded comparison. It is a candidate generator to develop, not a validated
replacement runtime or proof that its upstream application is the most accurate.
No visual method in this batch automatically accepts a card.

## Corrected ground truth

The earlier ten-photo audit missed visible lower-left Planeswalker stamps on
Krosan Vorine (PLST LGN-131), Saber Ants (PLST MMQ-267), and Timberland Ancient
(PLST MOM-210). Both manifests now use those identities. The original
four-correct-automatic-match claim is withdrawn: Timberland Ancient was wrongly
confirmed as MOM 210. Existing saved reviews and Inventory are not silently
rewritten; earlier choices can be corrected by the user.

Stamped reprints can retain original set/collector text, so reading that text
correctly does not eliminate this ambiguity. The stamp also does not uniquely
identify every distribution product. [Wizards' Mystery Booster explanation](https://magic.wizards.com/en/news/announcements/mystery-booster-convention-edition-returns-store-events-2021-06-21)

## Measured comparison

All 23 private Android photos are development samples. The shared diagnostic
pool has 3,635 public reference images: all catalog printings of their card names
plus 256 deterministic unrelated distractors. Labels select the diagnostic pool
and score results; they do not route individual queries. This smaller, favourable
pool is **not full-catalog or held-out accuracy**.

| Method | Exact printing first | Exact printing in first 12 | Correct name first |
| --- | ---: | ---: | ---: |
| Current Paddle region OCR + original resolver | 11/23 | 16/23 | 17/23 |
| Experimental enlarged footer/grouped text + original resolver | 13/23 | 19/23 | 20/23 |
| Tesseract regions + original resolver | 8/23 | 11/23 | 12/23 |
| Basic perceptual hash | 15/23 | 20/23 | 20/23 |
| VGG16 pooled image embeddings | 17/23 | 22/23 | 18/23 |
| Union of image candidates, reranked with SIFT/RANSAC | 16/23 | 22/23 | 22/23 |

OCR rows use the frozen pre-change resolver for a comparable baseline. The
current and experimental OCR paths would wrongly auto-confirm one card each
(4 and 7 automatic decisions respectively). The experimental path also regressed
a correctly identified ONE Mountain. It is retained privately and not deployed.

Against the actual local Card projection, current OCR ranked 10/23 exact
printings first and 16/23 in the first 12. This is distinct from the controlled
pool result; catalog contents and ID tie-breaking differ. The protective resolver
change retains those ranks and reduces automatic decisions from four to three,
with zero wrong automatic choices **on these samples only**.

### What the failures show

- OCR splits some titles and misses small collector text. Current geometry fails
  on three photos, including one cropped card, one near the frame edge and one
  with glare.
- VGG16 ranks all three stamped List examples correctly. That does not establish
  a stamp detector: it chooses a wrong card name on five other photos.
- SIFT improves name retrieval, but ranks the original printing ahead of the
  stamped version on all three List examples. Shared artwork dominates its
  whole-card score. It also prefers promo variants for Phylath.
- All visual paths fail to put the expected Winter, Tormented Loner in the first
  12. Localization needs attention before more confidence rules.
- A combined candidate set is promising; a calibrated combined acceptance rule
  has not yet been evaluated. No oracle choosing the best method per photograph
  is presented as an implementable result.

The visual run used an offline Docker container limited to four CPUs/3 GiB,
four indexing threads and one query thread. The measured remaining index pass
was 537.7 seconds after resuming a 208-reference checkpoint; this is **not total
cold index time**. Combined decode/geometry/pHash/VGG/SIFT query time was median
4.845 seconds, maximum 7.558 seconds; peak process RSS was about 1,355 MiB and
includes indexing. These are combined experimental timings, not isolated VGG
latency or a production load test. The reference pool is far smaller than the
full supported catalog.

## Existing projects reviewed

| Project | Relevant method | Conclusion for this app |
| --- | --- | --- |
| [MTG Card Analyzer](https://github.com/dills122/MTG-Card-Analyzer/tree/40738918a4805f12120638f94ef0362bedd5d75a) | Tesseract/fuzzy names with PDQ visual fingerprints | Useful hybrid design; its own research documents printing gaps. Our basic pHash is not PDQ and does not benchmark the entire upstream app. |
| [MTG RealTime](https://github.com/pulkit4501/MTG_RealTime/tree/70be8912152919acece136aff0088d74370588db) | VGG16 pooled embeddings and flat L2 search | Reproduced the embedding method with exact matrix search. Its stock YOLO segmentation weights are not demonstrated card-trained weights; its nearest neighbour is not calibrated printing certainty. |
| [local-mtg-scanner](https://github.com/McDandle/local-mtg-scanner/tree/2b7868383c8396625c19345b1162d1c6fead8310) | Apple Vision on macOS; Tesseract on Linux/Windows; metadata/fuzzy matching | No evidence that switching to its Linux OCR path fixes these photos. |
| [mtgscan](https://github.com/fortierq/mtgscan) | OCR and name correction for deck lists | Name recognition is a different target from exact printing; its documented Azure path was not tested with private photos. |

The first three wrappers have MIT licenses. Dependency/model/data rights need
their own review before deployment; wrapper licensing does not grant rights to
all referenced weights or card images. VGG uses the official torchvision
IMAGENET1K_V1 weights, locally initialized outside the image. The experiment
does not redistribute weights or private photos. [Torchvision model documentation](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.vgg16.html)

## Delivered protective change

Resolver v3 retrieves known PLST entries by their printed source set/collector
alias as well as name, explains the stamp ambiguity, and requires review when
that ambiguity is known. Older resolver outputs cannot newly auto-confirm.
Unreviewed photos are reprocessed; existing saved decisions remain intact.
This is catalog-aware protection, **not stamp detection**, and an incomplete
catalog can still omit counterparts.

The app runtime still uses PaddleOCR. The visual comparison is evaluation-only;
there are no production configuration changes. Models, originals, reference
images and caches remain outside disposable images.

## Next recognition acceptance gate

Build a full supported-catalog visual index and union its candidates with OCR.
Compare robust localization and targeted printing/stamp verification before
changing automatic acceptance. Test unseen photos, same-art original/List pairs,
promos, difficult crops/glare, non-English cards and catalog omissions. Measure
wrong automatic decisions separately from candidate recall, with CPU latency,
memory and index maintenance costs. Keep #463 open until those failures are
addressed; this benchmark and protective change alone do not resolve it.

Reproduction instructions and pinned result metadata are in
[the evaluation directory](../tools/acquisition-eval/README.md).
