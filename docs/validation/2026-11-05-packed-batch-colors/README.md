# Pack numeric batch colors without repeated normalization

The actual ordinary-render CPU profile identified repeated Pixi `Color` normalization during default batch packing. The renderer now packs an already valid RGB integer directly, using the same alpha arithmetic and vertex/index layout as Pixi 7.4.2. Unusual color values delegate to the original method. Installation requires the original default packer and six-value vertex layout; custom plugins and the global Pixi prototype are untouched. The last viewport releases the change, including for a caller-owned application.

A complete ordinary frame supplied 7,223 actual batch inputs, all eligible numeric RGB, with 781 distinct tints and varied alpha. Every packed vertex/index word and surrounding sentinel matched. The native repeated-input comparison used four ABBA blocks, eight complete corpus passes per sample. Median time per pass fell from **10.998 ms to 8.918 ms (18.9%)**. All samples are retained.

Four ordinary 1.5-second A/B/B/A phases had stage medians 3.530 / 3.250 / 3.425 / 4.340 ms. The first A phase changed from about 6,735 batch calls to 625 as normal scene preparation completed; later phases had 625–627 calls. These short evolving phases support a qualified rendering improvement, not a matched sustained FPS conclusion. Their stage-completion interval p95 values were 21.920 / 18.390 / 18.600 / 19.590 ms. All 428 setup, first-request, phase and tail frames remain in the archive, including the deliberate CPU benchmark's 1,340.625 ms blocking interval. Stage completion intervals are not complete callback measurements.

The game ran ordinary unpaused simulation without fixed animal inputs, entity/quality reductions, cache clearing or changed retention. The same owned persistent profile was reused. The captured working-source manifest is `41bda76525e0f094b514104fe413e68d8579810361b1d2c5505233bcf442b03d`; its source is preserved, including uncommitted changes at capture. It predates later coastline edits and uses the R2 road selector `64b548a9…`. The common passive observer manifest is `cccd34aa…`. User processes were untouched; global host isolation is not claimed. The 500 ms PSS sampler remained enabled; all overlapping intervals stay included. The packing helper did not retain a page time origin, so exact per-frame sampler overlap is unavailable for this comparison. Peak owned-tree PSS was 2,707,425,280 bytes, under the unchanged 4 GiB guard. There were no page, guard or cleanup failures, and the healthy game stayed alive after camera/method restoration.

Scoped verification:

- Six installed real-Pixi controls cover all 256 channel values, alpha modes/edges, negative/nonfinite alpha, fallback colors and errors, custom methods/layouts, release ownership, empty buffers and the complete captured corpus. The production module has 100% remapped statement, line, function and branch coverage.
- Seven actual PixiViewport browser lifecycle controls pass, including caller-owned app restoration and preservation of a custom packer. All three changed executable install/cleanup lines were hit eight times. Whole legacy viewport coverage is reported separately: 82.63% statements, 84.51% lines, 81.81% functions and 72.58% branches.
- The affected source/browser strict closure passes the actual project configuration: baseline 0 errors, candidate 0. Initial adapter failures (the common test setup's Pixi mock, and an invented compiler configuration) are qualified as setup failures; no performance data was accepted from them.

Run the relevant portable controls from the engine root:

```sh
node node_modules/vitest/vitest.mjs run test/packed-batch-colors.test.ts --maxWorkers=1
UI_FINAL_BROWSER=/usr/bin/chromium node scripts/test-pixi-viewport-browser.mjs
```

`PACKED_BATCH_BENCH=1` on the first command repeats the captured corpus in Node under the original five-second test bound. This is a repeatability control; the reported 18.9% result comes from the retained native browser run. No full suite or additional journey was run for this increment.

`evidence.tar.gz` contains the exact frozen source, three passive source overlays, native helpers/candidate, actual input, full CPU profile, raw timings/frames/PSS, failed attempts and scoped verification. `archive-inventory.json` lists every member's size and SHA-256. The test fixture decompresses to the exact captured JSON hash `929ca87cf0b26f290269cfbaf339ffc4f6e497b24514b107e6afd01b8af1de13`.

Sustained active 16.67 ms frames, ordinary zoom-out/zoom-in return and normal eviction/lifetime acceptance remain open. This increment changes packing work, not rendering fidelity or those acceptance gates.
