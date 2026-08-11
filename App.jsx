import React, { useState } from "react";

function MatrixRain() {
  const canvasRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const chars = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<>[]{}|=+-*&^%$#@!?";
    const fontSize = 14;
    let drops = Array(Math.floor(canvas.width / fontSize)).fill(0).map(() => Math.random() * -100);
    const draw = () => {
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const cols = Math.floor(canvas.width / fontSize);
      while (drops.length < cols) drops.push(0);
      for (let i = 0; i < cols; i++) {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        const y  = drops[i] * fontSize;
        ctx.fillStyle = "#e0f7ff"; ctx.shadowColor = "#00cfff"; ctx.shadowBlur = 4;
        ctx.font = `bold ${fontSize}px monospace`; ctx.fillText(ch, i * fontSize, y);
        ctx.shadowBlur = 3; ctx.fillStyle = i%5===0 ? "#00ff41" : "#008f11";
        ctx.font = `${fontSize}px monospace`;
        if (drops[i] > 1) ctx.fillText(chars[Math.floor(Math.random()*chars.length)], i*fontSize, y-fontSize);
        if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 0.5 + Math.random() * 0.4;
      }
      ctx.shadowBlur = 0;
    };
    let rafId, lastDraw = 0;
    const animate = (now) => {
      // Throttle rain to ~28fps so it doesn't compete with orbital canvas
      if (now - lastDraw > 50) { draw(); lastDraw = now; }
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={canvasRef} style={{ position:"fixed", top:0, left:0, width:"100%", height:"100%", zIndex:0, opacity:0.82 }} />;
}

function useMatrixAudio() {
  const ctxRef   = React.useRef(null);
  const rafRef   = React.useRef(null);
  const stateRef = React.useRef(null);
  const bufsRef  = React.useRef({});
  const [playing, setPlaying] = React.useState(false);

  const stop = React.useCallback(() => {
    if (rafRef.current) clearInterval(rafRef.current);
    rafRef.current = null; stateRef.current = null;
    if (ctxRef.current) { ctxRef.current.close().catch(()=>{}); ctxRef.current = null; }
    bufsRef.current = {};
    setPlaying(false);
  }, []);

  const start = React.useCallback(() => {
    if (ctxRef.current) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctxRef.current = ctx;
    const sr = ctx.sampleRate;

    const mkNoise = (dur, hp, decay) => {
      const len = Math.floor(sr * dur);
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      let prev = 0, hp0 = 0;
      const rc = 1 / (2 * Math.PI * hp / sr + 1);
      for (let i = 0; i < len; i++) {
        const r = Math.random() * 2 - 1;
        hp0 = rc * (hp0 + r - prev); prev = r;
        d[i] = hp0 * Math.pow(1 - i / len, decay);
      }
      return buf;
    };
    bufsRef.current.hat    = mkNoise(0.06, 8000, 2.8);
    bufsRef.current.snare  = mkNoise(0.20, 1200, 1.0);
    bufsRef.current.click  = mkNoise(0.008, 4000, 0.8);
    bufsRef.current.shaker = mkNoise(0.04, 7000, 3.5);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value=-18; comp.ratio.value=4; comp.attack.value=0.005; comp.release.value=0.25;
    comp.connect(ctx.destination);
    const rvLen = Math.floor(sr*1.0);
    const rvBuf = ctx.createBuffer(2,rvLen,sr);
    for(let c=0;c<2;c++){const d=rvBuf.getChannelData(c);for(let i=0;i<rvLen;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/rvLen,1.8)*0.65;}
    const rv=ctx.createConvolver(); rv.buffer=rvBuf;
    const rvG=ctx.createGain(); rvG.gain.value=0.32;
    const master=ctx.createGain();
    master.gain.setValueAtTime(0,ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.72,ctx.currentTime+1.5);
    rv.connect(rvG); rvG.connect(comp); master.connect(comp);

    const BPM=112, BEAT=60/BPM, BAR=BEAT*4, LOOK=1.2;
    const pb=(t,buf,vol)=>{try{const s=ctx.createBufferSource(),g=ctx.createGain();s.buffer=buf;g.gain.value=vol;s.connect(g);g.connect(comp);s.start(t);}catch(e){}};
    const kick=(t,v=0.5)=>{try{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.setValueAtTime(165,t);o.frequency.exponentialRampToValueAtTime(45,t+0.07);g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(0.0001,t+0.17);o.connect(g);g.connect(comp);o.start(t);o.stop(t+0.22);pb(t,bufsRef.current.click,0.25);}catch(e){}};
    const pad=(freq,t,dur,vol,det=0)=>{try{const o=ctx.createOscillator(),g=ctx.createGain();o.type="sine";o.frequency.value=freq;o.detune.value=det;const atk=Math.min(0.10,dur*0.15);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+atk);g.gain.setValueAtTime(vol*0.78,t+dur-dur*0.28);g.gain.linearRampToValueAtTime(0,t+dur);o.connect(g);g.connect(rv);o.start(t);o.stop(t+dur+0.15);}catch(e){}};
    const bass=(freq,t,dur,vol)=>{try{const o=ctx.createOscillator(),g=ctx.createGain();o.type="sine";o.frequency.value=freq;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+0.025);g.gain.setValueAtTime(vol*0.72,t+dur*0.55);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);o.connect(g);g.connect(master);o.start(t);o.stop(t+dur+0.05);}catch(e){}};
    const sparkle=(freq,t,vol)=>{try{const o=ctx.createOscillator(),g=ctx.createGain();o.type="sine";o.frequency.value=freq;g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0001,t+0.34);o.connect(g);g.connect(rv);o.start(t);o.stop(t+0.38);}catch(e){}};

    // Bright uplifting progression: C - G - Am - F  (repeated with variations)
    const CHORDS=[
      {bass:65.4, pads:[130.8,164.8,196,261.6,392],  arps:[523.3,659.3,784]},   // C
      {bass:98,   pads:[196,246.9,293.7,392,493.9],  arps:[587.3,784,987.8]},   // G
      {bass:110,  pads:[220,261.6,329.6,440,523.3],  arps:[659.3,880,1046.5]},  // Am
      {bass:87.3, pads:[174.6,220,261.6,349.2,440],  arps:[523.3,698.5,880]},   // F
      {bass:65.4, pads:[130.8,164.8,196,261.6,329.6],arps:[659.3,784,1046.5]},  // C
      {bass:82.4, pads:[164.8,207.7,246.9,329.6,415],arps:[493.9,659.3,830.6]}, // E
      {bass:87.3, pads:[174.6,220,261.6,349.2,523.3],arps:[698.5,880,1046.5]},  // F
      {bass:98,   pads:[196,246.9,293.7,392,587.3],  arps:[784,987.8,1174.7]},  // G
    ];
    const MELODIES=[
      [[0,220,2.2,0.18],[2.5,246.9,1.5,0.16],[4,261.6,2.0,0.18],[6.5,293.7,1.5,0.16],[8,329.6,2.5,0.20],[11,293.7,1.8,0.17],[13,261.6,2.2,0.18],[16,246.9,3.5,0.20],[20,220,2.0,0.18],[22.5,196,1.5,0.16],[24,220,2.2,0.18],[27,246.9,4.0,0.20]],
      [[0,329.6,2.0,0.18],[2.5,293.7,1.5,0.16],[4,261.6,2.2,0.18],[6.5,246.9,1.5,0.16],[8,220,3.0,0.20],[11.5,196,2.0,0.18],[14,220,2.5,0.18],[17,246.9,3.5,0.20],[21,261.6,2.0,0.18],[23.5,293.7,1.5,0.16],[25,329.6,2.5,0.20],[28,261.6,4.0,0.18]],
      [[0,440,1.5,0.16],[2,329.6,2.5,0.18],[5,392,2.0,0.18],[7.5,349.2,1.5,0.16],[9,293.7,3.0,0.20],[12.5,329.6,2.0,0.18],[15,392,2.5,0.18],[18,440,3.5,0.20],[22,392,2.0,0.18],[24.5,349.2,1.5,0.16],[26,329.6,2.5,0.18],[29,293.7,4.0,0.20]],
      [[0,261.6,2.5,0.18],[3,293.7,2.0,0.18],[5.5,329.6,1.5,0.16],[7,349.2,2.5,0.18],[10,392,3.0,0.20],[13.5,349.2,2.0,0.18],[16,329.6,2.5,0.18],[19,293.7,3.5,0.20],[23,261.6,2.0,0.18],[25.5,246.9,1.5,0.16],[27,220,2.5,0.18],[30,261.6,3.5,0.20]],
      [[0,523.3,2.0,0.15],[2.5,493.9,1.5,0.14],[4,440,2.5,0.16],[7,392,3.0,0.18],[10.5,440,2.0,0.16],[13,493.9,2.5,0.15],[16,523.3,2.0,0.16],[18.5,587.3,3.5,0.18],[22.5,523.3,2.0,0.16],[25,493.9,1.5,0.14],[27,440,2.5,0.16],[30,392,4.5,0.18]],
      [[0,196,3.0,0.18],[3.5,220,2.5,0.18],[6.5,246.9,2.0,0.18],[9,261.6,3.5,0.20],[13,293.7,2.5,0.18],[16,261.6,2.0,0.18],[18.5,246.9,2.5,0.18],[21.5,220,3.5,0.20],[25.5,196,2.5,0.18],[28,174.6,2.0,0.16],[30.5,196,2.0,0.18],[33,220,4.5,0.20]],
      [[0,330,1.8,0.17],[2,392,1.5,0.16],[3.5,440,1.8,0.17],[5.5,392,1.5,0.16],[7,330,2.5,0.18],[10,293.7,2.0,0.18],[12.5,330,1.8,0.17],[14.5,392,2.5,0.18],[17.5,440,2.0,0.18],[20,493.9,3.0,0.20],[23.5,440,2.0,0.18],[26,392,2.5,0.18],[29,330,4.0,0.20]],
      [[0,293.7,2.5,0.18],[3,261.6,2.0,0.18],[5.5,246.9,1.5,0.16],[7,220,3.0,0.20],[10.5,246.9,2.0,0.18],[13,261.6,2.5,0.18],[16,293.7,2.0,0.18],[18.5,329.6,3.5,0.20],[22.5,293.7,2.0,0.18],[25,261.6,2.0,0.18],[27.5,246.9,1.5,0.16],[29.5,220,5.0,0.22]],
    ];
    const ARP_PATS=[
      [[0.5,0],[1.0,1],[1.5,2],[2.0,1],[2.5,0],[3.0,2],[3.5,1]],
      [[0.25,1],[0.75,2],[1.25,0],[1.75,2],[2.25,1],[2.75,0],[3.25,2]],
      [[0.5,2],[1.5,1],[2.5,0],[3.5,2]],
      [[0.33,0],[1.0,2],[1.66,1],[2.33,0],[3.0,2],[3.66,1]],
    ];

    const S={nextBeat:ctx.currentTime+0.5, beat:0};
    stateRef.current=S;

    const scheduleBeat=(bt,beatInBar,barNum)=>{
      const ch=CHORDS[barNum%CHORDS.length];
      const S16=BEAT*0.25;

      // ── DRIVING DRUMS ──
      // Four-on-the-floor kick for energy
      kick(bt, beatInBar===0?0.62:0.44);
      // Snare backbeat on 2 and 4
      if(beatInBar===1||beatInBar===3) pb(bt,bufsRef.current.snare,0.26);
      // Offbeat hats — the groove driver
      pb(bt,bufsRef.current.hat,0.09);
      pb(bt+BEAT*0.5,bufsRef.current.hat,0.11);
      // Shaker fills on odd bars
      if(barNum%2===1) pb(bt+BEAT*0.75,bufsRef.current.shaker,0.06);

      // ── BOUNCY BASS — plays on 1 and offbeat of 3 ──
      if(beatInBar===0) bass(ch.bass,bt,BEAT*0.85,0.50);
      if(beatInBar===2) bass(ch.bass,bt,BEAT*0.55,0.40);
      if(beatInBar===3) bass(ch.bass*1.5,bt+BEAT*0.5,BEAT*0.45,0.34);

      // ── CHORD STABS on every beat — rhythmic energy ──
      const stabDur = beatInBar%2===0 ? BEAT*0.7 : BEAT*0.45;
      ch.pads.slice(0,3).forEach((f,i)=>
        pad(f, bt, stabDur, (beatInBar%2===0?0.13:0.09)-i*0.02, i===1?-7:7)
      );

      // ── SPARKLING ARPEGGIO — 16th notes, very lively ──
      for(let s=0;s<4;s++){
        const idx=(beatInBar*4+s)%3;
        if(s%2===0||beatInBar%2===1){
          sparkle(ch.arps[idx], bt+s*S16, 0.055);
        }
      }

      // ── MELODY — brighter and more frequent ──
      if(barNum>=1){
        const lb=(barNum-1)*4+beatInBar;
        const phrase=MELODIES[Math.floor((barNum-1)/8)%MELODIES.length];
        for(let i=0;i<phrase.length;i++){
          const [bo,freq,dur,vol]=phrase[i];
          if(Math.floor(bo)===lb%32){
            pad(freq*2, bt+(bo-Math.floor(bo))*BEAT, Math.min(dur,1.2)*BEAT, vol*0.85, 4);
            break;
          }
        }
      }
    };

    // Use setInterval instead of RAF — RAF gets throttled by heavy canvas
    // rendering, which starves the audio scheduler and causes dropouts.
    const tick=()=>{
      if(!stateRef.current||!ctxRef.current) return;
      const S=stateRef.current;
      while(S.nextBeat<ctx.currentTime+LOOK){
        scheduleBeat(S.nextBeat,S.beat%4,Math.floor(S.beat/4));
        S.beat++; S.nextBeat+=BEAT;
      }
    };
    tick();
    rafRef.current=setInterval(tick,300);
    setPlaying(true);
  },[]);

  React.useEffect(()=>()=>stop(),[stop]);
  return {playing,start,stop};
}
// ── SPEECH HOOK ──
function useSpeech() {
  const [listening, setListening] = React.useState(false);
  const [speaking,  setSpeaking]  = React.useState(false);
  const recogRef = React.useRef(null);

  React.useEffect(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  const startListening = React.useCallback((onResult) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Tu navegador no soporta voz. Usa Chrome."); return; }
    try {
      if (recogRef.current) recogRef.current.abort();
      const r = new SR();
      r.lang = "es-ES"; r.continuous = false; r.interimResults = false;
      r.onstart  = () => setListening(true);
      r.onend    = () => setListening(false);
      r.onerror  = (e) => { setListening(false); if(e.error==="not-allowed") alert("Activa el micrófono en ajustes."); };
      r.onresult = (e) => { if(e.results?.[0]?.[0]) onResult(e.results[0][0].transcript); };
      recogRef.current = r; r.start();
    } catch(e) { setListening(false); }
  }, []);

  const stopListening = React.useCallback(() => {
    if (recogRef.current) { try { recogRef.current.stop(); } catch(e){} }
    setListening(false);
  }, []);

  const speak = React.useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const chunks = text.match(/.{1,200}/g) || [text];
    let i = 0;
    const next = () => {
      if (i >= chunks.length) { setSpeaking(false); return; }
      const utt = new SpeechSynthesisUtterance(chunks[i++]);
      utt.lang = "es-ES"; utt.rate = 0.95;
      const v = window.speechSynthesis.getVoices().find(v => v.lang.startsWith("es"));
      if (v) utt.voice = v;
      if (i === 1) setSpeaking(true);
      utt.onend = next; utt.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utt);
    };
    next();
  }, []);

  const stopSpeaking = React.useCallback(() => {
    window.speechSynthesis?.cancel(); setSpeaking(false);
  }, []);

  return { listening, speaking, startListening, stopListening, speak, stopSpeaking };
}



const METAL_GRADIENTS = {
  "#00b4d8":["#e0f7ff","#00b4d8","#004e6e","#00d4ff","#7ee8fa"],
  "#c77dff":["#f3e8ff","#c77dff","#6a00b8","#e0aaff","#fff"],
  "#f4a261":["#fff4e8","#f4a261","#8b4a0f","#ffcf96","#fff"],
  "#ff6b6b":["#ffe8e8","#ff6b6b","#8b0000","#ffaaaa","#fff"],
  "#52b788":["#e8fff4","#52b788","#0a4a2a","#95d5b2","#fff"],
  "#e9c46a":["#fffbe8","#e9c46a","#7a5c00","#ffd166","#fff"],
  "#f72585":["#ffe8f5","#f72585","#7a0040","#ffaadd","#fff"],
  "#a8dadc":["#e8feff","#a8dadc","#1a6b6e","#caf0f8","#fff"],
  "#e2b96f":["#fff8e8","#e2b96f","#7a5200","#ffd89b","#fff"],
  "#c0a0ff":["#f0e8ff","#c0a0ff","#5a00b8","#d8b8ff","#fff"],
  "#00f5d4":["#e0fffa","#00f5d4","#006e5e","#7ffff0","#fff"],
  "#f9c74f":["#fffbe0","#f9c74f","#7a5c00","#ffe08a","#fff"],
  "#ff9a3c":["#fff3e0","#ff9a3c","#8b4000","#ffbe80","#fff"],
  "#ff6eb4":["#ffe8f4","#ff6eb4","#8b0050","#ffaad4","#fff"],
  "#7fff00":["#f0ffe0","#7fff00","#3a7000","#bfff80","#fff"],
  "#ff8c00":["#fff3e0","#ff8c00","#8b4000","#ffba60","#fff"],
};

const CyberIcon=({d,d2,color,size=28,gradId})=>{
  const stops=METAL_GRADIENTS[color]||["#ccc","#fff","#888","#eee","#fff"];
  const id=gradId||("mg_"+(color||"").replace("#",""));
  return(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={stops[0]}/><stop offset="30%" stopColor={stops[1]}/>
          <stop offset="55%" stopColor={stops[2]}/><stop offset="80%" stopColor={stops[3]}/>
          <stop offset="100%" stopColor={stops[4]}/>
        </linearGradient>
        <filter id={"glow_"+id}><feGaussianBlur stdDeviation="1.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <path d={d} stroke={`url(#${id})`} strokeWidth="1.6" filter={`url(#glow_${id})`}/>
      {d2&&<path d={d2} stroke={`url(#${id})`} strokeWidth="0.9" opacity="0.7"/>}
    </svg>
  );
};

const ICONS = {
  plomeria:{d:"M12 2v4M8 6h8l1 3H7L8 6zM6 9v8a2 2 0 002 2h8a2 2 0 002-2V9",d2:"M10 13h4M12 11v4"},
  electricidad_hogar:{d:"M13 2L4.5 13.5H12L11 22l8.5-11.5H12L13 2z"},
  pintura:{d:"M3 17h4l9.5-9.5a2.12 2.12 0 00-3-3L4 14v3zM14.5 6.5l3 3",d2:"M19 21a2 2 0 01-2-2c0-1.1.9-2 2-2s2 .9 2 2v1h-4"},
  carpinteria:{d:"M3 7l4-4 10 10-4 4L3 7zM14 3l4 4M7 14l-4 4",d2:"M17 7l-1 1"},
  jardineria:{d:"M12 22V12M12 12C12 7 7 4 3 6c4 0 7 3 9 6M12 12c0-5 5-8 9-6-4 0-7 3-9 6",d2:"M8 20c1-2 2-4 4-6"},
  limpieza:{d:"M9 3h6l1 6H8L9 3zM8 9l-3 12h14L16 9",d2:"M12 9v4M10 13h4"},
  climatizacion:{d:"M12 2v4M4.93 4.93l2.83 2.83M2 12h4M4.93 19.07l2.83-2.83M12 18v4M19.07 19.07l-2.83-2.83M20 12h-4M19.07 4.93l-2.83 2.83",d2:"M12 8a4 4 0 100 8 4 4 0 000-8z"},
  seguridad_hogar:{d:"M12 2L3 7v6c0 5 4 9 9 11 5-2 9-6 9-11V7L12 2z",d2:"M9 12l2 2 4-4"},
  electrodomesticos:{d:"M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z",d2:"M9 8h6M9 12h6M9 16h4"},
  computadoras:{d:"M2 4h20v14H2zM8 20h8M12 18v2",d2:"M6 8h4M6 11h6M6 14h3"},
  redes:{d:"M12 2a2 2 0 100 4 2 2 0 000-4zM4 18a2 2 0 100 4 2 2 0 000-4zM20 18a2 2 0 100 4 2 2 0 000-4z",d2:"M12 6v4M12 10L4 18M12 10l8 8"},
  celulares:{d:"M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2z",d2:"M12 18h.01M9 6h6"},
  audio_video:{d:"M2 8h4l3-5 3 10 3-6 2 4 3-3h4",d2:"M2 16h20"},
  impresoras:{d:"M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2",d2:"M6 14h12v7H6z"},
  electronica_general:{d:"M3 6h18M3 12h18M3 18h18",d2:"M7 6v12M12 6v12M17 6v12"},
  domotica:{d:"M3 12L12 3l9 9v9H3V12z",d2:"M9 21v-8h6v8M12 9a1 1 0 100 2 1 1 0 000-2z"},
  motor:{d:"M12 12m-3 0a3 3 0 106 0 3 3 0 00-6 0M12 2v3M12 19v3M2 12h3M19 12h3",d2:"M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"},
  frenos:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M12 6a6 6 0 100 12A6 6 0 0012 6zM12 10a2 2 0 100 4 2 2 0 000-4z"},
  electrica_auto:{d:"M14.5 2l-8 11h7l-2 9 9-13h-7l1-7z"},
  carroceria:{d:"M3 12l2-4h14l2 4v4H3v-4z",d2:"M7 16v2M17 16v2M5 12h14M8 8l1-3h6l1 3"},
  ac_auto:{d:"M8 3l4 4 4-4M8 21l4-4 4 4M3 8l4 4-4 4M21 8l-4 4 4 4",d2:"M12 8v8M8 12h8"},
  motos:{d:"M5 17a3 3 0 100 6 3 3 0 000-6zM19 17a3 3 0 100 6 3 3 0 000-6z",d2:"M5 20h3l4-8 2 3h5M14 4l4 6h-3"},
  neumaticos:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M12 7v5l3 3"},
  diagnostico:{d:"M2 12h4l3-7 4 14 3-8 2 4 2-3h4",d2:"M2 20h20"},
  maquinaria:{d:"M12 2a2 2 0 100 4M12 18a2 2 0 100 4M2 12a2 2 0 104 0M18 12a2 2 0 104 0",d2:"M12 4v2M12 18v2M4 12h2M18 12h2M6.34 6.34l1.42 1.42M16.24 16.24l1.42 1.42"},
  hidraulica:{d:"M12 2v20M7 7c0-3 10-3 10 0s-10 3-10 0zM7 17c0-3 10-3 10 0s-10 3-10 0z",d2:"M7 7v10M17 7v10"},
  soldadura:{d:"M12 2l2 6h-4l2-6zM3 20l5-8 4 4 5-7 5 11H3z",d2:"M12 8v4"},
  electricidad_industrial:{d:"M13 2L4 14h8l-1 8 9-12h-8l1-8z"},
  plc:{d:"M2 3h20v18H2zM7 7h2v2H7zM11 7h2v2h-2zM15 7h2v2h-2zM7 13h10v4H7z",d2:"M9 13v4M12 13v4M15 13v4"},
  refrigeracion:{d:"M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07",d2:"M12 8l-2-2M12 8l2-2M12 16l-2 2M12 16l2 2"},
  herramientas:{d:"M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"},
  seguridad_industrial:{d:"M12 2L3 7v6c0 5.25 3.75 9.75 9 11 5.25-1.25 9-5.75 9-11V7L12 2z",d2:"M8 11h8M12 8v8"},
  windows:{d:"M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"},
  linux:{d:"M12 2C8 2 6 6 6 10c0 2 1 4 2 5l-2 5h12l-2-5c1-1 2-3 2-5 0-4-2-8-6-8z",d2:"M9 14c.5.5 1.5 1 3 1s2.5-.5 3-1M9 10h.01M15 10h.01"},
  macos:{d:"M12 3a9 9 0 100 18A9 9 0 0012 3z",d2:"M8 12c0-2 1.5-4 4-4s4 2 4 4-1.5 4-4 4-4-2-4-4zM12 8v1M12 15v1"},
  programacion:{d:"M8 9l-4 3 4 3M16 9l4 3-4 3",d2:"M13 6l-2 12"},
  bases_datos:{d:"M12 3c-4.4 0-8 1.3-8 3v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6c0-1.7-3.6-3-8-3z",d2:"M4 6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"},
  servidores:{d:"M2 6h20v4H2zM2 14h20v4H2z",d2:"M6 8h.01M6 16h.01M10 8h4M10 16h4"},
  apps_movil:{d:"M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2z",d2:"M12 18h.01M9 6h6M9 10h6M9 14h3"},
  ciberseguridad:{d:"M12 2L3 7v6c0 5 4 9 9 11 5-2 9-6 9-11V7L12 2z",d2:"M12 8v5M12 15h.01"},
  riego:{d:"M12 2v8M8 6l4-4 4 4M7 14c0 3 2.24 5 5 5s5-2 5-5c0-4-5-8-5-8s-5 4-5 8z"},
  maquinaria_agricola:{d:"M4 17a3 3 0 100 6 3 3 0 000-6zM17 16a4 4 0 100 8 4 4 0 000-8z",d2:"M4 20h5l4-8 4 3V9l-6-5H7L4 8v12z"},
  plagas:{d:"M12 12m-4 0a4 4 0 108 0 4 4 0 00-8 0M8 8L4 4M16 8l4-4M8 16l-4 4M16 16l4 4",d2:"M2 12h4M18 12h4"},
  suelo:{d:"M12 2v10M8 6l4 4 4-4M5 22c0-4 7-8 7-8s7 4 7 8H5z"},
  energia_solar:{d:"M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",d2:"M12 7a5 5 0 100 10A5 5 0 0012 7z"},
  agua:{d:"M12 2L8 9h8l-4-7zM6 14a6 6 0 1012 0c0-4-6-8-6-8s-6 4-6 8z"},
  animales:{d:"M4 8c0-2 2-4 4-4 0 2-1 4-4 4zM20 8c0-2-2-4-4-4 0 2 1 4 4 4zM8 8c-2 2-3 5-3 8h14c0-3-1-6-3-8H8z",d2:"M10 13v3M14 13v3"},
  invernadero:{d:"M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z",d2:"M9 22V12h6v10M12 7v5M9 9l3-2 3 2"},
  primeros_auxilios:{d:"M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18",d2:"M12 8v8M8 12h8"},
  medicamentos:{d:"M9 3h6l2 4H7L9 3zM7 7h10v12a2 2 0 01-2 2H9a2 2 0 01-2-2V7z",d2:"M9 12h6M12 10v4"},
  equipos_medicos:{d:"M22 12h-4l-3 9L9 3l-3 9H2"},
  emergencias:{d:"M13 2L3 14h9l-1 8 10-12h-9l1-8z"},
  ergonomia:{d:"M12 4a2 2 0 100 4 2 2 0 000-4zM12 10v4M8 14l-2 6M16 14l2 6M8 14h8",d2:"M10 14v4M14 14v4"},
  aire:{d:"M9 7c-3 0-4 3-2 5M9 12H2M12 5c-5 0-7 5-4 8M12 13H5",d2:"M17 8c2 1 3 3 3 5a5 5 0 01-5 5H9"},
  impresion3d:{d:"M12 2l8 4v8l-8 4-8-4V6l8-4z",d2:"M12 6v8M4 6l8 4 8-4"},
  drones:{d:"M6 6a2 2 0 100-4 2 2 0 000 4zM18 6a2 2 0 100-4 2 2 0 000 4zM6 22a2 2 0 100-4 2 2 0 000 4zM18 22a2 2 0 100-4 2 2 0 000 4z",d2:"M8 6l4 6-4 6M16 6l-4 6 4 6M12 12h.01"},
  musica:{d:"M9 18V5l12-2v13",d2:"M9 18a3 3 0 100 0M21 16a3 3 0 100 0"},
  fotografia:{d:"M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z",d2:"M12 17a4 4 0 100-8 4 4 0 000 8z"},
  costura:{d:"M20 4L4 20M4 4l16 16",d2:"M12 4v4M12 16v4M4 12h4M16 12h4"},
  otro:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M12 8h.01M11 12h1v4h1"},
  historia_antigua:{d:"M3 21h18M5 21V7l7-4 7 4v14",d2:"M9 21v-6h6v6"},
  historia_moderna:{d:"M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"},
  historia_contemporanea:{d:"M3 3h18v4H3zM3 10h18v4H3zM3 17h18v4H3z",d2:"M7 5h.01M7 12h.01M7 19h.01"},
  geopolitica:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"},
  arqueologia:{d:"M3 21l9-18 9 18M5 17h14",d2:"M12 7v4M12 15h.01"},
  filosofia:{d:"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z",d2:"M12 8v4l3 3"},
  mitologia:{d:"M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"},
  arte_historia:{d:"M2 8h4l3-5 3 10 3-6 2 4 3-3h4",d2:"M2 20h20"},
  derecho_civil:{d:"M12 2L2 7h20L12 2zM3 7v13h18V7",d2:"M9 7v13M15 7v13M3 12h18"},
  derecho_penal:{d:"M12 2L3 7v6c0 5 4 9 9 11 5-2 9-6 9-11V7L12 2z",d2:"M9 12l2 2 4-4"},
  derecho_laboral:{d:"M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z",d2:"M16 3h-3a1 1 0 00-1 1v3h5V4a1 1 0 00-1-1zM8 3H5a1 1 0 00-1 1v3h5V4a1 1 0 00-1-1z"},
  derecho_mercantil:{d:"M3 3h18v18H3z",d2:"M3 9h18M9 21V9"},
  derecho_internacional:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M12 2v20M2 12h20M4.93 4.93l14.14 14.14"},
  derecho_constitucional:{d:"M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14",d2:"M8 7h8M8 11h8M8 15h4"},
  contratos:{d:"M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z",d2:"M14 2v6h6M8 13h8M8 17h5"},
  propiedad_intelectual:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M9.5 9.5a3 3 0 015 0c0 2-2 3-2 5M12 18h.01"},
  fisica:{d:"M12 12m-2 0a2 2 0 104 0 2 2 0 00-4 0M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"},
  quimica:{d:"M9 3h6v8l3 8H6l3-8V3z",d2:"M9 3h6M7 19h10"},
  biologia:{d:"M12 2a5 5 0 015 5c0 6-5 8-5 8s-5-2-5-8a5 5 0 015-5z",d2:"M12 10v12M8 18h8"},
  matematicas:{d:"M4 6h16M4 12h16M4 18h16",d2:"M8 3v18M16 3v18"},
  astronomia:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M12 6a2 2 0 100 4 2 2 0 000-4zM6 18l3-4M18 18l-3-4"},
  geologia:{d:"M3 21l9-12 9 12H3z",d2:"M6 21v-4l3-4M18 21v-4l-3-4M12 21v-8"},
  neurociencia:{d:"M12 2C6 2 2 6 2 12s4 10 10 10 10-4 10-10S18 2 12 2z",d2:"M8 12c0-2 2-4 4-4s4 2 4 4M6 16c1-1 3-2 6-2s5 1 6 2"},
  genetica:{d:"M8 3c0 4 4 5 4 9s-4 5-4 9M16 3c0 4-4 5-4 9s4 5 4 9",d2:"M6 8h12M6 16h12"},
  macroeconomia:{d:"M2 20h20M5 20V10l7-7 7 7v10",d2:"M9 20v-6h6v6"},
  microeconomia:{d:"M3 3v18h18",d2:"M7 16l4-8 4 4 4-6"},
  finanzas_personales:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M12 6v2M12 16v2M9 9h1.5a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3H11M12 9h2"},
  bolsa:{d:"M3 3v18h18",d2:"M7 14l4-6 4 4 4-5"},
  crypto:{d:"M9 3h6l3 9-9 9-9-9 9-9z",d2:"M12 3v18M3 12h18"},
  contabilidad:{d:"M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z",d2:"M8 12h8M8 16h5M14 2v6h6"},
  marketing:{d:"M22 12h-4l-3 9L9 3l-3 9H2"},
  emprendimiento:{d:"M12 2L2 19h20L12 2z",d2:"M12 9v4M12 17h.01"},
  psicologia:{d:"M12 2C8 2 5 5 5 9c0 3 2 5 4 7l1 6h4l1-6c2-2 4-4 4-7 0-4-3-7-7-7z",d2:"M10 22h4"},
  sociologia:{d:"M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"},
  antropologia:{d:"M12 2a4 4 0 100 8 4 4 0 000-8zM6 20v-2a4 4 0 014-4h4a4 4 0 014 4v2",d2:"M3 10h3M18 10h3"},
  politica:{d:"M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4"},
  comunicacion:{d:"M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",d2:"M8 10h8M8 14h5"},
  educacion:{d:"M2 3h20v14H2zM8 21h8M12 17v4",d2:"M7 8h10M7 12h6"},
  linguistica:{d:"M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",d2:"M8 9h8M8 13h4"},
  geografia:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M2 12h20M12 2a15 15 0 010 20"},
  literatura:{d:"M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2z",d2:"M8 7h8M8 11h8M8 15h4"},
  escritura:{d:"M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"},
  poesia:{d:"M3 6h18M3 12h12M3 18h8",d2:"M19 12l2 2-2 2"},
  teatro:{d:"M8 3c0 4-4 6-4 9a4 4 0 008 0c0-3-4-5-4-9zM16 3c0 4-4 6-4 9a4 4 0 008 0c0-3-4-5-4-9z",d2:"M8 12h8"},
  etica:{d:"M12 2L3 7v6c0 5 4 9 9 11 5-2 9-6 9-11V7L12 2z",d2:"M8 12h8M12 9v6"},
  religion:{d:"M12 2v20M2 12h20",d2:"M12 7a5 5 0 000 10"},
  logica:{d:"M8 9l3 3-3 3M13 15h3",d2:"M2 5h8a2 2 0 012 2v10a2 2 0 01-2 2H2V5zM14 9h6M14 15h6M14 12h4"},
  retorica:{d:"M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",d2:"M9 10h.01M12 10h.01M15 10h.01"},
  mil_ejercito:{d:"M12 2L3 7v6c0 5 4 9 9 11 5-2 9-6 9-11V7L12 2z",d2:"M8 11h8M12 8v6"},
  mil_marina:{d:"M3 17l9-14 9 14H3z",d2:"M12 3v10M7 17h10"},
  mil_aviacion:{d:"M12 2L4 14h4v7h8v-7h4L12 2z",d2:"M9 14h6"},
  mil_fuerzas_especiales:{d:"M12 2a5 5 0 015 5c0 6-5 10-5 10S7 13 7 7a5 5 0 015-5z",d2:"M9 12l2 2 4-4"},
  mil_inteligencia:{d:"M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z",d2:"M12 9a3 3 0 100 6 3 3 0 000-6z"},
  mil_armamento:{d:"M4 8h16M4 8l2-4h12l2 4M4 8v8a2 2 0 002 2h12a2 2 0 002-2V8",d2:"M12 12v4M9 12v2M15 12v2"},
  mil_tactica:{d:"M3 3h18v18H3z",d2:"M3 9h18M3 15h18M9 3v18M15 3v18"},
  mil_historia_militar:{d:"M2 3h20v14H2zM8 21h8M12 17v4",d2:"M7 8h10M7 12h6"},
  mil_ciberguerra:{d:"M13 2L4 14h8l-1 8 10-12h-8l1-8z"},
  mil_logistica:{d:"M1 3h15v13H1zM16 8h4l3 3v5h-7V8z",d2:"M5 19a2 2 0 100-4 2 2 0 000 4zM18 19a2 2 0 100-4 2 2 0 000 4z"},
  mil_medicina_combate:{d:"M22 12h-4l-3 9L9 3l-3 9H2"},
  mil_derecho:{d:"M12 2L3 7v6c0 5 4 9 9 11 5-2 9-6 9-11V7L12 2z",d2:"M8 12h8M12 9v6"},
  surv_wilderness:{d:"M3 21l9-12 9 12H3z",d2:"M12 3v6M8 9l4-6 4 6"},
  surv_urbana:{d:"M3 21h18M5 21V7l7-4 7 4v14",d2:"M9 21v-6h6v6M9 11h2M13 11h2"},
  surv_agua:{d:"M12 2C8 8 4 12 4 16a8 8 0 0016 0c0-4-4-8-8-14z",d2:"M9 17c1 1 2 1.5 3 1.5s2-.5 3-1.5"},
  surv_fuego:{d:"M12 2c0 6-6 8-6 14a6 6 0 0012 0c0-6-6-8-6-14z",d2:"M10 17c.5 1 1 1.5 2 1.5s1.5-.5 2-1.5"},
  surv_refugio:{d:"M3 12L12 3l9 9v9H3V12z",d2:"M9 21v-6h6v6"},
  surv_alimentacion:{d:"M6 3v18M6 8c4 0 8-2 8-5",d2:"M18 9l-3 12M15 9l3-6"},
  surv_primeros_auxilios_surv:{d:"M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18",d2:"M12 8v8M8 12h8"},
  surv_navegacion:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M12 8l-1.5 7.5L16 12l-7.5 1.5L12 8z"},
  surv_señales:{d:"M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"},
  surv_preparacion:{d:"M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z",d2:"M12 12v4M10 14h4M8 7V5a4 4 0 018 0v2"},
  surv_clima_extremo:{d:"M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2",d2:"M12 7a5 5 0 100 10A5 5 0 0012 7z"},
  surv_autodefensa:{d:"M12 2L3 7v6c0 5 4 9 9 11 5-2 9-6 9-11V7L12 2z",d2:"M8 12l3 3 5-5"},
};

const SECTIONS=[
  {label:"SISTEMA // HOGAR",color:"#00b4d8",categories:[{id:"plomeria",label:"Plomería"},{id:"electricidad_hogar",label:"Electricidad"},{id:"pintura",label:"Pintura & Paredes"},{id:"carpinteria",label:"Carpintería"},{id:"jardineria",label:"Jardinería"},{id:"limpieza",label:"Limpieza"},{id:"climatizacion",label:"Clima & HVAC"},{id:"seguridad_hogar",label:"Seguridad Hogar"}]},
  {label:"MÓDULO // ELECTRÓNICA",color:"#c77dff",categories:[{id:"electrodomesticos",label:"Electrodomésticos"},{id:"computadoras",label:"Computadoras & PC"},{id:"redes",label:"Redes & WiFi"},{id:"celulares",label:"Celulares & Tablets"},{id:"audio_video",label:"Audio & Video"},{id:"impresoras",label:"Impresoras"},{id:"electronica_general",label:"Electrónica General"},{id:"domotica",label:"Smart Home"}]},
  {label:"PROTOCOLO // AUTOMOTRIZ",color:"#f4a261",categories:[{id:"motor",label:"Motor & Transmisión"},{id:"frenos",label:"Frenos & Suspensión"},{id:"electrica_auto",label:"Eléctrica Automotriz"},{id:"carroceria",label:"Carrocería & Pintura"},{id:"ac_auto",label:"A/C Automotriz"},{id:"motos",label:"Motos & Bicicletas"},{id:"neumaticos",label:"Neumáticos & Llantas"},{id:"diagnostico",label:"Diagnóstico OBD"}]},
  {label:"NÚCLEO // INDUSTRIAL",color:"#ff6b6b",categories:[{id:"maquinaria",label:"Maquinaria Industrial"},{id:"hidraulica",label:"Hidráulica & Neumática"},{id:"soldadura",label:"Soldadura & Metales"},{id:"electricidad_industrial",label:"Eléctrica Industrial"},{id:"plc",label:"PLC & Automatización"},{id:"refrigeracion",label:"Refrigeración Ind."},{id:"herramientas",label:"Herramientas & Taller"},{id:"seguridad_industrial",label:"Seguridad Industrial"}]},
  {label:"RED // SOFTWARE",color:"#52b788",categories:[{id:"windows",label:"Windows"},{id:"linux",label:"Linux & Unix"},{id:"macos",label:"macOS"},{id:"programacion",label:"Programación & Código"},{id:"bases_datos",label:"Bases de Datos"},{id:"servidores",label:"Servidores & Cloud"},{id:"apps_movil",label:"Apps Móviles"},{id:"ciberseguridad",label:"Ciberseguridad"}]},
  {label:"BIOSCAN // AGRÍCOLA",color:"#e9c46a",categories:[{id:"riego",label:"Sistemas de Riego"},{id:"maquinaria_agricola",label:"Maquinaria Agrícola"},{id:"plagas",label:"Control de Plagas"},{id:"suelo",label:"Suelo & Cultivos"},{id:"energia_solar",label:"Energía Solar"},{id:"agua",label:"Tratamiento de Agua"},{id:"animales",label:"Veterinaria & Animales"},{id:"invernadero",label:"Invernaderos"}]},
  {label:"MEDLAB // SALUD",color:"#f72585",categories:[{id:"primeros_auxilios",label:"Primeros Auxilios"},{id:"medicamentos",label:"Medicamentos & Dosis"},{id:"equipos_medicos",label:"Equipos Médicos"},{id:"emergencias",label:"Emergencias"},{id:"ergonomia",label:"Ergonomía & Postura"},{id:"aire",label:"Calidad del Aire"}]},
  {label:"NEXUS // CREATIVOS",color:"#a8dadc",categories:[{id:"impresion3d",label:"Impresión 3D"},{id:"drones",label:"Drones & RC"},{id:"musica",label:"Instrumentos & Audio"},{id:"fotografia",label:"Fotografía & Video"},{id:"costura",label:"Costura & Textiles"},{id:"otro",label:"Otro / General"}]},
  {label:"ARCHIVO // HISTORIA",color:"#e2b96f",categories:[{id:"historia_antigua",label:"Historia Antigua"},{id:"historia_moderna",label:"Historia Moderna"},{id:"historia_contemporanea",label:"Historia Contemporánea"},{id:"geopolitica",label:"Geopolítica"},{id:"arqueologia",label:"Arqueología"},{id:"filosofia",label:"Filosofía"},{id:"mitologia",label:"Mitología"},{id:"arte_historia",label:"Historia del Arte"}]},
  {label:"LEXIS // DERECHO",color:"#c0a0ff",categories:[{id:"derecho_civil",label:"Derecho Civil"},{id:"derecho_penal",label:"Derecho Penal"},{id:"derecho_laboral",label:"Derecho Laboral"},{id:"derecho_mercantil",label:"Derecho Mercantil"},{id:"derecho_internacional",label:"Derecho Internacional"},{id:"derecho_constitucional",label:"Constitucional"},{id:"contratos",label:"Contratos & Notaría"},{id:"propiedad_intelectual",label:"Propiedad Intelectual"}]},
  {label:"QUANTUM // CIENCIAS",color:"#00f5d4",categories:[{id:"fisica",label:"Física"},{id:"quimica",label:"Química"},{id:"biologia",label:"Biología"},{id:"matematicas",label:"Matemáticas"},{id:"astronomia",label:"Astronomía & Cosmos"},{id:"geologia",label:"Geología"},{id:"neurociencia",label:"Neurociencia"},{id:"genetica",label:"Genética & ADN"}]},
  {label:"NEXUS // ECONOMÍA",color:"#f9c74f",categories:[{id:"macroeconomia",label:"Macroeconomía"},{id:"microeconomia",label:"Microeconomía"},{id:"finanzas_personales",label:"Finanzas Personales"},{id:"bolsa",label:"Bolsa & Inversión"},{id:"crypto",label:"Crypto & Blockchain"},{id:"contabilidad",label:"Contabilidad"},{id:"marketing",label:"Marketing & Negocios"},{id:"emprendimiento",label:"Emprendimiento"}]},
  {label:"SIGMA // CC. SOCIALES",color:"#ff9a3c",categories:[{id:"psicologia",label:"Psicología"},{id:"sociologia",label:"Sociología"},{id:"antropologia",label:"Antropología"},{id:"politica",label:"Ciencia Política"},{id:"comunicacion",label:"Comunicación & Media"},{id:"educacion",label:"Educación & Pedagogía"},{id:"linguistica",label:"Lingüística & Idiomas"},{id:"geografia",label:"Geografía"}]},
  {label:"VERTEX // HUMANIDADES",color:"#ff6eb4",categories:[{id:"literatura",label:"Literatura"},{id:"escritura",label:"Escritura & Redacción"},{id:"poesia",label:"Poesía & Prosa"},{id:"teatro",label:"Teatro & Dramaturgia"},{id:"etica",label:"Ética & Moral"},{id:"religion",label:"Religión & Espiritualidad"},{id:"logica",label:"Lógica & Argumentación"},{id:"retorica",label:"Retórica & Debate"}]},
  {label:"⚔ COMANDO // MILITAR",color:"#7fff00",categories:[{id:"mil_ejercito",label:"Ejército & Infantería"},{id:"mil_marina",label:"Marina & Fuerzas Navales"},{id:"mil_aviacion",label:"Aviación Militar"},{id:"mil_fuerzas_especiales",label:"Fuerzas Especiales"},{id:"mil_inteligencia",label:"Inteligencia & Contrainteligencia"},{id:"mil_armamento",label:"Armamento & Balística"},{id:"mil_tactica",label:"Táctica & Estrategia"},{id:"mil_historia_militar",label:"Historia Militar"},{id:"mil_ciberguerra",label:"Ciberguerra & EW"},{id:"mil_logistica",label:"Logística Militar"},{id:"mil_medicina_combate",label:"Medicina de Combate"},{id:"mil_derecho",label:"Derecho Internacional Bélico"}]},
  {label:"🛡 OMEGA // SUPERVIVENCIA",color:"#ff8c00",categories:[{id:"surv_wilderness",label:"Supervivencia Wilderness"},{id:"surv_urbana",label:"Supervivencia Urbana"},{id:"surv_agua",label:"Obtención de Agua"},{id:"surv_fuego",label:"Fuego & Calor"},{id:"surv_refugio",label:"Construcción de Refugios"},{id:"surv_alimentacion",label:"Caza, Pesca & Forrajeo"},{id:"surv_primeros_auxilios_surv",label:"Primeros Auxilios Campo"},{id:"surv_navegacion",label:"Navegación & Orientación"},{id:"surv_señales",label:"Señales & Rescate"},{id:"surv_preparacion",label:"Preparacionismo & SHTF"},{id:"surv_clima_extremo",label:"Climas Extremos"},{id:"surv_autodefensa",label:"Autodefensa & Seguridad"}]},
];

const ALL_CATS=SECTIONS.flatMap(s=>s.categories.map(c=>({...c,sectionColor:s.color,sectionLabel:s.label})));

// ── COLUMN FRAME WITH FLOATING CLOUDS ──
function ColumnFrame({color,children}){
  const [t,setT]=React.useState(0);
  React.useEffect(()=>{
    let raf,last=performance.now();
    const loop=(now)=>{
      const dt=Math.min((now-last)/1000,0.05); last=now;
      setT(v=>v+dt);
      raf=requestAnimationFrame(loop);
    };
    raf=requestAnimationFrame(loop);
    return()=>cancelAnimationFrame(raf);
  },[]);

  // Cloud definitions: [baseX%, baseY, scale, speed, opacity]
  const CLOUDS=[
    [10, 18, 1.0, 0.9,  0.16],
    [35, 10, 1.4, 0.55, 0.12],
    [62, 22, 0.85,1.3,  0.18],
    [82, 12, 1.2, 0.7,  0.13],
    [48, 28, 0.7, 1.6,  0.20],
  ];

  const Cloud=({x,y,s,op})=>(
    <g transform={`translate(${x},${y}) scale(${s})`} opacity={op}>
      <ellipse cx="0"  cy="0" rx="22" ry="11"/>
      <ellipse cx="16" cy="-5" rx="16" ry="12"/>
      <ellipse cx="-15" cy="-3" rx="14" ry="9"/>
      <ellipse cx="5"  cy="-9" rx="12" ry="10"/>
    </g>
  );

  return(
    <div style={{position:"relative",width:"100%"}}>
      {/* Top decorative band: columns + clouds */}
      <svg viewBox="0 0 400 92" preserveAspectRatio="none"
        style={{width:"100%",height:88,display:"block",marginBottom:-2}}>
        <defs>
          {/* Realistic white marble column gradient */}
          <linearGradient id="colGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#8a94a6" stopOpacity="0.75"/>
            <stop offset="18%"  stopColor="#d8dee8" stopOpacity="0.92"/>
            <stop offset="38%"  stopColor="#ffffff" stopOpacity="1"/>
            <stop offset="58%"  stopColor="#eef1f6" stopOpacity="0.96"/>
            <stop offset="80%"  stopColor="#b6bfcd" stopOpacity="0.85"/>
            <stop offset="100%" stopColor="#7c8697" stopOpacity="0.7"/>
          </linearGradient>
          {/* Vertical marble for side columns */}
          <linearGradient id="colGradV" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#7c8697" stopOpacity="0.7"/>
            <stop offset="22%"  stopColor="#dde3ec" stopOpacity="0.9"/>
            <stop offset="45%"  stopColor="#ffffff" stopOpacity="1"/>
            <stop offset="70%"  stopColor="#c9d1dd" stopOpacity="0.88"/>
            <stop offset="100%" stopColor="#8a94a6" stopOpacity="0.72"/>
          </linearGradient>
          {/* Soft sky behind clouds */}
          <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stopColor="#dce6f2" stopOpacity="0.10"/>
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.02"/>
          </linearGradient>
          {/* Cloud body gradient - white with soft grey underside */}
          <radialGradient id="cloudGrad" cx="42%" cy="32%" r="72%">
            <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.95"/>
            <stop offset="55%"  stopColor="#f4f7fb" stopOpacity="0.80"/>
            <stop offset="100%" stopColor="#c4cedd" stopOpacity="0.45"/>
          </radialGradient>
          <filter id="cloudBlur"><feGaussianBlur stdDeviation="1.8"/></filter>
          <filter id="cloudSoft"><feGaussianBlur stdDeviation="3.5"/></filter>
          {/* Weathered stone texture — fractal noise for erosion */}
          <filter id="weathered" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9 0.35" numOctaves="4" seed="7" result="noise"/>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
          </filter>
          {/* Heavier erosion for broken edges */}
          <filter id="eroded" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence type="fractalNoise" baseFrequency="0.55 0.25" numOctaves="5" seed="13" result="n"/>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>
          </filter>
          {/* Grime and age stains */}
          <filter id="grime">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="21" result="t"/>
            <feColorMatrix in="t" type="matrix"
              values="0 0 0 0 0.35  0 0 0 0 0.33  0 0 0 0 0.30  0 0 0 0.32 0"/>
          </filter>
          {/* Aged marble — yellowed and stained */}
          <linearGradient id="agedGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#6b6a63" stopOpacity="0.8"/>
            <stop offset="20%"  stopColor="#b8b3a4" stopOpacity="0.9"/>
            <stop offset="42%"  stopColor="#ddd8c8" stopOpacity="0.95"/>
            <stop offset="62%"  stopColor="#c4bfae" stopOpacity="0.9"/>
            <stop offset="85%"  stopColor="#8f8b7e" stopOpacity="0.82"/>
            <stop offset="100%" stopColor="#5f5e57" stopOpacity="0.75"/>
          </linearGradient>
          <linearGradient id="agedGradV" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#5f5e57" stopOpacity="0.78"/>
            <stop offset="24%"  stopColor="#c0bbab" stopOpacity="0.9"/>
            <stop offset="48%"  stopColor="#e2ddcd" stopOpacity="0.95"/>
            <stop offset="74%"  stopColor="#a9a496" stopOpacity="0.88"/>
            <stop offset="100%" stopColor="#6b6a63" stopOpacity="0.76"/>
          </linearGradient>
        </defs>

        {/* Sky background */}
        <rect x="0" y="0" width="400" height="92" fill="url(#skyGrad)"/>

        {/* Back cloud layer - softer, more diffuse */}
        <g fill="url(#cloudGrad)" filter="url(#cloudSoft)">
          {CLOUDS.map(([bx,by,s,sp,op],i)=>{
            const x=((bx+t*sp*2.5)%130)*400/130 - 40;
            const y=by+3+Math.sin(t*0.4+i)*2;
            return <Cloud key={"b"+i} x={x} y={y} s={s*1.3} op={op*0.55}/>;
          })}
        </g>
        {/* Front cloud layer - crisper white */}
        <g fill="url(#cloudGrad)" filter="url(#cloudBlur)">
          {CLOUDS.map(([bx,by,s,sp,op],i)=>{
            const x=((bx+t*sp*4)%130)*400/130 - 40;
            const y=by+Math.sin(t*0.5+i)*3;
            return <Cloud key={"f"+i} x={x} y={y} s={s} op={Math.min(1,op*3.2)}/>;
          })}
        </g>

        {/* RUINED PEDIMENT — broken apex, missing chunks */}
        <g filter="url(#eroded)">
          {/* Left surviving portion */}
          <path d="M0,42 L58,33.5 L96,26 L132,22 L150,20.5 L146,42 Z" fill="url(#agedGrad)" opacity="0.92"/>
          {/* Right surviving portion — larger gap at apex */}
          <path d="M243,23.5 L280,26.5 L322,32 L365,38 L400,42 L400,42 L248,42 Z" fill="url(#agedGrad)" opacity="0.9"/>
          {/* Small isolated fragment near the centre */}
          <path d="M172,21 L196,18.5 L206,24 L188,27 Z" fill="url(#agedGrad)" opacity="0.75"/>
        </g>
        {/* Tympanum — eroded recess, only partially visible */}
        <path d="M16,40.5 L100,29 L142,25" fill="none" stroke="#6b6a63" strokeWidth="0.6" opacity="0.45"/>
        <path d="M256,26 L340,35 L384,40.5" fill="none" stroke="#6b6a63" strokeWidth="0.6" opacity="0.42"/>
        {/* Broken raking cornice — dashed to suggest missing sections */}
        <path d="M0,42 L150,20.5" fill="none" stroke="#e8e2d2" strokeWidth="1.4" opacity="0.6" strokeDasharray="26 5 14 8 20"/>
        <path d="M243,23.5 L400,42" fill="none" stroke="#e8e2d2" strokeWidth="1.4" opacity="0.55" strokeDasharray="18 6 24 4"/>
        {/* Rubble at the base of the gap */}
        <circle cx="196" cy="41" r="1.4" fill="#8f8b7e" opacity="0.5"/>
        <circle cx="214" cy="40.5" r="1" fill="#a9a496" opacity="0.45"/>
        <circle cx="228" cy="41.5" r="1.7" fill="#6b6a63" opacity="0.4"/>
        {/* Surviving acroterion stub on the left */}
        <path d="M2,41.5 L4.5,38 L7,41.5 Z" fill="#c4bfae" opacity="0.6"/>

        {/* CORNICE — chipped and uneven */}
        <g filter="url(#weathered)">
          <rect x="0" y="41.5" width="400" height="2.5" fill="#ddd8c8" opacity="0.75"/>
          <rect x="0" y="44" width="400" height="2.5" fill="url(#agedGrad)"/>
        </g>
        {/* Missing cornice chunks */}
        <rect x="88" y="41.5" width="17" height="5" fill="#0a1420" opacity="0.55"/>
        <rect x="211" y="42" width="12" height="4.5" fill="#0a1420" opacity="0.5"/>
        <rect x="318" y="41.8" width="9" height="4.7" fill="#0a1420" opacity="0.45"/>
        {/* Mutules — some broken off */}
        {[25,65,145,185,265,305,385].map((mx,mi)=>(
          <rect key={mi} x={mx-7} y="46.5" width={mi%3===0?10:14} height="1.6"
            fill="#b8b3a4" opacity={0.35+((mi*7)%4)*0.1}/>
        ))}
        {/* DORIC FRIEZE — triglyphs over each column and midpoint */}
        <rect x="0" y="48.5" width="400" height="8" fill="#5c6675" opacity="0.22"/>
        {[45,95,145,200,255,305,355,10,390].map((tx,ti)=>{
          const dmg=(ti*13)%5;           // pseudo-random damage per triglyph
          const h=dmg===0?5.5:dmg===3?6.8:8;
          return(
            <g key={ti} filter="url(#weathered)" opacity={dmg===4?0.45:0.9}>
              <rect x={tx-5} y="48.5" width={dmg===1?8:10} height={h} fill="url(#agedGrad)"/>
              <line x1={tx-2.5} y1="49.2" x2={tx-2.5} y2={48.5+h-0.5} stroke="#4a4943" strokeWidth="0.9" opacity="0.65"/>
              <line x1={tx+2.5} y1="49.2" x2={tx+2.5} y2={48.5+h-0.5} stroke="#4a4943" strokeWidth="0.9" opacity="0.6"/>
              <line x1={tx-5}   y1="49.2" x2={tx-5}   y2={48.5+h-0.5} stroke="#5f5e57" strokeWidth="0.6" opacity="0.45"/>
              {dmg!==0&&<rect x={tx-4} y="56.5" width={dmg===2?5:8} height="1" fill="#b8b3a4" opacity="0.45"/>}
            </g>
          );
        })}
        {/* ARCHITRAVE — plain undecorated beam (Doric) */}
        <rect x="0" y="57.5" width="400" height="2.5" fill="url(#colGrad)"/>
        <rect x="0" y="60" width="400" height="0.8" fill="#7c8697" opacity="0.5"/>

        {/* Modern columns */}
        {[45,145,255,355].map((cx,i)=>{
          const dmg=i;  // 0=intact-ish, 1=chipped, 2=broken short, 3=cracked
          const topY = dmg===2 ? 78 : 60.5;      // broken column starts lower
          const hasCapital = dmg!==2;
          return(
          <g key={i}>
            {hasCapital&&(
            <g filter="url(#weathered)">
              {/* Abacus — chipped corners */}
              <path d={dmg===1
                ? `M${cx-15},60.5 L${cx+16},60.8 L${cx+15.5},63.5 L${cx-16},63.2 Z`
                : `M${cx-16},60.5 L${cx+16},60.5 L${cx+16},63.5 L${cx-16},63.5 Z`}
                fill="#ddd8c8" opacity="0.85"/>
              <rect x={cx-16} y="63.5" width="32" height="1" fill="#5f5e57" opacity="0.5"/>
              {/* Echinus — eroded flare */}
              <path d={`M${cx-15},64.5 Q${cx-13.5},68 ${cx-11},70 L${cx+11},70 Q${cx+13.5},68 ${cx+15},64.5 Z`}
                fill="url(#agedGrad)"/>
              {/* Annulets — some worn away */}
              <rect x={cx-11} y="70.2" width="22" height="0.7" fill="#6b6a63" opacity="0.55"/>
              {dmg!==1&&<rect x={cx-11} y="71.4" width={dmg===3?16:22} height="0.7" fill="#6b6a63" opacity="0.42"/>}
              <rect x={cx-11} y="72.6" width={dmg===3?12:20} height="0.6" fill="#6b6a63" opacity="0.35"/>
            </g>)}

            {/* SHAFT — drums with joint lines, cracks, missing pieces */}
            <g filter="url(#weathered)">
              <path d={`M${cx-10.5},${topY+12.8} Q${cx-12},80 ${cx-12.5},89.5 L${cx+12.5},89.5 Q${cx+12},80 ${cx+10.5},${topY+12.8} Z`}
                fill="url(#agedGradV)"/>
            </g>

            {/* Drum joint lines — horizontal seams between stone blocks */}
            {[77,81.5,86].filter(y=>y>topY+13).map((jy,ji)=>(
              <line key={ji} x1={cx-11.6} y1={jy} x2={cx+11.6} y2={jy}
                stroke="#4a4943" strokeWidth="0.5" opacity="0.4"/>
            ))}

            {/* Flutes — worn, uneven opacity */}
            {[-10.5,-8.2,-5.9,-3.6,-1.3,1.3,3.6,5.9,8.2,10.5].map((fx,fi)=>{
              const btm=fx*1.19;
              const wear=0.28+((fi*11)%5)*0.09;
              return(
                <g key={fi}>
                  <line x1={cx+fx} y1={topY+13} x2={cx+btm} y2="89.5"
                    stroke="#4a4943" strokeWidth="0.7" opacity={wear}/>
                  <line x1={cx+fx+1.15} y1={topY+13} x2={cx+btm*1.06} y2="89.5"
                    stroke="#e8e2d2" strokeWidth="0.8" opacity={wear*1.4}/>
                </g>
              );
            })}

            {/* Cracks */}
            {dmg===3&&(
              <path d={`M${cx-4},${topY+14} L${cx-2},${topY+22} L${cx-5},${topY+29} L${cx-3},89.5`}
                fill="none" stroke="#3a3934" strokeWidth="0.6" opacity="0.55"/>
            )}
            {dmg===1&&(
              <path d={`M${cx+6},74 L${cx+8},80 L${cx+5},84`}
                fill="none" stroke="#3a3934" strokeWidth="0.5" opacity="0.45"/>
            )}

            {/* Chipped edge bites */}
            {dmg===1&&<path d={`M${cx+10.8},76 L${cx+13},78 L${cx+11},81 Z`} fill="#0a1420" opacity="0.5"/>}
            {dmg===3&&<path d={`M${cx-11.8},82 L${cx-14},84.5 L${cx-11.5},87 Z`} fill="#0a1420" opacity="0.45"/>}
            {dmg===2&&(
              <>
                {/* Jagged broken top */}
                <path d={`M${cx-10.5},${topY+12.8} L${cx-6},${topY+9} L${cx-1},${topY+13.5} L${cx+4},${topY+8} L${cx+8},${topY+12} L${cx+10.5},${topY+10.5} L${cx+10.5},${topY+14} L${cx-10.5},${topY+14} Z`}
                  fill="url(#agedGradV)"/>
                <path d={`M${cx-10.5},${topY+12.8} L${cx-6},${topY+9} L${cx-1},${topY+13.5} L${cx+4},${topY+8} L${cx+8},${topY+12} L${cx+10.5},${topY+10.5}`}
                  fill="none" stroke="#3a3934" strokeWidth="0.7" opacity="0.6"/>
              </>
            )}

            {/* Category tint */}
            <path d={`M${cx-10.5},${topY+12.8} Q${cx-12},80 ${cx-12.5},89.5 L${cx+12.5},89.5 Q${cx+12},80 ${cx+10.5},${topY+12.8} Z`}
              fill={color} opacity="0.05"/>
          </g>);
        })}</svg>

      {/* Content area flanked by side columns */}
      <div style={{position:"relative",display:"flex",alignItems:"stretch"}}>
        {/* Left column */}
        <svg width="26" style={{flexShrink:0,alignSelf:"stretch"}} preserveAspectRatio="none" viewBox="0 0 38 100">
          <defs>
            <linearGradient id="sideGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#7c8697" stopOpacity="0.7"/>
              <stop offset="25%"  stopColor="#e2e8f0" stopOpacity="0.92"/>
              <stop offset="48%"  stopColor="#ffffff" stopOpacity="1"/>
              <stop offset="72%"  stopColor="#c9d1dd" stopOpacity="0.88"/>
              <stop offset="100%" stopColor="#8a94a6" stopOpacity="0.7"/>
            </linearGradient>
          </defs>
          <g filter="url(#weathered)">
            <rect x="1" y="0" width="36" height="100" fill="url(#agedGradV)"/>
          </g>
          <rect x="1" y="0" width="36" height="100" fill={color} opacity="0.05"/>
          {/* Drum joints */}
          <line x1="1" y1="22" x2="37" y2="22" stroke="#4a4943" strokeWidth="0.6" opacity="0.35"/>
          <line x1="1" y1="48" x2="37" y2="48" stroke="#4a4943" strokeWidth="0.6" opacity="0.32"/>
          <line x1="1" y1="74" x2="37" y2="74" stroke="#4a4943" strokeWidth="0.6" opacity="0.3"/>
          {/* Worn flutes */}
          <line x1="4"    y1="0" x2="4"    y2="100" stroke="#3a3934" strokeWidth="0.9" opacity="0.35"/>
          <line x1="7.5"  y1="0" x2="7.5"  y2="100" stroke="#e8e2d2" strokeWidth="1.1" opacity="0.5"/>
          <line x1="11"   y1="0" x2="11"   y2="100" stroke="#4a4943" strokeWidth="0.9" opacity="0.4"/>
          <line x1="14.5" y1="0" x2="14.5" y2="100" stroke="#e8e2d2" strokeWidth="1" opacity="0.42"/>
          <line x1="18"   y1="0" x2="18"   y2="100" stroke="#5f5e57" strokeWidth="0.9" opacity="0.38"/>
          <line x1="21.5" y1="0" x2="21.5" y2="100" stroke="#ddd8c8" strokeWidth="1" opacity="0.45"/>
          <line x1="25"   y1="0" x2="25"   y2="100" stroke="#4a4943" strokeWidth="0.9" opacity="0.35"/>
          <line x1="28.5" y1="0" x2="28.5" y2="100" stroke="#e8e2d2" strokeWidth="0.95" opacity="0.4"/>
          <line x1="32"   y1="0" x2="32"   y2="100" stroke="#4a4943" strokeWidth="0.9" opacity="0.33"/>
          <line x1="35"   y1="0" x2="35"   y2="100" stroke="#3a3934" strokeWidth="0.7" opacity="0.3"/>
          {/* Cracks and chips */}
          <path d="M12,18 L15,32 L11,44 L14,58" fill="none" stroke="#2e2d29" strokeWidth="0.6" opacity="0.35"/>
          <path d="M1,62 L5,65 L1,69 Z" fill="#0a1420" opacity="0.4"/>
          <path d="M37,30 L33,33 L37,37 Z" fill="#0a1420" opacity="0.35"/>>>
        </svg>

        {/* Actual content */}
        <div style={{flex:1,minWidth:0}}>{children}</div>

        {/* Right column */}
        <svg width="26" style={{flexShrink:0,alignSelf:"stretch"}} preserveAspectRatio="none" viewBox="0 0 38 100">
          <rect x="1" y="0" width="36" height="100" fill="url(#sideGrad)"/>
          <rect x="1" y="0" width="36" height="100" fill={color} opacity="0.05"/>
          {/* Doric annulets at top */}
          <rect x="1" y="0" width="36" height="0.8" fill="#8f9aab" opacity="0.55"/>
          <rect x="1" y="1.4" width="36" height="0.7" fill="#8f9aab" opacity="0.45"/>
          {/* 20 flutes — alternating groove shadow and arris highlight */}
          <line x1="4"  y1="0" x2="4"  y2="100" stroke="#5c6675" strokeWidth="0.9" opacity="0.5"/>
          <line x1="7.5" y1="0" x2="7.5" y2="100" stroke="#ffffff" strokeWidth="1.1" opacity="0.72"/>
          <line x1="11" y1="0" x2="11" y2="100" stroke="#6f7a8c" strokeWidth="0.9" opacity="0.52"/>
          <line x1="14.5" y1="0" x2="14.5" y2="100" stroke="#ffffff" strokeWidth="1" opacity="0.68"/>
          <line x1="18" y1="0" x2="18" y2="100" stroke="#8f9aab" strokeWidth="0.9" opacity="0.5"/>
          <line x1="21.5" y1="0" x2="21.5" y2="100" stroke="#ffffff" strokeWidth="1" opacity="0.65"/>
          <line x1="25" y1="0" x2="25" y2="100" stroke="#7c8697" strokeWidth="0.9" opacity="0.5"/>
          <line x1="28.5" y1="0" x2="28.5" y2="100" stroke="#ffffff" strokeWidth="0.95" opacity="0.6"/>
          <line x1="32" y1="0" x2="32" y2="100" stroke="#6f7a8c" strokeWidth="0.9" opacity="0.48"/>
          <line x1="35" y1="0" x2="35" y2="100" stroke="#5c6675" strokeWidth="0.7" opacity="0.42"/>>
        </svg>
      </div>

      {/* Base platform */}
      <svg viewBox="0 0 400 14" preserveAspectRatio="none" style={{width:"100%",height:10,display:"block",marginTop:-2}}>
        {/* STYLOBATE — worn steps with missing chunks */}
        <g filter="url(#weathered)">
          <rect x="0" y="0"   width="400" height="1.2" fill="#e8e2d2" opacity="0.6"/>
          <rect x="0" y="1.2" width="400" height="3.3" fill="url(#agedGrad)"/>
          <rect x="0" y="4.5" width="400" height="0.8" fill="#5f5e57" opacity="0.45"/>
          <rect x="0" y="5.3" width="400" height="3.5" fill="url(#agedGrad)" opacity="0.85"/>
          <rect x="0" y="8.8" width="400" height="0.8" fill="#5f5e57" opacity="0.4"/>
          <rect x="0" y="9.6" width="400" height="4.4" fill="url(#agedGrad)" opacity="0.75"/>
        </g>
        {/* Missing step chunks */}
        <rect x="62" y="0" width="14" height="4.5" fill="#0a1420" opacity="0.45"/>
        <rect x="188" y="5.3" width="10" height="3.5" fill="#0a1420" opacity="0.4"/>
        <rect x="298" y="9.6" width="18" height="4.4" fill="#0a1420" opacity="0.35"/>
        {/* Cracks across the platform */}
        <path d="M120,0 L124,5 L119,9.6 L123,14" fill="none" stroke="#3a3934" strokeWidth="0.6" opacity="0.4"/>
        <path d="M256,1 L252,6 L257,10 L253,14" fill="none" stroke="#3a3934" strokeWidth="0.5" opacity="0.35"/>
        <rect x="0" y="0"   width="400" height="14" fill={color} opacity="0.04"/>
      </svg>
    </div>
  );
}

// ── STARFIELD SUBMENU ──
function StarField({section,color,icon,label,onBack,onSelect}){
  const canvasRef=React.useRef(null);
  const stateRef=React.useRef(null);
  const rafRef=React.useRef(null);

  React.useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas) return;
    const ctx=canvas.getContext("2d");
    const dpr=window.devicePixelRatio||1;
    let W=canvas.offsetWidth,H=canvas.offsetHeight;
    canvas.width=W*dpr; canvas.height=H*dpr; ctx.scale(dpr,dpr);

    const cats=section.categories;
    const N=cats.length;

    // 3D spherical distribution using golden angle (Fibonacci sphere)
    const stars=cats.map((cat,i)=>{
      const golden=Math.PI*(3-Math.sqrt(5));
      const yNorm=N>1?1-(i/(N-1))*2:0;
      const rAtY=Math.sqrt(Math.max(0,1-yNorm*yNorm));
      const theta=golden*i;
      return{
        cat,i,
        bx:Math.cos(theta)*rAtY, by:yNorm, bz:Math.sin(theta)*rAtY,
        x:0,y:0,z:0,depth:1,size:0,
        hovered:false,scale:1,
        twinkle:Math.random()*Math.PI*2,
        spin:Math.random()*Math.PI*2,
      };
    });
    stateRef.current={stars};

    // Draw a radiant 3D sun with corona and rays
    const drawStar3D=(s,t)=>{
      const r=s.size*s.scale;
      if(r<1) return;
      const alpha=Math.min(1,0.4+s.depth*0.5);
      const puls=0.9+Math.sin(s.twinkle)*0.1;

      ctx.save();
      ctx.translate(s.x,s.y);

      // ── OUTER CORONA — soft radial haze ──
      const corona=ctx.createRadialGradient(0,0,r*0.5,0,0,r*3.4);
      corona.addColorStop(0,   color+Math.round(90*alpha*puls).toString(16).padStart(2,"0"));
      corona.addColorStop(0.35,color+Math.round(40*alpha).toString(16).padStart(2,"0"));
      corona.addColorStop(1,   "transparent");
      ctx.beginPath();ctx.arc(0,0,r*3.4,0,Math.PI*2);
      ctx.fillStyle=corona;ctx.fill();

      // ── RADIANT RAYS — long and short alternating, rotating ──
      ctx.save();
      ctx.rotate(s.spin+t*0.35);
      const RAYS=16;
      for(let i=0;i<RAYS;i++){
        const a=(i/RAYS)*Math.PI*2;
        const long=i%2===0;
        const len=r*(long?2.9:1.9)*puls;
        const w=r*(long?0.16:0.10);
        const rg=ctx.createLinearGradient(
          Math.cos(a)*r*0.85, Math.sin(a)*r*0.85,
          Math.cos(a)*len,    Math.sin(a)*len
        );
        rg.addColorStop(0,"rgba(255,255,255,"+(0.75*alpha)+")");
        rg.addColorStop(0.3,color+Math.round(190*alpha).toString(16).padStart(2,"0"));
        rg.addColorStop(1,"transparent");
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*r*0.8 - Math.sin(a)*w, Math.sin(a)*r*0.8 + Math.cos(a)*w);
        ctx.lineTo(Math.cos(a)*len, Math.sin(a)*len);
        ctx.lineTo(Math.cos(a)*r*0.8 + Math.sin(a)*w, Math.sin(a)*r*0.8 - Math.cos(a)*w);
        ctx.closePath();
        ctx.fillStyle=rg;ctx.fill();
      }
      ctx.restore();

      // ── COUNTER-ROTATING SECONDARY RAYS ──
      ctx.save();
      ctx.rotate(-s.spin-t*0.22);
      for(let i=0;i<8;i++){
        const a=(i/8)*Math.PI*2+0.2;
        const len=r*2.2*puls;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*r*0.9,Math.sin(a)*r*0.9);
        ctx.lineTo(Math.cos(a)*len,Math.sin(a)*len);
        ctx.strokeStyle=color+Math.round(110*alpha).toString(16).padStart(2,"0");
        ctx.lineWidth=Math.max(0.6,r*0.05);
        ctx.stroke();
      }
      ctx.restore();

      // ── SOLAR DISC — 3D lit sphere ──
      const disc=ctx.createRadialGradient(-r*0.22,-r*0.22,r*0.03,0,0,r);
      disc.addColorStop(0,   "rgba(255,255,255,"+(0.98*alpha)+")");
      disc.addColorStop(0.25,"rgba(255,250,220,"+(0.92*alpha)+")");
      disc.addColorStop(0.5, color+Math.round(240*alpha).toString(16).padStart(2,"0"));
      disc.addColorStop(0.85,color+Math.round(170*alpha).toString(16).padStart(2,"0"));
      disc.addColorStop(1,   "rgba(0,0,0,"+(0.32*alpha)+")");
      ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);
      ctx.fillStyle=disc;ctx.fill();

      // Surface granulation — subtle plasma texture
      ctx.save();
      ctx.beginPath();ctx.arc(0,0,r*0.96,0,Math.PI*2);ctx.clip();
      for(let i=0;i<5;i++){
        const ga=(i/5)*Math.PI*2+t*0.3;
        const gd=r*(0.3+((i*7)%3)*0.16);
        const gr=r*(0.18+((i*5)%3)*0.07);
        const gg=ctx.createRadialGradient(Math.cos(ga)*gd,Math.sin(ga)*gd,0,Math.cos(ga)*gd,Math.sin(ga)*gd,gr);
        gg.addColorStop(0,"rgba(255,255,255,"+(0.16*alpha)+")");
        gg.addColorStop(1,"transparent");
        ctx.beginPath();ctx.arc(Math.cos(ga)*gd,Math.sin(ga)*gd,gr,0,Math.PI*2);
        ctx.fillStyle=gg;ctx.fill();
      }
      ctx.restore();

      // Chromosphere rim — bright edge glow
      ctx.beginPath();ctx.arc(0,0,r*0.99,0,Math.PI*2);
      ctx.strokeStyle="rgba(255,255,255,"+((s.hovered?0.85:0.5)*alpha)+")";
      ctx.lineWidth=Math.max(0.9,r*0.07);ctx.stroke();

      // Core hotspot
      const core=ctx.createRadialGradient(-r*0.12,-r*0.12,0,-r*0.12,-r*0.12,r*0.5);
      core.addColorStop(0,"rgba(255,255,255,"+(0.9*alpha*puls)+")");
      core.addColorStop(1,"transparent");
      ctx.beginPath();ctx.arc(-r*0.12,-r*0.12,r*0.5,0,Math.PI*2);
      ctx.fillStyle=core;ctx.fill();

      ctx.restore();

      // ── LABEL — only front-facing ──
      if(s.depth>0.88){
        ctx.save();
        ctx.globalAlpha=Math.min(1,(s.depth-0.88)*3.5);
        ctx.font="bold "+Math.max(7,(r*0.34)|0)+"px monospace";
        ctx.fillStyle=s.hovered?"#ffffff":color;
        ctx.shadowColor="rgba(0,0,0,0.9)";ctx.shadowBlur=5;
        ctx.textAlign="center";ctx.textBaseline="top";
        const words=s.cat.label.split(" ");
        const txt=(!s.hovered&&words.length>2)
          ? words.slice(0,2).join(" ")
          : s.cat.label.toUpperCase();
        ctx.fillText(txt,s.x,s.y+r*2.0);
        ctx.restore();
      }
    };

    // Central hub sphere (the parent category)
    const drawHub=(cx,cy,t)=>{
      const hs=Math.min(W,H)*0.048*(1+Math.sin(t*1.2)*0.05);
      // Glow
      const gl=ctx.createRadialGradient(cx,cy,0,cx,cy,hs*2.2);
      gl.addColorStop(0,color+"33");gl.addColorStop(1,"transparent");
      ctx.beginPath();ctx.arc(cx,cy,hs*2.2,0,Math.PI*2);
      ctx.fillStyle=gl;ctx.fill();
      // Rotating ring
      ctx.save();ctx.translate(cx,cy);ctx.rotate(t*0.35);
      ctx.beginPath();ctx.arc(0,0,hs*1.5,0,Math.PI*2);
      ctx.strokeStyle=color+"55";ctx.lineWidth=1.2;
      ctx.setLineDash([5,6]);ctx.stroke();ctx.setLineDash([]);
      ctx.restore();
      // 3D sphere body
      const g=ctx.createRadialGradient(cx-hs*0.35,cy-hs*0.35,hs*0.05,cx,cy,hs*1.05);
      g.addColorStop(0,"rgba(255,255,255,0.9)");
      g.addColorStop(0.2,color+"ee");
      g.addColorStop(0.6,color+"bb");
      g.addColorStop(1,"rgba(0,0,0,0.5)");
      ctx.beginPath();ctx.arc(cx,cy,hs,0,Math.PI*2);
      ctx.fillStyle=g;ctx.fill();
      ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke();
      // Icon
      ctx.font=((hs*0.8)|0)+"px sans-serif";
      ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText(icon,cx,cy);
    };

    let t=0,lastTime=performance.now(),lastFrame=0;
    const loop=(now)=>{
      rafRef.current=requestAnimationFrame(loop);
      if(now-lastFrame<33) return;
      lastFrame=now;
      const dt=Math.min((now-lastTime)/1000,0.06);
      lastTime=now; t+=dt;
      ctx.clearRect(0,0,W,H);
      const cx=W/2,cy=H/2;
      const S=stateRef.current;
      const R=Math.min(W,H)*0.40;
      const FOV=3.0;
      const rotY=t*0.64;
      const tiltX=0.40;
      const wob=Math.sin(t*0.8)*0.16;

      S.stars.forEach(s=>{
        const cY=Math.cos(rotY),sY=Math.sin(rotY);
        const px=s.bx*cY - s.bz*sY;
        const pz=s.bx*sY + s.bz*cY;
        const py=s.by;
        const tx=tiltX+wob;
        const cX=Math.cos(tx),sX=Math.sin(tx);
        const py2=py*cX - pz*sX;
        const pz2=py*sX + pz*cX;
        const persp=FOV/(FOV-pz2);
        s.x=cx+px*R*persp;
        s.y=cy+py2*R*persp*0.9;
        s.z=pz2;
        s.depth=persp;
        s.size=Math.min(W,H)*0.039*Math.pow(persp,2.2);
        s.scale+=((s.hovered?1.45:1)-s.scale)*Math.min(1,dt*9);
        s.twinkle+=dt*2.2; s.spin+=dt*0.5;
      });

      const sorted=[...S.stars].sort((a,b)=>a.z-b.z);

      // Back stars
      sorted.filter(s=>s.z<0).forEach(s=>drawStar3D(s,t));
      // Connection lines from hub to hovered
      S.stars.forEach(s=>{
        if(s.hovered){
          const g=ctx.createLinearGradient(cx,cy,s.x,s.y);
          g.addColorStop(0,color+"77");g.addColorStop(1,color+"22");
          ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(s.x,s.y);
          ctx.strokeStyle=g;ctx.lineWidth=1.2;ctx.stroke();
        }
      });
      // Hub in the middle
      drawHub(cx,cy,t);
      // Front stars on top
      sorted.filter(s=>s.z>=0).forEach(s=>drawStar3D(s,t));
    };
    rafRef.current=requestAnimationFrame(loop);

    const pos=(e)=>{const rc=canvas.getBoundingClientRect();const tc=e.touches?.[0];return tc?[tc.clientX-rc.left,tc.clientY-rc.top]:[e.clientX-rc.left,e.clientY-rc.top];};
    const onMove=(e)=>{const[mx,my]=pos(e);let best=null,bd=1e9;stateRef.current.stars.forEach(s=>{s.hovered=false;const dx=mx-s.x,dy=my-s.y;const d=Math.sqrt(dx*dx+dy*dy);if(d<s.size*1.6&&s.z>-0.3&&d<bd){bd=d;best=s;}});if(best)best.hovered=true;};
    const onTap=(e)=>{const[mx,my]=pos(e);let best=null,bd=1e9;stateRef.current.stars.forEach(s=>{const dx=mx-s.x,dy=my-s.y;const d=Math.sqrt(dx*dx+dy*dy);if(d<s.size*1.8&&s.z>-0.3&&d<bd){bd=d;best=s;}});if(best)onSelect({...best.cat,sectionColor:color});};
    const resize=()=>{const d=window.devicePixelRatio||1;W=canvas.offsetWidth;H=canvas.offsetHeight;canvas.width=W*d;canvas.height=H*d;ctx.setTransform(1,0,0,1,0,0);ctx.scale(d,d);};
    window.addEventListener("resize",resize);
    canvas.addEventListener("mousemove",onMove);
    canvas.addEventListener("touchmove",onMove,{passive:true});
    canvas.addEventListener("click",onTap);
    canvas.addEventListener("touchend",onTap);
    return()=>{cancelAnimationFrame(rafRef.current);window.removeEventListener("resize",resize);};
  },[section,color,icon]);

  return(
    <div style={{position:"relative",width:"100%",height:"calc(100vh - 70px)",animation:"fadeIn 0.35s ease"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 4px 0"}}>
        <button onClick={onBack} style={{background:"rgba(0,8,20,0.8)",border:"1px solid "+color+"44",color:color,padding:"5px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontFamily:"monospace"}}>← VOLVER</button>
        <span style={{fontFamily:"monospace",fontSize:12,color:color,textShadow:"0 0 8px "+color,letterSpacing:"0.1em"}}>{icon} {label}</span>
        <span style={{fontFamily:"monospace",fontSize:10,color:"#444",marginLeft:"auto"}}>// TOCA UNA ESTRELLA</span>
      </div>
      <canvas ref={canvasRef} style={{width:"100%",height:"calc(100% - 28px)",cursor:"pointer",touchAction:"none",display:"block"}}/>
    </div>
  );
}

function OrbitalHome({onSelect}){
  const canvasRef=React.useRef(null);
  const stateRef=React.useRef(null);
  const rafRef=React.useRef(null);
  const [subSpheres,setSubSpheres]=React.useState(null);
  const [selected,setSelected]=React.useState(null);

  const MAIN_ORBS=SECTIONS.map((sec,i)=>({
    label:sec.label.split("//")[1]?.trim()||sec.label,
    color:sec.color, section:sec,
    icon:["🏠","⚡","🚗","⚙️","💻","🌿","⚕️","🎨","📜","⚖️","⚛️","💹","🧠","📖","⚔️","🛡️"][i]||"🔵"
  }));

  React.useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas) return;
    const ctx=canvas.getContext("2d",{alpha:true,desynchronized:false});
    // Handle high-DPI screens for crisp rendering
    const dpr=window.devicePixelRatio||1;
    let W=canvas.offsetWidth, H=canvas.offsetHeight;
    canvas.width=W*dpr; canvas.height=H*dpr;
    ctx.scale(dpr,dpr);
    const N=MAIN_ORBS.length;

    // 3D orbital setup — spherical distribution using golden angle
    const orbs=MAIN_ORBS.map((o,i)=>{
      const golden=Math.PI*(3-Math.sqrt(5));
      const yNorm=1-(i/(N-1))*2;           // -1 .. 1
      const rAtY=Math.sqrt(1-yNorm*yNorm); // ring radius at that latitude
      const theta=golden*i;
      return {...o,i,
        // Base position on unit sphere
        bx:Math.cos(theta)*rAtY, by:yNorm, bz:Math.sin(theta)*rAtY,
        phase:theta,
        x:0,y:0,z:0,depth:1,
        size:0, hovered:false, scale:1,
      };
    });
    stateRef.current={orbs};

    // Central AI avatar — abstract geometric polyhedron
    const drawAvatar=(cx,cy,t)=>{
      const s=Math.min(W,H)*0.062*(1+Math.sin(t*0.8)*0.05);
      // Outer glow
      const g=ctx.createRadialGradient(cx,cy,0,cx,cy,s*2.4);
      g.addColorStop(0,"rgba(0,207,255,0.18)");
      g.addColorStop(1,"transparent");
      ctx.beginPath();ctx.arc(cx,cy,s*2.4,0,Math.PI*2);
      ctx.fillStyle=g;ctx.fill();
      // Counter-rotating rings
      [[1.55,0.45,"rgba(0,207,255,0.32)"],[1.15,-0.75,"rgba(199,125,255,0.28)"]].forEach(([rr,sp,col],ri)=>{
        ctx.save();ctx.translate(cx,cy);ctx.rotate(t*sp);
        ctx.beginPath();ctx.arc(0,0,s*rr,0,Math.PI*2);
        ctx.strokeStyle=col;ctx.lineWidth=1.5;
        ctx.setLineDash([6,5]);ctx.stroke();ctx.setLineDash([]);
        if(ri===0){
          ctx.fillStyle="rgba(0,207,255,0.7)";
          for(let i=0;i<6;i++){
            const a=(i/6)*Math.PI*2;
            ctx.beginPath();ctx.arc(Math.cos(a)*s*rr,Math.sin(a)*s*rr,2,0,Math.PI*2);ctx.fill();
          }
        }
        ctx.restore();
      });
      // Central polyhedron
      ctx.save();ctx.translate(cx,cy);
      const rot=t*0.6;
      const pts=Array.from({length:6},(_,i)=>{
        const a=(i/6)*Math.PI*2+rot;
        const r=i%2===0?s:s*0.55;
        return[Math.cos(a)*r,Math.sin(a)*r];
      });
      const sg=ctx.createRadialGradient(0,0,0,0,0,s);
      sg.addColorStop(0,"rgba(0,207,255,0.95)");
      sg.addColorStop(0.5,"rgba(100,50,255,0.65)");
      sg.addColorStop(1,"rgba(0,207,255,0.12)");
      ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);
      pts.forEach(p=>ctx.lineTo(p[0],p[1]));ctx.closePath();
      ctx.fillStyle=sg;ctx.fill();
      ctx.strokeStyle="rgba(0,207,255,0.9)";ctx.lineWidth=1.5;ctx.stroke();
      ctx.strokeStyle="rgba(199,125,255,"+(0.18+Math.sin(t)*0.06)+")";ctx.lineWidth=0.7;
      for(let i=0;i<6;i+=2){
        ctx.beginPath();ctx.moveTo(0,0);
        ctx.lineTo(pts[i][0],pts[i][1]);
        ctx.lineTo(pts[(i+1)%6][0],pts[(i+1)%6][1]);
        ctx.closePath();ctx.stroke();
      }
      ctx.beginPath();ctx.arc(0,0,s*0.1,0,Math.PI*2);
      ctx.fillStyle="white";ctx.fill();
      ctx.restore();
    };

    // Draw a shaded 3D sphere with specular highlight and terminator
    const drawSphere3D=(o,t)=>{
      const r=o.size*o.scale;
      if(r<1) return;
      const lx=-0.42, ly=-0.42;  // light direction

      // Ambient glow behind (stronger when closer)
      if(o.hovered||o.depth>1.15){
        const gl=ctx.createRadialGradient(o.x,o.y,r*0.6,o.x,o.y,r*2.4);
        gl.addColorStop(0,o.color+(o.hovered?"55":"28"));
        gl.addColorStop(1,"transparent");
        ctx.beginPath();ctx.arc(o.x,o.y,r*2.4,0,Math.PI*2);
        ctx.fillStyle=gl;ctx.fill();
      }

      // Main sphere body — offset radial gradient creates the 3D lit look
      const g=ctx.createRadialGradient(
        o.x+lx*r*0.55, o.y+ly*r*0.55, r*0.05,
        o.x, o.y, r*1.05
      );
      g.addColorStop(0,   "rgba(255,255,255,0.92)");
      g.addColorStop(0.18, o.color+"ee");
      g.addColorStop(0.55, o.color+"bb");
      g.addColorStop(0.82, o.color+"55");
      g.addColorStop(1,   "rgba(0,0,0,0.55)");
      ctx.beginPath();ctx.arc(o.x,o.y,r,0,Math.PI*2);
      ctx.fillStyle=g;ctx.fill();

      // Terminator shadow — dark crescent on the unlit side
      const sh=ctx.createRadialGradient(
        o.x-lx*r*0.75, o.y-ly*r*0.75, r*0.1,
        o.x, o.y, r*1.1
      );
      sh.addColorStop(0,"rgba(0,0,0,0.42)");
      sh.addColorStop(0.7,"rgba(0,0,0,0.08)");
      sh.addColorStop(1,"transparent");
      ctx.beginPath();ctx.arc(o.x,o.y,r,0,Math.PI*2);
      ctx.fillStyle=sh;ctx.fill();

      // Rim light — thin bright edge on the far side
      ctx.beginPath();
      ctx.arc(o.x,o.y,r*0.97,Math.PI*0.15,Math.PI*1.15);
      ctx.strokeStyle="rgba(255,255,255,"+(0.25*o.depth)+")";
      ctx.lineWidth=Math.max(0.8,r*0.06);ctx.stroke();

      // Specular highlight — small bright spot
      const sp=ctx.createRadialGradient(
        o.x+lx*r*0.5, o.y+ly*r*0.5, 0,
        o.x+lx*r*0.5, o.y+ly*r*0.5, r*0.32
      );
      sp.addColorStop(0,"rgba(255,255,255,0.85)");
      sp.addColorStop(1,"transparent");
      ctx.beginPath();
      ctx.arc(o.x+lx*r*0.5,o.y+ly*r*0.5,r*0.32,0,Math.PI*2);
      ctx.fillStyle=sp;ctx.fill();

      // Outline
      ctx.beginPath();ctx.arc(o.x,o.y,r,0,Math.PI*2);
      ctx.strokeStyle=o.color+(o.hovered?"ff":"77");
      ctx.lineWidth=o.hovered?2:1;ctx.stroke();

      // Icon — scaled and faded by depth
      ctx.save();
      ctx.globalAlpha=Math.min(1,0.45+o.depth*0.45);
      ctx.font=((r*0.72)|0)+"px sans-serif";
      ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText(o.icon,o.x,o.y-r*0.04);
      ctx.restore();

      // Label — only for front-facing orbs
      if(o.depth>0.85){
        ctx.save();
        ctx.globalAlpha=Math.min(1,(o.depth-0.85)*3.5);
        ctx.font="bold "+Math.max(7,(r*0.30)|0)+"px monospace";
        ctx.fillStyle=o.hovered?"#fff":o.color;
        ctx.shadowColor="rgba(0,0,0,0.8)";ctx.shadowBlur=4;
        ctx.textAlign="center";ctx.textBaseline="top";
        ctx.fillText(o.label,o.x,o.y+r+4);
        ctx.restore();
      }
    };

    let t=0;
    let lastTime=performance.now();
    let lastFrame=0;
    const loop=(now)=>{
      rafRef.current=requestAnimationFrame(loop);
      // Cap at ~30fps to leave CPU headroom for the audio scheduler
      if(now-lastFrame<33) return;
      lastFrame=now;
      const dt=Math.min((now-lastTime)/1000,0.06);
      lastTime=now; t+=dt;

      ctx.clearRect(0,0,W,H);
      const cx=W/2,cy=H/2;
      const S=stateRef.current;
      const R=Math.min(W,H)*0.40;      // sphere radius in px
      const FOV=3.0;                    // perspective strength
      const rotY=t*0.56;                // horizontal rotation
      const tiltX=0.42;                 // fixed tilt for a nicer view
      const wob=Math.sin(t*0.70)*0.14;  // gentle wobble

      S.orbs.forEach(o=>{
        // Rotate base point around Y axis
        const cosY=Math.cos(rotY), sinY=Math.sin(rotY);
        let px=o.bx*cosY - o.bz*sinY;
        let pz=o.bx*sinY + o.bz*cosY;
        let py=o.by;
        // Tilt around X axis (with wobble)
        const tx=tiltX+wob;
        const cosX=Math.cos(tx), sinX=Math.sin(tx);
        const py2=py*cosX - pz*sinX;
        const pz2=py*sinX + pz*cosX;

        // Perspective projection
        const persp=FOV/(FOV-pz2);
        o.x=cx+px*R*persp;
        o.y=cy+py2*R*persp*0.92;
        o.z=pz2;
        o.depth=persp;                       // ~0.7 (back) .. ~1.6 (front)
        o.size=Math.min(W,H)*0.045*Math.pow(persp,2.2);
        o.scale+=(((o.hovered?1.3:1))-o.scale)*Math.min(1,dt*9);
      });

      // Painter's algorithm — draw far orbs first
      const sorted=[...S.orbs].sort((a,b)=>a.z-b.z);

      // Back half
      sorted.filter(o=>o.z<0).forEach(o=>drawSphere3D(o,t));
      // Avatar in the middle of the sphere
      drawAvatar(cx,cy,t);
      // Front half on top
      sorted.filter(o=>o.z>=0).forEach(o=>drawSphere3D(o,t));
    };
    rafRef.current=requestAnimationFrame(loop);

    const pos=(e)=>{const r=canvas.getBoundingClientRect();const tc=e.touches?.[0];return tc?[tc.clientX-r.left,tc.clientY-r.top]:[e.clientX-r.left,e.clientY-r.top];};
    const onMove=(e)=>{const[mx,my]=pos(e);let best=null,bd=1e9;stateRef.current.orbs.forEach(o=>{o.hovered=false;const dx=mx-o.x,dy=my-o.y;const d=Math.sqrt(dx*dx+dy*dy);if(d<o.size*1.5&&o.z>-0.3&&d<bd){bd=d;best=o;}});if(best)best.hovered=true;};
    const onTap=(e)=>{const[mx,my]=pos(e);let best=null,bd=1e9;stateRef.current.orbs.forEach(o=>{const dx=mx-o.x,dy=my-o.y;const d=Math.sqrt(dx*dx+dy*dy);if(d<o.size*1.7&&o.z>-0.3&&d<bd){bd=d;best=o;}});if(best){setSelected(best);setSubSpheres(best.section);}};
    const resize=()=>{
      const d=window.devicePixelRatio||1;
      W=canvas.offsetWidth; H=canvas.offsetHeight;
      canvas.width=W*d; canvas.height=H*d;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.scale(d,d);
    };
    window.addEventListener("resize",resize);
    canvas.addEventListener("mousemove",onMove);
    canvas.addEventListener("touchmove",onMove,{passive:true});
    canvas.addEventListener("click",onTap);
    canvas.addEventListener("touchend",onTap);
    return()=>{
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize",resize);
      canvas.removeEventListener("mousemove",onMove);
      canvas.removeEventListener("touchmove",onMove);
      canvas.removeEventListener("click",onTap);
      canvas.removeEventListener("touchend",onTap);
    };
  },[subSpheres]);

  if(subSpheres) return(
    <StarField section={subSpheres} color={selected?.color} icon={selected?.icon}
      label={selected?.label} onBack={()=>setSubSpheres(null)} onSelect={onSelect}/>
  );

  return(
    <div style={{position:"relative",width:"100%",height:"calc(100vh - 70px)"}}>
      <p style={{fontFamily:"monospace",fontSize:10,color:"#444",letterSpacing:"0.15em",textAlign:"center",paddingTop:6}}>// TOCA UNA ESFERA PARA EXPLORAR</p>
      <canvas ref={canvasRef} style={{width:"100%",height:"calc(100% - 24px)",cursor:"pointer",touchAction:"none",display:"block"}}/>
    </div>
  );
}

function CatCard({cat,color,onClick}){
  const [hov,setHov]=useState(false);
  const ico=ICONS[cat.id]||ICONS.otro;
  return(
    <button style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,padding:"20px 12px 14px",border:`1px solid ${hov?color:"rgba(255,255,255,0.07)"}`,borderRadius:4,cursor:"pointer",transition:"all 0.2s ease",background:hov?"rgba(0,15,0,0.88)":"rgba(0,8,0,0.72)",transform:hov?"translateY(-2px)":"none",position:"relative",overflow:"hidden",boxShadow:hov?`0 0 18px ${color}44, inset 0 0 12px ${color}11`:"none"}}
      onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
      <span style={{position:"absolute",top:0,left:0,width:8,height:8,borderTop:`1px solid ${color}`,borderLeft:`1px solid ${color}`,opacity:hov?1:0.4}}/>
      <span style={{position:"absolute",top:0,right:0,width:8,height:8,borderTop:`1px solid ${color}`,borderRight:`1px solid ${color}`,opacity:hov?1:0.4}}/>
      <span style={{position:"absolute",bottom:0,left:0,width:8,height:8,borderBottom:`1px solid ${color}`,borderLeft:`1px solid ${color}`,opacity:hov?1:0.4}}/>
      <span style={{position:"absolute",bottom:0,right:0,width:8,height:8,borderBottom:`1px solid ${color}`,borderRight:`1px solid ${color}`,opacity:hov?1:0.4}}/>
      <div style={{width:40,height:40,display:"flex",alignItems:"center",justifyContent:"center",filter:hov?`drop-shadow(0 0 8px ${color})`:"drop-shadow(0 0 2px rgba(255,255,255,0.15))",transition:"filter 0.25s"}}>
        <CyberIcon d={ico.d} d2={ico.d2} color={color} size={30} gradId={`mg_${cat.id}`}/>
      </div>
      <span style={{fontSize:11,fontWeight:"700",fontFamily:"monospace",textAlign:"center",color:hov?color:"#c8ffd4",transition:"color 0.2s",letterSpacing:"0.04em",lineHeight:1.3,textShadow:hov?`0 0 8px ${color}`:"0 0 6px rgba(0,255,65,0.3)"}}>
        {cat.label.toUpperCase()}
      </span>
    </button>
  );
}

export default function Maestro(){
  const [screen,setScreen]=useState("home");
  const [selectedCategory,setSelectedCategory]=useState(null);
  const [problem,setProblem]=useState("");
  const [guide,setGuide]=useState(null);
  const [loading,setLoading]=useState(false);
  const [completedSteps,setCompletedSteps]=useState([]);
  const [search,setSearch]=useState("");
  const [history,setHistory]=useState(()=>{
    try{const s=localStorage.getItem("maestro_history")||sessionStorage.getItem("maestro_history");return s?JSON.parse(s):[];}catch(e){return [];}
  });
  const [viewHistory,setViewHistory]=useState(false);
  const [aiProvider,setAiProvider]=useState("claude");
  const [apiKeys,setApiKeys]=useState({claude:"",gemini:""});
  const [showKeys,setShowKeys]=useState(false);
  const [autoSpoken,setAutoSpoken]=useState(false);
  const [rating,setRating]=useState(null);
  const [darkMode,setDarkMode]=useState(false);
  const [lang,setLang]=useState("es");
  const [level,setLevel]=useState("normal"); // "simple" | "normal" | "experto"
  const [points,setPoints]=useState(0);
  const { listening, speaking, startListening, stopListening, speak, stopSpeaking } = useSpeech();

  // Speak the welcome question once on first interaction
  React.useEffect(()=>{
    if(autoSpoken) return;
    const greet=()=>{
      if(autoSpoken) return;
      setAutoSpoken(true);
      setTimeout(()=>{
        speak("Bienvenido a Maestro. ¿Qué problema necesitas resolver? Elige una esfera de conocimiento o pulsa el micrófono para hablar.");
      },600);
      window.removeEventListener("pointerdown",greet);
      window.removeEventListener("keydown",greet);
    };
    // Try immediately (works if browser allows), otherwise wait for first tap
    const timer=setTimeout(()=>{
      try{
        if(window.speechSynthesis&&!autoSpoken){
          setAutoSpoken(true);
          speak("Bienvenido a Maestro. ¿Qué problema necesitas resolver? Elige una esfera de conocimiento o pulsa el micrófono para hablar.");
        }
      }catch(e){}
    },900);
    window.addEventListener("pointerdown",greet,{once:true});
    window.addEventListener("keydown",greet,{once:true});
    return()=>{
      clearTimeout(timer);
      window.removeEventListener("pointerdown",greet);
      window.removeEventListener("keydown",greet);
    };
  },[autoSpoken,speak]);
  const {playing,start,stop}=useMatrixAudio();

  const filtered=search.trim()?ALL_CATS.filter(c=>c.label.toLowerCase().includes(search.toLowerCase())||c.sectionLabel.toLowerCase().includes(search.toLowerCase())):null;

  const handleCategory=(cat)=>{setSelectedCategory(cat);setScreen("describe");setSearch("");setViewHistory(false);};

  const fetchGuide=async()=>{
    if(!problem.trim()) return;
    setLoading(true);setScreen("guide");setCompletedSteps([]);setGuide(null);
    const lvlStr=level==="simple"?"Use very simple language for beginners, avoid technical terms, max 5 steps":level==="experto"?"Use technical professional language with advanced detail, 7-8 steps":"Use clear practical language, 5-7 steps";
    const sys="You are a universal expert. Respond ONLY with valid JSON. Keys: titulo, dificultad (Facil/Moderado/Dificil/Experto), tiempo, herramientas (array), pasos (array of {titulo,descripcion,consejo}), advertencia, cuando_llamar_profesional. "+lvlStr+". In Spanish.";
    const usr="Categoria: "+selectedCategory.label+". Consulta: "+problem+". Solo JSON.";
    const parse=(raw)=>{let p=null;try{p=JSON.parse(raw);}catch(e){}if(!p){try{const clean=raw.replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();p=JSON.parse(clean);}catch(e){}}if(!p){try{const m=raw.match(/\{[\s\S]*\}/);if(m)p=JSON.parse(m[0]);}catch(e){}}return p;};
    try{
      let raw="";
      if(aiProvider==="claude"){
        const h={"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"};
        if(apiKeys.claude) h["x-api-key"]=apiKeys.claude;
        const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:h,body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:4000,system:sys,messages:[{role:"user",content:usr}]})});
        if(!res.ok){const e=await res.json().catch(()=>({}));setGuide({error:true,msg:"Claude Error "+res.status+": "+JSON.stringify(e).slice(0,200)});return;}
        const data=await res.json();
        raw=data.content.map(b=>b.text||"").join("").trim();
      } else {
        if(!apiKeys.gemini){setGuide({error:true,msg:"⚠️ Añade tu API Key de Gemini pulsando ⚙️. Es gratis en aistudio.google.com"});return;}
        // Model names change over time; try current ones in order until one works.
        const GEMINI_MODELS=["gemini-2.5-flash","gemini-2.0-flash","gemini-flash-latest","gemini-2.5-pro"];
        let res=null,lastErr="";
        for(const m of GEMINI_MODELS){
          res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+m+":generateContent?key="+apiKeys.gemini,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents:[{parts:[{text:usr}]}],generationConfig:{maxOutputTokens:4000}})});
          if(res.ok) break;
          const e=await res.json().catch(()=>({}));
          lastErr="Gemini Error "+res.status+": "+JSON.stringify(e).slice(0,200);
          if(res.status!==404) break;   // only a missing model is worth retrying
        }
        if(!res||!res.ok){setGuide({error:true,msg:lastErr||"Gemini no respondió."});return;}
        const data=await res.json();
        raw=(data&&data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts&&data.candidates[0].content.parts[0]&&data.candidates[0].content.parts[0].text)||"";
      }
      const parsed=parse(raw);
      if(!parsed){setGuide({error:true,msg:"Error al parsear respuesta.",raw:raw.slice(0,300)});return;}
      setGuide(parsed);
      const newEntry={id:Date.now(),category:selectedCategory,problem,guide:parsed,date:new Date().toLocaleDateString("es-ES"),ai:aiProvider};
      setHistory(prev=>{
        const updated=[newEntry,...prev.slice(0,19)];
        try{localStorage.setItem("maestro_history",JSON.stringify(updated));sessionStorage.setItem("maestro_history",JSON.stringify(updated));}catch(e){}
        return updated;
      });
    }catch(e){setGuide({error:true,msg:e.message||"Error de red."});}
    finally{setLoading(false);}
  };

  const toggleStep=i=>setCompletedSteps(prev=>prev.includes(i)?prev.filter(s=>s!==i):[...prev,i]);
  const reset=()=>{setScreen("home");setSelectedCategory(null);setProblem("");setGuide(null);setCompletedSteps([]);setViewHistory(false);setSearch("");};
  const openHistoryItem=item=>{setSelectedCategory(item.category);setGuide(item.guide);setCompletedSteps([]);setViewHistory(false);setScreen("guide");};

  const diffColor={Facil:"#57cc99",Moderado:"#f4a261",Dificil:"#ff6b6b",Experto:"#f72585"};
  const accentColor=selectedCategory?.sectionColor||"#c77dff";

  return(
    <div style={{minHeight:"100vh",maxHeight:"100vh",width:"100vw",overflowX:"hidden",background:screen==="describe"?"linear-gradient(180deg,#0a1420 0%,#0d1a2a 40%,#050a12 100%)":(darkMode?"#f0f4f8":"#000"),color:darkMode?"#111":"#eee",fontFamily:"Georgia,serif",position:"relative",overflowX:"hidden"}}>
      {screen!=="describe" && <MatrixRain/>}
      <header style={{position:"sticky",top:0,zIndex:10,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",width:"100%",boxSizing:"border-box",background:"rgba(0,10,0,0.82)",backdropFilter:"blur(14px)",borderBottom:"1px solid rgba(0,255,65,0.15)"}}>
        <button onClick={reset} style={{display:"flex",alignItems:"center",gap:10,background:"none",border:"none",cursor:"pointer",padding:0}}>
          <span style={{fontSize:26,fontFamily:"monospace",color:"#c77dff",fontWeight:"bold",textShadow:"0 0 12px #c77dff"}}>⬡</span>
          <span style={{fontSize:18,fontWeight:"bold",color:"#eee",letterSpacing:"0.12em",fontFamily:"monospace",textShadow:"0 0 8px rgba(199,125,255,0.4)"}}>MAESTRO</span>
        </button>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {history.length>0&&<button onClick={()=>{setViewHistory(true);setScreen("home");}} style={btnStyle}>📋 ({history.length})</button>}
          {(screen!=="home"||viewHistory)&&<button onClick={reset} style={btnStyle}>← Inicio</button>}
          <div style={{display:"flex",borderRadius:4,overflow:"hidden",border:"1px solid rgba(0,180,255,0.2)"}}>
            <button onClick={()=>setAiProvider("claude")} style={{padding:"5px 10px",background:aiProvider==="claude"?"rgba(199,125,255,0.25)":"transparent",color:aiProvider==="claude"?"#c77dff":"#555",border:"none",cursor:"pointer",fontSize:11,fontFamily:"monospace",fontWeight:"bold"}}>⚡ Claude</button>
            <button onClick={()=>setAiProvider("gemini")} style={{padding:"5px 10px",background:aiProvider==="gemini"?"rgba(66,133,244,0.25)":"transparent",color:aiProvider==="gemini"?"#6ba3f5":"#555",border:"none",cursor:"pointer",fontSize:11,fontFamily:"monospace",fontWeight:"bold"}}>✦ Gemini</button>
          </div>
          <span style={{fontFamily:"monospace",fontSize:11,color:"#00cfff",background:"rgba(0,180,255,0.1)",border:"1px solid rgba(0,180,255,0.2)",padding:"4px 8px",borderRadius:4}}>⭐{points}</span>
          <button onClick={()=>setDarkMode(v=>!v)} style={{...btnStyle}} title="Tema">{darkMode?"🌙":"☀️"}</button>
          <button onClick={()=>setShowKeys(v=>!v)} style={{...btnStyle,fontSize:14}}>⚙️</button>
          <button onClick={()=>playing?stop():start()} style={{...btnStyle,background:playing?"rgba(0,180,255,0.12)":"rgba(0,8,20,0.8)",border:"1px solid "+(playing?"rgba(0,180,255,0.5)":"rgba(0,180,255,0.2)"),color:playing?"#00cfff":"#00aaee",boxShadow:playing?"0 0 10px rgba(0,180,255,0.3)":"none"}}>
            {playing?"◼":"▶"}
          </button>{history.length>0&&<button onClick={()=>{setViewHistory(true);setScreen("home");}} style={{background:"rgba(0,15,0,0.8)",border:"1px solid rgba(0,255,65,0.2)",color:"#00cc33",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"monospace"}}>📋 Historial ({history.length})</button>}
          {(screen!=="home"||viewHistory)&&<button onClick={reset} style={{background:"rgba(0,15,0,0.8)",border:"1px solid rgba(0,255,65,0.2)",color:"#00cc33",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"monospace"}}>← Inicio</button>}
          <button onClick={()=>playing?stop():start()} style={{background:playing?"rgba(0,255,65,0.12)":"rgba(0,15,0,0.8)",border:`1px solid ${playing?"rgba(0,255,65,0.5)":"rgba(0,255,65,0.2)"}`,color:playing?"#00ff41":"#00cc33",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:13,fontFamily:"monospace",boxShadow:playing?"0 0 10px rgba(0,255,65,0.3)":"none",transition:"all 0.2s"}}>
            {playing?"◼ AUDIO ON":"▶ AUDIO"}
          </button>
        </div>
      </header>

      {showKeys&&(
        <div style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowKeys(false)}>
          <div style={{background:"#050d18",border:"1px solid rgba(0,180,255,0.3)",borderRadius:8,padding:28,width:"100%",maxWidth:440}} onClick={e=>e.stopPropagation()}>
            <h3 style={{fontFamily:"monospace",color:"#00cfff",marginBottom:20,fontSize:16}}>⚙️ API Keys</h3>
            <div style={{marginBottom:16}}>
              <label style={{fontFamily:"monospace",fontSize:12,color:"#c77dff",display:"block",marginBottom:6}}>⚡ Claude API Key</label>
              <input type="password" placeholder="sk-ant-..." value={apiKeys.claude} onChange={e=>setApiKeys(k=>({...k,claude:e.target.value}))} style={{width:"100%",background:"rgba(0,0,0,0.5)",border:"1px solid rgba(199,125,255,0.3)",borderRadius:4,color:"#eee",padding:"10px 14px",fontFamily:"monospace",fontSize:13,boxSizing:"border-box"}}/>
              <p style={{fontSize:11,color:"#555",marginTop:4,fontFamily:"monospace"}}>console.anthropic.com</p>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontFamily:"monospace",fontSize:12,color:"#6ba3f5",display:"block",marginBottom:6}}>✦ Gemini API Key — Gratis</label>
              <input type="password" placeholder="AIza..." value={apiKeys.gemini} onChange={e=>setApiKeys(k=>({...k,gemini:e.target.value}))} style={{width:"100%",background:"rgba(0,0,0,0.5)",border:"1px solid rgba(66,133,244,0.3)",borderRadius:4,color:"#eee",padding:"10px 14px",fontFamily:"monospace",fontSize:13,boxSizing:"border-box"}}/>
              <p style={{fontSize:11,color:"#555",marginTop:4,fontFamily:"monospace"}}>aistudio.google.com (gratis)</p>
            </div>
            <button onClick={()=>setShowKeys(false)} style={{width:"100%",padding:"12px",border:"none",borderRadius:4,background:"rgba(0,180,255,0.15)",color:"#00cfff",fontFamily:"monospace",fontSize:14,cursor:"pointer",fontWeight:"bold"}}>✓ Guardar y cerrar</button>
          </div>
        </div>
      )}
      <main style={{position:"relative",zIndex:1,maxWidth:"100%",width:"100%",margin:"0 auto",padding:"16px 12px 80px",boxSizing:"border-box"}}>

        {screen==="home"&&!viewHistory&&(
          <div style={{animation:"fadeIn 0.35s ease"}}>
            <p style={{fontSize:11,color:"#444",letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:8,fontFamily:"monospace"}}>{"//"} SISTEMA ACTIVO · ASISTENTE TÉCNICO IA</p>
            <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:20}}>
              <h1 style={{fontSize:"clamp(26px,5vw,44px)",fontWeight:"bold",lineHeight:1.15,color:"#eee",margin:0,fontFamily:"monospace",textShadow:"0 0 30px rgba(0,180,255,0.25)",flex:1}}>¿Qué problema<br/>necesitas resolver?</h1>
              <button
                onClick={()=>speaking?stopSpeaking():speak("¿Qué problema necesitas resolver? Elige una esfera de conocimiento o pulsa el micrófono para hablar.")}
                title={speaking?"Detener":"Escuchar"}
                style={{width:42,height:42,borderRadius:"50%",border:`2px solid ${speaking?"#ff6b6b":"rgba(0,180,255,0.4)"}`,background:speaking?"rgba(255,80,80,0.18)":"rgba(0,180,255,0.1)",color:speaking?"#ff6b6b":"#00cfff",fontSize:19,cursor:"pointer",flexShrink:0,marginTop:4,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {speaking?"⏹":"🔊"}
              </button>
            </div>
            <div style={{position:"relative",marginBottom:24}}>
              <input style={{width:"100%",background:"rgba(0,8,20,0.8)",border:"1px solid rgba(0,180,255,0.25)",borderRadius:4,color:"#00cfff",fontSize:15,padding:"13px 52px 13px 18px",fontFamily:"monospace",boxSizing:"border-box"}} placeholder="🔍  Busca o pulsa 🎤 para hablar..." value={search} onChange={e=>setSearch(e.target.value)}/>
              <button
                onClick={()=>listening?stopListening():startListening(txt=>{setSearch(txt);})}
                title={listening?"Detener":"Buscar por voz"}
                style={{position:"absolute",top:"50%",right:8,transform:"translateY(-50%)",width:36,height:36,borderRadius:"50%",border:`2px solid ${listening?"#ff6b6b":"rgba(0,180,255,0.45)"}`,background:listening?"rgba(255,80,80,0.22)":"rgba(0,180,255,0.12)",color:listening?"#ff6b6b":"#00cfff",fontSize:17,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",animation:listening?"pulse 1s infinite":"none"}}>
                {listening?"⏹":"🎤"}
              </button>
            </div>
            {listening&&(
              <p style={{fontFamily:"monospace",fontSize:12,color:"#ff6b6b",textAlign:"center",marginBottom:16,animation:"fadeIn 0.2s"}}>
                🔴 Escuchando... habla ahora
              </p>
            )}
            {filtered?(
              <div>
                <p style={{fontSize:13,color:"#666",fontFamily:"monospace",marginBottom:14}}>{filtered.length} resultado(s) para "{search}"</p>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,marginBottom:32}}>
                  {filtered.map(cat=><CatCard key={cat.id} cat={cat} color={cat.sectionColor} onClick={()=>handleCategory(cat)}/>)}
                </div>
              </div>
            ):(
              <OrbitalHome onSelect={handleCategory}/>
            )}
          </div>
        )}

        {viewHistory&&(
          <div style={{animation:"fadeIn 0.35s ease"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24,flexWrap:"wrap"}}>
              <h2 style={{fontSize:22,fontFamily:"monospace",margin:0}}>📋 Historial</h2>
              <div style={{display:"flex",gap:8,marginLeft:"auto",flexWrap:"wrap"}}>
                <span style={{fontFamily:"monospace",fontSize:12,color:"#f9c74f",background:"rgba(249,199,79,0.1)",border:"1px solid rgba(249,199,79,0.2)",padding:"4px 10px",borderRadius:20}}>⭐ {points} pts</span>
                {points>=50&&<span style={{fontFamily:"monospace",fontSize:12,color:"#c77dff",background:"rgba(199,125,255,0.1)",border:"1px solid rgba(199,125,255,0.2)",padding:"4px 10px",borderRadius:20}}>🏆 Experto</span>}
                {history.length>=5&&<span style={{fontFamily:"monospace",fontSize:12,color:"#52b788",background:"rgba(82,183,136,0.1)",border:"1px solid rgba(82,183,136,0.2)",padding:"4px 10px",borderRadius:20}}>🔥 {history.length} guías</span>}
              </div>
            </div>
            {history.length===0?<p style={{color:"#555",fontFamily:"monospace"}}>Sin historial aún.</p>:(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {history.map(item=>(
                  <button key={item.id} onClick={()=>openHistoryItem(item)} style={{display:"flex",alignItems:"center",gap:14,background:"rgba(0,12,0,0.85)",border:"1px solid rgba(0,255,65,0.14)",borderRadius:4,padding:"14px 18px",cursor:"pointer",textAlign:"left"}}>
                    <div style={{width:30,height:30,flexShrink:0}}>{ICONS[item.category.id]&&<CyberIcon d={ICONS[item.category.id].d} d2={ICONS[item.category.id].d2} color={item.category.sectionColor} size={28} gradId={`h_${item.id}`}/>}</div>
                    <div style={{flex:1}}><p style={{margin:0,fontSize:15,fontWeight:"bold",color:"#eee"}}>{item.guide.titulo}</p><p style={{margin:"4px 0 0",fontSize:12,color:"#666",fontFamily:"monospace"}}>{item.category.label} · {item.date}</p></div>
                    <span style={{color:"#555",fontSize:18}}>→</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {screen==="describe"&&(
          <div style={{animation:"fadeIn 0.35s ease"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{width:46,height:46,filter:`drop-shadow(0 0 10px ${accentColor})`}}>
                {selectedCategory&&ICONS[selectedCategory.id]&&<CyberIcon d={ICONS[selectedCategory.id].d} d2={ICONS[selectedCategory.id].d2} color={accentColor} size={32} gradId={`desc_${selectedCategory.id}`}/>}
              </div>
              <div>
                <p style={{fontSize:12,letterSpacing:"0.1em",textTransform:"uppercase",margin:0,fontFamily:"monospace",fontWeight:"bold",color:accentColor}}>{selectedCategory?.label}</p>
                <h2 style={{fontSize:18,margin:"2px 0 0",fontWeight:"bold",fontFamily:"monospace"}}>Describe tu problema</h2>
              </div>
            </div>
            <ColumnFrame color={accentColor}>
            <div style={{background:"rgba(0,8,20,0.88)",border:`1px solid ${accentColor}33`,borderRadius:4,padding:14,display:"flex",flexDirection:"column",gap:12}}>
              <div style={{position:"relative"}}>
                <textarea style={{width:"100%",background:"rgba(0,0,0,0.5)",border:"1px solid rgba(0,180,255,0.2)",borderRadius:4,color:"#00cfff",fontSize:15,padding:"14px 16px",fontFamily:"monospace",resize:"vertical",boxSizing:"border-box",lineHeight:1.6}} placeholder="Describe el problema... o pulsa 🎤" value={problem} onChange={e=>setProblem(e.target.value)} rows={4}/>
                <button onClick={()=>listening?stopListening():startListening(t=>setProblem(p=>p?p+" "+t:t))} style={{position:"absolute",top:10,right:10,width:34,height:34,borderRadius:"50%",border:`2px solid ${listening?"#ff6b6b":"rgba(0,180,255,0.4)"}`,background:listening?"rgba(255,80,80,0.2)":"rgba(0,180,255,0.1)",color:listening?"#ff6b6b":"#00cfff",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{listening?"⏹":"🎤"}</button>
              </div>
              <button style={{padding:"14px 24px",border:"none",borderRadius:4,color:"#000",fontSize:15,fontWeight:"bold",cursor:"pointer",background:accentColor,opacity:problem.trim()?1:0.4,fontFamily:"monospace"}} onClick={fetchGuide} disabled={!problem.trim()}>
                GENERAR GUÍA PASO A PASO →
              </button>
            </div>
            </ColumnFrame>
            <p style={{fontSize:13,color:"#555",fontFamily:"monospace",marginTop:12}}>// Cuanto más detallado seas, mejor será la guía</p>
          </div>
        )}

        {screen==="guide"&&(
          <div style={{animation:"fadeIn 0.35s ease"}}>
            {loading&&(
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"55vh",gap:16}}>
                <div style={{width:48,height:48,border:"3px solid rgba(0,255,65,0.1)",borderTop:`3px solid ${accentColor}`,borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>
                <p style={{fontSize:18,color:"#eee",margin:0,fontFamily:"monospace"}}>Analizando tu problema...</p>
                <p style={{fontSize:13,color:"#555",margin:0,fontFamily:"monospace"}}>// Generando guía con IA</p>
              </div>
            )}
            {!loading&&guide&&!guide.error&&(
              <div>
                <div style={{display:"flex",gap:16,alignItems:"flex-start",marginBottom:16}}>
                  <div style={{width:44,height:44,marginTop:4,flexShrink:0,filter:`drop-shadow(0 0 8px ${accentColor})`}}>
                    {selectedCategory&&ICONS[selectedCategory.id]&&<CyberIcon d={ICONS[selectedCategory.id].d} d2={ICONS[selectedCategory.id].d2} color={accentColor} size={40} gradId={`guide_${selectedCategory.id}`}/>}
                  </div>
                  <div>
                    <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                      <h2 style={{fontSize:21,fontWeight:"bold",margin:"0 0 10px",lineHeight:1.3,fontFamily:"monospace",flex:1}}>{guide.titulo}</h2>
                      <button onClick={()=>speaking?stopSpeaking():speak(guide.pasos?.map((p,i)=>"Paso "+(i+1)+": "+p.titulo+". "+p.descripcion).join(". "))}
                        style={{width:36,height:36,borderRadius:"50%",border:`2px solid ${speaking?"#ff6b6b":"rgba(0,180,255,0.3)"}`,background:speaking?"rgba(255,80,80,0.15)":"rgba(0,180,255,0.08)",color:speaking?"#ff6b6b":"#00cfff",fontSize:18,cursor:"pointer",flexShrink:0}}>
                        {speaking?"⏹":"🔊"}
                      </button>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
                      {guide.dificultad&&<span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:"bold",fontFamily:"monospace",background:(diffColor[guide.dificultad]||"#aaa")+"28",color:diffColor[guide.dificultad]||"#aaa"}}>{guide.dificultad}</span>}
                      <span style={{fontSize:12,color:"#666",fontFamily:"monospace"}}>⏱ {guide.tiempo}</span>
                      <span style={{fontSize:12,color:"#666",fontFamily:"monospace"}}>✅ {completedSteps.length}/{guide.pasos?.length||0} pasos</span>
                    </div>
                  </div>
                </div>

                <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}>
                  <button onClick={()=>window.print()} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 18px",background:"rgba(0,15,0,0.8)",border:"1px solid rgba(0,255,65,0.2)",borderRadius:4,color:"#00cc33",fontSize:12,fontFamily:"monospace",cursor:"pointer",fontWeight:"600"}}>📄 Guardar PDF</button>
                </div>

                <div style={{height:4,background:"rgba(0,255,65,0.08)",borderRadius:2,marginBottom:24,overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:2,transition:"width 0.4s ease",background:accentColor,width:`${guide.pasos?(completedSteps.length/guide.pasos.length)*100:0}%`}}/>
                </div>

                {guide.advertencia&&<div style={{display:"flex",gap:12,background:"rgba(40,0,0,0.88)",border:"1px solid rgba(255,80,80,0.3)",borderRadius:4,padding:"13px 16px",marginBottom:20,alignItems:"flex-start"}}><span>⚠️</span><p style={{margin:0,fontSize:14,color:"#ffb3b3",lineHeight:1.55,fontFamily:"monospace"}}>{guide.advertencia}</p></div>}

                {guide.herramientas?.length>0&&(
                  <div style={{background:"rgba(0,12,0,0.85)",border:"1px solid rgba(0,255,65,0.12)",borderRadius:4,padding:"16px 20px",marginBottom:24}}>
                    <h3 style={{fontSize:13,fontWeight:"bold",color:"#777",margin:"0 0 12px",fontFamily:"monospace",letterSpacing:"0.06em",textTransform:"uppercase"}}>🧰 Herramientas y materiales</h3>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {guide.herramientas.map((t,i)=><span key={i} style={{background:"rgba(0,255,65,0.07)",border:"1px solid rgba(0,255,65,0.15)",borderRadius:4,padding:"4px 12px",fontSize:13,fontFamily:"monospace",color:"#c8ffd4"}}>{t}</span>)}
                    </div>
                  </div>
                )}

                <h3 style={{fontSize:13,fontWeight:"bold",color:"#777",margin:"0 0 14px",fontFamily:"monospace",letterSpacing:"0.06em",textTransform:"uppercase"}}>📋 Pasos a seguir</h3>
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:28}}>
                  {guide.pasos?.map((paso,i)=>{
                    const done=completedSteps.includes(i);
                    const query=encodeURIComponent((selectedCategory?.label||"")+" "+paso.titulo);
                    return(
                      <div key={i} style={{border:`1px solid ${done?accentColor:"rgba(0,255,65,0.12)"}`,borderRadius:4,overflow:"hidden",transition:"all 0.18s",background:done?accentColor+"22":"rgba(0,10,0,0.75)"}}>
                        <div onClick={()=>toggleStep(i)} style={{display:"flex",gap:14,padding:"15px 17px",cursor:"pointer"}}>
                          <div style={{width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:"bold",fontFamily:"monospace",transition:"all 0.18s",flexShrink:0,marginTop:2,background:done?accentColor:"rgba(0,255,65,0.1)",color:done?"#000":"rgba(0,255,65,0.5)"}}>{done?"✓":i+1}</div>
                          <div style={{flex:1}}>
                            <p style={{fontSize:15,fontWeight:"bold",margin:"0 0 6px",lineHeight:1.3,opacity:done?0.45:1,textDecoration:done?"line-through":"none",fontFamily:"monospace"}}>{paso.titulo}</p>
                            <p style={{fontSize:14,margin:"0 0 8px",color:"#c8ffd4",lineHeight:1.6,fontFamily:"monospace",opacity:done?0.35:0.8}}>{paso.descripcion}</p>
                            {paso.consejo&&<div style={{display:"flex",gap:8,background:"rgba(233,196,106,0.07)",border:"1px solid rgba(233,196,106,0.15)",borderRadius:4,padding:"8px 12px",alignItems:"flex-start"}}><span>💡</span><span style={{fontSize:12,color:"#e9c46a",fontFamily:"monospace",lineHeight:1.5}}>{paso.consejo}</span></div>}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:8,padding:"10px 17px 13px 61px",borderTop:"1px solid rgba(0,255,65,0.07)"}}>
                          <a href={`https://www.youtube.com/results?search_query=${query}`} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:4,background:"rgba(255,0,0,0.12)",border:"1px solid rgba(255,0,0,0.25)",color:"#ff6b6b",fontSize:12,fontFamily:"monospace",textDecoration:"none",fontWeight:"600"}}>▶ YouTube</a>
                          <a href={`https://www.google.com/search?tbm=isch&q=${query}`} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:4,background:"rgba(66,133,244,0.12)",border:"1px solid rgba(66,133,244,0.25)",color:"#6ba3f5",fontSize:12,fontFamily:"monospace",textDecoration:"none",fontWeight:"600"}}>🖼 Imágenes</a>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {guide.cuando_llamar_profesional&&<div style={{background:"rgba(0,15,0,0.85)",border:"1px solid rgba(0,255,65,0.1)",borderRadius:4,padding:"16px 20px",marginBottom:28}}><h3 style={{fontSize:13,fontWeight:"bold",color:"#777",margin:"0 0 10px",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:"0.06em"}}>👷 ¿Cuándo llamar a un profesional?</h3><p style={{margin:0,fontSize:14,color:"#aaa",lineHeight:1.6,fontFamily:"monospace"}}>{guide.cuando_llamar_profesional}</p></div>}

                {guide.pasos&&completedSteps.length===guide.pasos.length&&(
                  <div style={{textAlign:"center",background:"rgba(0,30,0,0.92)",border:"1px solid rgba(0,255,65,0.35)",borderRadius:4,padding:"32px 24px"}}>
                    <span style={{fontSize:48}}>🎉</span>
                    <h3 style={{fontSize:22,margin:"12px 0 8px",fontFamily:"monospace"}}>¡Problema resuelto!</h3>
                    <p style={{color:"#888",margin:0,fontFamily:"monospace"}}>Has completado todos los pasos.</p>
                    <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginTop:12}}>
                      <button style={{padding:"12px 18px",border:"1px solid rgba(0,180,255,0.3)",borderRadius:4,color:"#00cfff",fontSize:14,cursor:"pointer",background:"transparent",fontFamily:"monospace"}} onClick={()=>{const t=guide.titulo+(guide.pasos?.map((p,i)=>"\n"+(i+1)+". "+p.titulo+"\n"+p.descripcion)||[]).join("");navigator.clipboard?.writeText(t).then(()=>alert("¡Copiado!"));}}>📋 COPIAR</button>
                      <button style={{padding:"12px 18px",border:"1px solid rgba(0,180,255,0.3)",borderRadius:4,color:"#00cfff",fontSize:14,cursor:"pointer",background:"transparent",fontFamily:"monospace"}} onClick={()=>window.print()}>📄 PDF</button>
                      <button style={{padding:"12px 18px",border:"1px solid rgba(87,204,153,0.3)",borderRadius:4,color:"#57cc99",fontSize:14,cursor:"pointer",background:"transparent",fontFamily:"monospace"}}
                        onClick={()=>{const t=encodeURIComponent("📋 Guía MAESTRO: "+guide.titulo+"\n\n"+(guide.pasos?.map((p,i)=>(i+1)+". "+p.titulo+"\n"+p.descripcion)||[]).join("\n\n"));window.open("https://wa.me/?text="+t,"_blank");}}>
                        💬 WHATSAPP
                      </button>
                    </div>
                    <button style={{padding:"14px 24px",border:"none",borderRadius:4,color:"#000",fontSize:15,fontWeight:"bold",cursor:"pointer",background:accentColor,marginTop:20,fontFamily:"monospace"}} onClick={()=>{setPoints(p=>p+10);reset();}}>RESOLVER OTRO</button>
                  </div>
                )}
              </div>
            )}
            {!loading&&guide?.error&&(
              <div style={{textAlign:"center",padding:40,color:"#ff6b6b",fontFamily:"monospace"}}>
                <span style={{fontSize:40}}>⚠️</span>
                <p style={{fontSize:16,marginTop:12}}>No se pudo generar la guía.</p>
                {guide.msg&&<p style={{fontSize:13,color:"#a05050",maxWidth:400,margin:"0 auto 8px"}}>{guide.msg}</p>}
                {guide.raw&&<pre style={{fontSize:11,color:"#555",maxWidth:400,margin:"0 auto 16px",textAlign:"left",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{guide.raw}</pre>}
                <button style={{padding:"12px 24px",border:"none",borderRadius:4,color:"#000",fontSize:15,fontWeight:"bold",cursor:"pointer",background:"#f4a261",fontFamily:"monospace"}} onClick={()=>setScreen("describe")}>INTENTAR DE NUEVO</button>
              </div>
            )}
          </div>
        )}
      </main>

      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes scan{0%,100%{opacity:0;transform:translateX(-100%);}50%{opacity:1;transform:translateX(100%);}}
        textarea:focus,input:focus{outline:none;border-color:rgba(0,255,65,0.5)!important;box-shadow:0 0 10px rgba(0,255,65,0.15)!important;}
        textarea{color:#00ff41!important;}input{color:#00ff41!important;}
        ::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:#000;}::-webkit-scrollbar-thumb{background:#1a3a1a;border-radius:3px;}
      `}</style>
    </div>
  );
}
  const btnStyle={background:"rgba(0,8,20,0.8)",border:"1px solid rgba(0,180,255,0.2)",color:"#00aaee",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"monospace"};
