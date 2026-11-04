# FarBake: one renderer submission per tile

The renderer change batches an existing tile's under and over parts within one
`renderer.render` call. On three fixed, real tile inputs, submissions fell from
326 to 3. The pooled CPU submission median was 10.8175 ms before and 8.1225 ms
after (24.91% lower), with wide overlapping ranges. This is a rendering
microbenchmark; minimum 60 FPS and cold reconstruction remain **OPEN**.

The change preserves texture dimensions, resolution, depth geometry, part order,
local transforms, alpha, masks and filters. It neither reparents live parts nor
changes LOD, shared budgets, floors, eviction or resource lifetime. A temporary
empty container submits the existing parts in their original order and is
destroyed in `finally`. Part visibility, alpha, occluder visibility and temporary
parent state are restored even when drawing throws.

## Why this work was selected

The unchanged joined 5411 scene showed 1,254 per-part submissions across 34
midzoom bakes and 976 across 34 return bakes. The largest measured tile had 161
members, 77 drawable under parts and 147 drawable over parts: 224 submissions.
The nested renderer costs are included in bake costs and must not be summed with
them. Instrumentation overhead is unknown.

Current 5411 also retains genuine failures: midzoom needed 1,752.650 ms to finish
145 buildings, and a return after all 2,532 static instances were actually
destroyed needed 715.345 ms for 98 buildings. These observations are separate
from the fixed-input comparison below. Most midzoom roof runs genuinely exceeded
the existing 12 ms shared budget; conservative historical accounting during the
return is a separate issue. This patch changes no budget policy.

## Fixed-input correctness before timing

The 5412 diagnostic candidate overlays only `engine/streaming/far.ts` on joined
5411. The diagnostic-only old-source query loader and optimizer settings are
absent from production. Normal Begin, a visibly nonempty running game and its
production Screenshot capture precede comparison. After exactly three seconds
at zoom 0.5, the diagnostic freezes simulation and art admission. Both variants
then use the same existing instances, materials and geometry. No new arrivals
enter either input set.

Selection is deterministic: actual normal tile member sets are sorted by
drawable-part count, with numeric tile key as tie-break. The two largest sets
and an actually empty set are selected. No fake live part supplies the empty
case. Every target is 943 × 943 at resolution 0.46.

| Tile key | Members | Under / over parts | Color alpha pixels | Depth coverage |
| --- | ---: | ---: | ---: | ---: |
| 137439215615 | 161 | 77 / 147 | 431,083 | 404,904 |
| 137439739903 | 190 | 41 / 60 | 205,050 | 195,294 |
| 137437642750 | 12, all unbuilt | 0 / 0 | 0 | 0 |

All color channels match exactly; geometry, indices, shader/style state,
transforms and encoded depth match. Depth images encode the actual vertex
shader's `gl_FragCoord.z`; they are not direct depth-buffer reads. Source part
state is restored, including recursive derived transforms and alpha. Injected
`render` and `updateTransform` failures restore state and dispose the temporary
paint root, followed by successful healthy paints.

A separate actual Pixi/WebGL fixture verifies child stencil masks, under and
over `AlphaFilter`, additive child blending, nonidentity parents, rotated/scaled
parts, initially hidden/faded parts and stable depth ties. All 64 × 64 RGBA
channels match, with 2,245 nonempty pixels, zero GL errors and equal mask/filter
stack depth afterward. Its one-texture sampler cap is fixture-only. A harmless
404 resource warning is retained; no shader warning occurred.

## CPU submission benchmark

Timing begins only after exact pixel/state/error-cleanup gates pass. Four ABBA
blocks each contain six trials, producing 12 measurements per variant. Each
trial bakes the same three tiles and regenerates their depth meshes equally.

| Block | Median ms | Min–max ms |
| --- | ---: | ---: |
| Original A1 | 11.1650 | 9.845–14.235 |
| Candidate B1 | 9.4375 | 4.770–11.600 |
| Candidate B2 | 6.5650 | 4.355–12.415 |
| Original A2 | 10.6875 | 8.290–14.370 |

Pooled medians: **10.8175 → 8.1225 ms**. Ranges: **8.290–14.370 →
4.355–12.415 ms**. Submission count is deterministically **326 → 3**; timings
remain subject to driver scheduling and hardware load. No frame-rate, GPU-time
or whole-city loading improvement is inferred from these samples.

Launch: isolated Chromium, default headed backend (`headless: false`, no forced
GPU flags), 1687 × 1067, DPR 1; actual renderer reported NVIDIA RTX 5090. Source,
optimizer dependency URLs, epoch and context guards remain stable. No user
browser/profile is touched.

## Scoped checks and provenance

The relevant gate executed only `test/streaming/far.test.ts` and
`test/streaming/far-paint.test.ts`: **16 tests / 2 files passed**. Engine
`tsc --noEmit` passed. The intended committed compiler tree is HEAD
`e16e1a21e20dcb76844ecdd89bd1614c2936647f` plus exactly the three source/test
files named in `intended-tree.json`. No unrelated runtime or dependency draft is
present in that checked tree. The untracked UI build directory lies outside
the compiler's include patterns and is excluded from this commit.

Changed rendering-block Istanbul coverage is **100% lines, statements,
functions and branches**. Whole-module coverage is reported separately:
87.84% lines, 85.67% statements, 90.90% functions and **79.54% branches**.
No unrelated tests were added to inflate the whole-file result. The tests cover
submission count/order, local transforms and whole alpha, parent ownership,
empty tiles, failure recovery and existing invalidation/LOD/resource lifecycle.
No full suite was run or authorized for this work.

The diagnostic commands, run from the engine root, were:

```sh
npx vitest run test/streaming/far.test.ts test/streaming/far-paint.test.ts --config /tmp/far-bake-prototype/coverage-config.mjs
node /tmp/far-bake-prototype/coverage-summary.cjs
npm run typecheck
```

The temporary coverage configuration, setup, remapping script and logs are
copied here as text. The full raw comparison contains all 24 benchmark rows and
pixel/state hashes. A representative dense tile's before/after color and depth
images, the second tile, actual empty tile, nonempty scene compositor and
mask/filter fixture are retained alongside those records.

Candidate source SHA-256:
`bea775fc35f5f591647f2260abca631630702902a4bfd5b3a2e09372b30b8b96`.
Original source SHA-256:
`206f535cdabef949b8c16bc744c576ec20e573d48cbf462070ceb68fda52b815`.
Joined 5411 manifest:
`a548850ec62dcb0d4ce7d197183f99a90290f987e6a59d0f0c1d2210c98e4b01`.
Diagnostic 5412 manifest:
`a333d6a81434bceab3a2945e982a4d8bb9cf19ddde4e187fcbf458fcfcf9964c`.

Raw working artifacts remain under `/tmp/far-bake-prototype/`. Earlier failed
attempts remain evidence, never accepted pixels or timings: live entry scanning
outside the diagnostic loader, late optimizer reload/module identity split,
partial city readiness (16 complete / 82 unbuilt), and a duplicate diagnostic
`SHADER_NAME` define. The corrected depth encoder was verified with a tiny actual
WebGL mesh before the successful comparison. In that final run all 98 buildings
completed after 298.025 ms; an inherited partial-readiness note in the raw driver
is corrected explicitly rather than presented as the final result.

The first scoped gate failed before test execution because the optional
`@vitest/coverage-istanbul` package was unavailable; typecheck also found a new
test's union-method restoration assignment. Both logs are retained. Coverage
uses the already installed Istanbul instrumenter/remapper in the existing
scoped-check pattern; no dependency is installed. Test restoration now uses
method-specific branches.
