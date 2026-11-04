# Distant attachment geometry and foot depth

DepthQuads previously packed world positions and depth feet directly into Float32 arrays. The actual app passes world positions for rifles, pistols, hands and masks. At NYC/Mexico Y coordinates near 352 million, a small attachment could become a 32-unit strip or disappear, and its depth could move to the wrong side of the pawn. This is independent of the already committed bird and FarBake defects.

`begin(originX = 0, originY = 0)` now owns one per-draw placement. Quad anchor and foot coordinates are offset before upload, and the mesh sits at that origin. `corner()` still returns world coordinates. Legacy zero-origin calls, negative-height flips, UVs, tint, alpha, order, growth, empty frames and reuse are preserved. The two actual app callers explicitly provide a chunk-aligned frame origin; simulation, culling and grip/pose calculations stay global. No per-quad node, texture, quality or retention change is introduced.

Caller inventory found only MaskAssets and LoadAssets constructing these meshes in current production. Their draw callers are MaskDraw and LoadGuns. No existing app caller sets the meshes' position/rotation/scale or transforms the guns parent; all previously used default begin at zero position. External public Mesh users that assign their own transforms are not claimed as audited. The new begin contract explicitly owns mesh placement.

## Actual-buffer red and scoped regression

`depthquad-audit.json` uses actual DepthQuads, real gun/hand/mask dimensions and an actual ChunkScene pawn layer as its control. At NYC, rifle height changes 20.516→32 units, pistol 10.258→32, hand 3.2→32 and mask 6.1875→0 on old code. At Mexico all four collapse to zero height. Projected packed-foot error is 23.165 pixels in NYC and 36.283 in Mexico at zoom 2.791. The local pawn control remains within 1.2e-7 pixels. UVs and poses are unchanged. This attributes attachment/mask precision, not generic whole pedestrian bodies.

The initial diagnostic config omitted JSON5 transformation for real art metadata and failed before bodies; its failure is retained. The corrected diagnostic reproduces the actual buffer error. Permanent engine regressions produce five failures/two passes on original source, then seven passes after correction. They cover packed attributes, world corners, flipped artwork, order/growth/empty/default/return semantics and actual ProjectedCamera depth relative to a local pawn. Engine typecheck passes. Remapped entire depth-quads.ts coverage is 100% lines, statements, functions and branches; changed scope is eight lines, ten statements, one function and two branch outcomes, all covered. No full suite was run during development.

The sibling app's `docs/validation/2026-11-04-distant-attachments/` contains actual caller integration reds, greens, typecheck and changed coverage.

## Measured equal-output packing cost

`depthquad-packing-bench.json` retains all samples. Each draw publishes 500 quads; each sample averages 20 draws, with six warmups and 20 measured samples per variant in interleaved forward/reverse orders. Exact uploaded position/UV/tint/alpha/foot arrays match the original near reference before timing. Median CPU packing/publication cost is 0.229309 ms original, 0.233103 ms corrected zero-origin and 0.226773 ms corrected distant-origin. Ranges overlap: 0.222624–0.260715, 0.222813–0.256949 and 0.221726–0.276405 ms. The approximately 3.8 microsecond zero-origin median difference is a small measured correctness overhead, not a speedup or whole-frame/FPS claim.

## Actual GPU attachment and pawn occlusion proof

`native-r2/attachment-proof.json` uses the actual game renderer, real installed gun/hand/mask atlas objects and real ChunkScene pawn geometry/shaders. Four attachment kinds × clear/front-pawn controls × near/NYC/Mexico placements × original/corrected implementations produce 48 fixtures. These are focused fixture translations after one Seville boot, not geographic journeys or injected world actors.

All 24 corrected outputs exactly match their unchanged original-near reference pixels; all 16 original distant controls differ. The actual front pawn reduces the isolated q-on versus q-off attachment channels in every kind: rifle 799→765, pistol 121→101, hand 27→24 and mask 313→275. Every comparison retains the same pawn/background. Real sampler identity, texture dimensions/scale mode, UVs, alpha cutoff 0.03, blending and read-only depth state are recorded. Camera projection, render target and mask stacks restore correctly, with zero GL errors.

The backend is actual NVIDIA RTX 5090 OpenGL ES 3.2. Native source, assets and optimizer hashes stay unchanged; one module epoch/navigation and zero page/request errors are required. Actual Chromium spawn arguments include `--js-flags=--max-old-space-size=512`; the independent off-thread guard retains 6 GiB complete owned-browser PSS, 8 GiB available memory and a 180-second outer deadline. Boot, fixture and metadata bounds stay 60, 15 and 3 seconds. Peak owned PSS is 3,081,191,424 bytes. Three deprecated-initialization console warnings exactly match the unchanged c7d23 baseline inventory; the raw comparison is retained, with no warning suppression. These are functional safety guards, not a memory improvement or minimum 60 FPS acceptance result.

## Failed first GPU control and causal correction

`native-r1/` is retained as an unsuccessful occlusion proof. Although all translated corrected pictures matched, its repeated q-hidden render reused the same depth target after q left depth writes disabled. The visibility metric consequently included disappearing pawn-body pixels and failed its original front-pawn assertion.

The R2 causal prelude starts with known writable depth, renders the actual q to introduce read-only depth, then repeats body-only without a reset. Real DEPTH_WRITEMASK is false and the depth function is LESS (513); body alpha falls 3,698→1,585 pixels, visibly leaving an outline. A writable fixture clear restores the exact original body SHA `53116602a6b3ec363b5d5e11e8b8ef554e2632f4416919d42c7213384783bba9`. Reversed on/off order retains identical on hashes and identical off hashes. Only then do the unchanged 48 fixtures run with Pixi's normal State.for2d set before each offscreen clear. The occlusion assertion itself is unchanged.

This clear-state reset is diagnostic only. The body-only reference also leaves the depth-write mask false: DepthQuads is not the unique trigger. No production clear, pose, artwork or renderer policy was modified. The fixture hazard is not by itself attribution of any main-game pedestrian disappearance; that would need a separate actual main-pass observation.

## Provenance

Candidate manifest `fefa78a3515f6b56d9fcd2c0833b57145203507a30d104b64c4ff93b3cd17423` derives from the accepted distant-bird/building cohort `9e9213327079462085d7916f014572b516c17a5b93a290797332f4f30b854e2b`. Only depth-quads.ts and its two app callers are new production overlays. Old class duplicates are explicitly diagnostic. Complete manifests, private asset pins/configuration, guard, original failures, drivers, helper and exact before/after source bytes are durable. Live production bytes match the successful candidate exactly.

The first coverage-summary helper attempted a child-process git call that the sandbox reported as EPERM despite returning its diff; summary generation instead reads separately captured exact git diffs. This changes no test body or coverage result. No skipped tests, wider timeout, warning suppression or package dependency was introduced.
