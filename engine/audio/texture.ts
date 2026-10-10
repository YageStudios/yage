/** Breath, reed, vocal and friction sources. All graphs are voice-owned and seeded. */
import { clamp, finite, nonnegative, positive } from './dsp';
import { hz } from './notes';
import type { Voice } from './voice';
import type { FormantOptions, SurfaceOptions } from './types';

function onset(v: Voice, time: number): number {
  return Math.max(nonnegative(time, 'start time'), v.now() + ('startRendering' in v.ctx ? 0 : .012));
}

/** Parallel moving vocal cavities over a band-limited glottal/reed excitation.
 * Unlike a pitched bell this sustains pressure, formant motion and pulse roughness.
 * It is stylized synthesis, not a recording or a model of a particular speaker.
 */
export function formant(v: Voice, t0: number, o: FormantOptions): number {
  if (v._stopped) return t0;
  const ctx = v.ctx, dur = positive(o.dur ?? .5, 'formant duration');
  const peak = nonnegative(o.peak ?? .35, 'formant peak');
  const a = clamp(nonnegative(o.attack ?? .015, 'formant attack'), .001, dur * .65);
  const r = clamp(nonnegative(o.release ?? dur * .28, 'formant release'), .002, dur * .8);
  const breath = clamp(nonnegative(o.breath ?? .08, 'breath'), 0, 1);
  const rough = clamp(nonnegative(o.roughness ?? .08, 'roughness'), 0, .9);
  const rate = positive(o.vibratoRate ?? 5.2, 'vibrato rate');
  const vibrato = nonnegative(o.vibrato ?? .006, 'vibrato depth') * v.motion;
  const path = o.contour ?? [o.f, o.f2 ?? o.f];
  const flutter = nonnegative(o.flutter ?? 31, 'flutter rate');
  const cutoff = positive(o.cutoff ?? 6500, 'formant cutoff');
  if (path.length < 2 || path.length > 64) throw new RangeError('bleep-bloop: formant contour needs 2–64 pitches');
  const freqs = path.map(n => clamp(hz(n) * v.pitch, 20, ctx.sampleRate * .18));
  const bands = o.formants ?? [{freq:600,end:750,gain:1,Q:3},{freq:1300,end:1150,gain:.65,Q:4},{freq:2600,gain:.22,Q:5}];
  if (!bands.length || bands.length > 8) throw new RangeError('bleep-bloop: formant needs 1–8 bands');
  const panValue = clamp(finite(o.pan ?? 0, 'formant pan'), -1, 1);
  // Validate before allocating the graph.
  bands.forEach(b => { positive(b.freq,'formant frequency'); if(b.end!==undefined)positive(b.end,'formant end'); positive(b.Q??3,'formant Q'); nonnegative(b.gain??1,'formant gain'); });
  const real = new Float32Array(65), imag = new Float32Array(65);
  const slope = clamp(positive(o.slope ?? 1.18, 'spectral slope'), .6, 3);
  const odd = clamp(nonnegative(o.odd ?? .85, 'even harmonic weight'), 0, 1);
  for (let h = 1; h < imag.length; h++) {
    if (h * Math.max(...freqs) >= ctx.sampleRate * .43) break;
    imag[h] = Math.pow(h, -slope) * (h % 2 ? 1 : odd) * Math.exp(-h/45);
  }
  const osc = ctx.createOscillator(); osc.setPeriodicWave(ctx.createPeriodicWave(real,imag));
  const sum = ctx.createGain(), env = ctx.createGain(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), pan = ctx.createStereoPanner();
  hp.type='highpass';hp.frequency.value=35;hp.Q.value=.5;
  lp.type='lowpass';lp.frequency.value=clamp(cutoff*v.brightness,100,ctx.sampleRate*.43);lp.Q.value=.5;
  pan.pan.value=panValue;
  const nodes: AudioNode[] = [sum,env,hp,lp,pan];
  const direct=ctx.createGain(); direct.gain.value=.18;osc.connect(direct);direct.connect(sum);nodes.push(direct);
  const norm = Math.max(1,bands.reduce((s,b)=>s+(b.gain??1),0));
  // Construct first, then select the live onset so short curves cannot land in the past.
  const filters = bands.map(b => {
    const f=ctx.createBiquadFilter(), g=ctx.createGain();f.type='bandpass';f.Q.value=clamp(b.Q??3,.3,20);g.gain.value=2.9*(b.gain??1)/norm;
    osc.connect(f);f.connect(g);g.connect(sum);nodes.push(f,g);return f;
  });
  const t=onset(v,t0);
  freqs.forEach((f,i)=>i?osc.frequency.exponentialRampToValueAtTime(f,t+dur*i/(freqs.length-1)):osc.frequency.setValueAtTime(f,t));
  bands.forEach((b,i)=>{filters[i].frequency.setValueAtTime(clamp(b.freq*v.brightness,60,ctx.sampleRate*.43),t);filters[i].frequency.exponentialRampToValueAtTime(clamp((b.end??b.freq)*v.brightness,60,ctx.sampleRate*.43),t+dur*.88);});
  const curve=new Float32Array(512), phase=v.random(0,Math.PI*2);
  for(let i=0;i<curve.length;i++){
    const x=i/(curve.length-1)*dur;
    const edge=Math.sin(Math.min(1,x/a)*Math.PI/2)**1.2 * Math.sin(Math.min(1,(dur-x)/r)*Math.PI/2)**2;
    const pressure=(.88+.12*Math.sin(Math.PI*x/dur))*(1-rough*.5+rough*.5*Math.sin(2*Math.PI*flutter*x+phase));
    curve[i]=peak*edge*pressure;
  }
  curve[0]=0;curve[511]=0;env.gain.setValueCurveAtTime(curve,t,dur);
  sum.connect(hp);hp.connect(lp);lp.connect(env);env.connect(pan);pan.connect(v.dest);
  v.own(osc,...nodes);
  if(vibrato){const lfo=ctx.createOscillator(), depth=ctx.createGain();lfo.frequency.value=rate;depth.gain.value=freqs[0]*vibrato;lfo.connect(depth);depth.connect(osc.frequency);v.own(lfo,depth);lfo.start(t);lfo.stop(t+dur+.006);}
  osc.start(t);osc.stop(t+dur+.006);
  if(breath) v.noise(t,{color:'pink',type:'bp',freq:bands[0].freq,freq2:bands[0].end??bands[0].freq,Q:.75,dur,peak:peak*breath,pan:panValue,fade:{in:a,hold:Math.max(a,dur-r),out:r}});
  v._track(t+dur+.015);return t+dur;
}

/** A changing density of discrete friction grains, not an unvarying noise bed.
 * Rates, grain size, brightness and stereo placement can evolve independently.
 */
export function surface(v: Voice, t: number, o: SurfaceOptions): number {
  if(v._stopped)return t;
  nonnegative(t,'surface time');
  const dur=positive(o.dur??.3,'surface duration'), rate=positive(o.rate??60,'grain rate'), rateEnd=positive(o.rateEnd??rate,'grain end rate');
  const grain=positive(o.grain??.018,'grain duration'), grainEnd=positive(o.grainEnd??grain,'grain end duration');
  const freq=positive(o.freq??2400,'surface frequency'), endFreq=positive(o.freqEnd??freq,'surface end frequency');
  const peak=nonnegative(o.peak??.2,'surface peak'), width=clamp(nonnegative(o.width??.35,'surface width'),0,1), pan=clamp(finite(o.pan??0,'surface pan'),-1,1);
  const Q=clamp(positive(o.Q??.8,'surface Q'),.1,20);
  const attack=clamp(nonnegative(o.attack??dur*.12,'surface attack'),.001,dur*.5), release=clamp(nonnegative(o.release??dur*.4,'surface release'),.001,dur*.8);
  if(Math.max(rate,rateEnd)*dur>512)throw new RangeError('bleep-bloop: surface needs at most 512 grains per call');
  let at=0, count=0, end=t;
  while(at<dur && count++<512){
    const x=at/dur, density=rate+(rateEnd-rate)*x, d=grain+(grainEnd-grain)*x;
    const contour=Math.min(1,(at+.006)/attack)*Math.min(1,(dur-at)/release);
    const f=freq*Math.pow(endFreq/freq,x)*v.random(.78,1.24);
    const n=Math.min(d*v.random(.7,1.3),dur-at+.005);
    end=Math.max(end,v.noise(t+at,{dur:n,color:o.color??'pink',type:o.type??'bp',freq:f*v.brightness,Q,peak:peak*contour*v.random(.55,1)/Math.sqrt(Math.max(1,density*d*.7)),pan:clamp(pan+v.random(-width,width),-1,1),fade:{in:Math.min(.003,n*.22),hold:n*.24,out:n*.72}}));
    at+=v.random(.55,1.45)/density;
  }
  return end;
}
