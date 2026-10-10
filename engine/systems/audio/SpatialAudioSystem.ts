import { DrawSystemImpl, System } from "minecs";
import type { ReadOnlyGameModel } from "yage/game/GameModel";
import { SpatialAudio } from "yage/schemas/audio/SpatialAudio";
import { Transform } from "yage/schemas/entity/Transform";
import { SpatialPlayback } from "yage/audio/SpatialPlayback";
import { audioEnabled, getAudio } from "yage/audio/runtime";

@System(SpatialAudio, Transform)
export class SpatialAudioSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static depth = 11500;
  private playback = new SpatialPlayback();
  runAll = (g: ReadOnlyGameModel) => {
    const audio = getAudio();
    if (!audio || !audioEnabled()) { this.playback.clear(); return; }
    this.playback.update(audio, [...this.query(g)].map(id => {
      const p = g.getTypedUnsafe(Transform, id);
      return { id, position: [p.x, p.z, p.y] as const, source: g.getTypedUnsafe(SpatialAudio, id) };
    }));
  };
  cleanup = () => this.playback.clear();
}
