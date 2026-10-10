import type { GameAudio, Handle, Vec3 } from "./engine";
import type { SpatialAudio } from "../schemas/audio/SpatialAudio";

export type SpatialEmitter = { id: number; position: Vec3; source: SpatialAudio };

/** Owns local playback only; entity state is never mutated by rendering. */
export class SpatialPlayback {
  private playing = new Map<number, { sound: string; trigger: number; handle: Handle }>();
  update(audio: GameAudio, emitters: SpatialEmitter[]): void {
    const active = new Set<number>();
    for (const { id, position, source } of emitters) {
      if (!source.enabled || !source.sound) continue;
      active.add(id);
      let current = this.playing.get(id);
      if (current && (current.sound !== source.sound || current.trigger !== source.trigger || (current.handle.loop && !current.handle.playing))) {
        current.handle.stop(0.1);
        this.playing.delete(id);
        current = undefined;
      }
      if (!current) {
        const handle = audio.play(source.sound, { position, volume: source.volume, params: source.params,
          spatial: { refDistance: source.refDistance, maxDistance: source.maxDistance, rolloff: source.rolloff, occlusion: source.occlusion, air: source.air } });
        if (!handle.accepted) continue;
        current = { sound: source.sound, trigger: source.trigger, handle };
        this.playing.set(id, current);
      }
      current.handle.setPosition(position);
      current.handle.volume = source.volume;
      current.handle.setOcclusion(source.occlusion);
      for (const [name, value] of Object.entries(source.params)) current.handle.setParam(name, value);
    }
    for (const [id, current] of this.playing) if (!active.has(id)) {
      current.handle.stop(0.1);
      this.playing.delete(id);
    }
  }
  clear(): void {
    for (const { handle } of this.playing.values()) handle.stop(0.1);
    this.playing.clear();
  }
}
