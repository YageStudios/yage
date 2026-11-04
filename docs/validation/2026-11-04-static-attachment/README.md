# Attach lazy static parts when they are built

`StaticSet.list` used to attach four empty containers for every listed instance, including art that was never built. Actual Seville listed 2,104 instances but built only 202 in the measured view, leaving **7,608 empty unbuilt containers** in its four display trees. The candidate attaches each instance's existing containers only when its real build starts. Picking, chunk ownership and normal full eviction are unchanged; no art cache or retention was introduced.

The first implementation searched all listed metadata to preserve paint order. Measurement rejected it: build median rose from0.49 to14.51ms and total lifecycle from11.66 to21.50ms. The final implementation assigns weak listing ranks once per new lazy instance and searches only attached siblings. Non-lazy builds retain their direct append path. Ranking is private presentation metadata, not retained art; disposal still destroys all four containers, including never-built ones.

The real `ChunkScene` owns one `StaticSet` for its roots. Nearest-first or reverse builds retain listing paint order, current unrelated prefix/suffix siblings remain in place, and existing z/restack rules still apply. This change does not add a protocol for arbitrary interleaving by multiple independent StaticSets sharing a root; that arrangement is not used by ChunkScene.

## Controlled CPU benchmark

The same-process test instantiates actual old/new StaticSet implementations with the same PIXI dependency and identical inputs: 2,104 lazy-listed instances, 202 built, four real shadow/static roots, full destruction every trial. The part payloads are deliberately identical empty containers, isolating listing, attachment and disposal rather than pretending to benchmark roof construction. After three warm-up pairs, eight ABBA cycles produce16 samples per implementation. Raw trials and the exact executed fixture/config are preserved here.

| CPU phase, median milliseconds | Before | After |
|---|---:|---:|
| List | 3.055 | 4.332 |
| Build and cull | 0.589 | 1.074 |
| Drop | 8.424 | 1.886 |
| Whole lifecycle | 13.206 | 7.423 |

Listing/ranking and insertion have explicit costs; the net improvement comes from eliminating unused tree membership and its disposal work. These are CPU lifecycle measurements, not a 60FPS claim. The benchmark uses the original engine `65da0f7` source for its before class, and the exact source hashes are in [provenance.json](provenance.json).

## Relevant regression checks

The original source fails the actual production lazy-listing test: no build occurs, yet each root contains2,104 empty children. The candidate passes. Four permanent tests cover unseen picking/ownership, all-four-pass attachment, reverse build order and unrelated siblings, tint, shared holders, exact-once disposal, full eviction/fresh reconstruction and roof fade/depth. The22 existing StaticSet tests also pass. Two directly affected ChunkScene/FarBake picture tests check compatibility; no unrelated full suite was run.

28 relevant tests pass across three files. Engine typecheck exits0. Source-remapped Istanbul coverage is **94.66% statements / 83.91% branches for the affected StaticSet class**, and **100% in every metric for the attachment helper**. Whole-file figures are recorded separately; untouched code was not added to the test scope to pad coverage.

## Actual native checks and remaining failure

The actual paused Seville frame is pixel-identical after restoring the original all-listed display-tree layout on the same geometry: **zero changed pixels out of1,800,029**. The natural screen frame also exactly matches the manual-render control before that counterfactual. All four pass roots retain their unrelated siblings; no lost geometry, alpha/depth change, black canvas or lost context occurred. Geometry/UV/style hash remains `f2ad31fdff734e871bd7f76181cfb8cfaca9cdcc78a89fac272c8fb794093a56`.

Serial headed native before/after runs use identical hooks, source/assets except this one engine file, 1687×1067/DPR1, no GPU timer and no PNG/readback during timing. Each deliberately destroys all2,104 instances before reconstructing98 visible buildings. StaticSet release CPU totals fall29.25→16.36ms; inclusive scene removal falls34.27→21.65ms. These costs nest and must not be added. Empty unbuilt attachment falls7,608→0, while all202 built instances still attach and all2,104 listed instances still evict completely.

**The user-facing performance requirement is not met.** Cold visible completion is496.53→495.13ms, so this pair establishes no loading speedup. Eviction's maximum model frame remains80.20→76.06ms; cold-return frame p99/max is33.35/49.99→50.02/50.05ms, with6→5 intervals over20ms. Headed nominal cadence is16.67/16.68ms, not sustained minimum60FPS under load. About55ms of the candidate eviction frame lies outside the measured scene-removal calls and remains a causal profiling target. FrameBudget estimates, quality and eviction policy are unchanged.

[native-summary.json](native-summary.json) preserves native phase/frame/count/pixel results, with compressed complete reports alongside it. Native images and exact diagnostic drivers are preserved in the Infected integration's `2026-11-04-static-attachment` evidence. These frozen Seville inputs intentionally predate the separate DC coastline correction; latest-source integration acceptance remains separate. Improving this measured lifecycle is one verified increment, not completion of instantaneous reconstruction or minimum60FPS work.
