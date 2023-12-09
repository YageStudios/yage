import { WaveTypeEnum } from "../constants/enums";
import dt from "./dt";

export class WaveGen {
  constructor(
    private waveType: WaveTypeEnum,
    private frequency: number,
    private amplitude: number = 1.0,
    private frequencyScale: "minutes" | "seconds" = "seconds"
  ) {}
  static gen(
    frameTime: number,
    waveType: WaveTypeEnum,
    frequency: number,
    amplitude: number,
    frequencyScale: "minutes" | "seconds" = "seconds"
  ) {
    if (frequencyScale === "minutes") {
      frequency /= 60;
    }
    switch (waveType) {
      case WaveTypeEnum.SINE:
        return Math.sin(frameTime * frequency * Math.PI * 2) * amplitude;
      case WaveTypeEnum.SQUARE:
        return Math.sign(Math.sin(frameTime * frequency * Math.PI * 2)) * amplitude;
      case WaveTypeEnum.TRIANGLE:
        // amp*(1-4*abs(((float)x/period+0.5) % 1 - 0.5))
        return amplitude * (1 - 4 * Math.abs(((frameTime * frequency) % 1) - 0.5));
      case WaveTypeEnum.SAWTOOTH:
        return amplitude * (-2 * Math.abs(((frameTime / frequency + 1) % 1) - 1) + 1);
    }
    return 0;
  }

  get(frame: number) {
    const frameTime = dt(frame);
    return WaveGen.gen(frameTime, this.waveType, this.frequency, this.amplitude, this.frequencyScale);
  }

  getFreq(frame: number) {
    const frameTime = dt(frame);
    return Math.floor(frameTime * (this.frequencyScale === "minutes" ? 60 : 1) * this.frequency);
  }
}
