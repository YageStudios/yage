import type { GameReplayInstance } from "yage/game/GameReplayInstance";

function createSilentWav(frames: number, frameLengthMs: number): ArrayBuffer {
  const sampleRate = 8000; // Changed to 16 kHz
  const bytesPerSample = 2;
  const totalSamples = frames * (frameLengthMs / 1000) * sampleRate;
  const buffer = new ArrayBuffer(44 + 12 + totalSamples * bytesPerSample); // 12 extra bytes for 'fact' chunk
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, "RIFF");
  // file length
  view.setUint32(4, 36 + 12 + totalSamples * bytesPerSample, true); // 12 extra bytes for 'fact' chunk
  // WAV identifier
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);

  // fact chunk
  writeString(view, 36, "fact");
  view.setUint32(40, 4, true);
  view.setUint32(44, totalSamples, true);

  // data chunk
  writeString(view, 48, "data");
  view.setUint32(52, totalSamples * bytesPerSample, true);

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function playSilentWav(wav: ArrayBuffer, audio?: HTMLAudioElement) {
  if (!audio) {
    audio = document.createElement("audio");
    audio.controls = true;
    // @ts-ignore
    audio.controlsList = "nodownload";
    audio.style.position = "fixed";
    audio.style.bottom = "0";
    audio.style.width = "390px";
    audio.style.zIndex = "1000";
    audio.style.left = "50%";
    audio.style.transform = "translateX(-50%)";
  }
  const blob = new Blob([wav], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  audio.src = url;

  document.body.appendChild(audio);
  return audio;
}

export const createControls = (connection: GameReplayInstance<any>) => {
  const frameLengthMs = 16;
  const replay = connection.replayStack;
  console.log(replay);
  const firstPlayer = Object.keys(replay.frames)[0];
  const wav = createSilentWav(replay.frames[firstPlayer].length, frameLengthMs);
  const audio = playSilentWav(wav);

  audio.addEventListener("error", (e: any) => {
    console.log(e.target.error);
  });

  audio.addEventListener("ended", () => {
    connection.pausePlayback();
  });

  audio.addEventListener("pause", () => {
    connection.pausePlayback();
  });

  audio.addEventListener("play", () => {
    connection.resumePlayback();
  });

  audio.addEventListener("seeked", () => {
    const frameRate = 1000 / frameLengthMs;
    const currentFrame = Math.floor(audio.currentTime * frameRate);
    connection.onScrub(currentFrame);
    if (audio.paused && audio.currentTime !== 0) {
      connection.resumePlayback();
      audio.play();
    }
  });

  audio.addEventListener("ratechange", () => {
    const playbackSpeed = audio.playbackRate;
    connection.onPlaybackSpeedChange(playbackSpeed);
  });

  return audio;
};
