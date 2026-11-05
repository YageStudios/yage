# One-byte surface visited markers

`paintSurface` builds each sprite atlas's surface map. Its found array stored a 32-bit root pixel index, but that value was only copied forward and tested for seen/unseen; it never addressed art or output. Surface colors already propagate directly through `copyWithin`. Replacing the index with a byte marker preserves seed/frontier append order, nearest-fringe tie handling and every output byte while reducing explicit scratch by three bytes per atlas pixel. Interfaces, cell/lift/rise behavior, full atlas dimensions and rendering quality are unchanged.

The production diff is five lines in `engine/streaming/shadow-pass.ts`, based on clean engine `685ce27c6a1a17ca0775a567b51c298fe54d2a0b`. Original SHA-256 `8b8d4b191dcb509b4a71b85c06995e7f5ea8d76ea74b38059c996fa9aea1a45a`; tested candidate `a7a10ee3bb87efe504bf5791c738f80deadcc76b7d4ca7e530bbd43e99cd11e8`. Original source and the existing historical fixture are archived losslessly. The source manifest records the exact replacements.

## Verification

- Seven scoped private controls compare the exact original and candidate algorithm with their real color encoder. They assert byte-for-byte output, actual seed/frontier append sequence, array-index-zero seeds, alpha threshold/no-height hits, raised underside/top/side encodings, varied lifts/scales, partial cells, cell boundaries, the four-round fringe limit and growing queues. The historical pixel-step marcher's existing golden SHA is unchanged. `controls.log.gz` contains all seven individual passing bodies; no file-level wrapper result is counted as multiple tests.
- The separate allocation budget goes red on the original (6068 bytes for 1517 markers) and green on the candidate (1517 bytes). Both raw results are retained.
- Repository-native `node node_modules/vitest/vitest.mjs run test/paint-surface.test.ts --maxWorkers=1`: four real-module tests pass, including the existing golden, edge/fringe behavior, empty/unmatched texels and an allocation budget. The first run encountered the engine test setup's incomplete global Pixi mock before test bodies; the final test follows existing streaming tests by unmocking Pixi. That setup rejection is preserved, not labeled a product failure.
- Strict prospective original/candidate source-plus-test checking covers the actual 557-file import/type closure: zero original, candidate or introduced errors. An earlier private type harness lacked the correct type-reference root; its missing node/vite declarations are retained separately as a rejected setup result.
- Exact embedded source maps show 100% changed executable coverage: five lines, 12 statements and eight branches. This is coverage of the changed algorithm, not whole-engine coverage. The private loader masks unrelated module statements to execute the exact algorithm and dependencies; the repository-native test independently imports the real module.

## Equal-output allocation and CPU benchmark

One exclusive Node 26.2.0 run under independent `timeout --signal=TERM --kill-after=2s 30s node /tmp/paint-surface-markers/benchmark.mjs`, actual handle 76561, exits 0 after 22.859 seconds. No forced GC, dependencies, browser, canvas painter or native rendering is involved. Both cases use fixed synthetic occupied silhouettes with actual atlas dimensions, cells and scale/lift/rise arguments. Pixels are synthetic, not captured real atlas images. Per case, seven balanced original/candidate pairs retain two warmup and five measured pairs; original runs first. Allocation instrumentation is a separate pass outside CPU timings. `benchmark-result.json` retains every sample, input/output hash, constructor allocation and resource receipt.

| Exact dimension case | Per-call typed-array allocation, original → candidate | Reduction | CPU median, original → candidate |
| --- | --- | --- | --- |
| Nature 1024×640, cell 128×160 | 7,379,840 → 5,413,760 bytes | **1.875 MiB** | 64.832 → 65.210 ms |
| Small items 3456×4032, cell 144×192 | 159,093,856 → 117,290,080 bytes | **39.8671875 MiB** | 1267.542 → 1184.714 ms |

Nature's +0.58% median is within the raw sample variation; small-item medians differ by −6.53%, with varied paired deltas. The reliable claim is the exact scratch reduction and unchanged output, not a universal CPU speedup. Allocation totals are the arrays constructed inside the function, excluding shared input ImageData and canvas/native/GPU allocations; they are not peak live bytes or PSS. The Node process maxRSS receipt (487,960 KiB) is not a game/browser memory measurement.

The successful shared startup observation proved item and nature painting ran, but its late 4 GiB tree-PSS stop also includes later GPU/renderer growth after atlas lanes stopped. This change does not claim to explain or close that guard stop, current startup memory, city loading or minimum 60 FPS. It changes no cache/retention, startup scheduling, budget or quality policy. No full suite was run during this scoped increment; the final goal gate remains separate.

## Captured evidence

Compressed logs/source/coverage/type receipts preserve their exact original bytes. Source, tests, scripts and prose require the normal whitespace check; no whitespace exception is used. Diagnostic helpers retain their actual private paths and installed dependency origins; restore the corresponding source fixtures under `/tmp/paint-surface-markers` to replay those exact commands. The repo test runs directly through the normal engine runner. Rejected setup records are distinct from accepted functional/benchmark evidence.
