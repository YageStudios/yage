# Dense road mesh merge overflow

The pinned production GWB journey fails inside `mergeMeshes → roadMesh → roadBuffers → ahead-worker` with `RangeError: Maximum call stack size exceeded` twice. `native-gwb-red.json` and its log preserve that actual native failure, default headed Chromium launch, source digest, and immutable 5406 manifest identity. The failed worker discarded its arrays; we do not claim to have recovered that exact chunk.

A separate CPU reproduction uses 470 original NYC city-detail paths (30,003 original vertices), selected from the same pinned archive. `input-proof.json` retains the exact ordered street IDs and input hashes; the compressed test fixture contains their original GPS vertices. Stroking these coordinates with a half-width of 0.00001 degrees is a unit-free merge stress case, not a rendered native world plan. The resulting real-data aggregate has 180,018 position values, 180,018 UV values, 90,009 edge values, and 354,396 indices. Passing that aggregate to the original merge throws the same RangeError. Its full mesh JSON SHA-256 is `86778e3c26a5ba73c872e36d8e23f5e0a7ebf41be918f9c35f6dc06ebd497e89`.

The fix appends position and attribute elements with loops instead of passing their entire arrays as JavaScript function arguments. It preserves position/attribute ordering, attribute sizes and validation, and index offsets. Twelve scoped tests pass, including exact dense input/output equality, independently large attributes, prefix/suffix index offsets, empty inputs, and missing/incompatible attributes. Instrumented coverage is 100% for all changed `mergeMeshes` lines, statements, functions, and branches; the whole vector module has 98.56% line and 96.66% branch coverage. Engine `tsc --noEmit` passes without warnings.

The CPU benchmark alternates before/after order, excludes input construction and equality checks, and reports medians. On Node v26.2.0, 30 source pieces take 1.3653 → 1.0024 ms and 470 pieces take 10.3374 → 9.0016 ms. The formerly failing single dense aggregate takes 7.4067 ms after the fix. Both fixed aggregation forms preserve the exact mesh hash. These are merge CPU timings, not game-frame or FPS measurements. Raw samples and source hashes are in `benchmark.json`.

## Reproduction

From the engine checkout:

```sh
npm test -- --run test/streaming/vector.test.ts
npm run typecheck
git show 80f81413331567aa69b4fc70a9eb024ebf7fa591:engine/streaming/vector.ts > /tmp/vector-before.ts
node scripts/benchmark-merge-meshes.mjs /tmp/vector-before.ts /tmp/vector-benchmark.json
```

The benchmark and tests use the small committed fixture directly. To independently regenerate it, use the existing Python environment with NumPy and the pinned application's codec; no dependency installation is required:

```sh
PYTHONDONTWRITEBYTECODE=1 /data/workspace/worldmap/.venv313/bin/python scripts/recover-ny-road-traces.py \
  /tmp/infected-perf-snapshot-current-c017-a008/public/world-data/data/city_detail.zip \
  ../infected/tools/connector_geometry.py /tmp/ny-road-traces.json.gz
```

The codec SHA and exact decoded fixture hash must match. The retained coverage config/setup are the actual instrumentation used and require the already installed Istanbul cache path shown there; they add no runtime dependency.

## Remaining native acceptance

GWB native green remains pending on a separately pinned candidate containing only this engine fix over the unchanged verified 5406 cohort. No public grade assets were installed for this fix, and this increment does not establish bridge restoration completeness or 60 FPS.
