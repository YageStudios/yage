import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getAudio: vi.fn(), getSound: vi.fn(), play: vi.fn() }));
vi.mock('yage/audio/runtime', () => ({ getAudio: mocks.getAudio }));
vi.mock('yage/loader/AssetLoader', () => ({ default: { getInstance: () => ({ getSound: mocks.getSound }) } }));
import { playSound } from 'yage/utils/playSound';
beforeEach(() => { vi.resetAllMocks(); });
it('routes procedural sounds and maps the 2D position to the world floor', () => {
  mocks.getAudio.mockReturnValue({ list: () => [{ id: 'airport' }], play: mocks.play });
  playSound('airport', { volume: 0.3, position: { x: 10, y: 20 } });
  expect(mocks.play).toHaveBeenCalledWith('airport', { volume: 0.3, position: [10, 0, 20] });
  expect(mocks.getSound).not.toHaveBeenCalled();
  playSound('airport'); expect(mocks.play).toHaveBeenLastCalledWith('airport', { volume: 1 });
});
it('uses per-instance volume and filters for recordings without mutating shared sound volume', () => {
  const sound = { play: mocks.play, volume: 0.7 }, filters = [{}];
  mocks.getAudio.mockReturnValue({ list: () => [] });
  mocks.getSound.mockReturnValue([sound, { baseVolume: 0.25 }]);
  playSound('recording', { volume: 0.4, filters });
  expect(mocks.play).toHaveBeenCalledWith({ volume: 0.1, filters });
  expect(sound.volume).toBe(0.7);
  mocks.getAudio.mockReturnValue(undefined); mocks.getSound.mockReturnValue([sound, {}]);
  playSound('recording'); expect(mocks.play).toHaveBeenLastCalledWith({ volume: 1, filters: undefined });
});
