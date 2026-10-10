/** Shared instruments, not shared compositions. Each original ID has its own authored event graph. */
import type { GameAudio } from '../engine';
import type { Voice } from '../voice';
import type { FormantOptions, MaterialVoice, WaveType } from '../types';
import { ORIGINAL, type OriginalId } from './original-catalog';
import { LEVELS } from './levels-richness';
export { SPACES, type Scene } from '../spaces';
import { SPACES, type Scene } from '../spaces';
export function designer(audio: GameAudio, category: string) {
  return (id: OriginalId, bodySeconds: number, hint: string, play: (v:Voice,t:number)=>unknown, scene:Scene='touch', gain=.9):void => {
    const meta=ORIGINAL[id];
    if(meta.category!==category)throw new Error(`Wrong category for ${id}`);
    const space=SPACES[scene];
    const tail = space.wet ? space.decay * 1.12 + .12 + ('preDelay' in space ? space.preDelay : 0) : (space.early ? .08 : 0);
    audio.define(id,{category,bus:category==='music'?'music':'sfx',name:meta.name,hint,loop:meta.loop,gain:gain*(LEVELS[id]??1),duration:meta.loop?10:Math.ceil((bodySeconds+tail+.09)*100)/100,tags:['reinvented',scene,...hint.toLowerCase().split(' · ').map(x=>x.trim())],play:(v,t)=>{v.space(space);play(v,t);}});
  };
}
export const m=(n:number):number=>440*Math.pow(2,(n-69)/12);
export function tone(v:Voice,t:number,f:number,end:number,dur:number,peak=.3,type:WaveType='sine',pan=0):void {
  v.tone(t,{f,f2:end,dur,peak,type,pan,attack:Math.min(.006,dur*.08),filter:type==='sine'?undefined:{type:'lp',freq:Math.min(6000,f*10)*v.brightness,freq2:Math.min(4000,end*7)*v.brightness,Q:.65}});
}
export function air(v:Voice,t:number,dur:number,f:number,end:number,peak=.15,pan=0,color:'white'|'pink'|'brown'='pink'):void {
  v.noise(t,{dur,color,type:'bp',freq:f*v.brightness,freq2:end*v.brightness,Q:.7,peak,pan,fade:{in:Math.min(.08,dur*.2),hold:dur*.28,out:dur*.65}});
}
export function hit(v:Voice,t:number,f:number,dur:number,peak=.35,material:MaterialVoice='wood',pan=0,modes?:readonly number[]):void {
  v.resonate(t,{f,dur,peak,material,pan,modes,strike:material==='wood'?.75:.4,bloom:.0025,width:.2});
}
export function thud(v:Voice,t:number,f=95,peak=.4,dur=.24):void {
  tone(v,t,f*1.9,f,dur,peak);hit(v,t+.003,f*2.08,dur*.55,peak*.35,'stone');air(v,t,.022,1900,420,peak*.24);
}
export function reed(v:Voice,t:number,f:number,end:number,dur:number,peak=.32,options:Partial<FormantOptions>={}):void {
  v.formant(t,{f,f2:end,dur,peak,...options});
}
export function pluck(v:Voice,t:number,n:number,dur=.5,peak=.3,pan=0,brightness=.52):void {
  v.string(t,{f:m(n),dur,peak,pan,brightness,pick:.19});
}
export function membrane(v:Voice,t:number,f:number,dur:number,peak=.4,pan=0):void {
  tone(v,t,f*1.25,f,dur,peak,'sine',pan);
  hit(v,t,f*1.58,dur*.62,peak*.47,'stone',pan,[1,1.356,1.663,2.14]);
  air(v,t,.028,f*8,f*3,peak*.3,pan);
}
export function metallic(v:Voice,t:number,f:number,dur:number,peak=.3,pan=0,ratios:readonly number[]=[1,1.483,2.137,2.672,3.89,5.11]):void {
  hit(v,t,f,dur,peak,'bronze',pan,ratios);
  v.fm(t,{f:f*1.31,ratio:1.414,index:2.1,indexEnd:.04,dur:dur*.33,peak:peak*.18,pan,filter:{type:'hp',freq:f}});
}
export function pulses(v:Voice,t:number,fs:readonly number[],dur:number,peak=.26,pan=0):void {
  fs.forEach(f=>v.tone(t,{f,dur,peak:peak/Math.sqrt(fs.length),flat:true,attack:.008,fadeOut:Math.min(.025,dur*.18),pan}));
}
export function handclap(v:Voice,t:number,peak=.32,pan=0):void {
  [0,.011,.025].forEach((at,i)=>v.noise(t+at,{dur:i===2?.14:.018,type:'bp',freq:1350+i*270,Q:.65,color:'pink',peak:peak*(i===2?.85:1),pan,attack:.001}));
  v.noise(t+.025,{color:'white',type:'bp',freq:1850,Q:.7,dur:.105,peak:peak*.6,pan,attack:.0015});
  hit(v,t+.026,390,.1,peak*.13,'wood',pan);
}
export function step(v:Voice,t:number,peak=.35,pan=0,hard=false):void {
  membrane(v,t,hard?150:95,.14,peak*.65,pan);
  v.surface(t+.008,{dur:.19,rate:hard?95:55,grain:.012,freq:hard?2300:870,freqEnd:hard?900:430,peak:peak*.55,width:.08,pan,attack:.008});
  if(hard)hit(v,t+.016,1650,.08,peak*.16,'stone',pan);
}
