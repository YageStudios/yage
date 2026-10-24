/**
 * The engine pause: one flag per page or worker that GameInstance's loop (GameModel),
 * LeanGameModel.step and the audio runtime (yage/audio/runtime: its GameAudio pauses and resumes)
 * all honour. A game's pause menu calls setGamePaused(true/false); `gameModel.paused` stays the
 * per-room flag the connection uses while loading and syncing. In a lockstep peer room a paused
 * peer stops advancing, so the room waits for it.
 *
 * Dependency-free and kept on globalThis (Symbol.for("yage.pause")), so every bundle copy of this
 * module and the standalone audio module share the same state.
 */
export type PauseListener = (paused: boolean) => void;

interface PauseState {
  paused: boolean;
  listeners: Set<PauseListener>;
}

const KEY = Symbol.for("yage.pause");

const state = (): PauseState => ((globalThis as any)[KEY] ??= { paused: false, listeners: new Set<PauseListener>() });

export const isGamePaused = (): boolean => state().paused;

/** Pauses or resumes the game; listeners run only when the flag changes. */
export const setGamePaused = (paused: boolean): void => {
  const s = state();
  if (s.paused === paused) return;
  s.paused = paused;
  for (const listener of [...s.listeners]) listener(paused);
};

export const toggleGamePaused = (): boolean => {
  setGamePaused(!isGamePaused());
  return isGamePaused();
};

/** Calls `listener` on every change of the flag. Returns the unsubscribe. */
export const onGamePause = (listener: PauseListener): (() => void) => {
  const s = state();
  s.listeners.add(listener);
  return () => void s.listeners.delete(listener);
};
