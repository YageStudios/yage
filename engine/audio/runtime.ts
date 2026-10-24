import { GameAudio } from "./engine";
import type { PresetRegistrar } from "./types";

let instance: GameAudio | undefined;
let registrar: PresetRegistrar | undefined;
let enabled = true;
let unlocked = false;
let unsubscribePause: (() => void) | undefined;
let pausedByGame = false;

// The engine pause (yage/game/pause), read through its globalThis key so this module stays standalone.
type PauseState = { paused: boolean; listeners: Set<(paused: boolean) => void> };
const gamePause = (): PauseState => ((globalThis as any)[Symbol.for("yage.pause")] ??= { paused: false, listeners: new Set() });

/** Follows the engine pause: pauses the audio with the game and resumes it with the game (not a pause() of your own). */
const followGamePause = (audio: GameAudio) => {
  const apply = (paused: boolean) => {
    if (paused && !audio.paused) {
      pausedByGame = true;
      void audio.pause().catch(() => {});
    } else if (!paused && pausedByGame) {
      pausedByGame = false;
      if (unlocked) audio.resume();
    }
  };
  const state = gamePause();
  state.listeners.add(apply);
  unsubscribePause = () => void state.listeners.delete(apply);
  apply(state.paused);
};

export function configureAudio(register: PresetRegistrar): void { registrar = register; }
export function setAudioEnabled(value: boolean): void {
  enabled = value;
  if (instance) instance.volume = value ? 0.8 : 0;
}
export function audioEnabled(): boolean { return enabled && unlocked; }
/** Call synchronously from a user gesture. No context is allocated during preload. */
export function unlockAudio(): GameAudio | undefined {
  if (!enabled || typeof globalThis.AudioContext === "undefined") return undefined;
  if (!instance) {
    instance = new GameAudio({ presets: registrar, maxVoices: 64 });
    followGamePause(instance);
  }
  unlocked = true;
  if (!instance.paused) instance.resume();
  return instance;
}
export function getAudio(): GameAudio | undefined { return instance; }
export async function disposeAudio(): Promise<void> {
  const audio = instance;
  instance = undefined;
  unlocked = false;
  unsubscribePause?.();
  unsubscribePause = undefined;
  pausedByGame = false;
  await audio?.dispose();
}
