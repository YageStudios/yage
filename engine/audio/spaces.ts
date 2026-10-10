import type { SpaceOptions } from "./types";
/** Designed acoustic scenes shared by presets, the SFX synthesizer and music. */
export const SPACES = {
  dry: {wet:0,early:0,decay:.2},
  touch: {wet:0,early:.12,decay:.2,size:.36,damping:4800},
  cabinet: {wet:.07,early:.14,decay:.27,size:.35,damping:2100,preDelay:.004,lowCut:200},
  room: {wet:.12,early:.1,decay:.52,size:.52,damping:3500,preDelay:.012,lowCut:170},
  plate: {wet:.16,early:.06,decay:.78,size:.44,damping:4200,preDelay:.006,lowCut:260},
  chamber: {wet:.22,early:.08,decay:1.18,size:.75,damping:2900,preDelay:.022,lowCut:150},
  open: {wet:.13,early:.04,decay:.94,size:1.1,damping:1800,preDelay:.038,lowCut:240},
  deep: {wet:.27,early:.06,decay:1.85,size:1.2,damping:2300,preDelay:.032,lowCut:150},
  hall: {wet:.24,early:.08,decay:2.35,size:1.25,damping:3400,preDelay:.03,lowCut:180},
} satisfies Record<string, SpaceOptions>;
export type Scene = keyof typeof SPACES;
export const SCENES = Object.keys(SPACES) as Scene[];
