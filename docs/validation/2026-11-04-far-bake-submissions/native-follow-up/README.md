# Same-graph native follow-up: mixed results, targets still fail

Both source-guarded runs complete normally with visibly populated native game
frames, actual art disposal and no page, GL, shader or request errors. The
committed FarBake change is exercised through the normal game pipeline. Minimum
60 FPS and instantaneous reconstruction remain **OPEN**: midzoom completion
worsens, and the improved observed return still takes 729 ms. This single serial
pair is not a statistically established whole-game speedup.

The same immutable 5412 graph serves both runs. Before any tile has been baked,
the actual existing FarBake instance selects only the exact original versus
committed `bake` method. Class identity, original/candidate source hashes,
configuration, dependency optimizer metadata and one epoch are verified. The
original query loader is diagnostic-only. Initial far tile count is zero on
both sides. Default headed graphics, viewport 1687×1067/DPR1, normal simulation,
mutation handling, camera phases and shared budgets are identical. No art reset,
pause, retention, speculative-work suppression, LOD or quality change occurs.

| Phase | Visible completion, original → committed | Model max ms | Final-screen interval max ms |
| --- | ---: | ---: | ---: |
| Observed entry, zoom 0.5 | 352.585 → 297.955 ms, 98 buildings | 47.845 → 56.850 | 40.005 → 38.735 |
| Midzoom 0.4 | **1,264.495 → 1,316.095 ms**, 145 buildings | 47.060 → 44.060 | **38.430 → 47.455** |
| Regional map, 10 seconds | Actual 2,532 instances → 0 on both sides | 36.025 → 34.655 | 56.430 → 54.825 |
| Return zoom 0.5 | **880.725 → 728.950 ms**, 98 buildings | 43.330 → 32.315 | 49.135 → 29.400 |

Entry is not called cold: both runs start that phase with 16 painted chunks,
1,709 static listings and no ahead packets. After midzoom both contain 2,532
statics. The map phase verifies disposal of all four owned containers for every
one of those instances. Both returns begin with **painted=0, statics=0,
ahead=25**, then end with 98/98 buildings complete, zero unbuilt visible
buildings and 2,114 static listings. This establishes genuine art reconstruction
without retaining city art. Prepared plan and worker data keep their normal
production lifetime.

## Frame distributions are separate from completion

All actual reported p50/p95/p99/max values and 16.67/20/33 ms counts are retained
in `comparison-summary.json` and both complete `result.json.gz` files. Final-screen start
intervals are distinct from rAF callbacks and render CPU. The reused meter
exports distributions and counts, not the complete raw rAF timestamp series;
this is sufficient to preserve these failures and is not a frame acceptance
claim.

| Phase | rAF samples >16.67 ms / samples | Final-screen intervals >16.67 ms / intervals | Final-screen p95 ms |
| --- | ---: | ---: | ---: |
| Entry | 61/172 → 62/173 | 81/172 → 88/173 | 23.120 → 21.445 |
| Midzoom | 73/173 → 62/174 | 83/173 → 77/174 | 24.210 → 25.665 |
| Map | 200/599 → 200/598 | 281/599 → 283/598 | 18.225 → 18.390 |
| Return | 53/177 → 53/179 | 86/177 → 81/179 | 18.975 → 19.615 |

Return final-screen intervals above 20 ms increase **6→8**, despite its lower
maximum. Entry model maximum worsens before any FarBake work. No average FPS or
above-20-ms count substitutes for the actual 16.67 ms target. Distinct pre-phase
startup model maxima of **729.510 / 705.510 ms** are also preserved; the named
system observer starts later, so these startup spikes are not assigned to a
particular leaf or to this renderer change.

## What the renderer change does establish

Midzoom uses the same 25 tile keys, 34 bakes and exact key/member-count multiset
(4,680 member visits) on both sides. Actual renderer submissions fall
**1,295→34**. Inclusive bake CPU totals fall **45.585→34.045 ms**, with largest
bake **7.820→6.015 ms**. Diagnostic wrapper overhead is unknown; this supports
the mechanical work removal and the separate fixed-tile benchmark, rather than
establishing a whole-frame speedup.

Return uses 34→33 bakes and 4,853→4,674 member visits, with 815→33 submissions.
Inclusive bake totals are 29.050→28.940 ms; maximum bake worsens 3.630→8.580 ms.
Those unequal rebake counts and timing variations are retained. The return's
completion improvement must not be attributed entirely to this renderer change.
Nested bake, render and named-system times must not be added together.

## Remaining measured work

The committed-side midzoom's largest model is 44.065 ms, including unchanged
**CritterView 28.605 ms** and final viewport rendering 8.465 ms. Its entry model
of 56.895 ms includes CritterView 32.365 ms before any FarBake use. Earlier
same-source leaf counts identify fresh `crittersOf` generation as the target;
the next bounded seven-chunk diagnostic separates preparation, ground/street
classification and clearance queries before another source change.

The return's largest committed model is 32.315 ms: PrefabStatics 8.390 ms,
GroundPaint 8.275 ms, WorldMapDraw 3.795 ms, final viewport 3.535 ms and
AudioEffects 3.370 ms. Until return completion, all 37 active roof runs observe
zero spare allowance; midzoom observes 63/63. This does not justify raising the
12 ms shared cap or changing floor semantics. Both map phases separately retain
an AuthorityStepSystem spike around 33 ms.

## Safety and provenance

The explicitly retained **4 GiB complete owned-browser PSS guard** never trips:
measured peaks are 3.557 / 3.595 GiB, with no first stop reason. The 8 GiB
available-memory floor and 90-second independent browser hard close are retained.
There is no new V8 heap flag; default `args:[]` is identical on both sides. This
is separate from London's later, differently calibrated 6 GiB diagnostic.

Both natural final compositor frames were visually inspected and show actual
roads, buildings, paths and people. Production Screenshot captures before/after
are nonempty; context is live, GL errors are empty, and all sources/configuration/
optimizer hashes are stable. No lazy road request or new tile materialization
occurs inside any timed phase. Each run has the same three pre-existing Rapier
initialization deprecation warnings; no new shader or renderer warning appears.
Active simulation clocks and ambient counts differ slightly between serial
runs; exact live-world output equality is not claimed. The separate fixed-input
tile comparison remains the exact pixel/state/depth oracle.

The initial restricted-sandbox command fails with localhost EPERM before any
browser launches. The identical authorized host-network command then runs each
variant once; no failed game or timed phase is retried. Both owned browsers close
before analysis. Root and sibling lanes serialize all native/CPU measurements.
Observer, scan, PSS-sampling and WebSocket-driver overhead remain uncalibrated.
No full suite is run for this evidence-only checkpoint.
