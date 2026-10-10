import { GameAudio } from "./engine";
import type { PresetRegistrar } from "./types";

let instance: GameAudio | undefined;
let registrar: PresetRegistrar | undefined;
let enabled = true;
let unlocked = false;

export function configureAudio(register: PresetRegistrar): void { registrar = register; }
export function setAudioEnabled(value: boolean): void {
  enabled = value;
  if (instance) instance.volume = value ? 0.8 : 0;
}
export function audioEnabled(): boolean { return enabled && unlocked; }
/** Call synchronously from a user gesture. No context is allocated during preload. */
export function unlockAudio(): GameAudio | undefined {
  if (!enabled || typeof globalThis.AudioContext === "undefined") return undefined;
  if (!instance) instance = new GameAudio({ presets: registrar, maxVoices: 64 });
  unlocked = true;
  instance.resume();
  return instance;
}
export function getAudio(): GameAudio | undefined { return instance; }
export async function disposeAudio(): Promise<void> {
  const audio = instance;
  instance = undefined;
  unlocked = false;
  await audio?.dispose();
}
