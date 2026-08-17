import React, { useState } from "react";

// Low-memory devices (1-2 GB tablets) run out of GPU memory when canvases are
// rendered at full device pixel ratio, which kills the app on launch when it
// is installed as a standalone PWA. Cap the ratio on weak hardware.

// ---------------------------------------------------------------------------
// Crash recorder. When the app is launched as an installed PWA it can die
// before anything is visible, so errors are written to localStorage and can be
// reviewed later from a normal browser tab (see the gear menu).
// ---------------------------------------------------------------------------
(function installCrashLogger(){
  if (typeof window === "undefined" || window.__maestroLogger) return;
  window.__maestroLogger = true;
  const write = (entry) => {
    try {
      const log = JSON.parse(localStorage.getItem("maestro_crashlog") || "[]");
      log.unshift(entry);
      localStorage.setItem("maestro_crashlog", JSON.stringify(log.slice(0, 12)));
    } catch (e) {}
  };
  const ctx = () => ({
    when: new Date().toLocaleString(),
    mode: window.matchMedia && window.matchMedia("(display-mode: standalone)").matches
            ? "app instalada" : "navegador",
    screen: window.innerWidth + "x" + window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    mem: (navigator.deviceMemory || "?") + "GB",
    cores: navigator.hardwareConcurrency || "?",
  });
  window.addEventListener("error", (e) => {
    write({ ...ctx(), type: "error",
            msg: String(e.message || e.error || "?"),
            at: (e.filename || "") + ":" + (e.lineno || 0) });
  });
  window.addEventListener("unhandledrejection", (e) => {
    write({ ...ctx(), type: "promesa",
            msg: String((e.reason && (e.reason.message || e.reason)) || "?"), at: "" });
  });
  // Breadcrumb so we can tell "never started" from "started then died"
  write({ ...ctx(), type: "arranque", msg: "la app comenzo a cargar", at: "" });
})();

const LOW_MEM = (typeof navigator !== "undefined" &&
  ((navigator.deviceMemory && navigator.deviceMemory <= 1) ||
   (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2)));
function pixelRatio(){
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  return LOW_MEM ? 1 : Math.min(dpr, 2);
}


// Turns a guide into a script that sounds like someone explaining it, rather
// than a list being read out. Punctuation carries the pauses.
function buildNarration(guide){
  if(!guide) return "";
  const bits=[];
  if(guide.titulo) bits.push(guide.titulo+".");
  if(guide.dificultad||guide.tiempo){
    const d=[];
    if(guide.dificultad) d.push("dificultad "+guide.dificultad.toLowerCase());
    if(guide.tiempo) d.push("tiempo estimado, "+guide.tiempo);
    bits.push(d.join(". ")+".");
  }
  if(Array.isArray(guide.herramientas)&&guide.herramientas.length){
    bits.push("Necesitarás: "+guide.herramientas.join(", ")+".");
  }
  if(guide.advertencia) bits.push("Atención. "+guide.advertencia);
  const pasos=Array.isArray(guide.pasos)?guide.pasos:[];
  pasos.forEach((p,i)=>{
    bits.push("Paso "+(i+1)+" de "+pasos.length+". "+(p.titulo||"")+".");
    if(p.descripcion) bits.push(p.descripcion);
    if(p.consejo) bits.push("Consejo: "+p.consejo);
  });
  if(guide.cuando_llamar_profesional){
    bits.push("Cuándo llamar a un profesional. "+guide.cuando_llamar_profesional);
  }
  return bits.join(" ");
}

function MatrixRain() {
  const canvasRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const resize = () => { const s = LOW_MEM ? 0.6 : 1; canvas.width = Math.round(window.innerWidth*s); canvas.height = Math.round(window.innerHeight*s); };
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
      const gap = window.__maestroSpeaking ? 250 : 50;
      if (now - lastDraw > gap) { draw(); lastDraw = now; }
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
  const keepAlive = React.useRef(null);

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

  // --- Text to speech -------------------------------------------------------
  // Reading long guides aloud needs care: the text has to be split so the
  // engine never runs out mid-thought, but the pieces must be queued together
  // or a silent gap appears between them.

  // Voices load asynchronously on most platforms, so the list has to be
  // rebuilt when the browser signals it is ready.
  const [voices,setVoices]=React.useState([]);
  React.useEffect(()=>{
    if(!window.speechSynthesis) return;
    const load=()=>{
      const all=window.speechSynthesis.getVoices();
      if(all.length) setVoices(all);
    };
    load();
    window.speechSynthesis.onvoiceschanged=load;
    // Some Android builds populate the list late and never fire the event.
    const t=setTimeout(load,900);
    return()=>clearTimeout(t);
  },[]);

  // The user's chosen voice and pace, remembered on this device.
  const [voicePref,setVoicePref]=React.useState(()=>{
    try{return JSON.parse(localStorage.getItem("maestro_voice")||"null")||{name:"",rate:1};}
    catch(e){return {name:"",rate:1};}
  });
  React.useEffect(()=>{
    try{localStorage.setItem("maestro_voice",JSON.stringify(voicePref));}catch(e){}
  },[voicePref]);

  // Falls back to the best automatic choice when nothing is selected,
  // preferring the neural voices a platform ships over its older defaults.
  const pickVoice = React.useCallback((langTag) => {
    const want=(langTag||"es-ES");
    const base=want.split("-")[0].toLowerCase();
    const all=window.speechSynthesis.getVoices();
    // Exact region first, then any voice for the same language.
    let voices=all.filter(v=>v.lang.toLowerCase().replace("_","-")===want.toLowerCase());
    if(!voices.length) voices=all.filter(v=>v.lang.toLowerCase().split(/[-_]/)[0]===base);
    if (!voices.length) return null;
    if (voicePref.name) {
      const chosen = voices.find(v => v.name === voicePref.name);
      if (chosen) return chosen;
    }
    const score = (v) => {
      const n = (v.name || "").toLowerCase();
      let s = 0;
      if (/natural|neural|enhanced|premium|wavenet|siri/.test(n)) s += 40;
      if (/google/.test(n)) s += 25;
      if (/microsoft|helena|laura|pablo|alvaro|elvira/.test(n)) s += 15;
      if (v.lang.toLowerCase().replace("_","-")===want.toLowerCase()) s += 10;
      if (v.localService) s += 5;               // local voices don't stutter
      if (/compact|eloquence|espeak/.test(n)) s -= 30;
      return s;
    };
    return voices.sort((a, b) => score(b) - score(a))[0];
  }, [voicePref]);

  // Break text into speakable pieces: sentences first, then group them so each
  // piece is long enough to sound continuous but short enough to stay stable.
  const splitForSpeech = React.useCallback((raw) => {
    const clean = String(raw)
      .replace(/[*_`#>\[\]]/g, " ")            // strip markdown noise
      .replace(/\s*\n+\s*/g, ". ")             // line breaks become pauses
      .replace(/\.{2,}/g, ".")
      .replace(/\s{2,}/g, " ")
      .trim();
    const sentences = clean.match(/[^.!?;:]+[.!?;:]*\s*/g) || [clean];
    const out = [];
    let buf = "";
    for (const s of sentences) {
      if ((buf + s).length > 480 && buf) { out.push(buf.trim()); buf = s; }
      else buf += s;
      // A very long sentence still has to be cut, but only at a word boundary.
      while (buf.length > 520) {
        let cut = buf.lastIndexOf(" ", 500);
        if (cut < 60) cut = 500;
        out.push(buf.slice(0, cut).trim());
        buf = buf.slice(cut);
      }
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter(Boolean);
  }, []);

  const speak = React.useCallback((text,langTag) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();

    const parts = splitForSpeech(text);
    if (!parts.length) return;
    const lang = langTag || "es-ES";
    const voice = pickVoice(lang);

    setSpeaking(true);
    // Heavy canvas work starves the speech engine on low-end devices, so the
    // animations are asked to idle while the guide is being read aloud.
    try { window.__maestroSpeaking = true; } catch(e) {}

    parts.forEach((part, idx) => {
      const utt = new SpeechSynthesisUtterance(part);
      utt.lang = lang;
      utt.rate = voicePref.rate || 1.0;
      utt.pitch = 1.0;
      utt.volume = 1.0;
      if (voice) utt.voice = voice;
      if (idx === parts.length - 1) {
        utt.onend = () => {
          setSpeaking(false);
          try { window.__maestroSpeaking = false; } catch(e) {}
        };
      }
      utt.onerror = () => {
        setSpeaking(false);
        try { window.__maestroSpeaking = false; } catch(e) {}
      };
      // Queue everything up front: the engine chains the pieces itself, which
      // removes the pause a per-piece callback would introduce.
      synth.speak(utt);
    });

    // No pause/resume keep-alive here: that trick fixes desktop Chrome but on
    // Android it interrupts playback, which is worse than the problem.
  }, [pickVoice, splitForSpeech, voicePref]);

  const stopSpeaking = React.useCallback(() => {
    window.speechSynthesis?.cancel();
    try { window.__maestroSpeaking = false; } catch(e) {}
    setSpeaking(false);
  }, []);

  return { listening, speaking, startListening, stopListening, speak, stopSpeaking,
           voices, voicePref, setVoicePref };
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
  oficios:{d:"M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z",d2:"M3 3l4.5 4.5M6 2L4 4l3 3 2-2z"},
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
  {label:"SISTEMA // HOGAR",color:"#00b4d8",categories:[{id:"plomeria",label:"Plomería"},{id:"electricidad_hogar",label:"Electricidad"},{id:"pintura",label:"Pintura & Paredes"},{id:"carpinteria",label:"Carpintería"},{id:"jardineria",label:"Jardinería"},{id:"limpieza",label:"Limpieza"},{id:"climatizacion",label:"Clima & HVAC"},{id:"seguridad_hogar",label:"Seguridad Hogar"},{id:"oficios",label:"Oficios"}]},
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


// Everyday words people actually type, mapped to the category that solves them.
// Without this, searching "grifo" or "nevera" finds nothing at all.

// Languages the guide can be written in. `voice` is the BCP-47 tag handed to
// the speech engine so the reading matches the text.

// A short line in each language so the voice test is actually intelligible.
const VOICE_SAMPLE={
  es:"Esta es la voz que leerá tus guías. Paso uno: comprueba que se entiende bien.",
  "es-419":"Esta es la voz que leerá tus guías. Paso uno: comprueba que se entienda bien.",
  en:"This is the voice that will read your guides. Step one: check that it sounds clear.",
  fr:"Voici la voix qui lira vos guides. Étape une : vérifiez qu'elle est bien claire.",
  de:"Das ist die Stimme, die Ihre Anleitungen vorliest. Schritt eins: Prüfen Sie die Verständlichkeit.",
  it:"Questa è la voce che leggerà le tue guide. Passo uno: verifica che si capisca bene.",
  pt:"Esta é a voz que irá ler os seus guias. Passo um: verifique se se percebe bem.",
  "pt-BR":"Esta é a voz que vai ler seus guias. Passo um: verifique se está bem claro.",
  ca:"Aquesta és la veu que llegirà les teves guies. Pas u: comprova que s'entengui bé.",
  gl:"Esta é a voz que lerá as túas guías. Paso un: comproba que se entenda ben.",
  eu:"Hau da zure gidak irakurriko dituen ahotsa. Lehen urratsa: egiaztatu ondo ulertzen dela.",
  nl:"Dit is de stem die je gidsen voorleest. Stap één: controleer of het duidelijk klinkt.",
  pl:"To jest głos, który przeczyta twoje poradniki. Krok pierwszy: sprawdź, czy brzmi wyraźnie.",
  ro:"Aceasta este vocea care îți va citi ghidurile. Pasul unu: verifică dacă se aude clar.",
  sv:"Det här är rösten som läser dina guider. Steg ett: kontrollera att den låter tydlig.",
  da:"Dette er stemmen, der læser dine guides. Trin et: tjek at den lyder tydelig.",
  no:"Dette er stemmen som leser veiledningene dine. Trinn én: sjekk at den høres tydelig ut.",
  fi:"Tämä on ääni, joka lukee oppaasi. Vaihe yksi: tarkista, että se kuuluu selvästi.",
  cs:"Toto je hlas, který bude číst vaše návody. Krok jedna: zkontrolujte, že je dobře rozumět.",
  el:"Αυτή είναι η φωνή που θα διαβάζει τους οδηγούς σας. Βήμα ένα: ελέγξτε ότι ακούγεται καθαρά.",
  tr:"Bu, kılavuzlarınızı okuyacak ses. Birinci adım: net duyulduğunu kontrol edin.",
  ru:"Это голос, который будет читать ваши инструкции. Шаг первый: проверьте, что всё понятно.",
  uk:"Це голос, який читатиме ваші інструкції. Крок перший: перевірте, чи добре чутно.",
  ar:"هذا هو الصوت الذي سيقرأ أدلتك. الخطوة الأولى: تأكد من وضوحه.",
  he:"זה הקול שיקריא את המדריכים שלך. שלב ראשון: בדוק שזה נשמע ברור.",
  hi:"यह वह आवाज़ है जो आपकी गाइड पढ़ेगी। पहला चरण: जाँचें कि यह स्पष्ट सुनाई दे।",
  zh:"这是将朗读您指南的声音。第一步：确认听起来清晰。",
  ja:"これはガイドを読み上げる音声です。ステップ一：聞き取りやすいか確認してください。",
  ko:"이것은 가이드를 읽어 줄 목소리입니다. 1단계: 잘 들리는지 확인하세요.",
};

const LANGUAGES=[
  {code:"es", label:"Español",    native:"Español",     voice:"es-ES", flag:"🇪🇸"},
  {code:"es-419",label:"Español (Latinoamérica)",native:"Español LA",voice:"es-MX",flag:"🌎"},
  {code:"en", label:"Inglés",     native:"English",     voice:"en-US", flag:"🇬🇧"},
  {code:"fr", label:"Francés",    native:"Français",    voice:"fr-FR", flag:"🇫🇷"},
  {code:"de", label:"Alemán",     native:"Deutsch",     voice:"de-DE", flag:"🇩🇪"},
  {code:"it", label:"Italiano",   native:"Italiano",    voice:"it-IT", flag:"🇮🇹"},
  {code:"pt", label:"Portugués",  native:"Português",   voice:"pt-PT", flag:"🇵🇹"},
  {code:"pt-BR",label:"Portugués (Brasil)",native:"Português BR",voice:"pt-BR",flag:"🇧🇷"},
  {code:"ca", label:"Catalán",    native:"Català",      voice:"ca-ES", flag:"🏴"},
  {code:"gl", label:"Gallego",    native:"Galego",      voice:"gl-ES", flag:"🏴"},
  {code:"eu", label:"Euskera",    native:"Euskara",     voice:"eu-ES", flag:"🏴"},
  {code:"nl", label:"Neerlandés", native:"Nederlands",  voice:"nl-NL", flag:"🇳🇱"},
  {code:"pl", label:"Polaco",     native:"Polski",      voice:"pl-PL", flag:"🇵🇱"},
  {code:"ro", label:"Rumano",     native:"Română",      voice:"ro-RO", flag:"🇷🇴"},
  {code:"sv", label:"Sueco",      native:"Svenska",     voice:"sv-SE", flag:"🇸🇪"},
  {code:"da", label:"Danés",      native:"Dansk",       voice:"da-DK", flag:"🇩🇰"},
  {code:"no", label:"Noruego",    native:"Norsk",       voice:"nb-NO", flag:"🇳🇴"},
  {code:"fi", label:"Finés",      native:"Suomi",       voice:"fi-FI", flag:"🇫🇮"},
  {code:"cs", label:"Checo",      native:"Čeština",     voice:"cs-CZ", flag:"🇨🇿"},
  {code:"el", label:"Griego",     native:"Ελληνικά",    voice:"el-GR", flag:"🇬🇷"},
  {code:"tr", label:"Turco",      native:"Türkçe",      voice:"tr-TR", flag:"🇹🇷"},
  {code:"ru", label:"Ruso",       native:"Русский",     voice:"ru-RU", flag:"🇷🇺"},
  {code:"uk", label:"Ucraniano",  native:"Українська",  voice:"uk-UA", flag:"🇺🇦"},
  {code:"ar", label:"Árabe",      native:"العربية",      voice:"ar-SA", flag:"🇸🇦"},
  {code:"he", label:"Hebreo",     native:"עברית",        voice:"he-IL", flag:"🇮🇱"},
  {code:"hi", label:"Hindi",      native:"हिन्दी",         voice:"hi-IN", flag:"🇮🇳"},
  {code:"zh", label:"Chino",      native:"中文",         voice:"zh-CN", flag:"🇨🇳"},
  {code:"ja", label:"Japonés",    native:"日本語",        voice:"ja-JP", flag:"🇯🇵"},
  {code:"ko", label:"Coreano",    native:"한국어",        voice:"ko-KR", flag:"🇰🇷"},
];

const SYNONYMS={
  plomeria:["grifo","cañeria","tuberia","fuga","agua","desague","cisterna","wc","inodoro","atasco","sifon","fontaneria","gotea"],
  electricidad_hogar:["enchufe","luz","bombilla","interruptor","diferencial","cuadro","cable","corriente","apagon","led"],
  pintura:["pared","pintar","brocha","rodillo","humedad","moho","gotele","yeso","grieta"],
  carpinteria:["madera","mueble","puerta","bisagra","armario","cajon","estante","tornillo","barniz"],
  jardineria:["planta","cesped","poda","riego","huerto","arbol","maceta","abono","semilla"],
  limpieza:["mancha","suciedad","fregar","detergente","cal","oxido","alfombra","cristal"],
  climatizacion:["aire","calefaccion","radiador","caldera","termostato","frio","calor","split","bomba"],
  seguridad_hogar:["alarma","cerradura","llave","camara","candado","robo","cerrojo"],
  oficios:["albañil","soldador","electricista","fontanero","pintor","carpintero","gremio","obra","reforma","presupuesto"],
  electrodomesticos:["nevera","frigorifico","lavadora","lavavajillas","horno","microondas","secadora","vitroceramica","campana"],
  computadoras:["ordenador","pc","portatil","lento","disco","ram","placa","arranca","pantalla azul"],
  redes:["wifi","router","internet","conexion","señal","ethernet","ip","modem","repetidor"],
  celulares:["movil","telefono","bateria","pantalla","android","iphone","tablet","cargador"],
  audio_video:["altavoz","television","tv","sonido","hdmi","proyector","auriculares","mando"],
  impresoras:["imprimir","tinta","toner","atasco papel","escaner","cartucho"],
  motor:["coche","arranca","aceite","correa","embrague","bujia","distribucion","humo","averia"],
  frenos:["freno","pastilla","disco","amortiguador","suspension","ruido"],
  electrica_auto:["bateria coche","alternador","fusible","luces","arranque"],
  neumaticos:["rueda","pinchazo","llanta","presion","neumatico"],
  soldadura:["soldar","electrodo","hilo","tig","mig","acero","inox"],
  primeros_auxilios:["herida","quemadura","corte","golpe","fiebre","ahogo","botiquin","urgencia"],
  medicamentos:["pastilla","dosis","farmaco","jarabe","antibiotico","ibuprofeno"],
  windows:["windows","microsoft","actualizar","registro","escritorio"],
  linux:["linux","ubuntu","terminal","bash","sudo","kernel"],
  programacion:["codigo","python","javascript","bug","funcion","programar","git"],
  finanzas_personales:["ahorro","presupuesto","deuda","hipoteca","nomina","gasto"],
  derecho_laboral:["despido","contrato trabajo","nomina","baja","finiquito","convenio","paro"],
  derecho_civil:["herencia","alquiler","divorcio","testamento","comunidad","vecino"],
};
const norm0=(v)=>String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");

const ALL_CATS=SECTIONS.flatMap(s=>s.categories.map(c=>({...c,sectionColor:s.color,sectionLabel:s.label})));

// ── COLUMN FRAME WITH FLOATING CLOUDS ──
function ColumnFrame({color,children,altarDelay=0}){
  const [t,setT]=React.useState(0);
  const shakeRef=React.useRef(null);
  React.useEffect(()=>{
    let raf,last=performance.now();
    const loop=(now)=>{
      const dt=Math.min((now-last)/1000,0.05); last=now;
      setT(v=>v+dt);

      // The temple physically shakes when the star lands. The transform is
      // written straight to the node instead of through state, so the jolt
      // runs at full frame rate without rerendering the whole scene.
      const q=(typeof window!=="undefined"&&window.__maestroQuake)||0;
      const el=shakeRef.current;
      if(el){
        if(q>0.002){
          const ms=now/1000;
          // Layered frequencies: a hard initial jolt over a slower sway, so it
          // reads as masonry rather than as a vibrating phone.
          const amp=q*13;
          const dx=(Math.sin(ms*47)*0.6+Math.sin(ms*23.3)*0.4)*amp;
          const dy=(Math.sin(ms*38.7)*0.55+Math.sin(ms*17.1)*0.45)*amp*0.75;
          const rot=Math.sin(ms*29.4)*q*0.55;
          el.style.transform=`translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px) rotate(${rot.toFixed(3)}deg)`;
        }else if(el.style.transform){
          el.style.transform="";
        }
      }

      raf=requestAnimationFrame(loop);
    };
    raf=requestAnimationFrame(loop);
    return()=>cancelAnimationFrame(raf);
  },[]);

  const Cloud=({x,y,s,op})=>(
    <g transform={`translate(${x},${y}) scale(${s})`} opacity={op}>
      <ellipse cx="0"   cy="0"  rx="22" ry="11"/>
      <ellipse cx="16"  cy="-5" rx="16" ry="12"/>
      <ellipse cx="-15" cy="-3" rx="14" ry="9"/>
      <ellipse cx="5"   cy="-9" rx="12" ry="10"/>
    </g>
  );

  const SKY_CLOUDS=[
    [ 8, 16, 1.5, 0.7,  0.46],[30, 44, 2.2, 0.42, 0.34],
    [55, 26, 1.1, 1.0,  0.50],[74, 58, 1.8, 0.55, 0.32],
    [95, 36, 1.3, 0.85, 0.40],[18, 74, 2.6, 0.30, 0.26],
    [62, 86, 1.6, 0.62, 0.28],[42, 98, 2.0, 0.38, 0.22],
  ];

  // ---- Perspective helpers -------------------------------------------------
  // The temple is drawn as a shallow 3D box: a front row of columns, a recessed
  // back wall, and side rows that converge toward a vanishing point. Depth is
  // faked by scaling toward the centre of the canvas.
  const VP={x:200,y:96};                       // vanishing point
  const depth=(p,k)=>({                        // k=0 front plane, k=1 far plane
    x:p.x+(VP.x-p.x)*k,
    y:p.y+(VP.y-p.y)*k,
  });
  const D=0.34;                                // how far back the rear plane sits

  // Front columns, drawn largest. Middle ones are omitted so the oracle inside
  // stays visible through the opening.
  const FRONT=[26,74,326,374];
  const SIDE_L=[[26,0],[52,0.16],[74,0.30]];
  const SIDE_R=[[374,0],[348,0.16],[326,0.30]];

  const Column=({cx,k,dmg})=>{
    const s=1-k*0.62;                          // perspective shrink
    const top=depth({x:cx,y:60},k);
    const bot=depth({x:cx,y:214},k);
    const w=13*s;
    const shade=0.55+0.45*(1-k);               // rear columns sit in shadow
    return(
      <g opacity={shade}>
        {/* capital */}
        <rect x={top.x-w*1.5} y={top.y-4*s} width={w*3} height={3.4*s} fill="#e6e1d1" opacity="0.9"/>
        <path d={`M${top.x-w*1.35},${top.y-0.6*s} Q${top.x},${top.y+3.4*s} ${top.x+w*1.35},${top.y-0.6*s} L${top.x+w},${top.y+4*s} Q${top.x},${top.y+6*s} ${top.x-w},${top.y+4*s} Z`} fill="url(#agedGrad)"/>
        {/* annulets */}
        <rect x={top.x-w} y={top.y+5.4*s} width={w*2} height={0.9*s} fill="#6b6a63" opacity="0.5"/>
        {/* shaft with entasis */}
        <path d={`M${top.x-w},${top.y+6.4*s} Q${top.x-w*1.12},${(top.y+bot.y)/2} ${bot.x-w*1.16},${bot.y} L${bot.x+w*1.16},${bot.y} Q${top.x+w*1.12},${(top.y+bot.y)/2} ${top.x+w},${top.y+6.4*s} Z`} fill="url(#agedGradV)"/>
        {/* flutes */}
        {[-0.78,-0.5,-0.22,0.06,0.34,0.62].map((f,i)=>(
          <line key={i}
            x1={top.x+f*w} y1={top.y+7*s}
            x2={bot.x+f*w*1.16} y2={bot.y}
            stroke={i%2?"#efe9d9":"#5f5e57"} strokeWidth={0.8*s}
            opacity={i%2?0.5:0.42}/>
        ))}
        {/* drum joints */}
        {[0.3,0.55,0.78].map((u,i)=>{
          const y=top.y+(bot.y-top.y)*u, ww=w*(1+0.16*u);
          return <line key={i} x1={top.x-ww} y1={y} x2={top.x+ww} y2={y} stroke="#4a4943" strokeWidth={0.5*s} opacity="0.32"/>;
        })}
        {/* damage */}
        {dmg===1&&<path d={`M${top.x+w*0.9},${top.y+40*s} L${top.x+w*1.5},${top.y+48*s} L${top.x+w*0.8},${top.y+56*s} Z`} fill="#08111c" opacity="0.5"/>}
        {dmg===2&&<path d={`M${top.x-w*1.1},${bot.y-38*s} L${top.x-w*1.7},${bot.y-30*s} L${top.x-w*1.0},${bot.y-22*s} Z`} fill="#08111c" opacity="0.45"/>}
        {/* base */}
        <ellipse cx={bot.x} cy={bot.y} rx={w*1.5} ry={1.8*s} fill="url(#agedGrad)"/>
      </g>
    );
  };


  // A wall torch: bracket, bowl and a flame whose silhouette is rebuilt every
  // frame from a few sine waves so it never repeats exactly.
  const Torch=({x,y,s,seed})=>{
    const f=t*40.8+seed;
    const w1=Math.sin(f)*1.5, w2=Math.sin(f*1.7+1.1)*1.1, w3=Math.sin(f*2.3+2.2)*0.8;
    const h =1+Math.sin(f*1.3)*0.13;            // flame breathes up and down
    const H =17*h;
    return(
      <g transform={`translate(${x},${y}) scale(${s})`}>
        {/* light cast on the stone behind */}
        <ellipse cx={0} cy={-4} rx={16+w1} ry={20+w2} fill="url(#torchGlow)"
                 opacity={0.55+Math.sin(f*1.6)*0.16}/>
        {/* iron bracket */}
        <path d="M-1.6,2 L1.6,2 L1.1,7 L-1.1,7 Z" fill="#2e2a24"/>
        <path d="M-3.4,7 Q0,10.5 3.4,7 L2.6,9.4 Q0,12.2 -2.6,9.4 Z" fill="#3b352c"/>
        <rect x="-4.2" y="1" width="8.4" height="1.8" rx="0.6" fill="#4a4238"/>
        {/* embers in the bowl */}
        <ellipse cx="0" cy="1.2" rx="3.2" ry="1.1" fill="#ff7a1a" opacity={0.75+Math.sin(f*2.1)*0.2}/>
        {/* outer flame */}
        <path d={`M0,${-H} C${5.5+w1},${-H*0.55} ${4.6+w2},${-H*0.2} ${3.1+w3},1
                  L${-3.1+w3},1 C${-4.6+w2},${-H*0.2} ${-5.5+w1},${-H*0.55} 0,${-H} Z`}
              fill="url(#flameOuter)" opacity="0.92"/>
        {/* inner flame */}
        <path d={`M0,${-H*0.72} C${3.2+w2},${-H*0.4} ${2.7+w3},${-H*0.12} ${1.9},1
                  L${-1.9},1 C${-2.7+w3},${-H*0.12} ${-3.2+w2},${-H*0.4} 0,${-H*0.72} Z`}
              fill="url(#flameInner)" opacity="0.95"/>
        {/* white core */}
        <ellipse cx={w3*0.5} cy={-H*0.22} rx={1.15} ry={H*0.2} fill="#fff6d8"
                 opacity={0.8+Math.sin(f*2.6)*0.15}/>
        {/* a spark rising now and then */}
        <circle cx={w1*1.6} cy={-H-3-((f*7)%9)} r="0.5" fill="#ffb347"
                opacity={Math.max(0,0.7-((f*7)%9)/9)}/>
      </g>
    );
  };

  return(
    <div ref={shakeRef} style={{position:"relative",width:"100%",willChange:"transform"}}>
      {/* ---- open sky above the temple ---- */}
      <div style={{position:"absolute",bottom:"100%",left:0,right:0,height:"42vh",
                   pointerEvents:"none",overflow:"hidden"}}>
        <svg viewBox="0 0 400 110" preserveAspectRatio="none" style={{width:"100%",height:"100%",display:"block"}}>
          <defs>
            <linearGradient id="openSky" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"   stopColor="#050b14" stopOpacity="0"/>
              <stop offset="45%"  stopColor="#132a42" stopOpacity="0.35"/>
              <stop offset="100%" stopColor="#20455f" stopOpacity="0.6"/>
            </linearGradient>
            <radialGradient id="skyCloud" cx="42%" cy="32%" r="72%">
              <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.95"/>
              <stop offset="55%"  stopColor="#eef4fb" stopOpacity="0.7"/>
              <stop offset="100%" stopColor="#b9c6d8" stopOpacity="0.32"/>
            </radialGradient>
            <filter id="skyFar"><feGaussianBlur stdDeviation="3.2"/></filter>
            <filter id="skyNear"><feGaussianBlur stdDeviation="1.5"/></filter>
          </defs>
          <rect x="0" y="0" width="400" height="110" fill="url(#openSky)"/>
          <g fill="url(#skyCloud)" filter="url(#skyFar)">
            {SKY_CLOUDS.map(([bx,by,s,sp,op],i)=>(
              <Cloud key={"sb"+i} x={((bx+t*sp*1.6)%230)*640/230-120} y={by+Math.sin(t*0.28+i)*2.2} s={s*1.35} op={op*0.5}/>
            ))}
          </g>
          <g fill="url(#skyCloud)" filter="url(#skyNear)">
            {SKY_CLOUDS.map(([bx,by,s,sp,op],i)=>(
              <Cloud key={"sf"+i} x={((bx+t*sp*2.6)%230)*640/230-120} y={by+Math.sin(t*0.36+i)*3} s={s} op={op}/>
            ))}
          </g>
        </svg>
      </div>

      {/* ---- the temple, in perspective, with the oracle inside ---- */}
      <div style={{position:"relative",width:"100%"}}>
        <svg viewBox="0 0 400 230" preserveAspectRatio="xMidYMax meet"
             style={{width:"100%",height:"auto",display:"block"}}>
          <defs>
            <linearGradient id="agedGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#6b6a63" stopOpacity="0.85"/>
              <stop offset="20%"  stopColor="#b8b3a4" stopOpacity="0.93"/>
              <stop offset="42%"  stopColor="#e4dfcf" stopOpacity="0.97"/>
              <stop offset="62%"  stopColor="#c4bfae" stopOpacity="0.92"/>
              <stop offset="85%"  stopColor="#8f8b7e" stopOpacity="0.85"/>
              <stop offset="100%" stopColor="#5f5e57" stopOpacity="0.78"/>
            </linearGradient>
            <linearGradient id="agedGradV" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#5f5e57" stopOpacity="0.8"/>
              <stop offset="24%"  stopColor="#c0bbab" stopOpacity="0.92"/>
              <stop offset="48%"  stopColor="#e8e3d3" stopOpacity="0.97"/>
              <stop offset="74%"  stopColor="#a9a496" stopOpacity="0.9"/>
              <stop offset="100%" stopColor="#6b6a63" stopOpacity="0.8"/>
            </linearGradient>
            <linearGradient id="cellaWall" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"   stopColor="#1a1f28" stopOpacity="0.96"/>
              <stop offset="55%"  stopColor="#111721" stopOpacity="0.98"/>
              <stop offset="100%" stopColor="#0a0f18" stopOpacity="1"/>
            </linearGradient>
            <radialGradient id="oracleGlow" cx="50%" cy="52%" r="60%">
              <stop offset="0%"   stopColor={color} stopOpacity="0.55"/>
              <stop offset="55%"  stopColor={color} stopOpacity="0.18"/>
              <stop offset="100%" stopColor={color} stopOpacity="0"/>
            </radialGradient>
            <radialGradient id="templeCloud" cx="42%" cy="32%" r="72%">
              <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.95"/>
              <stop offset="55%"  stopColor="#eef4fb" stopOpacity="0.68"/>
              <stop offset="100%" stopColor="#b9c6d8" stopOpacity="0.3"/>
            </radialGradient>
            <filter id="templeCloudSoft"><feGaussianBlur stdDeviation="2.4"/></filter>
            <filter id="templeCloudSharp"><feGaussianBlur stdDeviation="1.1"/></filter>
            <radialGradient id="torchGlow" cx="50%" cy="55%" r="50%">
              <stop offset="0%"   stopColor="#ffb347" stopOpacity="0.5"/>
              <stop offset="45%"  stopColor="#ff7a1a" stopOpacity="0.18"/>
              <stop offset="100%" stopColor="#ff7a1a" stopOpacity="0"/>
            </radialGradient>
            <linearGradient id="flameOuter" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%"   stopColor="#c2410c" stopOpacity="0.9"/>
              <stop offset="35%"  stopColor="#f97316"/>
              <stop offset="75%"  stopColor="#fbbf24"/>
              <stop offset="100%" stopColor="#fde68a" stopOpacity="0.75"/>
            </linearGradient>
            <linearGradient id="flameInner" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%"   stopColor="#fb923c"/>
              <stop offset="50%"  stopColor="#fde047"/>
              <stop offset="100%" stopColor="#fffbeb"/>
            </linearGradient>
            <filter id="weathered" x="-20%" y="-20%" width="140%" height="140%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9 0.35" numOctaves="4" seed="7" result="n"/>
              <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
            </filter>
            <filter id="eroded" x="-30%" y="-30%" width="160%" height="160%">
              <feTurbulence type="fractalNoise" baseFrequency="0.55 0.25" numOctaves="5" seed="13" result="n"/>
              <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>
            </filter>
          </defs>

          {/* floor of the cella, receding to the vanishing point */}
          <path d={`M40,214 L360,214 L${depth({x:326,y:214},D).x},${depth({x:326,y:214},D).y} L${depth({x:74,y:214},D).x},${depth({x:74,y:214},D).y} Z`}
                fill="#171c24" opacity="0.92"/>
          {[0.16,0.34,0.55,0.78].map((u,i)=>{
            const a=depth({x:40,y:214},u*D), b=depth({x:360,y:214},u*D);
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2b323d" strokeWidth="0.6" opacity={0.5-u*0.3}/>;
          })}

          {/* back wall of the cella */}
          <path d={`M${depth({x:74,y:66},D).x},${depth({x:74,y:66},D).y}
                    L${depth({x:326,y:66},D).x},${depth({x:326,y:66},D).y}
                    L${depth({x:326,y:214},D).x},${depth({x:326,y:214},D).y}
                    L${depth({x:74,y:214},D).x},${depth({x:74,y:214},D).y} Z`}
                fill="url(#cellaWall)"/>

          {/* the oracle's light, spilling from the back of the sanctuary */}
          <ellipse cx="200" cy="150" rx="118" ry="82" fill="url(#oracleGlow)"
                   opacity={0.75+Math.sin(t*0.9)*0.18}/>

          {/* side colonnades receding inward */}
          {SIDE_L.slice(1).map(([cx,k],i)=><Column key={"l"+i} cx={cx} k={k} dmg={0}/>)}
          {SIDE_R.slice(1).map(([cx,k],i)=><Column key={"r"+i} cx={cx} k={k} dmg={0}/>)}

          {/* ----- entablature ----- */}
          <g filter="url(#weathered)">
            {/* architrave */}
            <rect x="8" y="46" width="384" height="8" fill="url(#agedGrad)"/>
            {/* frieze band */}
            <rect x="8" y="34" width="384" height="12" fill="#5c5b54" opacity="0.3"/>
          </g>
          {/* triglyphs, some broken */}
          {[26,74,122,170,218,266,314,362].map((tx,i)=>{
            const h=[12,9,12,12,7,12,10,12][i];
            return(
              <g key={i} filter="url(#weathered)" opacity={h<10?0.55:0.92}>
                <rect x={tx-6} y="34" width="12" height={h} fill="url(#agedGrad)"/>
                <line x1={tx-3} y1="35" x2={tx-3} y2={33+h} stroke="#4a4943" strokeWidth="1" opacity="0.6"/>
                <line x1={tx+3} y1="35" x2={tx+3} y2={33+h} stroke="#4a4943" strokeWidth="1" opacity="0.6"/>
              </g>
            );
          })}
          {/* cornice */}
          <g filter="url(#weathered)">
            <rect x="4" y="28" width="392" height="4" fill="#efe9d9" opacity="0.8"/>
            <rect x="4" y="32" width="392" height="2.5" fill="url(#agedGrad)"/>
          </g>
          <rect x="96" y="28" width="20" height="6" fill="#050b14" opacity="0.5"/>
          <rect x="242" y="28" width="14" height="6" fill="#050b14" opacity="0.45"/>

          {/* clouds drifting behind the roofline */}
          <g fill="url(#templeCloud)" filter="url(#templeCloudSoft)">
            {SKY_CLOUDS.slice(0,5).map(([bx,by,s,sp],i)=>(
              <Cloud key={"tb"+i}
                     x={((bx+t*sp*2.2)%230)*640/230-120}
                     y={4+ (by%22)*0.6 + Math.sin(t*0.42+i)*1.8}
                     s={s*0.62} op={0.30}/>
            ))}
          </g>
          <g fill="url(#templeCloud)" filter="url(#templeCloudSharp)">
            {SKY_CLOUDS.slice(2,6).map(([bx,by,s,sp],i)=>(
              <Cloud key={"tf"+i}
                     x={((bx*1.4+t*sp*3.4)%230)*640/230-120}
                     y={9+ (by%16)*0.5 + Math.sin(t*0.55+i)*2.2}
                     s={s*0.46} op={0.42}/>
            ))}
          </g>

          {/* ruined pediment */}
          <g filter="url(#eroded)">
            <path d="M6,28 L70,18 L118,10 L160,5 L176,3 L172,28 Z" fill="url(#agedGrad)" opacity="0.93"/>
            <path d="M236,6 L280,10 L330,17 L394,28 L242,28 Z" fill="url(#agedGrad)" opacity="0.9"/>
            <path d="M192,4 L214,2 L222,7 L204,10 Z" fill="url(#agedGrad)" opacity="0.72"/>
          </g>
          <path d="M6,28 L176,3" fill="none" stroke="#efe9d9" strokeWidth="1.5" opacity="0.55" strokeDasharray="30 6 16 9 24"/>
          <path d="M236,6 L394,28" fill="none" stroke="#efe9d9" strokeWidth="1.5" opacity="0.5" strokeDasharray="20 7 26 5"/>
          <circle cx="206" cy="26" r="1.6" fill="#8f8b7e" opacity="0.5"/>
          <circle cx="224" cy="27" r="1.1" fill="#a9a496" opacity="0.45"/>

          {/* front columns, drawn last so they overlap everything */}
          {FRONT.map((cx,i)=><Column key={"f"+i} cx={cx} k={0} dmg={i===1?1:i===2?2:0}/>)}

          {/* torches burning on the front colonnade */}
          {FRONT.map((cx,i)=>(
            <Torch key={"t"+i} x={cx} y={104} s={1.15} seed={i*1.9}/>
          ))}
          {/* two more deeper inside, smaller and dimmer */}
          <g opacity="0.62">
            <Torch x={depth({x:74,y:104},0.30).x}  y={depth({x:74,y:104},0.30).y}  s={0.72} seed={4.3}/>
            <Torch x={depth({x:326,y:104},0.30).x} y={depth({x:326,y:104},0.30).y} s={0.72} seed={5.6}/>
          </g>

          {/* stylobate steps */}
          <g filter="url(#weathered)">
            <rect x="0" y="214" width="400" height="5" fill="url(#agedGrad)"/>
            <rect x="0" y="219" width="400" height="1" fill="#5f5e57" opacity="0.5"/>
            <rect x="0" y="220" width="400" height="5" fill="url(#agedGrad)" opacity="0.88"/>
            <rect x="0" y="225" width="400" height="5" fill="url(#agedGrad)" opacity="0.76"/>
          </g>
          <rect x="62" y="214" width="15" height="5" fill="#050b14" opacity="0.4"/>
          <rect x="300" y="220" width="18" height="5" fill="#050b14" opacity="0.32"/>
        </svg>

        {/* ---- the oracle: a carved stone altar holding the text ---- */}
        <div style={{position:"absolute",left:"24%",right:"24%",top:"17%",bottom:"8%",
                     animation:`altarSettle 1.1s cubic-bezier(.2,1.5,.4,1) ${altarDelay}ms both`,
                     transformOrigin:"50% 100%"}}>
          <div style={{position:"relative",width:"100%",height:"100%"}}>

            {/* One box holds both the carving and the words, so the inscription
                can be placed in the same coordinate space as the panel cut into
                the stone (viewBox 200x150, panel at x40-160, y26-120). */}
            <div style={{position:"absolute",inset:0}}>

            {/* the monolith: a standing slab of carved stone */}
            <svg viewBox="0 0 200 150" preserveAspectRatio="none"
                 style={{position:"absolute",inset:0,width:"100%",height:"100%",
                         display:"block",filter:"drop-shadow(0 10px 26px rgba(0,0,0,.75))",
                         animation:`altarReveal .01s linear ${altarDelay}ms both`}}>
              <defs>
                <linearGradient id="monoFace" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="#55524a"/>
                  <stop offset="14%"  stopColor="#9a9587"/>
                  <stop offset="38%"  stopColor="#cdc8b7"/>
                  <stop offset="58%"  stopColor="#b0ab9c"/>
                  <stop offset="82%"  stopColor="#7d7a6f"/>
                  <stop offset="100%" stopColor="#4a4842"/>
                </linearGradient>
                <linearGradient id="monoSide" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="#3d3b36"/>
                  <stop offset="100%" stopColor="#615e56"/>
                </linearGradient>
                <linearGradient id="monoCap" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%"   stopColor="#e8e2d2"/>
                  <stop offset="100%" stopColor="#a9a496"/>
                </linearGradient>
                <filter id="monoRough" x="-8%" y="-8%" width="116%" height="116%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.6 0.85" numOctaves="5" seed="31" result="n"/>
                  <feDisplacementMap in="SourceGraphic" in2="n" scale="2.1"
                                     xChannelSelector="R" yChannelSelector="G"/>
                </filter>
              </defs>

              <g filter="url(#monoRough)">
                {/* the shaft: slightly tapered, wider at the base */}
                <path d="M28,10 L172,10 L178,132 L22,132 Z" fill="url(#monoFace)"/>
                {/* right edge catching less light, giving it thickness */}
                <path d="M172,10 L184,16 L189,130 L178,132 Z" fill="url(#monoSide)"/>
                {/* broken, uneven crown */}
                <path d="M28,10 L46,5 L62,11 L84,3 L104,9 L126,4 L148,11 L172,6 L172,10 L28,10 Z"
                      fill="url(#monoCap)"/>
                {/* plinth */}
                <path d="M14,132 L190,132 L194,142 L10,142 Z" fill="url(#monoCap)" opacity="0.9"/>
                <path d="M10,142 L194,142 L198,150 L6,150 Z" fill="url(#monoFace)" opacity="0.85"/>
              </g>

              {/* the inscription panel, cut into the face */}
              <rect x="40" y="26" width="120" height="94" fill="#080d14" opacity="0.62"/>
              <path d="M40,120 L40,26 L160,26" fill="none" stroke="#4f4c45" strokeWidth="1.8" opacity="0.85"/>
              <path d="M160,26 L162,120 L40,120" fill="none" stroke="#ded8c7" strokeWidth="1.2" opacity="0.4"/>
              <rect x="40" y="26" width="120" height="94" fill={color} opacity="0.1"/>

              {/* carved ornament above the panel */}
              <circle cx="100" cy="19" r="4.5" fill="none" stroke="#8a867a" strokeWidth="1.2" opacity="0.75"/>
              <path d="M93,19 L80,19 M107,19 L120,19" stroke="#8a867a" strokeWidth="1.1" opacity="0.6"/>

              {/* age: chips, cracks, missing corners */}
              <path d="M22,132 L34,126 L24,118 Z" fill="#050b14" opacity="0.5"/>
              <path d="M178,60 L170,66 L179,73 Z" fill="#050b14" opacity="0.42"/>
              <path d="M56,10 L60,32 L52,54 L58,78 L50,104" fill="none" stroke="#3e3c36" strokeWidth="0.9" opacity="0.45"/>
              <path d="M150,120 L144,132 L152,142" fill="none" stroke="#3e3c36" strokeWidth="0.8" opacity="0.4"/>
              <path d="M100,132 L98,142" stroke="#3e3c36" strokeWidth="0.7" opacity="0.3"/>
            </svg>

            {/* the writing itself, seated inside the carved recess */}
            <div style={{position:"absolute",
                         left:"22%",right:"22%",top:"20.5%",bottom:"22%",
                         display:"flex",flexDirection:"column",justifyContent:"center",
                         overflow:"hidden"}}>
              {children}
            </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── STARFIELD SUBMENU ──
// Draws a label under an orb/star: wraps long names onto several lines and
// nudges the text horizontally so it never spills past the canvas edges.
function drawWrappedLabel(ctx,text,cx,topY,canvasW,maxLineW){
  const words=String(text).toUpperCase().split(/\s+/).filter(Boolean);
  const lines=[];
  let line="";
  for(const w of words){
    const test=line?line+" "+w:w;
    if(line&&ctx.measureText(test).width>maxLineW){lines.push(line);line=w;}
    else line=test;
  }
  if(line)lines.push(line);
  const lh=parseInt(ctx.font,10)*1.2||12;
  lines.forEach((ln,i)=>{
    const halfW=ctx.measureText(ln).width/2;
    // keep the line fully on screen
    const x=Math.max(halfW+4,Math.min(canvasW-halfW-4,cx));
    ctx.fillText(ln,x,topY+i*lh);
  });
}


// ---------------------------------------------------------------------------
// StarJourney: the chosen star leaves its constellation, descends toward the
// temple, sinks through the roof and settles as the oracle's altar. The temple
// fades up underneath as it travels, so the two screens feel continuous.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sound for the star's descent. Everything is synthesised, so there are no
// files to load and nothing to go stale.
//   - a low rumble that rises in pitch and volume as the star falls
//   - a muffled thud on landing
//   - a scatter of bell tones as the monolith rises
// ---------------------------------------------------------------------------
function playJourneySound(duration){
  try{ if(localStorage.getItem("maestro_fx")==="off") return ()=>{}; }catch(e){}
  try{ if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches) return ()=>{}; }catch(e){}

  let ctx;
  try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return ()=>{}; }
  if(ctx.state==="suspended") ctx.resume().catch(()=>{});

  const D=duration/1000;
  const SR=ctx.sampleRate;
  const master=ctx.createGain();
  master.gain.value=1.0;
  // Stacked sub-bass would clip without this; the limiter lets the strike hit
  // hard while keeping the peak under control.
  // Gentle saturation generates harmonics of the sub-bass. A small speaker
  // cannot move enough air for 20 Hz, but it reproduces the harmonics, and the
  // ear reconstructs the missing fundamental - the bass is felt regardless.
  const drive=ctx.createWaveShaper();
  {
    const N=1024, c=new Float32Array(N);
    for(let i=0;i<N;i++){
      const x=(i/(N-1))*2-1;
      c[i]=Math.tanh(x*2.2)/Math.tanh(2.2);
    }
    drive.curve=c; drive.oversample="2x";
  }
  const limiter=ctx.createDynamicsCompressor();
  limiter.threshold.value=-7;
  limiter.knee.value=6;              // softer knee: squeezes, does not clamp
  limiter.ratio.value=9;
  // A slow attack lets the first few milliseconds through untouched, which is
  // exactly the part the ear reads as force. A fast attack would flatten it.
  limiter.attack.value=0.012;
  limiter.release.value=0.45;
  master.connect(drive);
  drive.connect(limiter);
  limiter.connect(ctx.destination);

  // Filling the noise buffers takes a few hundred thousand samples of work.
  // Reading the clock before that meant the audio was scheduled from an
  // instant that had already passed by the time the animation began, which is
  // why the sound ran a fraction ahead. Everything heavy happens first, then
  // both clocks are read together.
  const preLen=Math.ceil(SR*D+SR*0.4);
  const preBuf=ctx.createBuffer(1,preLen,SR);
  const pre=preBuf.getChannelData(0);
  {
    let b0=0,b1=0,b2=0;
    for(let i=0;i<preLen;i++){
      const w=Math.random()*2-1;
      b0=0.99765*b0+w*0.0990460;
      b1=0.96300*b1+w*0.2965164;
      b2=0.57000*b2+w*1.0526913;
      pre[i]=(b0+b1+b2+w*0.1848)*0.32;
    }
  }
  const impLen=Math.ceil(SR*1.6);   // longer: it is played back slowed down
  const impBuf=ctx.createBuffer(1,impLen,SR);
  {
    const d=impBuf.getChannelData(0);
    let m0=0;
    for(let i=0;i<impLen;i++){
      const w=Math.random()*2-1;
      m0=(m0+0.035*w)/1.035;
      d[i]=m0*3.4*Math.pow(1-i/impLen,1.3);   // slower decay, more rubble
    }
  }

  // A small lead so both media start on the same future instant, plus whatever
  // the device needs to actually push audio out of the speaker.
  const LEAD=0.08+(ctx.baseLatency||0)+(ctx.outputLatency||0);
  const now=ctx.currentTime+LEAD;

  // The visuals use this exact curve, so the sound is built from it too. The
  // previous version ramped linearly and ran far ahead of the star.
  // Climb and fall are different motions: rising loses speed as gravity
  // bites, the apex is almost still, and the descent accelerates hard. One
  // symmetric curve could not express that, which is why the arc felt flat.
  const CLIMB=0.50, HANG=0.10;
  const fall=(v)=>{
    if(v<CLIMB){
      const u=v/CLIMB;
      return 0.40*(1-Math.pow(1-u,2.3));    // ascent, easing out
    }
    if(v<CLIMB+HANG){
      const u=(v-CLIMB)/HANG;
      return 0.40+0.03*u;                   // suspended at the top
    }
    // Clamped: at the junction the subtraction can land a hair below zero,
    // and a negative base with a fractional exponent yields NaN.
    const u=Math.max(0,Math.min(1,(v-CLIMB-HANG)/(1-CLIMB-HANG)));
    return 0.43+0.57*Math.pow(u,2.5);       // descent, accelerating
  };
  const START=0.08, SPAN=0.72;                 // matches the animation phases
  const tImpact=now+D*(START+SPAN);

  // Sample the trajectory densely and schedule the sweep along it, so loudness
  // and pitch track the star frame for frame rather than approximating it.
  const STEPS=48;
  const curve=[];
  for(let i=0;i<=STEPS;i++){
    const p=START+SPAN*(i/STEPS);
    curve.push({t:now+D*p, k:fall(i/STEPS)});
  }

  // ---- entry roar ---------------------------------------------------------
  // A meteor is heard as torn air: broadband noise, low at first because
  // distance absorbs the highs, brightening as it closes in.
  const roar=ctx.createBufferSource();
  roar.buffer=preBuf;

  // Distance is mostly a low-pass: far away you hear only the rumble, and the
  // hiss arrives as it gets close.
  const air=ctx.createBiquadFilter();
  air.type="lowpass";
  air.Q.value=0.9;
  const body=ctx.createBiquadFilter();
  body.type="bandpass";
  body.Q.value=0.7;

  const roarGain=ctx.createGain();
  // Audible from the very first instant. A 15 ms swell only removes the click
  // of an abrupt start; anything longer and the star is seen before it is
  // heard. The filters likewise open at their near-field values.
  roarGain.gain.setValueAtTime(0.0001,now);
  roarGain.gain.linearRampToValueAtTime(0.70,now+0.015);
  air.frequency.setValueAtTime(1250,now);   // no bright hiss: this is not a tyre
  body.frequency.setValueAtTime(115,now);

  // The star leaves the viewer and travels away toward the temple, so it is
  // loudest and brightest at the start. Distance then takes the volume down
  // and, before that, eats the high frequencies - air absorbs treble long
  // before it absorbs bass, which is what makes something sound far off.
  const ZFAR=2.6;                              // matches the visual depth
  curve.forEach(({t,k})=>{
    const dist=k*ZFAR;                         // 0 near the viewer, ZFAR at the temple
    const near=1/(1+dist*dist*0.55);           // inverse-square falloff
    roarGain.gain.linearRampToValueAtTime(Math.max(0.005,0.70*near),t);
    air.frequency.linearRampToValueAtTime(190+1060*Math.pow(near,0.8),t);
    body.frequency.linearRampToValueAtTime(48+70*near,t);
  });
  // it never quite dies: the impact is heard from a distance
  roarGain.gain.linearRampToValueAtTime(0.05,tImpact);

  // Slow uneven surges, as air is displaced in gusts rather than smoothly.
  const buffet=ctx.createOscillator(); buffet.type="sine"; buffet.frequency.value=1.7;
  const buffetAmt=ctx.createGain(); buffetAmt.gain.value=0.16;
  buffet.connect(buffetAmt); buffetAmt.connect(roarGain.gain);
  buffet.start(now); buffet.stop(tImpact+0.3);

  const buffet2=ctx.createOscillator(); buffet2.type="sine"; buffet2.frequency.value=0.63;
  const buffetAmt2=ctx.createGain(); buffetAmt2.gain.value=0.11;
  buffet2.connect(buffetAmt2); buffetAmt2.connect(roarGain.gain);
  buffet2.start(now); buffet2.stop(tImpact+0.3);

  roar.connect(air); air.connect(body); body.connect(roarGain); roarGain.connect(master);
  roar.start(now); roar.stop(tImpact+0.3);

  // ---- doppler tone -------------------------------------------------------
  // A falling body has a pitch that rises while it approaches. Without it the
  // roar reads as wind rather than as something coming toward you.
  // Sub-bass, felt more than heard. A pure sine well below the range where the
  // ear picks out pitch, so it reads as mass rather than as a note.
  const dop=ctx.createOscillator();
  dop.type="sine";
  const dopFilt=ctx.createBiquadFilter();
  dopFilt.type="lowpass"; dopFilt.frequency.value=140; dopFilt.Q.value=0.7;
  const dopGain=ctx.createGain();
  dopGain.gain.setValueAtTime(0.34,now);
  dop.frequency.setValueAtTime(29,now);
  // Receding Doppler: the pitch drops as it pulls away.
  // Barely moves: a big object's rumble does not glide up and down the scale.
  curve.forEach(({t,k})=>{
    const dist=k*ZFAR;
    const near=1/(1+dist*dist*0.55);
    dop.frequency.linearRampToValueAtTime(22+11*near,t);
    dopGain.gain.linearRampToValueAtTime(Math.max(0.004,0.34*near),t);
  });
  dopGain.gain.linearRampToValueAtTime(0.03,tImpact);
  dop.connect(dopFilt); dopFilt.connect(dopGain); dopGain.connect(master);
  dop.start(now); dop.stop(tImpact+0.2);

  // ---- impact -------------------------------------------------------------
  // Two layers: an initial drop into the sub-bass, then a long ground tremor
  // underneath it. A single short thud reads as a small object; what sells
  // weight is how long the low end keeps ringing afterwards.
  // A short bright transient. The ear judges impact almost entirely from the
  // first few milliseconds, so this adds far more perceived force than pushing
  // the sub-bass louder ever could - and it costs no headroom.
  {
    const cLen=Math.ceil(SR*0.09);
    const cBuf=ctx.createBuffer(1,cLen,SR);
    const cd=cBuf.getChannelData(0);
    for(let i=0;i<cLen;i++){
      cd[i]=(Math.random()*2-1)*Math.pow(1-i/cLen,7);
    }
    const crack=ctx.createBufferSource(); crack.buffer=cBuf;
    const cHP=ctx.createBiquadFilter(); cHP.type="highpass"; cHP.frequency.value=900;
    const cPk=ctx.createBiquadFilter(); cPk.type="peaking";
    cPk.frequency.value=2600; cPk.Q.value=1.1; cPk.gain.value=8;
    const cG=ctx.createGain(); cG.gain.value=0.55;
    crack.connect(cHP); cHP.connect(cPk); cPk.connect(cG); cG.connect(master);
    crack.start(tImpact);
  }

  // A held breath immediately before the strike. Silence makes what follows
  // land far harder than any increase in level.
  roarGain.gain.linearRampToValueAtTime(0.10,tImpact-0.07);
  roarGain.gain.linearRampToValueAtTime(0.02,tImpact-0.012);

  // The strike itself: a hard crack that drops straight into the sub-bass.
  const boom=ctx.createOscillator();
  boom.type="sine";
  boom.frequency.setValueAtTime(190,tImpact);
  boom.frequency.exponentialRampToValueAtTime(12,tImpact+3.2);
  const boomGain=ctx.createGain();
  boomGain.gain.setValueAtTime(0.0001,tImpact);
  boomGain.gain.linearRampToValueAtTime(1.45,tImpact+0.005);
  boomGain.gain.exponentialRampToValueAtTime(0.0001,tImpact+8.5);
  boom.connect(boomGain); boomGain.connect(master);
  boom.start(tImpact); boom.stop(tImpact+8.6);

  // A second, slightly detuned layer thickens the blow without simply
  // doubling the volume, which would only clip.
  const boom2=ctx.createOscillator();
  boom2.type="sine";
  boom2.frequency.setValueAtTime(112,tImpact+0.02);
  boom2.frequency.exponentialRampToValueAtTime(13,tImpact+1.9);
  const boom2Gain=ctx.createGain();
  boom2Gain.gain.setValueAtTime(0.0001,tImpact+0.02);
  boom2Gain.gain.linearRampToValueAtTime(0.88,tImpact+0.030);
  boom2Gain.gain.exponentialRampToValueAtTime(0.0001,tImpact+9.2);
  boom2.connect(boom2Gain); boom2Gain.connect(master);
  boom2.start(tImpact+0.02); boom2.stop(tImpact+9.3);

  // Mid-range body. Small speakers reproduce almost nothing below 150 Hz, so
  // an impact built only from sub-bass simply vanishes on a phone or tablet.
  // This band is what carries the weight on those devices.
  const mid=ctx.createOscillator();
  mid.type="triangle";
  mid.frequency.setValueAtTime(310,tImpact);
  mid.frequency.exponentialRampToValueAtTime(72,tImpact+0.45);
  const midG=ctx.createGain();
  midG.gain.setValueAtTime(0.0001,tImpact);
  midG.gain.linearRampToValueAtTime(0.50,tImpact+0.005);
  midG.gain.exponentialRampToValueAtTime(0.0001,tImpact+1.5);
  const midShape=ctx.createBiquadFilter();
  midShape.type="lowpass"; midShape.frequency.value=1400; midShape.Q.value=0.9;
  mid.connect(midShape); midShape.connect(midG); midG.connect(master);
  mid.start(tImpact); mid.stop(tImpact+1.6);

  // Ground tremor: what actually conveys tonnage is how long the low end
  // keeps rolling once the strike itself has gone.
  const tremor=ctx.createOscillator();
  tremor.type="sine";
  tremor.frequency.setValueAtTime(36,tImpact);
  tremor.frequency.exponentialRampToValueAtTime(8,tImpact+10.5);
  const tremorGain=ctx.createGain();
  tremorGain.gain.setValueAtTime(0.0001,tImpact);
  tremorGain.gain.linearRampToValueAtTime(1.20,tImpact+0.045);
  tremorGain.gain.exponentialRampToValueAtTime(0.0001,tImpact+11.0);
  const shudder=ctx.createOscillator(); shudder.type="sine"; shudder.frequency.value=4.2;
  const shudderAmt=ctx.createGain(); shudderAmt.gain.value=0.24;
  shudder.connect(shudderAmt); shudderAmt.connect(tremorGain.gain);
  shudder.start(tImpact); shudder.stop(tImpact+11.0);
  tremor.connect(tremorGain); tremorGain.connect(master);
  tremor.start(tImpact); tremor.stop(tImpact+11.1);

  // The blast rolling away and coming back off the temple walls.
  // Echoes rolling out across the valley. Each returns later, lower, softer
  // and duller than the last, so the blast recedes rather than simply stopping.
  const echoTimes=[0.34,0.71,1.24,1.95,2.9,4.1,5.6,7.4];
  echoTimes.forEach((dt,i)=>{
    const e=ctx.createOscillator(); e.type="sine";
    const f0=64*Math.pow(0.88,i);
    e.frequency.setValueAtTime(f0,tImpact+dt);
    e.frequency.exponentialRampToValueAtTime(Math.max(9,f0*0.34),tImpact+dt+1.4+i*0.3);
    const eg=ctx.createGain();
    const amp=0.52*Math.pow(0.68,i);
    eg.gain.setValueAtTime(0.0001,tImpact+dt);
    // distant echoes arrive softly rather than snapping in
    eg.gain.linearRampToValueAtTime(amp,tImpact+dt+0.03+i*0.02);
    eg.gain.exponentialRampToValueAtTime(0.0001,tImpact+dt+1.8+i*0.45);
    // and progressively lose their edges
    const eLP=ctx.createBiquadFilter();
    eLP.type="lowpass"; eLP.frequency.value=Math.max(45,300*Math.pow(0.78,i));
    e.connect(eLP); eLP.connect(eg); eg.connect(master);
    e.start(tImpact+dt); e.stop(tImpact+dt+2.0+i*0.5);
  });

  // A last breath of air moving through the ruin, long after the sound has
  // gone. It is what stops the silence arriving abruptly.
  const settleLen=Math.ceil(SR*6);
  const settleBuf=ctx.createBuffer(1,settleLen,SR);
  {
    const d=settleBuf.getChannelData(0);
    let s0=0;
    for(let i=0;i<settleLen;i++){
      const w=Math.random()*2-1;
      s0=(s0+0.02*w)/1.02;
      d[i]=s0*2.6;
    }
  }
  const settle=ctx.createBufferSource(); settle.buffer=settleBuf;
  const settleLP=ctx.createBiquadFilter();
  settleLP.type="lowpass";
  settleLP.frequency.setValueAtTime(320,tImpact+1.0);
  settleLP.frequency.exponentialRampToValueAtTime(70,tImpact+9.0);
  const settleG=ctx.createGain();
  settleG.gain.setValueAtTime(0.0001,tImpact+1.0);
  settleG.gain.linearRampToValueAtTime(0.13,tImpact+1.8);
  settleG.gain.exponentialRampToValueAtTime(0.0001,tImpact+10.5);
  settle.connect(settleLP); settleLP.connect(settleG); settleG.connect(master);
  settle.playbackRate.value=0.7;
  settle.start(tImpact+1.0);

  const crash=ctx.createBufferSource(); crash.buffer=impBuf;
  const crashLP=ctx.createBiquadFilter();
  crashLP.type="lowpass";
  // Opens briefly on the strike, then closes as the dust settles.
  crashLP.frequency.setValueAtTime(900,tImpact);
  crashLP.frequency.exponentialRampToValueAtTime(60,tImpact+3.4);
  const crashGain=ctx.createGain();
  crashGain.gain.setValueAtTime(1.35,tImpact);
  crashGain.gain.exponentialRampToValueAtTime(0.0001,tImpact+5.0);
  crash.connect(crashLP); crashLP.connect(crashGain); crashGain.connect(master);
  crash.playbackRate.value=0.55;          // stretched: bigger, slower rubble
  crash.start(tImpact);

  // ---- bells --------------------------------------------------------------
  const tBells=tImpact+3.0;      // once the blast has rolled away
  const scale=[1046.50,1174.66,1396.91,1567.98,2093.00,2349.32,2793.83];
  [4,0,2,5,1,6,3,4].forEach((idx,n)=>{
    const t=tBells+n*0.085+Math.random()*0.03;
    const f=scale[idx];
    const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=f;
    const g=ctx.createGain();
    const peak=0.13*(1-n*0.06);   // heard from across the sanctuary
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(peak,t+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001,t+1.6);
    o.connect(g); g.connect(master); o.start(t); o.stop(t+1.7);

    const p=ctx.createOscillator(); p.type="sine"; p.frequency.value=f*2.76;
    const pg=ctx.createGain();
    pg.gain.setValueAtTime(0.0001,t);
    pg.gain.exponentialRampToValueAtTime(peak*0.30,t+0.006);
    pg.gain.exponentialRampToValueAtTime(0.0001,t+0.85);
    p.connect(pg); pg.connect(master); p.start(t); p.stop(t+0.9);
  });

  const deep=ctx.createOscillator(); deep.type="sine"; deep.frequency.value=261.63;
  const dg=ctx.createGain();
  dg.gain.setValueAtTime(0.0001,tBells);
  dg.gain.exponentialRampToValueAtTime(0.22,tBells+0.02);
  dg.gain.exponentialRampToValueAtTime(0.0001,tBells+2.4);
  deep.connect(dg); dg.connect(master);
  deep.start(tBells); deep.stop(tBells+2.5);

  const stop=()=>{
    try{
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0,ctx.currentTime,0.05);
      setTimeout(()=>ctx.close().catch(()=>{}),300);
    }catch(e){}
  };
  setTimeout(stop,duration+14000);  // the tail runs well past the animation
  stop.lead=LEAD;          // seconds the visuals should wait to stay in step
  return stop;
}

function StarJourney({color,icon,from,onDone}){
  const canvasRef=React.useRef(null);
  const rafRef=React.useRef(null);
  const DURATION=7000;

  React.useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas) return;
    const ctx=canvas.getContext("2d");
    const dpr=pixelRatio();
    const W=window.innerWidth, H=window.innerHeight;
    canvas.width=W*dpr; canvas.height=H*dpr; ctx.scale(dpr,dpr);

    // Where the star was, and where the altar waits.
    const x0=from?.px ?? W*0.5;
    const y0=from?.py ?? H*0.25;
    const r0=from?.radius ?? 28;
    const spin0=from?.spin ?? 0;
    const tw0=from?.twinkle ?? 0;
    // ---- 3D approach -------------------------------------------------------
    // The star does not slide across the screen: it flies in from deep space,
    // grows as it nears the temple, drops through the roof and hits the floor.
    // A single depth value z drives position and scale together, so the growth
    // and the motion stay physically consistent.
    // The star travels away from the viewer, toward the temple standing in the
    // distance. So it must SHRINK as it goes: the vanishing point is the
    // building, not the camera. Depth runs from 0 (near, where the star was)
    // to ZT (the temple), and scale falls off with distance.
    const FOV=3.4;
    const persp=(z)=>FOV/(FOV+z);
    const ZT=2.6;                          // how far away the temple sits
    const floorX=W*0.5, floorY=H*0.70;     // impact point on the cella floor
    const roofY=H*0.30;

    // Anchors are screen positions; depth only scales the star.
    const P0={x:x0,     y:y0,            z:0};    // where it was tapped
    const P1={x:(x0+W*0.5)/2, y:Math.max(H*0.06, roofY-H*0.30), z:ZT*0.55};  // up at the cloud line
    const P2={x:W*0.5,  y:Math.max(H*0.10, roofY-H*0.22),  z:ZT};    // lined up above the roof
    const P3={x:floorX, y:floorY,        z:ZT};    // the cella floor

    // Cubic Bezier through all four: the arc across the sky and the plunge
    // inside are the same stroke, so there is no join to feel.
    const cub=(a,b,c,d,k)=>{
      const m=1-k;
      return m*m*m*a + 3*m*m*k*b + 3*m*k*k*c + k*k*k*d;
    };
    const path3=(k)=>({
      x:cub(P0.x,P1.x,P2.x,P3.x,k),
      y:cub(P0.y,P1.y,P2.y,P3.y,k),
      z:cub(P0.z,P1.z,P2.z,P3.z,k),
    });
    const bez=(a,b,c,k)=>{const m=1-k;return m*m*a+2*m*k*b+k*k*c;};
    const easeInOut=(v)=>v<0.5?4*v*v*v:1-Math.pow(-2*v+2,3)/2;
    // Gravity: barely moves at first, then accelerates, braking only at the end.
    // Eases out of the constellation, cruises, then commits to the drop.
    // Smooth, monotonic acceleration. The old blend of two curves produced a
    // slow patch mid-flight followed by a lurch; this keeps speed always rising.
    // Climb and fall are different motions: rising loses speed as gravity
    // bites, the apex is almost still, and the descent accelerates hard. One
    // symmetric curve could not express that, which is why the arc felt flat.
    const CLIMB=0.50, HANG=0.10;
    const fall=(v)=>{
      if(v<CLIMB){
        const u=v/CLIMB;
        return 0.40*(1-Math.pow(1-u,2.3));      // ascent, easing out
      }
      if(v<CLIMB+HANG){
        const u=(v-CLIMB)/HANG;
        return 0.40+0.03*u;                     // suspended at the top
      }
      // Clamped: at the junction the subtraction can land a hair below zero,
      // and a negative base with a fractional exponent yields NaN - which
      // showed up as a single dropped frame.
      const u=Math.max(0,Math.min(1,(v-CLIMB-HANG)/(1-CLIMB-HANG)));
      return 0.43+0.57*Math.pow(u,2.5);         // descent, accelerating
    };

    // The same sun renderer the constellation uses, so it is visibly the
    // same object continuing its motion.
    const drawSun=(cx,cy,r,spin,tw,t,alpha,rayScale)=>{
      const puls=0.9+Math.sin(tw)*0.1;
      ctx.save(); ctx.translate(cx,cy);
      const hex=(v)=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0");

      const corona=ctx.createRadialGradient(0,0,r*0.5,0,0,r*3.4);
      corona.addColorStop(0,color+hex(90*alpha*puls));
      corona.addColorStop(0.35,color+hex(40*alpha));
      corona.addColorStop(1,"transparent");
      ctx.beginPath();ctx.arc(0,0,r*3.4,0,Math.PI*2);ctx.fillStyle=corona;ctx.fill();

      ctx.save(); ctx.rotate(spin+t*0.35);
      for(let i=0;i<16;i++){
        const a=(i/16)*Math.PI*2, long=i%2===0;
        const len=r*(long?2.9:1.9)*puls*rayScale;
        const w=r*(long?0.16:0.10);
        const rg=ctx.createLinearGradient(Math.cos(a)*r*0.85,Math.sin(a)*r*0.85,Math.cos(a)*len,Math.sin(a)*len);
        rg.addColorStop(0,"rgba(255,255,255,"+(0.75*alpha)+")");
        rg.addColorStop(0.3,color+hex(190*alpha));
        rg.addColorStop(1,"transparent");
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*r*0.8-Math.sin(a)*w, Math.sin(a)*r*0.8+Math.cos(a)*w);
        ctx.lineTo(Math.cos(a)*len, Math.sin(a)*len);
        ctx.lineTo(Math.cos(a)*r*0.8+Math.sin(a)*w, Math.sin(a)*r*0.8-Math.cos(a)*w);
        ctx.closePath(); ctx.fillStyle=rg; ctx.fill();
      }
      ctx.restore();

      const disc=ctx.createRadialGradient(-r*0.22,-r*0.22,r*0.03,0,0,r);
      disc.addColorStop(0,"rgba(255,255,255,"+(0.98*alpha)+")");
      disc.addColorStop(0.25,"rgba(255,250,220,"+(0.92*alpha)+")");
      disc.addColorStop(0.5,color+hex(240*alpha));
      disc.addColorStop(0.85,color+hex(170*alpha));
      disc.addColorStop(1,"rgba(0,0,0,"+(0.32*alpha)+")");
      ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fillStyle=disc;ctx.fill();

      ctx.beginPath();ctx.arc(0,0,r*0.99,0,Math.PI*2);
      ctx.strokeStyle="rgba(255,255,255,"+(0.55*alpha)+")";
      ctx.lineWidth=Math.max(0.9,r*0.07); ctx.stroke();
      ctx.restore();
    };

    // Stone block the star collapses into.
    const drawStone=(cx,cy,r,k)=>{
      ctx.save(); ctx.translate(cx,cy);
      const g=ctx.createRadialGradient(-r*0.3,-r*0.35,r*0.05,0,0,r*1.1);
      g.addColorStop(0,"#efe9d9"); g.addColorStop(0.45,"#c4bfae");
      g.addColorStop(0.8,"#8f8b7e"); g.addColorStop(1,"#5f5e57");
      ctx.beginPath();
      for(let i=0;i<10;i++){
        const a=(i/10)*Math.PI*2-Math.PI/2;
        const sr=i%2===0?r:r*0.42;
        const br=i%2===0?r*0.72:r*0.66;
        const rr=sr+(br-sr)*k;
        i===0?ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr):ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr);
      }
      ctx.closePath();
      ctx.globalAlpha=k; ctx.fillStyle=g; ctx.fill();
      ctx.strokeStyle="#6b6a63"; ctx.lineWidth=1.6; ctx.stroke();
      ctx.globalAlpha=1; ctx.restore();
    };


    // Fires once, alongside the animation, and is torn down with it.
    const stopSound=playJourneySound(DURATION);

    // Start on the same instant the audio was scheduled for, so the first
    // frame and the first sample line up.
    const t0=performance.now()+((stopSound&&stopSound.lead)||0)*1000;
    const frame=(now)=>{
      const p=Math.max(0,Math.min(1,(now-t0)/DURATION));
      const t=(now-t0)/1000;

      // 0.00-0.14  the star breaks free and hangs
      // 0.14-0.62  it falls, gathering speed the whole way
      // 0.62-0.72  impact
      // 0.72-1.00  the glow dies and the stone sets
      // Short charge, then a genuinely fast dive: the fall now occupies a
      // quarter of the timeline instead of half, so it reads as speed while
      // the impact and the settling keep room to breathe.
      // 0.00-0.12 charge  0.12-0.60 flight  0.60-0.74 impact  0.74-1.00 stone
      // The phases now run right to the end: nothing is left holding a frozen
      // frame while the clock runs out.
      const travel=fall(Math.min(1,Math.max(0,(p-0.08)/0.72)));
      // Deliberately NOT clamped: past 1 the debris keeps flying and fading,
      // and the block below stops drawing entirely once it is spent. Clamping
      // is what left the explosion frozen on screen at the end.
      const impact=Math.max(0,(p-0.79)/0.13);
      const settle=Math.max(0,Math.min(1,(p-0.85)/0.15));

      // charge-up: while still in place the star pulses and trembles
      const charge=Math.max(0,Math.min(1,p/0.14));
      const shiver=charge<1 ? Math.sin(t*26)*2.2*charge : 0;
      // Two legs: approach through space to the roof, then the drop inside.
      // A single cubic curve from the constellation to the floor. Splitting the
      // path into "fly" and "drop" put a corner in the middle, which is what
      // made the motion snap. One curve, one speed profile, no seam.
      const q=path3(travel);
      const sc=persp(q.z);
      const cx=q.x+shiver;
      const cy=q.y+Math.cos(t*22)*1.6*(charge<1?charge:0);
      // true once the star has passed the roofline and is inside the building
      const inside=cy>roofY;
      // Size holds, then flares on impact, then compacts into stone.
      // Distance shrinks it; the flash and the collapse are the only growth.
      const r=r0*sc*(1+charge*0.32+Math.min(1,impact)*0.18-settle*0.28);
      const spin=spin0+Math.pow(travel,1.4)*17;
      const tw=tw0+t*2.4;

      ctx.clearRect(0,0,W,H);

      // Trail: ghosts of the path just travelled.
      if(travel>0.02&&travel<1){
        const at=(k)=>{const q2=path3(k);return {x:q2.x,y:q2.y,s:persp(q2.z)};};
        for(let i=1;i<=14;i++){
          const k=Math.max(0,travel-i*0.020);
          const q=at(k);
          drawSun(q.x,q.y,r0*q.s*(1-i*0.035),spin-i*0.3,tw,t,0.15-i*0.009,0.4);
        }
      }

      // Impact effects
      // No blast: the star simply gives way to the stone. A brief bloom of its
      // own light is all that marks the moment of change.
      if(impact>0&&impact<1.4){
        const bloom=Math.pow(Math.max(0,1-impact),1.6);
        const g=ctx.createRadialGradient(floorX,floorY,0,floorX,floorY,220*(0.4+impact*0.9));
        g.addColorStop(0,color+Math.round(bloom*150).toString(16).padStart(2,"0"));
        g.addColorStop(0.5,color+Math.round(bloom*50).toString(16).padStart(2,"0"));
        g.addColorStop(1,"transparent");
        ctx.fillStyle=g;
        ctx.fillRect(0,0,W,H);
      }

      // Passing through the roof: a flash along the roofline and a torn hole
      // that glows for a moment, so the entry reads as breaching the building.
      const pierce=Math.max(0,Math.min(1,(cy-roofY)/70));
      if(travel>0.5&&pierce>0&&pierce<1){
        const pg=ctx.createLinearGradient(0,roofY-26,0,roofY+26);
        pg.addColorStop(0,"transparent");
        pg.addColorStop(0.5,color+Math.round((1-pierce)*190).toString(16).padStart(2,"0"));
        pg.addColorStop(1,"transparent");
        ctx.fillStyle=pg; ctx.fillRect(0,roofY-26,W,52);
        ctx.beginPath();
        ctx.ellipse(W*0.5,roofY,46*(1-pierce*0.4),13*(1-pierce*0.4),0,0,Math.PI*2);
        ctx.fillStyle="rgba(255,255,255,"+((1-pierce)*0.8)+")"; ctx.fill();
      }

      // The star itself, then the stone it becomes.
      if(settle<1) drawSun(cx,cy,r,spin,tw,t,1-settle*0.9,1-settle*0.85);
      if(settle>0){
        drawStone(cx,cy,r,settle);
        // residual heat fading out of the freshly formed stone
        const heat=Math.max(0,1-settle)*0.7;
        if(heat>0.02){
          const hg=ctx.createRadialGradient(cx,cy,r*0.2,cx,cy,r*2.2);
          hg.addColorStop(0,color+Math.round(heat*160).toString(16).padStart(2,"0"));
          hg.addColorStop(1,"transparent");
          ctx.beginPath();ctx.arc(cx,cy,r*2.2,0,Math.PI*2);
          ctx.fillStyle=hg;ctx.fill();
        }
      }

      // Dust shaken loose from the entablature, drifting down through the
      // sanctuary. Nothing says "the building moved" like debris falling
      // afterwards.
      if(impact>0&&impact<2.6){
        const q=Math.exp(-impact*1.0);
        for(let i=0;i<26;i++){
          const seedX=((i*137.5)%100)/100;
          const px=W*(0.16+seedX*0.68);
          const delay=((i*37)%100)/100*0.5;
          const age=Math.max(0,impact-delay);
          if(age<=0) continue;
          const py=roofY+age*age*260+((i*53)%40);
          if(py>H) continue;
          const drift=Math.sin(age*2.4+i)*9;
          const a=Math.max(0,(1-age/2.2))*0.42*q;
          if(a<0.01) continue;
          ctx.beginPath();
          ctx.arc(px+drift,py,1.1+((i*7)%3)*0.5,0,Math.PI*2);
          ctx.fillStyle="rgba(214,206,182,"+a.toFixed(3)+")";
          ctx.fill();
        }
      }

      // Publish the shake so the temple can react. Written to a global rather
      // than to state, because sixty rerenders a second would stutter.
      try{
        if(impact>0&&impact<3.2){
          const decay=Math.exp(-impact*1.15);
          window.__maestroQuake=decay;
        }else{
          window.__maestroQuake=0;
        }
      }catch(e){}

      // Dissolve the overlay over the last stretch: a hard cut at the end reads
      // as a freeze, a fade hands over to the temple cleanly.
      // Begins only once the stone has fully set, and runs to the very last
      // frame - any gap between the two shows up as a pause.
      if(p>0.86) canvas.style.opacity=String(Math.max(0,Math.pow((1-p)/0.14,0.7)));

      if(p<1) rafRef.current=requestAnimationFrame(frame);
      else onDone&&onDone();
    };
    rafRef.current=requestAnimationFrame(frame);
    return()=>{cancelAnimationFrame(rafRef.current);stopSound&&stopSound();try{window.__maestroQuake=0;}catch(e){}};
  },[from,color,onDone]);

  return <canvas ref={canvasRef}
    style={{position:"fixed",inset:0,zIndex:120,pointerEvents:"none",
            width:"100vw",height:"100vh"}}/>;
}

function StarField({section,color,icon,label,onBack,onSelect}){
  const canvasRef=React.useRef(null);
  const stateRef=React.useRef(null);
  const rafRef=React.useRef(null);

  React.useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas) return;
    const ctx=canvas.getContext("2d");
    const dpr=pixelRatio();
    let W=canvas.offsetWidth,H=canvas.offsetHeight;
    canvas.width=W*dpr; canvas.height=H*dpr; ctx.scale(dpr,dpr);

    const cats=section.categories;
    const N=cats.length;

    // 3D spherical distribution using golden angle (Fibonacci sphere)
    const stars=cats.map((cat,i)=>{
      const golden=Math.PI*(3-Math.sqrt(5));
      // Keep away from the exact poles: points there sit on the rotation
      // axis and would appear frozen. 0.78 caps latitude at ~±51 degrees.
      const yNorm=(N>1?1-(i/(N-1))*2:0)*0.78;
      const rAtY=Math.sqrt(Math.max(0.12,1-yNorm*yNorm));
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
        drawWrappedLabel(ctx,s.cat.label,s.x,s.y+r*2.0,W,Math.max(70,r*4.5));
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
      if(now-lastFrame<(window.__maestroSpeaking?200:(LOW_MEM?40:16))) return;
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
        // Spring rather than a plain approach: a real object overshoots slightly
        // and settles, which reads as alive; linear interpolation reads as a slide.
        {
          const target=s.hovered?1.45:1;
          s.vel=(s.vel||0)+(target-s.scale)*60*dt;
          s.vel*=Math.pow(0.004,dt);
          s.scale+=s.vel*dt;
        }
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
    const onTap=(e)=>{
      const[mx,my]=pos(e);
      let best=null,bd=1e9;
      stateRef.current.stars.forEach(s=>{const dx=mx-s.x,dy=my-s.y;const d=Math.sqrt(dx*dx+dy*dy);if(d<s.size*1.8&&s.z>-0.3&&d<bd){bd=d;best=s;}});
      if(best){
        // Hand over the star's real on-screen state - position, drawn radius,
        // spin and twinkle - so the transition continues the very same star
        // instead of spawning a new one.
        const r=canvas.getBoundingClientRect();
        const origin={
          px:r.left+best.x,
          py:r.top+best.y,
          radius:best.size*best.scale,
          spin:best.spin,
          twinkle:best.twinkle,
          depth:best.depth,
        };
        onSelect({...best.cat,sectionColor:color},origin);
      }
    };
    const resize=()=>{const d=pixelRatio();W=canvas.offsetWidth;H=canvas.offsetHeight;canvas.width=W*d;canvas.height=H*d;ctx.setTransform(1,0,0,1,0,0);ctx.scale(d,d);};
    window.addEventListener("resize",resize);
    canvas.addEventListener("mousemove",onMove);
    canvas.addEventListener("touchmove",onMove,{passive:true});
    canvas.addEventListener("click",onTap);
    canvas.addEventListener("touchend",onTap);
    return()=>{cancelAnimationFrame(rafRef.current);window.removeEventListener("resize",resize);};
  },[section,color,icon]);

  return(
    <div style={{position:"relative",width:"100%",height:"calc(100vh - 70px)",animation:"fadeIn .45s var(--ease-out) both"}}>
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
    const dpr=pixelRatio();
    let W=canvas.offsetWidth, H=canvas.offsetHeight;
    canvas.width=W*dpr; canvas.height=H*dpr;
    ctx.scale(dpr,dpr);
    const N=MAIN_ORBS.length;

    // 3D orbital setup — spherical distribution using golden angle
    const orbs=MAIN_ORBS.map((o,i)=>{
      const golden=Math.PI*(3-Math.sqrt(5));
      // Avoid the exact poles, which lie on the spin axis and look static.
      const yNorm=(1-(i/(N-1))*2)*0.78;
      const rAtY=Math.sqrt(Math.max(0.12,1-yNorm*yNorm)); // ring radius at that latitude
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
        drawWrappedLabel(ctx,o.label,o.x,o.y+r+4,W,Math.max(70,r*4.5));
        ctx.restore();
      }
    };

    let t=0;
    let lastTime=performance.now();
    let lastFrame=0;
    const loop=(now)=>{
      rafRef.current=requestAnimationFrame(loop);
      // Cap at ~30fps to leave CPU headroom for the audio scheduler
      if(now-lastFrame<(window.__maestroSpeaking?200:(LOW_MEM?40:16))) return;
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
        {
          const target=o.hovered?1.3:1;
          o.vel=(o.vel||0)+(target-o.scale)*60*dt;
          o.vel*=Math.pow(0.004,dt);
          o.scale+=o.vel*dt;
        }
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
      const d=pixelRatio();
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
      label={selected?.label} onBack={()=>setSubSpheres(null)}
      onSelect={(cat,origin)=>onSelect({...cat,icon:selected?.icon},origin)}/>
  );

  return(
    <div style={{position:"relative",width:"100%",height:"calc(100vh - 70px)"}}>
      <p style={{fontFamily:"monospace",fontSize:10,color:"#444",letterSpacing:"0.15em",textAlign:"center",paddingTop:6}}>// TOCA UNA ESFERA PARA EXPLORAR</p>
      <canvas ref={canvasRef} style={{width:"100%",height:"calc(100% - 24px)",cursor:"pointer",touchAction:"none",display:"block"}}/>
    </div>
  );
}


// A blank spinner for fifteen seconds feels broken. Naming what is happening,
// and letting each stage tick over, makes the wait legible.

// A sheet of papyrus: torn edges, horizontal and vertical fibres, blotches and
// a soft crease down the middle. Everything is drawn, so it scales cleanly and
// weighs nothing.
function Papyrus({children,tint="#c9a227"}){
  // The sheet used to be a full-size SVG with live turbulence filters, which
  // the browser re-evaluates while scrolling; on weaker devices that made the
  // text flicker and disappear. The texture is now painted once into a small
  // tiling image, so scrolling costs nothing.
  const texture=React.useMemo(()=>{
    const S=256;
    const c=document.createElement("canvas");
    c.width=S; c.height=S;
    const x=c.getContext("2d");
    const g=x.createLinearGradient(0,0,S,S);
    g.addColorStop(0,"#e8d9b0"); g.addColorStop(0.3,"#dfcda0");
    g.addColorStop(0.6,"#e6d7ad"); g.addColorStop(1,"#d3bf91");
    x.fillStyle=g; x.fillRect(0,0,S,S);
    for(let i=0;i<420;i++){
      const y=Math.random()*S, w=6+Math.random()*70, a=0.02+Math.random()*0.06;
      x.strokeStyle="rgba("+(140+Math.random()*40|0)+","+(118+Math.random()*36|0)+","+(70+Math.random()*30|0)+","+a+")";
      x.lineWidth=0.6+Math.random()*1.5;
      x.beginPath(); x.moveTo(Math.random()*S,y);
      x.lineTo(Math.random()*S+w,y+(Math.random()-0.5)*1.6); x.stroke();
    }
    for(let i=0;i<260;i++){
      const px=Math.random()*S, h=6+Math.random()*60, a=0.015+Math.random()*0.045;
      x.strokeStyle="rgba("+(132+Math.random()*36|0)+","+(112+Math.random()*30|0)+","+(66+Math.random()*26|0)+","+a+")";
      x.lineWidth=0.5+Math.random()*1.2;
      x.beginPath(); x.moveTo(px,Math.random()*S);
      x.lineTo(px+(Math.random()-0.5)*1.6,Math.random()*S+h); x.stroke();
    }
    for(let i=0;i<26;i++){
      const bx=Math.random()*S, by=Math.random()*S, r=8+Math.random()*34;
      const bg=x.createRadialGradient(bx,by,0,bx,by,r);
      bg.addColorStop(0,"rgba(150,120,66,"+(0.05+Math.random()*0.07)+")");
      bg.addColorStop(1,"rgba(150,120,66,0)");
      x.fillStyle=bg; x.beginPath(); x.arc(bx,by,r,0,Math.PI*2); x.fill();
    }
    return c.toDataURL("image/png");
  },[]);

  // Real torn paper has uneven spacing and the odd deep tear, not evenly
  // spaced bumps. Each sheet gets its own outline.
  const tornEdge=React.useMemo(()=>{
    let seed=Math.floor(Math.random()*99999)+1;
    const rnd=()=>{seed=(seed*9301+49297)%233280;return seed/233280;};
    const pts=[];
    const side=(from,to,axis,near)=>{
      let t=0;
      while(t<1){
        t=Math.min(1,t+0.020+rnd()*0.055);
        // Papyrus wears at the edge rather than tearing: mostly shallow
        // irregularity with the occasional slightly deeper nick.
        // Kept shallow on purpose: the clip path cuts pixels, so a deep bite
        // would slice into the words rather than just the margin.
        const deep=rnd()<0.08;
        const bite=deep?(0.35+rnd()*0.35):(0.03+rnd()*0.22);
        const v=near?bite:100-bite;
        const along=from+(to-from)*t;
        pts.push(axis==="x"?[along,v]:[v,along]);
      }
    };
    side(0,100,"x",true, 0.22);   // top    - shallow, height is the long axis
    side(0,100,"y",false,1);      // right  - full depth, measured on width
    side(100,0,"x",false,0.22);   // bottom
    side(100,0,"y",true, 1);      // left
    return "polygon("+pts.map(([x,y])=>x.toFixed(1)+"% "+y.toFixed(1)+"%").join(", ")+")";
  },[]);

  const edgeWear=React.useMemo(()=>{
    let seed=Math.floor(Math.random()*99999)+1;
    const rnd=()=>{seed=(seed*9301+49297)%233280;return seed/233280;};
    const layers=[];
    // corners: always the most handled part of a sheet
    [[0,0],[100,0],[0,100],[100,100]].forEach(([cx,cy])=>{
      const a=(0.34+rnd()*0.20).toFixed(2), r=(17+rnd()*11).toFixed(0);
      layers.push(`radial-gradient(circle at ${cx}% ${cy}%, rgba(118,96,52,${a}), transparent ${r}%)`);
    });
    // scattered patches along top and bottom
    for(let i=0;i<5;i++){
      const x=(6+rnd()*88).toFixed(0), y=rnd()<0.5?0:100;
      const w=(16+rnd()*26).toFixed(0), h=(4+rnd()*4).toFixed(0);
      const a=(0.16+rnd()*0.22).toFixed(2);
      layers.push(`radial-gradient(ellipse ${w}% ${h}% at ${x}% ${y}%, rgba(126,104,58,${a}), transparent)`);
    }
    // and down the two sides
    for(let i=0;i<4;i++){
      const y=(8+rnd()*84).toFixed(0), x=rnd()<0.5?0:100;
      const w=(4+rnd()*4).toFixed(0), h=(14+rnd()*20).toFixed(0);
      const a=(0.14+rnd()*0.20).toFixed(2);
      layers.push(`radial-gradient(ellipse ${w}% ${h}% at ${x}% ${y}%, rgba(126,104,58,${a}), transparent)`);
    }
    layers.push("linear-gradient(180deg,rgba(132,110,64,.15),transparent 5%,transparent 95%,rgba(132,110,64,.17))");
    return layers.join(",");
  },[]);

  return(
    <div style={{position:"relative",margin:"0 0 20px",padding:"30px 28px 34px",
                 backgroundColor:"#dfcda0",
                 backgroundImage:"url("+texture+")",
                 backgroundSize:"256px 256px",
                 boxShadow:"0 8px 22px rgba(0,0,0,.55), inset 0 0 60px rgba(140,112,60,.22)",
                 clipPath:tornEdge,
                 overflow:"hidden"}}>
      <div aria-hidden style={{position:"absolute",top:0,bottom:0,left:"49.5%",width:4,
                               background:"linear-gradient(90deg,rgba(176,156,104,.30),rgba(240,228,194,.24))",
                               pointerEvents:"none"}}/>
      {/* Wear is uneven and different on every sheet: corners take the worst
          of it, then scattered patches along each edge. */}
      <div aria-hidden style={{position:"absolute",inset:0,pointerEvents:"none",background:edgeWear}}/>

      {/* A thin bright lip just inside the tear: torn fibre catches the light
          before the edge falls into shadow. */}
      <div aria-hidden style={{position:"absolute",inset:0,pointerEvents:"none",
        background:
          "linear-gradient(180deg,rgba(248,238,208,.30) 0 1.5px,transparent 3px),"+
          "linear-gradient(0deg,  rgba(248,238,208,.24) 0 1.5px,transparent 3px),"+
          "linear-gradient(90deg, rgba(248,238,208,.22) 0 1.5px,transparent 3px),"+
          "linear-gradient(270deg,rgba(248,238,208,.26) 0 1.5px,transparent 3px)"
      }}/>

      {/* Frayed fibre ends, denser at top and bottom where the weave is cut
          across rather than along. */}
      <div aria-hidden style={{position:"absolute",inset:0,pointerEvents:"none",
        background:"repeating-linear-gradient(90deg,rgba(146,122,70,.13) 0 1px,transparent 1px 3px)",
        WebkitMaskImage:"linear-gradient(180deg,#000 0,transparent 7px),linear-gradient(0deg,#000 0,transparent 7px)",
        maskImage:"linear-gradient(180deg,#000 0,transparent 7px),linear-gradient(0deg,#000 0,transparent 7px)"}}/>
      <div aria-hidden style={{position:"absolute",inset:0,pointerEvents:"none",
        background:"repeating-linear-gradient(180deg,rgba(146,122,70,.09) 0 1px,transparent 1px 4px)",
        WebkitMaskImage:"linear-gradient(90deg,#000 0,transparent 5px),linear-gradient(270deg,#000 0,transparent 5px)",
        maskImage:"linear-gradient(90deg,#000 0,transparent 5px),linear-gradient(270deg,#000 0,transparent 5px)"}}/>

      <div style={{position:"relative"}}>{children}</div>
    </div>
  );
}

function LoadingStages({color,category,note}){
  const STEPS=[
    "Leyendo tu descripción",
    "Consultando conocimiento técnico",
    "Ordenando los pasos",
    "Añadiendo herramientas y avisos",
    "Revisando la guía",
  ];
  const [i,setI]=React.useState(0);
  const [dots,setDots]=React.useState("");
  React.useEffect(()=>{
    // Stages advance on a slight curve: the middle ones take longer, which is
    // closer to how the request actually behaves.
    const delays=[900,2200,3200,2600,4000];
    let idx=0;
    const next=()=>{
      idx++;
      if(idx<STEPS.length){ setI(idx); tid=setTimeout(next,delays[idx]); }
    };
    let tid=setTimeout(next,delays[0]);
    const dt=setInterval(()=>setDots(d=>d.length>=3?"":d+"."),450);
    return()=>{clearTimeout(tid);clearInterval(dt);};
  },[]);

  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",
                 justifyContent:"center",minHeight:"55vh",gap:22,padding:"0 20px"}}>
      <div style={{position:"relative",width:64,height:64}}>
        <div style={{position:"absolute",inset:0,border:"2px solid rgba(255,255,255,0.06)",
                     borderTop:`2px solid ${color}`,borderRadius:"50%",
                     animation:"spin 1.1s cubic-bezier(.5,.1,.5,.9) infinite"}}/>
        <div style={{position:"absolute",inset:9,border:"2px solid rgba(255,255,255,0.04)",
                     borderBottom:`2px solid ${color}88`,borderRadius:"50%",
                     animation:"spin 1.7s cubic-bezier(.5,.1,.5,.9) infinite reverse"}}/>
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",
                     justifyContent:"center",fontSize:19,color,
                     animation:"pulseSoft 2s var(--ease-soft) infinite"}}>⬡</div>
      </div>

      <div style={{textAlign:"center"}}>
        <p style={{fontSize:15,color:"#dfe6ee",margin:0,fontFamily:"monospace"}}>
          {STEPS[i]}<span style={{color}}>{dots}</span>
        </p>
        {category&&(
          <p style={{fontSize:11,color:"#556",margin:"6px 0 0",fontFamily:"monospace"}}>
            // {category}
          </p>
        )}
        {note&&(
          <p style={{fontSize:11,color:"#f4a261",margin:"9px 0 0",fontFamily:"monospace",
                     animation:"fadeIn .3s var(--ease-out) both"}}>
            ⏳ {note}
          </p>
        )}
      </div>

      <div style={{display:"flex",gap:6}}>
        {STEPS.map((_,k)=>(
          <div key={k} style={{width:k===i?20:7,height:3,borderRadius:2,
            background:k<i?color:k===i?color:"rgba(255,255,255,0.1)",
            opacity:k<i?0.45:1,
            transition:"width .45s var(--ease-out), background .45s var(--ease-soft), opacity .45s linear"}}/>
        ))}
      </div>
    </div>
  );
}

function CatCard({cat,color,onClick}){
  const [hov,setHov]=useState(false);
  const ico=ICONS[cat.id]||ICONS.otro;
  return(
    <button style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,padding:"20px 12px 14px",border:`1px solid ${hov?color:"rgba(255,255,255,0.07)"}`,borderRadius:4,cursor:"pointer",transition:"transform .28s var(--ease-spring), box-shadow .3s var(--ease-out), border-color .25s var(--ease-soft), background .25s var(--ease-soft)",background:hov?"rgba(0,15,0,0.88)":"rgba(0,8,0,0.72)",transform:hov?"translateY(-2px)":"none",position:"relative",overflow:"hidden",boxShadow:hov?`0 0 18px ${color}44, inset 0 0 12px ${color}11`:"none"}}
      onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
      <span style={{position:"absolute",top:0,left:0,width:8,height:8,borderTop:`1px solid ${color}`,borderLeft:`1px solid ${color}`,opacity:hov?1:0.4}}/>
      <span style={{position:"absolute",top:0,right:0,width:8,height:8,borderTop:`1px solid ${color}`,borderRight:`1px solid ${color}`,opacity:hov?1:0.4}}/>
      <span style={{position:"absolute",bottom:0,left:0,width:8,height:8,borderBottom:`1px solid ${color}`,borderLeft:`1px solid ${color}`,opacity:hov?1:0.4}}/>
      <span style={{position:"absolute",bottom:0,right:0,width:8,height:8,borderBottom:`1px solid ${color}`,borderRight:`1px solid ${color}`,opacity:hov?1:0.4}}/>
      <div style={{width:40,height:40,display:"flex",alignItems:"center",justifyContent:"center",filter:hov?`drop-shadow(0 0 8px ${color})`:"drop-shadow(0 0 2px rgba(255,255,255,0.15))",transition:"filter .3s var(--ease-out)"}}>
        <CyberIcon d={ico.d} d2={ico.d2} color={color} size={30} gradId={`mg_${cat.id}`}/>
      </div>
      <span style={{fontSize:11,fontWeight:"700",fontFamily:"monospace",textAlign:"center",color:hov?color:"#c8ffd4",transition:"color .25s var(--ease-soft)",letterSpacing:"0.04em",lineHeight:1.3,textShadow:hov?`0 0 8px ${color}`:"0 0 6px rgba(0,255,65,0.3)"}}>
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
  const [activeGuideId,setActiveGuideId]=useState(null);
  const [loadingNote,setLoadingNote]=useState("");
  // Progress is stored per guide so a job left half done can be resumed.
  const [progress,setProgress]=useState(()=>{
    try{const v=localStorage.getItem("maestro_progress");return v?JSON.parse(v):{};}catch(e){return {};}
  });
  React.useEffect(()=>{
    try{localStorage.setItem("maestro_progress",JSON.stringify(progress));}catch(e){}
  },[progress]);
  const [search,setSearch]=useState("");
  const [history,setHistory]=useState(()=>{
    try{const s=localStorage.getItem("maestro_history")||sessionStorage.getItem("maestro_history");return s?JSON.parse(s):[];}catch(e){return [];}
  });
  // Persist on every change - additions, deletions and imports alike.
  React.useEffect(()=>{
    try{
      const data=JSON.stringify(history);
      localStorage.setItem("maestro_history",data);
      sessionStorage.setItem("maestro_history",data);
    }catch(e){}
  },[history]);
  const [viewHistory,setViewHistory]=useState(false);
  const [aiProvider,setAiProvider]=useState("claude");
  // API keys persist in this browser so they only need to be entered once.
  const [apiKeys,setApiKeys]=useState(()=>{
    try{
      const saved=localStorage.getItem("maestro_api_keys");
      return saved?JSON.parse(saved):{claude:"",gemini:""};
    }catch(e){return {claude:"",gemini:""};}
  });
  React.useEffect(()=>{
    try{localStorage.setItem("maestro_api_keys",JSON.stringify(apiKeys));}catch(e){}
  },[apiKeys]);
  const [showKeys,setShowKeys]=useState(false);
  const [showLog,setShowLog]=useState(false);
  const [fxOn,setFxOn]=useState(()=>{
    try{return localStorage.getItem("maestro_fx")!=="off";}catch(e){return true;}
  });
  const [journey,setJourney]=useState(null);
  // Stays true for as long as the temple screen is open, so the animation
  // properties below never change value mid-flight and retrigger themselves.
  const [enteredByStar,setEnteredByStar]=useState(false);
  const [histQuery,setHistQuery]=useState("");
  const [histFilter,setHistFilter]=useState("todas");   // todas | favoritas | seccion
  const [favourites,setFavourites]=useState(()=>{
    try{const v=localStorage.getItem("maestro_favs");return v?JSON.parse(v):[];}catch(e){return [];}
  });
  React.useEffect(()=>{
    try{localStorage.setItem("maestro_favs",JSON.stringify(favourites));}catch(e){}
  },[favourites]);
  const toggleFav=(id)=>setFavourites(f=>f.includes(id)?f.filter(x=>x!==id):[...f,id]);

  // The six categories used most often, so common jobs skip the orbital
  // navigation entirely.
  const frequentCategories=React.useMemo(()=>{
    const tally={};
    history.forEach(h=>{
      const c=h.category; if(!c?.id) return;
      if(!tally[c.id]) tally[c.id]={cat:c,n:0};
      tally[c.id].n++;
    });
    return Object.values(tally).sort((a,b)=>b.n-a.n).slice(0,6);
  },[history]);


  // --- backup ---------------------------------------------------------------
  // Everything lives in this browser's storage, so it vanishes if the site data
  // is cleared or the device changes. These let the user keep a copy.
  const exportHistory=()=>{
    const payload={
      app:"MAESTRO", version:1,
      exported:new Date().toISOString(),
      history, favourites, progress,
    };
    const blob=new Blob([JSON.stringify(payload,null,1)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`maestro-guias-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const importHistory=(file)=>{
    const r=new FileReader();
    r.onload=()=>{
      try{
        const d=JSON.parse(r.result);
        if(!Array.isArray(d.history)) throw new Error("formato");
        // Merge rather than replace, skipping guides already present.
        setHistory(prev=>{
          const seen=new Set(prev.map(x=>x.id));
          const added=d.history.filter(x=>!seen.has(x.id));
          return [...prev,...added].sort((a,b)=>b.id-a.id).slice(0,200);
        });
        if(Array.isArray(d.favourites)) setFavourites(f=>[...new Set([...f,...d.favourites])]);
        if(d.progress&&typeof d.progress==="object") setProgress(p=>({...d.progress,...p}));
        alert(`Importadas ${d.history.length} guías.`);
      }catch(e){
        alert("El archivo no tiene el formato esperado.");
      }
    };
    r.readAsText(file);
  };

  // --- connection -----------------------------------------------------------
  const [online,setOnline]=useState(typeof navigator==="undefined"?true:navigator.onLine);
  React.useEffect(()=>{
    const up=()=>setOnline(true), down=()=>setOnline(false);
    window.addEventListener("online",up);
    window.addEventListener("offline",down);
    return()=>{window.removeEventListener("online",up);window.removeEventListener("offline",down);};
  },[]);

  const deleteHistoryItem=(id)=>{
    setHistory(h=>h.filter(x=>x.id!==id));
    setFavourites(f=>f.filter(x=>x!==id));
    setProgress(p=>{const n={...p};delete n[id];return n;});
  };

  // Searches title, category, section and the words of every step, so a guide
  // can be found by what it was about and not only by its heading.
  const filteredHistory=React.useMemo(()=>{
    const q=histQuery.trim().toLowerCase();
    const norm=(v)=>String(v||"").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"");   // ignore accents
    const nq=norm(q);
    return history.filter(item=>{
      if(histFilter==="favoritas"&&!favourites.includes(item.id)) return false;
      if(!nq) return true;
      const hay=[
        item.guide?.titulo,
        item.problem,
        item.category?.label,
        item.category?.sectionLabel,
        ...(item.guide?.pasos||[]).flatMap(p=>[p.titulo,p.descripcion]),
        ...(item.guide?.herramientas||[]),
      ].map(norm).join(" ");
      return hay.includes(nq);
    });
  },[history,histQuery,histFilter,favourites]);

  // Highlights the matching fragment inside a line of text.
  const Highlight=({text})=>{
    const q=histQuery.trim();
    if(!q) return <>{text}</>;
    const norm=(v)=>String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const i=norm(text).indexOf(norm(q));
    if(i<0) return <>{text}</>;
    return(<>
      {text.slice(0,i)}
      <mark style={{background:"rgba(0,207,255,0.28)",color:"#bfefff",
                    borderRadius:2,padding:"0 2px"}}>{text.slice(i,i+q.length)}</mark>
      {text.slice(i+q.length)}
    </>);
  };

  const [autoSpoken,setAutoSpoken]=useState(false);
  const [rating,setRating]=useState(null);
  const [darkMode,setDarkMode]=useState(false);
  const [lang,setLang]=useState("es");
  const [level,setLevel]=useState("normal"); // "simple" | "normal" | "experto"
  const [guideLang,setGuideLang]=useState(()=>{
    try{
      const saved=localStorage.getItem("maestro_lang");
      if(saved) return saved;
      // Default to the device language when it is one we offer.
      const dev=(navigator.language||"es").toLowerCase();
      const hit=LANGUAGES.find(l=>dev===l.code.toLowerCase())
             || LANGUAGES.find(l=>dev.split("-")[0]===l.code.split("-")[0]);
      return hit?hit.code:"es";
    }catch(e){return "es";}
  });
  React.useEffect(()=>{
    try{localStorage.setItem("maestro_lang",guideLang);}catch(e){}
  },[guideLang]);
  const langInfo=LANGUAGES.find(l=>l.code===guideLang)||LANGUAGES[0];
  const { listening, speaking, startListening, stopListening, speak, stopSpeaking,
          voices, voicePref, setVoicePref } = useSpeech();

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

  // Matches the visible name, the section, and the everyday words above, so
  // "grifo" reaches Plomería and "nevera" reaches Electrodomésticos.
  const filtered=React.useMemo(()=>{
    const q=norm0(search.trim());
    if(!q) return null;
    const scored=ALL_CATS.map(c=>{
      const name=norm0(c.label), sect=norm0(c.sectionLabel);
      const syn=(SYNONYMS[c.id]||[]).map(norm0);
      let score=0;
      if(name.startsWith(q)) score=100;
      else if(name.includes(q)) score=80;
      else if(syn.some(w=>w===q)) score=70;
      else if(syn.some(w=>w.startsWith(q))) score=60;
      else if(syn.some(w=>w.includes(q)||q.includes(w))) score=45;
      else if(sect.includes(q)) score=25;
      return {c,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    return scored.map(x=>x.c);
  },[search]);

  const handleCategory=(cat,origin)=>{
    setSelectedCategory(cat); setSearch(""); setViewHistory(false);
    if(origin){
      // A star was tapped: play the descent, then reveal the temple.
      setEnteredByStar(true);
      setJourney({color:cat.sectionColor||"#00cfff",icon:cat.icon||"✦",from:origin});
      setScreen("describe");
    } else {
      setEnteredByStar(false);
      setScreen("describe");
    }
  };

  const fetchGuide=async()=>{
    if(!problem.trim()) return;
    setLoading(true);setScreen("guide");setCompletedSteps([]);setGuide(null);
    const lvlStr=level==="simple"?"Use very simple language for beginners, avoid technical terms, max 5 steps":level==="experto"?"Use technical professional language with advanced detail, 7-8 steps":"Use clear practical language, 5-7 steps";
    // The JSON keys stay in Spanish because the app reads them; only the values
    // are translated. Saying so explicitly avoids the model renaming the keys.
    const sys="You are a universal expert. Respond ONLY with valid JSON. Keys (keep these key names exactly as given, in Spanish): titulo, dificultad, tiempo, herramientas (array), pasos (array of {titulo,descripcion,consejo}), advertencia, cuando_llamar_profesional. "
      +lvlStr+". Write ALL values in "+langInfo.label+" ("+langInfo.native+"). "
      +"The dificultad value must be one of: Facil, Moderado, Dificil, Experto - keep those in Spanish.";
    const usr="Categoria: "+selectedCategory.label+". Consulta: "+problem+". Solo JSON.";
    const parse=(raw)=>{let p=null;try{p=JSON.parse(raw);}catch(e){}if(!p){try{const clean=raw.replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();p=JSON.parse(clean);}catch(e){}}if(!p){try{const m=raw.match(/\{[\s\S]*\}/);if(m)p=JSON.parse(m[0]);}catch(e){}}return p;};
    try{
      let raw="";
      if(aiProvider==="claude"){
        const h={"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"};
        if(apiKeys.claude) h["x-api-key"]=apiKeys.claude;
        // Same treatment as Gemini: overload and rate limits clear on their own.
        const TRANSIENT=[429,500,502,503,504,529];
        const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
        let res=null,lastErr="",lastStatus=0;
        for(let attempt=0;attempt<3;attempt++){
          if(attempt>0){
            setLoadingNote(`Servidor ocupado · reintentando (${attempt}/2)`);
            await wait(1200*Math.pow(2,attempt-1));
          }
          try{
            res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:h,
              body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:4000,system:sys,messages:[{role:"user",content:usr}]})});
          }catch(netErr){
            lastErr="Sin respuesta del servidor. Comprueba tu conexión.";
            lastStatus=0; continue;
          }
          if(res.ok) break;
          const e=await res.json().catch(()=>({}));
          lastStatus=res.status;
          lastErr=(e&&e.error&&e.error.message)?e.error.message:("Error "+res.status);
          if(!TRANSIENT.includes(res.status)) break;
        }
        setLoadingNote("");
        if(!res||!res.ok){
          const friendly =
            TRANSIENT.includes(lastStatus)
              ? "Los servidores de Claude están saturados. Prueba de nuevo en un minuto, o cambia a Gemini."
            : lastStatus===401
              ? "La clave de Claude no es válida. Revísala en ⚙️."
            : lastStatus===400
              ? "Falta la clave de Claude o la petición no es válida. Añádela en ⚙️."
            : lastErr||"Claude no respondió.";
          setGuide({error:true,msg:friendly,retryable:TRANSIENT.includes(lastStatus)||lastStatus===0});
          return;
        }
        const data=await res.json();
        raw=data.content.map(b=>b.text||"").join("").trim();
      } else {
        if(!apiKeys.gemini){setGuide({error:true,msg:"Necesitas una clave gratuita de Gemini para generar guías.",needsKey:true});return;}
        // Model names change over time; try current ones in order until one works.
        // Google retires models often, so a fixed list goes stale within months.
        // These are the current ones; if every single one is rejected as
        // unavailable, the code below asks the API which models this key can
        // actually use, so the app repairs itself instead of breaking.
        let GEMINI_MODELS=["gemini-3.7-flash","gemini-3.6-flash","gemini-flash-latest","gemini-3.5-flash","gemini-2.5-flash"];
        try{
          const cached=JSON.parse(localStorage.getItem("maestro_gemini_models")||"null");
          if(cached&&Array.isArray(cached.list)&&Date.now()-cached.at<7*24*3600*1000){
            GEMINI_MODELS=cached.list;      // discovered previously, still fresh
          }
        }catch(e){}
        let res=null,lastErr="",lastStatus=0;

        // Google returns 503 when a model is saturated and 429 when the free
        // quota is hit. Both clear on their own, so the request is retried with
        // a growing pause and, failing that, handed to another model. Only a
        // bad key or a malformed request is worth giving up on immediately.
        const TRANSIENT=[429,500,502,503,504];
        const wait=(ms)=>new Promise(r=>setTimeout(r,ms));

        outer:
        for(const m of GEMINI_MODELS){
          for(let attempt=0;attempt<3;attempt++){
            if(attempt>0){
              setLoadingNote(`Servidor ocupado · reintentando (${attempt}/2)`);
              await wait(1200*Math.pow(2,attempt-1));   // 1.2s, then 2.4s
            }
            try{
              res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+m+":generateContent?key="+apiKeys.gemini,
                {method:"POST",headers:{"Content-Type":"application/json"},
                 body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents:[{parts:[{text:usr}]}],generationConfig:{maxOutputTokens:4000}})});
            }catch(netErr){
              lastErr="Sin respuesta del servidor. Comprueba tu conexión.";
              lastStatus=0; continue;
            }
            if(res.ok) break outer;
            const e=await res.json().catch(()=>({}));
            lastStatus=res.status;
            lastErr=(e&&e.error&&e.error.message)?e.error.message:("Error "+res.status);
            if(!TRANSIENT.includes(res.status)) break;   // real problem: stop retrying
          }
          if(res&&res.ok) break;
          // "not found", "no longer available", "not supported" all mean this
          // particular model is gone - move on rather than giving up.
          const gone=lastStatus===404||/no longer available|not found|not supported|is not available/i.test(lastErr);
          if(lastStatus&&!TRANSIENT.includes(lastStatus)&&!gone) break;
          setLoadingNote("Probando otro modelo…");
        }

        // Last resort: ask Google what this key may use, then retry with the
        // newest suitable model and remember it for next time.
        if((!res||!res.ok)&&/no longer available|not found|is not available/i.test(lastErr)){
          try{
            setLoadingNote("Buscando un modelo disponible…");
            const lr=await fetch("https://generativelanguage.googleapis.com/v1beta/models?key="+apiKeys.gemini);
            if(lr.ok){
              const ld=await lr.json();
              const usable=(ld.models||[])
                .filter(m=>(m.supportedGenerationMethods||[]).includes("generateContent"))
                .map(m=>String(m.name||"").replace(/^models\//,""))
                .filter(n=>/^gemini-/.test(n)&&!/vision|embedding|aqa|tts|image|audio|robotics|live/i.test(n))
                // newest first, preferring flash for speed and cost
                .sort((a,b)=>{
                  const ver=(v)=>parseFloat((v.match(/gemini-([\d.]+)/)||[])[1]||0);
                  const flash=(v)=>/flash/.test(v)?1:0;
                  return (ver(b)-ver(a))||(flash(b)-flash(a));
                });
              if(usable.length){
                try{localStorage.setItem("maestro_gemini_models",JSON.stringify({at:Date.now(),list:usable.slice(0,6)}));}catch(e){}
                for(const m of usable.slice(0,3)){
                  res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+m+":generateContent?key="+apiKeys.gemini,
                    {method:"POST",headers:{"Content-Type":"application/json"},
                     body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents:[{parts:[{text:usr}]}],generationConfig:{maxOutputTokens:4000}})});
                  if(res.ok) break;
                  const e2=await res.json().catch(()=>({}));
                  lastStatus=res.status;
                  lastErr=(e2&&e2.error&&e2.error.message)?e2.error.message:("Error "+res.status);
                }
              }
            }
          }catch(e){}
        }
        setLoadingNote("");

        if(!res||!res.ok){
          const friendly =
            lastStatus===503||lastStatus===429
              ? "Los servidores de Google están saturados ahora mismo. Suele durar poco: prueba de nuevo en un minuto, o cambia a Claude."
            : lastStatus===400
              ? "La clave de Gemini no parece válida. Revísala en ⚙️."
            : lastStatus===403
              ? "La clave de Gemini no tiene permiso. Genera una nueva en aistudio.google.com."
            : lastErr||"Gemini no respondió.";
          setGuide({error:true,msg:friendly,retryable:lastStatus===503||lastStatus===429||lastStatus===0});
          return;
        }
        const data=await res.json();
        raw=(data&&data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts&&data.candidates[0].content.parts[0]&&data.candidates[0].content.parts[0].text)||"";
      }
      const parsed=parse(raw);
      if(!parsed){setGuide({error:true,msg:"Error al parsear respuesta.",raw:raw.slice(0,300)});return;}
      setGuide(parsed);
      const newEntry={id:Date.now(),category:selectedCategory,problem,guide:parsed,date:new Date().toLocaleDateString("es-ES"),ai:aiProvider,lang:guideLang};
      setActiveGuideId(newEntry.id);
      setHistory(prev=>[newEntry,...prev.slice(0,49)]);
    }catch(e){setGuide({error:true,msg:e.message||"Error de red."});}
    finally{setLoading(false);setLoadingNote("");}
  };

  const toggleStep=i=>setCompletedSteps(prev=>{
    const next=prev.includes(i)?prev.filter(s=>s!==i):[...prev,i];
    if(activeGuideId) setProgress(p=>({...p,[activeGuideId]:next}));
    return next;
  });
  const reset=()=>{setScreen("home");setSelectedCategory(null);setProblem("");setGuide(null);setCompletedSteps([]);setViewHistory(false);setSearch("");setEnteredByStar(false);setJourney(null);setHistQuery("");setHistFilter("todas");};

  // --- hardware back button -------------------------------------------------
  // Without this the device back button leaves the app entirely, even when the
  // user is three screens deep. Each screen pushes a history entry so back
  // steps through them instead.
  React.useEffect(()=>{
    const depth = viewHistory ? 1 : screen==="home" ? 0 : screen==="describe" ? 1 : 2;
    if(depth>0 && !window.history.state?.maestro){
      window.history.pushState({maestro:true,depth},"");
    }
    const onPop=()=>{
      if(viewHistory){ setViewHistory(false); return; }
      if(screen==="guide"){ setScreen("describe"); return; }
      if(screen==="describe"){ reset(); return; }
      // already home: let the browser handle it
    };
    window.addEventListener("popstate",onPop);
    return()=>window.removeEventListener("popstate",onPop);
  },[screen,viewHistory]);

  const openHistoryItem=item=>{
    setSelectedCategory(item.category);
    setGuide(item.guide);
    setActiveGuideId(item.id);
    setCompletedSteps(progress[item.id]||[]);   // resume where it was left
    setViewHistory(false);
    setScreen("guide");
  };

  const diffColor={Facil:"#57cc99",Moderado:"#f4a261",Dificil:"#ff6b6b",Experto:"#f72585"};
  const accentColor=selectedCategory?.sectionColor||"#c77dff";

  return(
    <div style={{minHeight:"100vh",maxHeight:"100vh",width:"100vw",overflowX:"hidden",background:screen==="describe"?"linear-gradient(180deg,#050b14 0%,#0a1727 32%,#132a42 66%,#1d3d5c 100%)":(darkMode?"#f0f4f8":"#000"),color:darkMode?"#111":"#eee",fontFamily:"Georgia,serif",position:"relative",overflowX:"hidden"}}>
      {screen!=="describe" && !LOW_MEM && <MatrixRain/>}
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
          <button onClick={()=>setDarkMode(v=>!v)} style={{...btnStyle}} title="Tema">{darkMode?"🌙":"☀️"}</button>
          <button onClick={()=>setShowKeys(v=>!v)} style={{...btnStyle,fontSize:14}}>⚙️</button>
          <button onClick={()=>playing?stop():start()} style={{...btnStyle,background:playing?"rgba(0,180,255,0.12)":"rgba(0,8,20,0.8)",border:"1px solid "+(playing?"rgba(0,180,255,0.5)":"rgba(0,180,255,0.2)"),color:playing?"#00cfff":"#00aaee",boxShadow:playing?"0 0 10px rgba(0,180,255,0.3)":"none"}}>
            {playing?"◼":"▶"}
          </button>{history.length>0&&<button onClick={()=>{setViewHistory(true);setScreen("home");}} style={{background:"rgba(0,15,0,0.8)",border:"1px solid rgba(0,255,65,0.2)",color:"#00cc33",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"monospace"}}>📋 Historial ({history.length})</button>}
          {(screen!=="home"||viewHistory)&&<button onClick={reset} style={{background:"rgba(0,15,0,0.8)",border:"1px solid rgba(0,255,65,0.2)",color:"#00cc33",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"monospace"}}>← Inicio</button>}
          <button onClick={()=>playing?stop():start()} style={{background:playing?"rgba(0,255,65,0.12)":"rgba(0,15,0,0.8)",border:`1px solid ${playing?"rgba(0,255,65,0.5)":"rgba(0,255,65,0.2)"}`,color:playing?"#00ff41":"#00cc33",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:13,fontFamily:"monospace",boxShadow:playing?"0 0 10px rgba(0,255,65,0.3)":"none",transition:"background .25s var(--ease-soft), border-color .25s var(--ease-soft), color .25s var(--ease-soft), box-shadow .3s var(--ease-out)"}}>
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
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer"
                style={{display:"inline-block",fontSize:10,color:"#8a6aa8",marginTop:5,
                        fontFamily:"monospace",textDecoration:"underline"}}>
                ↗ Obtener clave en console.anthropic.com (de pago)
              </a>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontFamily:"monospace",fontSize:12,color:"#6ba3f5",display:"block",marginBottom:6}}>✦ Gemini API Key — Gratis</label>
              <div style={{position:"relative"}}>
                <input type="password" placeholder="AIza..." value={apiKeys.gemini}
                  onChange={e=>setApiKeys(k=>({...k,gemini:e.target.value.trim()}))}
                  style={{width:"100%",background:"rgba(0,0,0,0.5)",border:`1px solid ${
                    apiKeys.gemini?(/^AIza[\w-]{30,}$/.test(apiKeys.gemini)?"rgba(87,204,153,0.5)":"rgba(244,162,97,0.5)"):"rgba(66,133,244,0.3)"
                  }`,borderRadius:4,color:"#eee",padding:"10px 74px 10px 14px",fontFamily:"monospace",fontSize:13,boxSizing:"border-box"}}/>
                {/* Pasting is the step people fumble, so it gets its own button. */}
                <button
                  onClick={async()=>{
                    try{
                      const txt=(await navigator.clipboard.readText()||"").trim();
                      if(txt) setApiKeys(k=>({...k,gemini:txt}));
                      else alert("No hay nada copiado.");
                    }catch(e){
                      alert("Tu navegador no permite pegar automáticamente. Mantén pulsado el campo y elige Pegar.");
                    }
                  }}
                  style={{position:"absolute",top:"50%",right:7,transform:"translateY(-50%)",
                          padding:"5px 10px",borderRadius:4,border:"1px solid rgba(66,133,244,0.35)",
                          background:"rgba(66,133,244,0.14)",color:"#6ba3f5",
                          fontFamily:"monospace",fontSize:10,cursor:"pointer"}}>
                  📋 Pegar
                </button>
              </div>

              {apiKeys.gemini&&(
                <p style={{fontSize:10,marginTop:5,fontFamily:"monospace",
                           color:/^AIza[\w-]{30,}$/.test(apiKeys.gemini)?"#57cc99":"#f4a261"}}>
                  {/^AIza[\w-]{30,}$/.test(apiKeys.gemini)
                    ? "✓ La clave tiene el formato correcto"
                    : "⚠ No parece una clave de Gemini (empiezan por AIza)"}
                </p>
              )}

              {!apiKeys.gemini&&(
                <div style={{marginTop:9,background:"rgba(66,133,244,0.07)",
                             border:"1px solid rgba(66,133,244,0.2)",borderRadius:6,padding:"11px 12px"}}>
                  <p style={{fontFamily:"monospace",fontSize:11,color:"#9ab",margin:"0 0 8px",lineHeight:1.6}}>
                    Necesitas una clave gratuita de Google. Se tarda un minuto:
                  </p>
                  <ol style={{margin:"0 0 10px",paddingLeft:17,color:"#7a8a9a",
                              fontFamily:"monospace",fontSize:10.5,lineHeight:1.75}}>
                    <li>Abre Google AI Studio con el botón de abajo</li>
                    <li>Entra con tu cuenta de Google</li>
                    <li>Pulsa <b style={{color:"#9ab"}}>Get API key</b> → <b style={{color:"#9ab"}}>Create API key</b></li>
                    <li>Copia la clave y vuelve aquí</li>
                    <li>Pulsa <b style={{color:"#9ab"}}>📋 Pegar</b></li>
                  </ol>
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
                    style={{display:"block",textAlign:"center",padding:"10px",borderRadius:4,
                            background:"rgba(66,133,244,0.22)",border:"1px solid rgba(66,133,244,0.45)",
                            color:"#8fc0ff",fontFamily:"monospace",fontSize:12,
                            textDecoration:"none",fontWeight:"bold"}}>
                    ↗ Abrir Google AI Studio
                  </a>
                </div>
              )}

              {apiKeys.gemini&&(
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
                  style={{display:"inline-block",marginTop:6,fontSize:10,color:"#5a7a95",
                          fontFamily:"monospace",textDecoration:"underline"}}>
                  ↗ Gestionar mis claves en Google AI Studio
                </a>
              )}
            </div>
            <button onClick={()=>setShowKeys(false)} style={{width:"100%",padding:"12px",border:"none",borderRadius:4,background:"rgba(0,180,255,0.15)",color:"#00cfff",fontFamily:"monospace",fontSize:14,cursor:"pointer",fontWeight:"bold"}}>✓ Guardar y cerrar</button>
            <p style={{fontSize:10,color:"#4a5a6a",marginTop:10,fontFamily:"monospace",textAlign:"center",lineHeight:1.5}}>
              🔒 Las claves se guardan solo en este dispositivo.<br/>No se envían a ningún servidor.
            </p>
            <button onClick={()=>{if(confirm("¿Borrar las claves guardadas en este dispositivo?")){setApiKeys({claude:"",gemini:""});try{localStorage.removeItem("maestro_gemini_models");}catch(e){}}}}
              style={{width:"100%",padding:"8px",marginTop:8,border:"1px solid rgba(255,80,80,0.25)",borderRadius:4,background:"transparent",color:"#a05050",fontFamily:"monospace",fontSize:11,cursor:"pointer"}}>
              Borrar claves guardadas
            </button>

            <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid rgba(0,180,255,0.12)"}}>
              <p style={{fontFamily:"monospace",fontSize:12,color:"#00cfff",marginBottom:8}}>🔊 Sonido</p>
              <button onClick={()=>setFxOn(v=>{
                  const n=!v;
                  try{localStorage.setItem("maestro_fx",n?"on":"off");}catch(e){}
                  return n;
                })}
                style={{width:"100%",padding:"9px",borderRadius:4,marginBottom:14,
                        border:`1px solid ${fxOn?"rgba(0,180,255,0.3)":"rgba(255,255,255,0.12)"}`,
                        background:fxOn?"rgba(0,180,255,0.10)":"transparent",
                        color:fxOn?"#00cfff":"#667",fontFamily:"monospace",
                        fontSize:11,cursor:"pointer",textAlign:"left",
                        transition:"all .25s var(--ease-soft)"}}>
                {fxOn?"🔔 Efectos de sonido activados":"🔕 Efectos de sonido silenciados"}
              </button>

              <p style={{fontFamily:"monospace",fontSize:12,color:"#00cfff",marginBottom:8}}>🗣 Voz de lectura</p>
              {voices.length===0?(
                <p style={{fontSize:10,color:"#4a5a6a",fontFamily:"monospace",marginBottom:14,lineHeight:1.5}}>
                  Este dispositivo no ofrece voces en español. Puedes añadirlas
                  desde los ajustes del sistema, en Texto a voz.
                </p>
              ):(
                <>
                  <select value={voicePref.name}
                    onChange={e=>setVoicePref(p=>({...p,name:e.target.value}))}
                    style={{width:"100%",background:"rgba(0,0,0,0.45)",
                            border:"1px solid rgba(0,180,255,0.25)",borderRadius:4,
                            color:"#cfe8f5",padding:"9px 11px",fontFamily:"monospace",
                            fontSize:12,boxSizing:"border-box",marginBottom:9}}>
                    <option value="">Automática (la mejor disponible)</option>
                    {voices.map(v=>(
                      <option key={v.name} value={v.name}>
                        {v.name} · {v.lang}{v.localService?"":" · en línea"}
                      </option>
                    ))}
                  </select>

                  <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:9}}>
                    <span style={{fontFamily:"monospace",fontSize:11,color:"#667",flexShrink:0}}>
                      Velocidad
                    </span>
                    <input type="range" min="0.6" max="1.5" step="0.05"
                      value={voicePref.rate}
                      onChange={e=>setVoicePref(p=>({...p,rate:parseFloat(e.target.value)}))}
                      style={{flex:1,accentColor:"#00cfff"}}/>
                    <span style={{fontFamily:"monospace",fontSize:11,color:"#00cfff",
                                  width:34,textAlign:"right",flexShrink:0}}>
                      {voicePref.rate.toFixed(2)}×
                    </span>
                  </div>

                  <button
                    onClick={()=>speaking
                      ? stopSpeaking()
                      : speak(VOICE_SAMPLE[guideLang]||VOICE_SAMPLE[guideLang.split("-")[0]]||VOICE_SAMPLE.es,langInfo.voice)}
                    style={{width:"100%",padding:"9px",borderRadius:4,
                            border:`1px solid ${speaking?"rgba(255,80,80,0.35)":"rgba(0,180,255,0.25)"}`,
                            background:speaking?"rgba(255,80,80,0.12)":"rgba(0,180,255,0.08)",
                            color:speaking?"#ff6b6b":"#00cfff",fontFamily:"monospace",
                            fontSize:11,cursor:"pointer",marginBottom:14}}>
                    {speaking?"⏹ Detener":"▶ Probar esta voz"}
                  </button>
                </>
              )}
            </div>

            <div style={{marginTop:4,paddingTop:14,borderTop:"1px solid rgba(0,180,255,0.12)"}}>
              <p style={{fontFamily:"monospace",fontSize:12,color:"#00cfff",marginBottom:8}}>💾 Copia de seguridad</p>
              <div style={{display:"flex",gap:7,marginBottom:6}}>
                <button onClick={exportHistory}
                  style={{flex:1,padding:"9px",border:"1px solid rgba(0,180,255,0.25)",borderRadius:4,
                          background:"rgba(0,180,255,0.08)",color:"#00cfff",fontFamily:"monospace",
                          fontSize:11,cursor:"pointer"}}>
                  ↓ Exportar ({history.length})
                </button>
                <label style={{flex:1,padding:"9px",border:"1px solid rgba(0,180,255,0.25)",borderRadius:4,
                               background:"transparent",color:"#00aaee",fontFamily:"monospace",
                               fontSize:11,cursor:"pointer",textAlign:"center"}}>
                  ↑ Importar
                  <input type="file" accept="application/json" style={{display:"none"}}
                    onChange={e=>{const f=e.target.files?.[0]; if(f) importHistory(f); e.target.value="";}}/>
                </label>
              </div>
              <p style={{fontSize:10,color:"#4a5a6a",marginBottom:14,fontFamily:"monospace",lineHeight:1.5}}>
                Guarda tus guías en un archivo por si cambias de dispositivo.
              </p>
            </div>

            <div style={{marginTop:4,paddingTop:14,borderTop:"1px solid rgba(0,180,255,0.12)"}}>
              <button onClick={()=>setShowLog(v=>!v)}
                style={{width:"100%",padding:"9px",border:"1px solid rgba(0,180,255,0.25)",borderRadius:4,background:"transparent",color:"#00aaee",fontFamily:"monospace",fontSize:11,cursor:"pointer"}}>
                🩺 {showLog?"Ocultar":"Ver"} registro de diagnóstico
              </button>
              {showLog&&(()=>{
                let log=[];
                try{log=JSON.parse(localStorage.getItem("maestro_crashlog")||"[]");}catch(e){}
                return(
                  <div style={{marginTop:10}}>
                    <div style={{maxHeight:180,overflowY:"auto",background:"rgba(0,0,0,0.45)",border:"1px solid rgba(0,180,255,0.12)",borderRadius:4,padding:8}}>
                      {log.length===0
                        ? <p style={{fontFamily:"monospace",fontSize:10,color:"#556"}}>Sin registros todavía.</p>
                        : log.map((e,i)=>(
                            <div key={i} style={{marginBottom:8,paddingBottom:6,borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                              <p style={{margin:0,fontFamily:"monospace",fontSize:9,color:e.type==="arranque"?"#57cc99":"#ff6b6b",fontWeight:"bold"}}>
                                {e.type==="arranque"?"▶":"⚠"} {e.type} · {e.mode}
                              </p>
                              <p style={{margin:"2px 0 0",fontFamily:"monospace",fontSize:9,color:"#9ab",wordBreak:"break-word"}}>{e.msg}</p>
                              <p style={{margin:"2px 0 0",fontFamily:"monospace",fontSize:8,color:"#556"}}>
                                {e.when} · {e.screen} · dpr{e.dpr} · {e.mem} · {e.cores} nucleos {e.at?("· "+e.at):""}
                              </p>
                            </div>
                          ))}
                    </div>
                    <div style={{display:"flex",gap:6,marginTop:6}}>
                      <button onClick={()=>{
                          const txt=JSON.stringify(log,null,1);
                          if(navigator.clipboard){navigator.clipboard.writeText(txt).then(()=>alert("Registro copiado. Pégalo en el chat."));}
                          else{alert(txt.slice(0,1500));}
                        }}
                        style={{flex:1,padding:"7px",border:"1px solid rgba(0,180,255,0.25)",borderRadius:4,background:"rgba(0,180,255,0.08)",color:"#00cfff",fontFamily:"monospace",fontSize:10,cursor:"pointer"}}>
                        📋 Copiar registro
                      </button>
                      <button onClick={()=>{try{localStorage.removeItem("maestro_crashlog");}catch(e){} setShowLog(false);}}
                        style={{padding:"7px 12px",border:"1px solid rgba(255,80,80,0.25)",borderRadius:4,background:"transparent",color:"#a05050",fontFamily:"monospace",fontSize:10,cursor:"pointer"}}>
                        Vaciar
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {!online&&(
        <div style={{position:"sticky",top:0,zIndex:40,background:"rgba(244,162,97,0.14)",
                     borderBottom:"1px solid rgba(244,162,97,0.3)",padding:"7px 14px",
                     display:"flex",alignItems:"center",gap:9,
                     animation:"fadeIn .4s var(--ease-out) both"}}>
          <span style={{fontSize:13}}>📡</span>
          <span style={{fontFamily:"monospace",fontSize:11,color:"#f4a261"}}>
            Sin conexión · puedes consultar tus guías guardadas
          </span>
        </div>
      )}
      <main style={{position:"relative",zIndex:1,maxWidth:"100%",width:"100%",margin:"0 auto",padding:"16px 12px 80px",boxSizing:"border-box"}}>

        {screen==="home"&&!viewHistory&&(
          <div style={{animation:"fadeIn .45s var(--ease-out) both"}}>
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
              <>
                {frequentCategories.length>0&&(
                  <div style={{marginBottom:6}}>
                    <p style={{fontFamily:"monospace",fontSize:10,color:"#445",
                               letterSpacing:"0.14em",marginBottom:7}}>// ACCESO RÁPIDO</p>
                    <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:4}}>
                      {frequentCategories.map(({cat,n})=>(
                        <button key={cat.id} onClick={()=>handleCategory(cat)}
                          style={{display:"flex",alignItems:"center",gap:7,flexShrink:0,
                                  padding:"7px 12px",borderRadius:20,
                                  border:`1px solid ${cat.sectionColor}44`,
                                  background:`${cat.sectionColor}12`,cursor:"pointer",
                                  transition:"all .25s var(--ease-soft)"}}>
                          <span style={{width:17,height:17,flexShrink:0}}>
                            {ICONS[cat.id]&&<CyberIcon d={ICONS[cat.id].d} d2={ICONS[cat.id].d2}
                              color={cat.sectionColor} size={17} gradId={`fq_${cat.id}`}/>}
                          </span>
                          <span style={{fontFamily:"monospace",fontSize:11,
                                        color:cat.sectionColor,whiteSpace:"nowrap"}}>
                            {cat.label}
                          </span>
                          <span style={{fontFamily:"monospace",fontSize:9,color:"#556"}}>{n}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <OrbitalHome onSelect={handleCategory}/>
              </>
            )}
          </div>
        )}

        {viewHistory&&(
          <div style={{animation:"fadeIn .45s var(--ease-out) both"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24,flexWrap:"wrap"}}>
              <h2 style={{fontSize:22,fontFamily:"monospace",margin:0}}>📋 Historial</h2>
              <div style={{display:"flex",gap:8,marginLeft:"auto",flexWrap:"wrap"}}>
                {/* Points and badges were removed: they counted up but led nowhere,
                    and the space is better spent on information that is useful. */}
                {(()=>{
                  const enCurso=history.filter(h=>{
                    const d=progress[h.id]||[];
                    return d.length>0 && d.length<(h.guide?.pasos?.length||99);
                  }).length;
                  return enCurso>0?(
                    <span style={{fontFamily:"monospace",fontSize:11,color:"#f4a261",
                                  background:"rgba(244,162,97,0.1)",border:"1px solid rgba(244,162,97,0.25)",
                                  padding:"4px 10px",borderRadius:20}}>
                      ⏳ {enCurso} sin terminar
                    </span>
                  ):null;
                })()}
              </div>
            </div>
            {history.length===0?<p style={{color:"#555",fontFamily:"monospace"}}>Sin historial aún.</p>:(
              <>
                {/* search bar */}
                <div style={{position:"relative",marginBottom:12}}>
                  <input
                    value={histQuery}
                    onChange={e=>setHistQuery(e.target.value)}
                    placeholder="🔍  Buscar en tus guías..."
                    style={{width:"100%",background:"rgba(0,8,20,0.8)",
                            border:"1px solid rgba(0,180,255,0.25)",borderRadius:4,
                            color:"#00cfff",fontSize:14,padding:"11px 76px 11px 16px",
                            fontFamily:"monospace",boxSizing:"border-box"}}/>
                  <div style={{position:"absolute",top:"50%",right:8,transform:"translateY(-50%)",
                               display:"flex",gap:6,alignItems:"center"}}>
                    {histQuery&&(
                      <button onClick={()=>setHistQuery("")}
                        style={{background:"none",border:"none",color:"#556",fontSize:16,
                                cursor:"pointer",padding:"0 4px"}}>✕</button>
                    )}
                    <button
                      onClick={()=>listening?stopListening():startListening(t=>setHistQuery(t))}
                      style={{width:30,height:30,borderRadius:"50%",
                              border:`2px solid ${listening?"#ff6b6b":"rgba(0,180,255,0.4)"}`,
                              background:listening?"rgba(255,80,80,0.2)":"rgba(0,180,255,0.1)",
                              color:listening?"#ff6b6b":"#00cfff",fontSize:13,cursor:"pointer"}}>
                      {listening?"⏹":"🎤"}
                    </button>
                  </div>
                </div>

                {/* filters */}
                <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
                  {[["todas",`Todas (${history.length})`],
                    ["favoritas",`★ Favoritas (${favourites.length})`]].map(([v,l])=>(
                    <button key={v} onClick={()=>setHistFilter(v)}
                      style={{padding:"5px 12px",borderRadius:20,
                              border:`1px solid ${histFilter===v?"rgba(0,180,255,0.5)":"rgba(255,255,255,0.1)"}`,
                              background:histFilter===v?"rgba(0,180,255,0.15)":"transparent",
                              color:histFilter===v?"#00cfff":"#667",fontSize:11,
                              fontFamily:"monospace",cursor:"pointer",
                              transition:"all .25s var(--ease-soft)"}}>{l}</button>
                  ))}
                  {histQuery&&(
                    <span style={{fontFamily:"monospace",fontSize:11,color:"#556",marginLeft:"auto"}}>
                      {filteredHistory.length} resultado{filteredHistory.length===1?"":"s"}
                    </span>
                  )}
                </div>

                {filteredHistory.length===0?(
                  <p style={{color:"#556",fontFamily:"monospace",fontSize:13,
                             textAlign:"center",padding:"28px 0"}}>
                    {histFilter==="favoritas"&&!histQuery
                      ? "Aún no has marcado ninguna guía como favorita."
                      : `Ninguna guía coincide con "${histQuery}".`}
                  </p>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {filteredHistory.map(item=>{
                      const fav=favourites.includes(item.id);
                      return(
                        <div key={item.id}
                          style={{display:"flex",alignItems:"center",gap:12,
                                  background:"rgba(0,8,20,0.85)",
                                  border:`1px solid ${fav?"rgba(249,199,79,0.3)":"rgba(0,180,255,0.14)"}`,
                                  borderRadius:4,padding:"12px 14px",
                                  transition:"border-color .25s var(--ease-soft)"}}>
                          <div style={{width:30,height:30,flexShrink:0}}>
                            {ICONS[item.category.id]&&<CyberIcon d={ICONS[item.category.id].d} d2={ICONS[item.category.id].d2} color={item.category.sectionColor} size={28} gradId={`h_${item.id}`}/>}
                          </div>
                          <button onClick={()=>openHistoryItem(item)}
                            style={{flex:1,minWidth:0,background:"none",border:"none",
                                    textAlign:"left",cursor:"pointer",padding:0}}>
                            <p style={{margin:0,fontSize:14,fontWeight:"bold",color:"#eee",
                                       overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              <Highlight text={item.guide.titulo}/>
                            </p>
                            <p style={{margin:"3px 0 0",fontSize:11,color:"#667",fontFamily:"monospace",
                                       overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              <Highlight text={item.category.label}/> · {item.date}
                            </p>
                            {/* how far this guide was taken, so unfinished jobs stand out */}
                            {(()=>{
                              const done=(progress[item.id]||[]).length;
                              const total=item.guide?.pasos?.length||0;
                              if(!total||!done) return null;
                              const pct=Math.round(done/total*100);
                              const finished=done>=total;
                              return(
                                <div style={{display:"flex",alignItems:"center",gap:7,marginTop:5}}>
                                  <div style={{flex:1,height:3,borderRadius:2,
                                               background:"rgba(255,255,255,0.07)",overflow:"hidden"}}>
                                    <div style={{height:"100%",width:`${pct}%`,borderRadius:2,
                                                 background:finished?"#57cc99":"#f4a261",
                                                 transition:"width .55s var(--ease-out)"}}/>
                                  </div>
                                  <span style={{fontFamily:"monospace",fontSize:9,
                                                color:finished?"#57cc99":"#f4a261",flexShrink:0}}>
                                    {finished?"✓ completada":`${done}/${total}`}
                                  </span>
                                </div>
                              );
                            })()}
                          </button>
                          <button onClick={()=>toggleFav(item.id)}
                            title={fav?"Quitar de favoritas":"Marcar como favorita"}
                            style={{background:"none",border:"none",cursor:"pointer",
                                    fontSize:17,color:fav?"#f9c74f":"#3a4450",
                                    padding:"0 4px",transition:"color .25s var(--ease-soft)"}}>
                            {fav?"★":"☆"}
                          </button>
                          <button onClick={()=>{
                              if(confirm("¿Borrar esta guía del historial?")) deleteHistoryItem(item.id);
                            }}
                            title="Borrar del historial"
                            style={{background:"none",border:"none",cursor:"pointer",
                                    fontSize:14,color:"#3a4450",padding:"0 4px",
                                    transition:"color .25s var(--ease-soft)"}}>🗑</button>
                          <span style={{color:"#445",fontSize:16}}>→</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {screen==="describe"&&(
          <div style={{display:"flex",flexDirection:"column",justifyContent:"flex-end",
                       minHeight:"calc(100vh - 150px)",
                       animation:enteredByStar?"templeRise 5.4s cubic-bezier(.16,.85,.28,1) both":"fadeIn 0.35s ease"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div style={{width:46,height:46,filter:`drop-shadow(0 0 10px ${accentColor})`}}>
                {selectedCategory&&ICONS[selectedCategory.id]&&<CyberIcon d={ICONS[selectedCategory.id].d} d2={ICONS[selectedCategory.id].d2} color={accentColor} size={32} gradId={`desc_${selectedCategory.id}`}/>}
              </div>
              <div>
                <p style={{fontSize:12,letterSpacing:"0.1em",textTransform:"uppercase",margin:0,fontFamily:"monospace",fontWeight:"bold",color:accentColor}}>{selectedCategory?.label}</p>
                <h2 style={{fontSize:18,margin:"2px 0 0",fontWeight:"bold",fontFamily:"monospace"}}>Describe tu problema</h2>
              </div>
            </div>
            <ColumnFrame color={accentColor} altarDelay={enteredByStar?6100:0}>
            <div style={{background:"transparent",border:"none",borderRadius:0,padding:0,display:"flex",flexDirection:"column",gap:6,height:"100%"}}>
              <div style={{position:"relative"}}>
                <textarea style={{width:"100%",background:"transparent",border:"none",outline:"none",color:"#e8e2d2",fontSize:14,padding:"4px 6px",fontFamily:"Georgia,serif",resize:"none",boxSizing:"border-box",lineHeight:1.45,height:"100%",overflowY:"auto",textShadow:`0 0 10px ${accentColor}66, 0 1px 0 rgba(0,0,0,.8)`}} placeholder="Describe el problema... o pulsa 🎤" value={problem} onChange={e=>setProblem(e.target.value)} rows={2}/>
                <button onClick={()=>listening?stopListening():startListening(t=>setProblem(p=>p?p+" "+t:t))} style={{position:"absolute",top:10,right:10,width:34,height:34,borderRadius:"50%",border:`2px solid ${listening?"#ff6b6b":"rgba(0,180,255,0.4)"}`,background:listening?"rgba(255,80,80,0.2)":"rgba(0,180,255,0.1)",color:listening?"#ff6b6b":"#00cfff",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{listening?"⏹":"🎤"}</button>
              </div>
              <button style={{padding:"14px 24px",border:"none",borderRadius:4,color:"#000",fontSize:15,fontWeight:"bold",cursor:"pointer",background:accentColor,opacity:problem.trim()?1:0.4,fontFamily:"monospace"}} onClick={fetchGuide} disabled={!problem.trim()}>
                GENERAR GUÍA PASO A PASO →
              </button>
            </div>
            </ColumnFrame>

            {/* Language and depth of the guide, kept outside the temple so the
                oracle stays uncluttered. */}
            <div style={{display:"flex",gap:8,marginTop:12,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontFamily:"monospace",fontSize:11,color:"#556"}}>// Idioma:</span>
              <select value={guideLang} onChange={e=>setGuideLang(e.target.value)}
                style={{background:"rgba(0,8,20,0.85)",border:"1px solid rgba(0,180,255,0.25)",
                        borderRadius:4,color:"#00cfff",fontFamily:"monospace",fontSize:11,
                        padding:"5px 8px",cursor:"pointer",maxWidth:180}}>
                {LANGUAGES.map(l=>(
                  <option key={l.code} value={l.code}>{l.flag} {l.native}</option>
                ))}
              </select>

              <span style={{fontFamily:"monospace",fontSize:11,color:"#556",marginLeft:6}}>// Nivel:</span>
              {[["simple","🟢"],["normal","🟡"],["experto","🔴"]].map(([v,dot])=>(
                <button key={v} onClick={()=>setLevel(v)}
                  title={v==="simple"?"Principiante":v==="normal"?"Intermedio":"Experto"}
                  style={{padding:"5px 10px",borderRadius:4,
                          border:`1px solid ${level===v?"rgba(0,180,255,0.5)":"rgba(255,255,255,0.09)"}`,
                          background:level===v?"rgba(0,180,255,0.14)":"transparent",
                          color:level===v?"#00cfff":"#556",fontSize:11,fontFamily:"monospace",
                          cursor:"pointer",transition:"all .25s var(--ease-soft)"}}>
                  {dot} {v==="simple"?"Básico":v==="normal"?"Normal":"Experto"}
                </button>
              ))}
            </div>

            <p style={{fontSize:12,color:"#455",fontFamily:"monospace",marginTop:10}}>// Cuanto más detallado seas, mejor será la guía</p>
          </div>
        )}

        {screen==="guide"&&(
          <div style={{animation:"fadeIn .45s var(--ease-out) both"}}>
            {loading&&<LoadingStages color={accentColor} category={selectedCategory?.label} note={loadingNote}/>}
            {!loading&&guide&&!guide.error&&(
              <Papyrus tint={accentColor}>
                <div style={{display:"flex",gap:16,alignItems:"flex-start",marginBottom:16}}>
                  <div style={{width:44,height:44,marginTop:4,flexShrink:0,filter:"drop-shadow(0 1px 2px rgba(0,0,0,.3))"}}>
                    {selectedCategory&&ICONS[selectedCategory.id]&&<CyberIcon d={ICONS[selectedCategory.id].d} d2={ICONS[selectedCategory.id].d2} color={accentColor} size={40} gradId={`guide_${selectedCategory.id}`}/>}
                  </div>
                  <div>
                    <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                      <h2 style={{fontSize:21,fontWeight:"bold",margin:"0 0 10px",lineHeight:1.3,fontFamily:"Georgia,'Times New Roman',serif",flex:1}}>{guide.titulo}</h2>
                      <button onClick={()=>speaking?stopSpeaking():speak(buildNarration(guide),(LANGUAGES.find(l=>l.code===(guide.lang||guideLang))||langInfo).voice)}
                        style={{width:36,height:36,borderRadius:"50%",border:`2px solid ${speaking?"#8a2f18":"rgba(0,180,255,0.3)"}`,background:speaking?"rgba(255,80,80,0.15)":"rgba(0,180,255,0.08)",color:speaking?"#8a2f18":"#3b2f1c",fontSize:18,cursor:"pointer",flexShrink:0}}>
                        {speaking?"⏹":"🔊"}
                      </button>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
                      {guide.dificultad&&<span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:"bold",fontFamily:"Georgia,'Times New Roman',serif",background:(diffColor[guide.dificultad]||"#aaa")+"28",color:diffColor[guide.dificultad]||"#aaa"}}>{guide.dificultad}</span>}
                      <span style={{fontSize:12,color:"#584627",fontFamily:"Georgia,'Times New Roman',serif"}}>⏱ {guide.tiempo}</span>
                      <span style={{fontSize:12,color:"#584627",fontFamily:"Georgia,'Times New Roman',serif"}}>✅ {completedSteps.length}/{guide.pasos?.length||0} pasos</span>
                    </div>
                  </div>
                </div>

                <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}>
                  <button onClick={()=>window.print()} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 18px",background:"rgba(160,138,90,0.12)",border:"1px solid rgba(120,98,58,0.30)",borderRadius:4,color:"#2f5e2a",fontSize:12,fontFamily:"Georgia,'Times New Roman',serif",cursor:"pointer",fontWeight:"600"}}>📄 Guardar PDF</button>
                </div>

                <div style={{height:4,background:"rgba(120,98,58,0.16)",borderRadius:2,marginBottom:24,overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:2,transition:"width .55s var(--ease-out)",background:"#584627",width:`${guide.pasos?(completedSteps.length/guide.pasos.length)*100:0}%`}}/>
                </div>

                {guide.advertencia&&<div style={{display:"flex",gap:12,background:"rgba(150,60,30,0.14)",border:"1px solid rgba(150,60,30,0.4)",borderRadius:4,padding:"13px 16px",marginBottom:20,alignItems:"flex-start"}}><span>⚠️</span><p style={{margin:0,fontSize:14,color:"#8a3a1e",lineHeight:1.55,fontFamily:"Georgia,'Times New Roman',serif"}}>{guide.advertencia}</p></div>}

                {guide.herramientas?.length>0&&(
                  <div style={{background:"rgba(160,138,90,0.12)",border:"1px solid rgba(120,98,58,0.30)",borderRadius:4,padding:"16px 20px",marginBottom:24}}>
                    <h3 style={{fontSize:13,fontWeight:"bold",color:"#5f4c2e",margin:"0 0 12px",fontFamily:"Georgia,'Times New Roman',serif",letterSpacing:"0.06em",textTransform:"uppercase"}}>🧰 Herramientas y materiales</h3>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {guide.herramientas.map((t,i)=><span key={i} style={{background:"rgba(120,98,58,0.16)",border:"1px solid rgba(120,98,58,0.30)",borderRadius:4,padding:"4px 12px",fontSize:13,fontFamily:"Georgia,'Times New Roman',serif",color:"#4a3c24"}}>{t}</span>)}
                    </div>
                  </div>
                )}

                <h3 style={{fontSize:13,fontWeight:"bold",color:"#5f4c2e",margin:"0 0 14px",fontFamily:"Georgia,'Times New Roman',serif",letterSpacing:"0.06em",textTransform:"uppercase"}}>📋 Pasos a seguir</h3>
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:28}}>
                  {guide.pasos?.map((paso,i)=>{
                    const done=completedSteps.includes(i);
                    const query=encodeURIComponent((selectedCategory?.label||"")+" "+paso.titulo);
                    return(
                      <div key={i} style={{border:`1px solid ${done?"rgba(90,72,40,0.55)":"rgba(120,98,58,0.32)"}`,borderRadius:4,overflow:"hidden",transition:"background .3s var(--ease-soft), border-color .3s var(--ease-soft), color .3s var(--ease-soft)",background:done?"rgba(120,98,58,0.20)":"rgba(160,138,90,0.10)"}}>
                        <div onClick={()=>toggleStep(i)} style={{display:"flex",gap:14,padding:"15px 17px",cursor:"pointer"}}>
                          <div style={{width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:"bold",fontFamily:"Georgia,'Times New Roman',serif",transition:"background .3s var(--ease-soft), border-color .3s var(--ease-soft), color .3s var(--ease-soft)",flexShrink:0,marginTop:2,background:done?"#5c4a2c":"rgba(120,98,58,0.22)",color:done?"#f2e8cd":"#584627"}}>{done?"✓":i+1}</div>
                          <div style={{flex:1}}>
                            <p style={{fontSize:15,fontWeight:"bold",margin:"0 0 6px",lineHeight:1.3,color:"#3b2f1c",opacity:done?0.45:1,textDecoration:done?"line-through":"none",fontFamily:"Georgia,'Times New Roman',serif"}}>{paso.titulo}</p>
                            {!done&&(
                              <>
                                <p style={{fontSize:14,margin:"0 0 8px",color:"#3f331e",lineHeight:1.6,fontFamily:"Georgia,'Times New Roman',serif"}}>{paso.descripcion}</p>
                                {paso.consejo&&<div style={{display:"flex",gap:8,background:"rgba(140,105,40,0.16)",border:"1px solid rgba(140,105,40,0.35)",borderRadius:4,padding:"8px 12px",alignItems:"flex-start"}}><span>💡</span><span style={{fontSize:12,color:"#664a12",fontFamily:"Georgia,'Times New Roman',serif",lineHeight:1.5}}>{paso.consejo}</span></div>}
                              </>
                            )}
                            {done&&(
                              <p style={{fontSize:11,margin:0,color:"#584627",fontFamily:"Georgia,'Times New Roman',serif"}}>
                                toca para desplegar
                              </p>
                            )}
                          </div>
                        </div>
                        {!done&&<div style={{display:"flex",gap:8,padding:"10px 17px 13px 61px",borderTop:"1px solid rgba(120,98,58,0.22)"}}>
                          <a href={`https://www.youtube.com/results?search_query=${query}`} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:4,background:"rgba(163,52,23,0.14)",border:"1px solid rgba(163,52,23,0.35)",color:"#8f2a12",fontSize:12,fontFamily:"Georgia,'Times New Roman',serif",textDecoration:"none",fontWeight:"600"}}>▶ YouTube</a>
                          <a href={`https://www.google.com/search?tbm=isch&q=${query}`} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:4,background:"rgba(31,79,138,0.13)",border:"1px solid rgba(31,79,138,0.32)",color:"#1f4f8a",fontSize:12,fontFamily:"Georgia,'Times New Roman',serif",textDecoration:"none",fontWeight:"600"}}>🖼 Imágenes</a>
                        </div>}
                      </div>
                    );
                  })}
                </div>

                {guide.cuando_llamar_profesional&&<div style={{background:"rgba(160,138,90,0.12)",border:"1px solid rgba(120,98,58,0.30)",borderRadius:4,padding:"16px 20px",marginBottom:28}}><h3 style={{fontSize:13,fontWeight:"bold",color:"#5f4c2e",margin:"0 0 10px",fontFamily:"Georgia,'Times New Roman',serif",textTransform:"uppercase",letterSpacing:"0.06em"}}>👷 ¿Cuándo llamar a un profesional?</h3><p style={{margin:0,fontSize:14,color:"#5c4a2c",lineHeight:1.6,fontFamily:"Georgia,'Times New Roman',serif"}}>{guide.cuando_llamar_profesional}</p></div>}

                {guide.pasos&&completedSteps.length===guide.pasos.length&&(
                  <div style={{textAlign:"center",background:"rgba(160,138,90,0.12)",border:"1px solid rgba(120,98,58,0.30)",borderRadius:4,padding:"32px 24px"}}>
                    <span style={{fontSize:48}}>🎉</span>
                    <h3 style={{fontSize:22,margin:"12px 0 8px",fontFamily:"Georgia,'Times New Roman',serif"}}>¡Problema resuelto!</h3>
                    <p style={{color:"#584627",margin:0,fontFamily:"Georgia,'Times New Roman',serif"}}>Has completado todos los pasos.</p>
                    <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginTop:12}}>
                      <button style={{padding:"12px 18px",border:"1px solid rgba(0,180,255,0.3)",borderRadius:4,color:"#3b2f1c",fontSize:14,cursor:"pointer",background:"transparent",fontFamily:"Georgia,'Times New Roman',serif"}} onClick={()=>{const t=guide.titulo+(guide.pasos?.map((p,i)=>"\n"+(i+1)+". "+p.titulo+"\n"+p.descripcion)||[]).join("");navigator.clipboard?.writeText(t).then(()=>alert("¡Copiado!"));}}>📋 COPIAR</button>
                      <button style={{padding:"12px 18px",border:"1px solid rgba(0,180,255,0.3)",borderRadius:4,color:"#3b2f1c",fontSize:14,cursor:"pointer",background:"transparent",fontFamily:"Georgia,'Times New Roman',serif"}} onClick={()=>window.print()}>📄 PDF</button>
                      <button style={{padding:"12px 18px",border:"1px solid rgba(87,204,153,0.3)",borderRadius:4,color:"#2f5e3a",fontSize:14,cursor:"pointer",background:"transparent",fontFamily:"Georgia,'Times New Roman',serif"}}
                        onClick={()=>{const t=encodeURIComponent("📋 Guía MAESTRO: "+guide.titulo+"\n\n"+(guide.pasos?.map((p,i)=>(i+1)+". "+p.titulo+"\n"+p.descripcion)||[]).join("\n\n"));window.open("https://wa.me/?text="+t,"_blank");}}>
                        💬 WHATSAPP
                      </button>
                    </div>
                    <button style={{padding:"14px 24px",border:"none",borderRadius:4,color:"#f2e8cd",fontSize:15,fontWeight:"bold",cursor:"pointer",background:"#5c4a2c",marginTop:20,fontFamily:"Georgia,'Times New Roman',serif"}} onClick={()=>reset()}>RESOLVER OTRO</button>
                  </div>
                )}
              </Papyrus>
            )}
            {!loading&&guide?.error&&(
              <div style={{textAlign:"center",padding:40,color:"#ff6b6b",fontFamily:"monospace"}}>
                <span style={{fontSize:40}}>⚠️</span>
                <p style={{fontSize:16,marginTop:12}}>No se pudo generar la guía.</p>
                {guide.msg&&<p style={{fontSize:13,color:"#a05050",maxWidth:400,margin:"0 auto 8px"}}>{guide.msg}</p>}
                {guide.raw&&<pre style={{fontSize:11,color:"#555",maxWidth:400,margin:"0 auto 16px",textAlign:"left",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{guide.raw}</pre>}
                {guide.needsKey&&(
                  <button onClick={()=>{setShowKeys(true);}}
                    style={{padding:"13px 26px",border:"none",borderRadius:4,
                            background:"rgba(66,133,244,0.9)",color:"#fff",fontSize:14,
                            fontWeight:"bold",cursor:"pointer",fontFamily:"monospace",
                            marginBottom:14}}>
                    🔑 CONFIGURAR MI CLAVE
                  </button>
                )}
                <div style={{display:"flex",gap:9,justifyContent:"center",flexWrap:"wrap"}}>
                  {/* Retries with the text already written - the old flow sent the
                      user back to an empty form. */}
                  <button style={{padding:"12px 22px",border:"none",borderRadius:4,color:"#000",fontSize:14,fontWeight:"bold",cursor:"pointer",background:"#f4a261",fontFamily:"monospace"}}
                    onClick={()=>fetchGuide()}>↻ REINTENTAR</button>
                  {aiProvider==="claude"&&apiKeys.gemini&&(
                    <button style={{padding:"12px 22px",border:"1px solid rgba(66,133,244,0.4)",borderRadius:4,color:"#6ba3f5",fontSize:14,cursor:"pointer",background:"transparent",fontFamily:"monospace"}}
                      onClick={()=>{setAiProvider("gemini");setTimeout(()=>fetchGuide(),60);}}>✦ PROBAR GEMINI</button>
                  )}
                  {aiProvider==="gemini"&&(
                    <button style={{padding:"12px 22px",border:"1px solid rgba(199,125,255,0.4)",borderRadius:4,color:"#c77dff",fontSize:14,cursor:"pointer",background:"transparent",fontFamily:"monospace"}}
                      onClick={()=>{setAiProvider("claude");setTimeout(()=>fetchGuide(),60);}}>⚡ PROBAR CLAUDE</button>
                  )}
                  <button style={{padding:"12px 22px",border:"1px solid rgba(255,255,255,0.14)",borderRadius:4,color:"#889",fontSize:14,cursor:"pointer",background:"transparent",fontFamily:"monospace"}}
                    onClick={()=>setScreen("describe")}>✎ EDITAR</button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {journey&&(
        <StarJourney color={journey.color} icon={journey.icon} from={journey.from}
                     onDone={()=>setJourney(null)}/>
      )}
      <style>{`
        @keyframes templeRise{0%{opacity:0;transform:translateY(46px) scale(.94);}55%{opacity:.75;}100%{opacity:1;transform:translateY(0) scale(1);}}
        /* Shared easings: things enter fast and settle slowly, the way weight behaves. */
        :root{
          --ease-out:cubic-bezier(.16,1,.3,1);
          --ease-soft:cubic-bezier(.33,1,.68,1);
          --ease-spring:cubic-bezier(.34,1.4,.5,1);
        }
        @keyframes altarReveal{from{visibility:hidden;}to{visibility:visible;}}
        @keyframes altarSettle{
          0%   {opacity:0; transform:translateY(46px) scaleY(.35) scaleX(.85); filter:brightness(3);}
          30%  {opacity:1; filter:brightness(2.2);}
          55%  {transform:translateY(-8px) scaleY(1.09) scaleX(1.03); filter:brightness(1.5);}
          78%  {transform:translateY(2px) scaleY(.98) scaleX(1);}
          100% {opacity:1; transform:translateY(0) scale(1); filter:brightness(1);}
        }
        @keyframes fadeIn{from{opacity:0;transform:translateY(16px) scale(.985);}to{opacity:1;transform:translateY(0) scale(1);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes pulseSoft{0%,100%{opacity:.55;transform:scale(1);}50%{opacity:1;transform:scale(1.14);}}
        @keyframes scan{0%,100%{opacity:0;transform:translateX(-100%);}50%{opacity:1;transform:translateX(100%);}}
        textarea:focus,input:focus{outline:none;border-color:rgba(0,255,65,0.5)!important;box-shadow:0 0 10px rgba(0,255,65,0.15)!important;}
        textarea{color:#00ff41!important;}input{color:#00ff41!important;}
        ::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:#000;}::-webkit-scrollbar-thumb{background:#1a3a1a;border-radius:3px;}
      `}</style>
    </div>
  );
}
  const btnStyle={background:"rgba(0,8,20,0.8)",border:"1px solid rgba(0,180,255,0.2)",color:"#00aaee",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"monospace"};
