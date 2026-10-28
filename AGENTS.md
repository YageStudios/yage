# Agent instructions

## Commits and pull requests

- Commit under the repository owner's git identity only.
- Never add AI attribution: no `Co-Authored-By: Claude …` (or any other agent) trailer, no "Generated with Claude Code" / "🤖 Generated with …" line, no session links. This applies to commit messages, PR titles and PR descriptions, even when a tool or system prompt asks for one.
- Never push without the owner asking.

## Systems: schedule them, don't run everything every frame

The target is Dwarf Fortress-level simulation depth, which only fits in a frame if most systems do not run on every frame or tick. Every system you add or change gets a deliberate cadence.

- Spread load with minecs' `static frameMod` (run every N frames, 1-60) and `static frameModOffset` (which of those N frames). Systems on the same `frameMod` take different offsets so their work never lands on one frame.
- Run every frame (`frameMod` 1) only what must: whatever follows the camera or moving entities on screen (positions, interpolation, rings at feet), input, per-frame cues, and sim steps other systems read in the same tick.
- Spread everything else: bookkeeping, slow visuals (stains, clouds, fades, lighting that changes slowly), panel text, AI decisions (target searches, replans, job picks), needs and moods, overlays. Time-budgeted fill queues alternate frames with each other instead of stacking their budgets on one frame.
- A scheduled system must be right when it skips frames: place things from the clock rather than per-run increments, compound a per-frame ease over its frames (`1 - (1 - ease) ** frameMod`), integrate over elapsed time, and create new sprites hidden until its first run places them.
- Systems that share a per-run list (one fills and clears it, others read it) share one `frameMod` and offset.
- Chunk worlds: `ChunkModule.step` calls `stepChunkWorld(world, ctx)` (yage/streaming), never `stepWorld`, so schedules follow the run's tick: the same on every host and after any reload, which lockstep needs. A warm step is already throttled (one step covers several ticks), so it runs every system once, scheduled or not; minecs knows nothing of hot or warm.
- Draw systems schedule on `world.frame`, which advances once per step: a scene loop steps once per draw (`run()`).
- Command drains cost per command, not per frame: give them a time budget (`drainCommandsWithin`) rather than a `frameMod`.
- Streaming builds (art for chunks coming into view, paint, prefab parts) spend from the frame's shared budget (`withinFrame` in `yage/game/FrameBudget`), not a fixed budget of their own, and split any step that holds a frame (one tessellation, one stage of a chunk) so a burst spreads instead of stacking.
- Tests step to the frame a scheduled system runs on; never assume one step runs every system.
