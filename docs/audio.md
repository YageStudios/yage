# Spatial and procedural audio

YAGE includes the Web Audio runtime and all 309 procedural airport sounds extracted from bleep-bloop 1.3.0. The original MIT notice is preserved in `engine/audio/LICENSE.txt`. The extraction includes synthesis, HRTF positioning, distance attenuation, occlusion, room acoustics, mixer buses, voice limits and real-time loop parameters. No external workspace or recording assets are required.

The default synthesis rate is **16,000 Hz**. `new GameAudio({ sampleRate: 16000 })` controls both an owned live context and generated PCM; a supplied context keeps its own rate. The browser resamples to the output device as needed.

Finite definitions with `duration` are generated through `OfflineAudioContext` and retained in a 64 MiB cache. Warm frequent sounds before starting gameplay:

```ts
const audio = unlockAudio();
if (audio) {
  const results = await audio.prepare(['apt-footstep-tile']);
  for (const result of results) if (result.error) throw result.error;
}
```

Warm-up prepares four seeded one-shot timbres, or one timbre per loop parameter setting. Subsequent triggers reuse PCM, including the authored filters and acoustic tail. Pitch variation uses playback rate; volume, preset trim, buses and spatial positioning stay live. Parameter changes on buffered loops prepare and crossfade to another cached setting, keeping the previous setting audible until the replacement is ready. Pass `params` to `prepare` to warm known settings in advance.

Cold triggers use the procedural graph while preparing a buffer for reuse. Functions without duration metadata also keep their live graph. `{ soundBuffers: false }` opts out. Re-registering a definition invalidates its cached PCM, and disposal clears it. `audio.soundBufferStats` exposes cache memory and preparation failures.

```ts
import { configureAudio, registerAirportSounds, unlockAudio } from 'yage/audio';
configureAudio(registerAirportSounds);
window.addEventListener('pointerdown', () => unlockAudio());
```

Attach `SpatialAudio` beside `Transform` on an entity:

```json
{
  "components": [
    "Transform",
    { "type": "SpatialAudio", "sound": "apt-amb-terminal", "volume": 0.4,
      "refDistance": 100, "params": { "crowd": 0.5 } }
  ]
}
```

`SpatialAudioSystem` manages playback during rendering. Entity coordinates map to Web Audio `[Transform.x, Transform.z, Transform.y]`. Distances use world units. Set the listener with `getAudio()?.setListener(...)` using the same axes. The default listener points along negative world Y; games with rotating cameras should update its orientation.

A loop starts once, follows its entity, and responds to changes in `params`, `volume`, and `occlusion`. A one-shot plays once; increment `trigger` to play it again. Changing `sound` replaces the playback. Disabling the component, removing the entity, or cleaning up the draw system stops its sound. Changing attenuation settings takes effect on the next playback.

Call `setAudioEnabled(false)` for local mute or pause; this mutes the master immediately and stops entity playback on the next draw. Re-enable it to restore ambience. `disposeAudio()` releases the runtime and its owned context. Keep audio nodes and user preferences local; components describe replicated playback intent.

`playSound` routes registered procedural IDs through this runtime, including its `position` option. Existing loaded recording IDs continue through Pixi Sound, with per-instance volume and filters.

In Sky Harbor, `AirportAudioState` drives station ambience and aircraft thrust from the simulation. `AirportAudioEffects` follows the viewport listener and plays boarding, flight, construction, upgrade, staff, money, notification and objective cues. Browser gestures unlock audio, and device mute, pause, visibility and page teardown control its lifecycle.

Validation: `npm run test:audio` in YAGE; `npm run test:audio` and `npm run test:audio:native` in idle.

Sky Harbor uses a 650-unit reference distance and gentle falloff for terminal sounds. It disables metre-based air absorption (`air: false`) because its transforms use pixels. Activity sounds follow occupied desks, service completions, quiet footsteps from nearby walking passengers, construction, and cleaners working near litter. Player footsteps and ambience presets containing background voices are disabled. The detector beeps when a passenger crosses the arch and alarms when a player crosses it.

Check-in and passport desk typing varies short, long and frantic bursts, loudness and thinking pauses without repeating the previous burst. It requires a worker at the counter and a passenger actively being served; unfinished typing stops when service ends or the worker leaves.

Boarding completions use a single scan (75%), three brief key clicks followed by a scan (15%), or a double rejection beep followed by a scan (10%). The same passenger check sets the processing timer and progress bar: 0.3, 0.7 or 0.9 seconds before upgrades. Keys and rejection beeps play during service; the final scan plays when service completes. Boarding has no repeating typing bursts.
