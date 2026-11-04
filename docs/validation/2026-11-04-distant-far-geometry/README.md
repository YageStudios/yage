# Distant FarBake colour and depth precision

FarBake previously sent global positions through Float32 conversion before its offscreen colour transform and in its depth mesh attributes. At geographic Y near 352 million, uploaded vertices snapped to rows 32 world units apart. Buildings that are normal near Seville could acquire skewed walls and roof triangles in distant frames. This is independent of the grounded animal precision failure documented in the sibling app evidence.

The correction temporarily draws each existing part relative to the tile origin before batching, then restores its original position in `finally`. Its original parent, scale, rotation, pivot, visibility, alpha and occluder state remain intact, including render/updateTransform failure paths. Colour projection then only scales tile-local coordinates. Depth attributes subtract the same origin before Float32 conversion; the depth mesh is positioned at that origin. No LOD threshold, texture quality, submission budget or retention policy changes.

## Scoped regression and coverage

`far-distant-buffer.json` records actual Sprite.calculateVertices and FarBake depth buffers for the same rotated 129.4×75.9 quad. Maximum upload error rises from 0.00003035 world units near the origin to 15.7567 in NYC, Pennsylvania and Mexico coordinates. Actual depth height changes from 75.900024 to 64 in the old distant buffer. The new actual FarBake regression fails in all three locations on original code and passes after correction.

The scoped run passes 21 tests across far-distant, far and far-paint. The new five tests cover those three actual packed-buffer comparisons and both draw/updateTransform throw-restoration/retry paths. Engine typecheck passes. The changed scope has 100% coverage across 47 lines, 59 statements, two functions and 14 branch outcomes. Whole far.ts coverage is 91.94% statements, 93.84% lines and 82.38% branches, reported separately. No full suite was run during development.

## Actual GPU colour, depth and mask proof

`native-candidate/far-proof.json` uses an actual already-built native building, with its original geometry, material, roof and occluder, in the actual game renderer. Only the placement is translated. The source ID, dimensions, original placement and tile origin are retained there. It compares old and corrected FarBake implementations near the origin, at a shifted near tile, NYC, Pennsylvania and Mexico coordinates. These are focused translations of one actual building, not three full regional journeys.

Every corrected colour and diagnostically encoded actual depth output is byte-identical to the unchanged near reference across all five placements. Reference colour SHA256 is `c2de8b678299aebe15915ee2495ea3e7e3a9f014bf0c571c67af10eceb536d97`; depth is `ac6fe4cfe166d8ca055b6c2616f316bceb8113d6517e17fa79f2965e9e097727`. Old distant outputs differ in more than 104,000 colour channels and 47,000 depth channels. The old/new Mexico PNGs visibly show the roof and wall distortion disappear.

`native-candidate/far-mask-proof.json` separately passes an actual native renderer fixture with nonidentity parents, rotated/scaled parts, original visibility/alpha, child masks, filters, additive children and tied depth. All 2,245 alpha pixels match, with zero differing channels and zero GL errors. Original state and renderer projection/mask/filter stacks are restored.

## Equal-output bake cost

The same actual building at shifted near tile (1,1) exercises position mutation and transform recomputation while requiring exact old/new colour and depth equality. ABBA ordering uses three warmups and nine measured samples per block, 18 samples per variant. Median bake cost is 0.1375 ms before and 0.1400 ms after; ranges are 0.125–0.155 and 0.135–0.160 ms. This is a measured approximately 2.5 microsecond correctness overhead with overlapping sample ranges, not a speedup or 60 FPS claim. Raw samples remain in far-proof.json.

## Source provenance and limits

The exact tested far.ts before/after bytes are in source-overlays. Candidate manifest `9e9213327079462085d7916f014572b516c17a5b93a290797332f4f30b854e2b` derives from frozen current parent `c7d23bb5617ca10be18331eca09797defbea7e2ef0c13f1226e68e635afc9a57`; only far.ts and the independent app CritterView correction are production overlays. Both full source manifests, asset pins, configuration and the native driver/helper are durable. The live far.ts SHA matches the tested candidate exactly. Native run peak complete owned-browser PSS is 3,827,168,256 bytes, under the 6 GiB diagnostic guard, with zero page/request/GL errors for the accepted proofs.

The complete runtime result is retained in native-candidate/runtime-result.json. Its final status is failure solely because a later fresh zoom 0.474 overview expected active FarBake, while admission is below 0.46. A later .4-admission → .474-hysteresis overview-only run timed out on a combined predicate without intermediate state. Those overview failures remain in the app's sibling `docs/validation/2026-11-04-distant-critter-geometry/` evidence. Whole-city overview acceptance remains OPEN; this fix verifies the actual bake colour/depth defect and mask invariants. It does not prove every screenshot artifact uses FarBake or close unrelated in-place rendering paths.
