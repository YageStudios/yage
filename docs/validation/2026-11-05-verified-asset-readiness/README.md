# Verified asset readiness

`AssetCache.readVerified` releases owned, SHA-verified bytes while persistent caching continues. It returns the persistence outcome explicitly. Renderer transfers or mutations cannot detach or alter the pending write. Concurrent render and durable callers share the same fetch, verification and transaction.

`load` and `preload` retain their durable-commit contract, including write failures and progress reporting. A renderer read cannot mark an uncommitted asset complete for preload. The in-flight record is retained until persistence settles.

Validation: 18 focused tests passed in asset-ready, asset-cache and asset-preload. Strict TypeScript checking passed for this class and the selected tests. Instrumented coverage for the modified AssetCache class: 100% lines/statements/functions, 98.38% branches. The unchanged IndexedDB adapter is excluded from that class-only figure. No full repository suite was run.

Controlled benchmark: actual AssetCache implementation, 1 MiB verified payload, persistent-store commit delayed by 75 ms, 10 paired trials. Median durable readiness 77.88 ms; median verified render readiness 3.22 ms. This tests removal of the commit dependency; it does not claim real IndexedDB latency, browser FPS or worldwide map readiness. Exact samples and source fingerprint are in benchmark.json.
