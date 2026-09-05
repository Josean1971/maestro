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
  // A rejected promise anywhere used to leave a button looking dead. Catching
  // them centrally means a blocked API degrades instead of breaking the UI.
  window.addEventListener("unhandledrejection",(e)=>{
    const msg=String((e.reason&&e.reason.message)||e.reason||"");
    if(/clipboard|permissions policy|NotAllowedError/i.test(msg)){
      e.preventDefault();      // expected in embedded contexts: not a fault
    }
  });

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


// The Clipboard API is blocked outright in some embedded and cross-origin
// contexts, and the rejection used to abort whatever the button was doing.
// This always succeeds: it copies when it can, falls back to the old
// execCommand path, and otherwise hands the text back for display.
async function copyText(txt){
  try{
    if(navigator.clipboard&&window.isSecureContext){
      await navigator.clipboard.writeText(txt);
      return true;
    }
  }catch(e){ /* blocked by policy - fall through */ }
  try{
    const ta=document.createElement("textarea");
    ta.value=txt;
    ta.setAttribute("readonly","");
    ta.style.cssText="position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0,txt.length);
    const ok=document.execCommand("copy");
    document.body.removeChild(ta);
    if(ok) return true;
  }catch(e){}
  return false;
}

async function readText(){
  try{
    if(navigator.clipboard&&navigator.clipboard.readText&&window.isSecureContext){
      return (await navigator.clipboard.readText()||"").trim();
    }
  }catch(e){}
  return null;      // caller should ask the user to paste manually
}


// ---------------------------------------------------------------------------
// Photo attachments. A picture of the actual fault tells the model far more
// than a paragraph can, so images are downscaled in the browser and sent
// alongside the description. Both providers accept base64 image parts.
// ---------------------------------------------------------------------------
const MAX_PHOTOS=3;

// Phone cameras produce 4000px, 6MB files. Sending those wastes quota and can
// exceed request limits, so every image is resized and re-encoded first.
function prepareImage(file){
  return new Promise((resolve,reject)=>{
    if(!file.type.startsWith("image/")){ reject(new Error("no es una imagen")); return; }
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("no se pudo leer"));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error("formato no reconocido"));
      img.onload=()=>{
        const MAX=1200;                       // plenty for the model to read
        let {width:w,height:h}=img;
        if(w>MAX||h>MAX){
          const k=MAX/Math.max(w,h);
          w=Math.round(w*k); h=Math.round(h*k);
        }
        const c=document.createElement("canvas");
        c.width=w; c.height=h;
        const x=c.getContext("2d");
        x.drawImage(img,0,0,w,h);
        // JPEG at 0.8 is visually indistinguishable here and a fraction of the size
        const url=c.toDataURL("image/jpeg",0.8);
        resolve({
          id:Date.now()+"_"+Math.random().toString(36).slice(2,7),
          name:file.name||"foto.jpg",
          preview:url,
          media:"image/jpeg",
          data:url.split(",")[1],             // base64 without the prefix
          kb:Math.round(url.length*0.75/1024),
        });
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
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
      [[0,293.7,2.5,0.18],[3,261.6,2.0,0.18],[5.5,246.9,1.5,0.16],[7,220,3.0,0.20],[10.5,246.9,2.0,0.18],[13,261.6,2.5,0.18],[16,293.7,2.0,0.18],[18.5,329.6,3.5,0.20],[22.5,293.7,2.0,0.18],[25,261.6,2.0,0.18],[27.5,246.9,1.5,0.16],[29.5,220,5.0,0.22]]];
    const ARP_PATS=[
      [[0.5,0],[1.0,1],[1.5,2],[2.0,1],[2.5,0],[3.0,2],[3.5,1]],
      [[0.25,1],[0.75,2],[1.25,0],[1.75,2],[2.25,1],[2.75,0],[3.25,2]],
      [[0.5,2],[1.5,1],[2.5,0],[3.5,2]],
      [[0.33,0],[1.0,2],[1.66,1],[2.33,0],[3.0,2],[3.66,1]]];

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


// ---------------------------------------------------------------------------
// The oracle. Embedded as a data URL rather than imported from a file: an
// import would need the asset uploaded alongside the code and the paths to
// line up, which is exactly the kind of thing that breaks a deploy. This way
// the whole app remains a single file.
// 360x324, quantised to 64 colours with the glow's soft alpha preserved.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The sanctuary. Embedded as a data URL for the same reason as the oracle: no
// separate asset to upload, no paths to line up, nothing that can break a
// deploy. 900x600, JPEG quality 68.
// The flat slab between the central columns is where the oracle's text sits.
// ---------------------------------------------------------------------------
const TEMPLE_IMG="data:image/jpeg;base64,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";

const ORACLE_IMG="data:image/png;base64,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";

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
  especialidades_medicas:{d:"M6 3v6a5 5 0 0010 0V3",d2:"M4 3h4M14 3h4M16 14a3 3 0 006 0 3 3 0 00-6 0M19 17v2a4 4 0 01-8 0"},
  emergencias:{d:"M13 2L3 14h9l-1 8 10-12h-9l1-8z"},
  ergonomia:{d:"M12 4a2 2 0 100 4 2 2 0 000-4zM12 10v4M8 14l-2 6M16 14l2 6M8 14h8",d2:"M10 14v4M14 14v4"},
  aire:{d:"M9 7c-3 0-4 3-2 5M9 12H2M12 5c-5 0-7 5-4 8M12 13H5",d2:"M17 8c2 1 3 3 3 5a5 5 0 01-5 5H9"},
  impresion3d:{d:"M12 2l8 4v8l-8 4-8-4V6l8-4z",d2:"M12 6v8M4 6l8 4 8-4"},
  drones:{d:"M6 6a2 2 0 100-4 2 2 0 000 4zM18 6a2 2 0 100-4 2 2 0 000 4zM6 22a2 2 0 100-4 2 2 0 000 4zM18 22a2 2 0 100-4 2 2 0 000 4z",d2:"M8 6l4 6-4 6M16 6l-4 6 4 6M12 12h.01"},
  musica:{d:"M9 18V5l12-2v13",d2:"M9 18a3 3 0 100 0M21 16a3 3 0 100 0"},
  fotografia:{d:"M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z",d2:"M12 17a4 4 0 100-8 4 4 0 000 8z"},
  costura:{d:"M20 4L4 20M4 4l16 16",d2:"M12 4v4M12 16v4M4 12h4M16 12h4"},
  cine_tv:{d:"M2 5h20v14H2z",d2:"M7 5v14M17 5v14M2 9h5M2 15h5M17 9h5M17 15h5M10 9l4 3-4 3z"},
  videojuegos:{d:"M7 8h10a5 5 0 015 5v1a4 4 0 01-7 2.7L13 16h-2l-2 .7A4 4 0 012 14v-1a5 5 0 015-5z",d2:"M7 11v3M5.5 12.5h3M16 11.5h.01M18.5 13.5h.01"},
  otro:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M12 8h.01M11 12h1v4h1"},
  dep_futbol:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M12 7l4 3-1.5 5h-5L8 10z M12 2v5M2.5 9l5.5 1M21.5 9l-5.5 1M6 20l3.5-5M18 20l-3.5-5"},
  dep_baloncesto:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M12 2v20M2 12h20M4.9 4.9c4 4 4 10.2 0 14.2M19.1 4.9c-4 4-4 10.2 0 14.2"},
  dep_ciclismo:{d:"M5 17a4 4 0 100-8 4 4 0 000 8zM19 17a4 4 0 100-8 4 4 0 000 8z",d2:"M5 13h5l4-6 3 6M14 7h3M9 13l3-6"},
  dep_running:{d:"M13 3a2 2 0 100 4 2 2 0 000-4z",d2:"M9 21l3-5-2-4 4-3 2 3 3 1M10 12L7 9 4 11"},
  dep_natacion:{d:"M2 17c2 0 2 1.5 4 1.5S8 17 10 17s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5",d2:"M6 12l5-4 4 3M17 6a2 2 0 100 4 2 2 0 000-4zM2 21c2 0 2 1.5 4 1.5"},
  dep_gimnasio:{d:"M3 9v6M7 6v12M17 6v12M21 9v6",d2:"M7 12h10"},
  dep_artes_marciales:{d:"M12 3a2 2 0 100 4 2 2 0 000-4z",d2:"M12 8v6M12 14l-4 7M12 14l4 7M6 10l6 2 6-2"},
  dep_tenis:{d:"M12 2a10 10 0 100 20A10 10 0 0012 2z",d2:"M5 5c4 4 4 10 0 14M19 5c-4 4-4 10 0 14"},
  dep_montana:{d:"M3 20l6-11 4 6 2-3 6 8H3z",d2:"M9 9l2-4 3 5"},
  dep_acuaticos:{d:"M3 18c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 3 2",d2:"M8 14l6-9 3 4M14 5l4 2"},
  dep_motor:{d:"M5 17a2 2 0 100 4 2 2 0 000-4zM19 17a2 2 0 100 4 2 2 0 000-4z",d2:"M3 15l2-6h11l3 6M8 9V6h5v3M6 15h13"},
  dep_equipo:{d:"M9 7a3 3 0 100-4 3 3 0 000 4zM17 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",d2:"M2 21v-3a5 5 0 015-5h4a5 5 0 015 5v3M17 13a4 4 0 014 4v4"},
  dep_nutricion:{d:"M12 21c-4 0-7-3-7-8 0-4 3-7 7-7s7 3 7 7c0 5-3 8-7 8z",d2:"M12 6V3M12 3c1.5 0 2.5-1 2.5-1M9 12h6M12 9v6"},
  dep_lesiones:{d:"M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18",d2:"M12 8v8M8 12h8"},
  dep_entrenamiento:{d:"M3 3v18h18",d2:"M7 15l4-5 3 3 4-7M7 15v3M11 10v8M14 13v5M18 6v12"},
  dep_arbitraje:{d:"M4 4h11l5 5v11H4z",d2:"M15 4v5h5M8 12h8M8 16h5"},
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
  {label:"MEDLAB // SALUD",color:"#f72585",categories:[{id:"primeros_auxilios",label:"Primeros Auxilios"},{id:"medicamentos",label:"Medicamentos & Dosis"},{id:"equipos_medicos",label:"Equipos Médicos"},{id:"emergencias",label:"Emergencias"},{id:"ergonomia",label:"Ergonomía & Postura"},{id:"aire",label:"Calidad del Aire"},{id:"especialidades_medicas",label:"Especialidades Médicas"}]},
  {label:"NEXUS // CREATIVOS",color:"#a8dadc",categories:[{id:"impresion3d",label:"Impresión 3D"},{id:"drones",label:"Drones & RC"},{id:"musica",label:"Instrumentos & Audio"},{id:"fotografia",label:"Fotografía & Video"},{id:"costura",label:"Costura & Textiles"},{id:"cine_tv",label:"Cine & TV"},{id:"videojuegos",label:"Videojuegos"},{id:"otro",label:"Otro / General"}]},
  {label:"ARENA // DEPORTES",color:"#4cc9f0",categories:[{id:"dep_futbol",label:"Fútbol"},{id:"dep_baloncesto",label:"Baloncesto & Canasta"},{id:"dep_ciclismo",label:"Ciclismo"},{id:"dep_running",label:"Running & Atletismo"},{id:"dep_natacion",label:"Natación"},{id:"dep_gimnasio",label:"Gimnasio & Fuerza"},{id:"dep_artes_marciales",label:"Artes Marciales"},{id:"dep_tenis",label:"Tenis & Raqueta"},{id:"dep_montana",label:"Montaña & Escalada"},{id:"dep_acuaticos",label:"Deportes Acuáticos"},{id:"dep_motor",label:"Deportes de Motor"},{id:"dep_equipo",label:"Deportes de Equipo"},{id:"dep_nutricion",label:"Nutrición Deportiva"},{id:"dep_lesiones",label:"Lesiones & Recuperación"},{id:"dep_entrenamiento",label:"Planes de Entrenamiento"},{id:"dep_arbitraje",label:"Reglamento & Arbitraje"}]},
  {label:"ARCHIVO // HISTORIA",color:"#e2b96f",categories:[{id:"historia_antigua",label:"Historia Antigua"},{id:"historia_moderna",label:"Historia Moderna"},{id:"historia_contemporanea",label:"Historia Contemporánea"},{id:"geopolitica",label:"Geopolítica"},{id:"arqueologia",label:"Arqueología"},{id:"filosofia",label:"Filosofía"},{id:"mitologia",label:"Mitología"},{id:"arte_historia",label:"Historia del Arte"}]},
  {label:"LEXIS // DERECHO",color:"#c0a0ff",categories:[{id:"derecho_civil",label:"Derecho Civil"},{id:"derecho_penal",label:"Derecho Penal"},{id:"derecho_laboral",label:"Derecho Laboral"},{id:"derecho_mercantil",label:"Derecho Mercantil"},{id:"derecho_internacional",label:"Derecho Internacional"},{id:"derecho_constitucional",label:"Constitucional"},{id:"contratos",label:"Contratos & Notaría"},{id:"propiedad_intelectual",label:"Propiedad Intelectual"}]},
  {label:"QUANTUM // CIENCIAS",color:"#00f5d4",categories:[{id:"fisica",label:"Física"},{id:"quimica",label:"Química"},{id:"biologia",label:"Biología"},{id:"matematicas",label:"Matemáticas"},{id:"astronomia",label:"Astronomía & Cosmos"},{id:"geologia",label:"Geología"},{id:"neurociencia",label:"Neurociencia"},{id:"genetica",label:"Genética & ADN"}]},
  {label:"NEXUS // ECONOMÍA",color:"#f9c74f",categories:[{id:"macroeconomia",label:"Macroeconomía"},{id:"microeconomia",label:"Microeconomía"},{id:"finanzas_personales",label:"Finanzas Personales"},{id:"bolsa",label:"Bolsa & Inversión"},{id:"crypto",label:"Crypto & Blockchain"},{id:"contabilidad",label:"Contabilidad"},{id:"marketing",label:"Marketing & Negocios"},{id:"emprendimiento",label:"Emprendimiento"}]},
  {label:"SIGMA // CC. SOCIALES",color:"#ff9a3c",categories:[{id:"psicologia",label:"Psicología"},{id:"sociologia",label:"Sociología"},{id:"antropologia",label:"Antropología"},{id:"politica",label:"Ciencia Política"},{id:"comunicacion",label:"Comunicación & Media"},{id:"educacion",label:"Educación & Pedagogía"},{id:"linguistica",label:"Lingüística & Idiomas"},{id:"geografia",label:"Geografía"}]},
  {label:"VERTEX // HUMANIDADES",color:"#ff6eb4",categories:[{id:"literatura",label:"Literatura"},{id:"escritura",label:"Escritura & Redacción"},{id:"poesia",label:"Poesía & Prosa"},{id:"teatro",label:"Teatro & Dramaturgia"},{id:"etica",label:"Ética & Moral"},{id:"religion",label:"Religión & Espiritualidad"},{id:"logica",label:"Lógica & Argumentación"},{id:"retorica",label:"Retórica & Debate"}]},
  {label:"⚔ COMANDO // MILITAR",color:"#7fff00",categories:[{id:"mil_ejercito",label:"Ejército & Infantería"},{id:"mil_marina",label:"Marina & Fuerzas Navales"},{id:"mil_aviacion",label:"Aviación Militar"},{id:"mil_fuerzas_especiales",label:"Fuerzas Especiales"},{id:"mil_inteligencia",label:"Inteligencia & Contrainteligencia"},{id:"mil_armamento",label:"Armamento & Balística"},{id:"mil_tactica",label:"Táctica & Estrategia"},{id:"mil_historia_militar",label:"Historia Militar"},{id:"mil_ciberguerra",label:"Ciberguerra & EW"},{id:"mil_logistica",label:"Logística Militar"},{id:"mil_medicina_combate",label:"Medicina de Combate"},{id:"mil_derecho",label:"Derecho Internacional Bélico"}]},
  {label:"🛡 OMEGA // SUPERVIVENCIA",color:"#ff8c00",categories:[{id:"surv_wilderness",label:"Supervivencia Wilderness"},{id:"surv_urbana",label:"Supervivencia Urbana"},{id:"surv_agua",label:"Obtención de Agua"},{id:"surv_fuego",label:"Fuego & Calor"},{id:"surv_refugio",label:"Construcción de Refugios"},{id:"surv_alimentacion",label:"Caza, Pesca & Forrajeo"},{id:"surv_primeros_auxilios_surv",label:"Primeros Auxilios Campo"},{id:"surv_navegacion",label:"Navegación & Orientación"},{id:"surv_señales",label:"Señales & Rescate"},{id:"surv_preparacion",label:"Preparacionismo & SHTF"},{id:"surv_clima_extremo",label:"Climas Extremos"},{id:"surv_autodefensa",label:"Autodefensa & Seguridad"}]}];


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
  {code:"ko", label:"Coreano",    native:"한국어",        voice:"ko-KR", flag:"🇰🇷"}];

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
  especialidades_medicas:["cardiolog","dermatolog","neurolog","traumatolog","pediatr","ginecolog","oftalmolog","otorrino","urolog","psiquiatr","psicolog clinic","endocrin","digestiv","gastroenterolog","reumatolog","oncolog","nefrolog","alergolog","hematolog","neumolog","radiolog","anestesi","cirug","cirujano","especialista","medico","consulta","diagnostico medico","sintomas"],
  windows:["windows","microsoft","actualizar","registro","escritorio"],
  linux:["linux","ubuntu","terminal","bash","sudo","kernel"],
  programacion:["codigo","python","javascript","bug","funcion","programar","git"],
  musica:["musica","instrumento","guitarra","piano","bateria musical","bajo","violin","afinar","acorde","partitura","solfeo","mezcla audio","grabar musica","estudio","microfono musica","altavoz monitor"],
  fotografia:["foto","camara","objetivo","diafragma","obturador","iso","enfoque","retrato","paisaje","revelado","raw","tripode","flash"],
  videojuegos:["videojuego","gameplay","unity","unreal","godot","motor grafico","pixel art","sprite","tileset","level design","mecanicas de juego","jugabilidad","npc","colisiones","shader","lowpoly","modelado personaje","rigging","rigging esqueleto","hud","partida guardada","multijugador","online","matchmaking","optimizar juego","fps","steam","itch","publicar juego","monetizacion","game jam","prototipo","narrativa interactiva","bso videojuego","testeo","bug juego","depurar","videoconsola","gamepad","pc gaming","retrogaming","emulador","modding"],
  cine_tv:["pelicula","film","cortometraje","guion","guionista","rodaje","rodar","camara cine","plano","secuencia","montaje","edicion video","postproduccion","iluminacion","foco","claqueta","storyboard","director","actor","actriz","reparto","casting","doblaje","subtitul","banda sonora","efectos especiales","vfx","croma","serie","episodio","temporada","documental","streaming","produccion","productora","festival","cine","television"],
  dep_futbol:["futbol","balon","porteria","portero","penalti","falta","regate","tactica futbol","once","liga","chut","cesped"],
  dep_baloncesto:["baloncesto","basket","canasta","tiro","triple","bote","rebote","mate","cancha"],
  dep_ciclismo:["bici","bicicleta","pedal","cadena bici","desviador","cambio bici","ruta","mtb","carretera","llanta bici","sillin"],
  dep_running:["correr","running","carrera","maraton","zancada","atletismo","trote","pisada","zapatilla","ritmo"],
  dep_natacion:["nadar","natacion","piscina","crol","braza","espalda","mariposa","brazada","respiracion nado"],
  dep_gimnasio:["gimnasio","pesa","mancuerna","musculacion","sentadilla","press","dominada","hipertrofia","serie","repeticion","barra"],
  dep_artes_marciales:["judo","karate","boxeo","taekwondo","jiujitsu","mma","lucha","guardia","golpe","cinturon","kata"],
  dep_tenis:["tenis","raqueta","padel","saque","derecha","reves","volea","pista","badminton","squash"],
  dep_montana:["escalada","montaña","senderismo","trekking","cuerda","arnes","via","cumbre","mosqueton","presa"],
  dep_acuaticos:["surf","remo","kayak","piragua","vela","buceo","paddle","ola","tabla","submarinismo"],
  dep_motor:["karting","motociclismo","rally","circuito","trazada","frenada","neumatico carrera","box"],
  dep_equipo:["voleibol","balonmano","rugby","hockey","beisbol","equipo","jugada","alineacion","entrenador"],
  dep_nutricion:["nutricion deportiva","proteina","carbohidrato","hidratacion","suplemento","dieta deportista","recuperacion muscular","creatina"],
  dep_lesiones:["lesion","esguince","tendinitis","rotura","contractura","rehabilitacion","fisioterapia","hielo","calentamiento","estiramiento"],
  dep_entrenamiento:["entrenamiento","plan","rutina","periodizacion","progresion","volumen","intensidad","descanso","calendario"],
  dep_arbitraje:["reglamento","arbitro","regla","falta reglamento","tarjeta","sancion","norma","competicion"],
  finanzas_personales:["ahorro","presupuesto","deuda","hipoteca","nomina","gasto"],
  derecho_laboral:["despido","contrato trabajo","nomina","baja","finiquito","convenio","paro"],
  derecho_civil:["herencia","alquiler","divorcio","testamento","comunidad","vecino"],
};
const norm0=(v)=>String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");


// ---------------------------------------------------------------------------
// Free resources for film and TV work. Each entry carries the words that make
// it relevant, so a step about sound offers audio libraries and a step about
// screenwriting offers script tools - rather than the same list every time.
//
// Only long-established, genuinely free sites are listed: link rot is the
// enemy here, and a dead button is worse than no button.
// ---------------------------------------------------------------------------
const FILM_RESOURCES=[
  {label:"Archive.org", url:"https://archive.org/details/movies",
   what:"metraje y películas de dominio público",
   when:["metraje","archivo","dominio publico","stock","material","referencia","documental"]},
  {label:"Pexels Video", url:"https://www.pexels.com/videos/",
   what:"clips gratuitos sin atribución",
   when:["metraje","stock","clip","plano","recurso","insert","fondo"]},
  {label:"Pixabay", url:"https://pixabay.com/videos/",
   what:"vídeo e imágenes libres",
   when:["metraje","stock","imagen","fondo","textura","recurso"]},
  {label:"Freesound", url:"https://freesound.org/",
   what:"efectos de sonido de la comunidad",
   when:["sonido","audio","efecto","foley","ambiente","ruido","grabacion","microfono","mezcla"]},
  {label:"Free Music Archive", url:"https://freemusicarchive.org/",
   what:"música con licencia libre",
   when:["musica","banda sonora","cancion","score","ambiente","audio"]},
  {label:"YouTube Audio Library", url:"https://studio.youtube.com/channel/UC/music",
   what:"música y efectos sin copyright",
   when:["musica","audio","sonido","banda sonora","copyright","licencia"]},
  {label:"DaVinci Resolve", url:"https://www.blackmagicdesign.com/products/davinciresolve",
   what:"montaje y etalonaje profesional, gratuito",
   when:["montaje","editar","edicion","postproduccion","color","etalonaje","corte","render","exportar"]},
  {label:"Shotcut", url:"https://shotcut.org/",
   what:"editor de vídeo libre y ligero",
   when:["montaje","editar","edicion","corte","software","programa"]},
  {label:"Blender", url:"https://www.blender.org/",
   what:"3D, VFX y composición",
   when:["vfx","efecto","3d","animacion","croma","composicion","tracking","render"]},
  {label:"Natron", url:"https://natrongithub.github.io/",
   what:"composición nodal libre",
   when:["vfx","composicion","croma","chroma","rotoscopia","tracking"]},
  {label:"Trelby", url:"https://www.trelby.org/",
   what:"guion con formato profesional",
   when:["guion","guionista","escribir","formato","escaleta","dialogo","escena","personaje"]},
  {label:"Fountain", url:"https://fountain.io/",
   what:"formato de guion en texto plano",
   when:["guion","escribir","formato","escaleta","borrador"]},
  {label:"Storyboarder", url:"https://wonderunit.com/storyboarder/",
   what:"storyboards gratis",
   when:["storyboard","guion grafico","plano","planificacion","previsualizacion","encuadre"]},
  {label:"Subtitle Edit", url:"https://www.nikse.dk/subtitleedit",
   what:"subtitulado y sincronización",
   when:["subtitul","srt","traduccion","accesibilidad","sincroniz"]},
  {label:"HandBrake", url:"https://handbrake.fr/",
   what:"conversión y compresión de vídeo",
   when:["exportar","comprimir","formato","codec","convertir","render","entrega"]},
  {label:"OBS Studio", url:"https://obsproject.com/",
   what:"grabación y directo",
   when:["grabar","directo","streaming","captura","emision","pantalla"]},
  {label:"Creative Commons", url:"https://search.creativecommons.org/",
   what:"buscador de material reutilizable",
   when:["licencia","derechos","copyright","permiso","atribucion","legal"]}];

// Picks the resources that actually match a step, best first, at most three.
function filmResourcesFor(text){
  const n=(v)=>String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const hay=n(text);
  if(!hay) return [];
  const scored=FILM_RESOURCES.map(r=>{
    let score=0;
    r.when.forEach(w=>{ if(hay.includes(n(w))) score++; });
    return {r,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  return scored.slice(0,3).map(x=>x.r);
}

const ALL_CATS=SECTIONS.flatMap(s=>s.categories.map(c=>({...c,sectionColor:s.color,sectionLabel:s.label})));

// ── COLUMN FRAME WITH FLOATING CLOUDS ──
function ColumnFrame({color,children,altarDelay=0}){
  const shakeRef=React.useRef(null);

  // The sanctuary is now a photograph, so the only thing this loop still needs
  // to do is shake the scene when the star lands. Everything that used to be
  // drawn here - columns, torches, clouds - is in the image itself.
  React.useEffect(()=>{
    let raf;
    const loop=(now)=>{
      const q=(typeof window!=="undefined"&&window.__maestroQuake)||0;
      const el=shakeRef.current;
      if(el){
        if(q>0.002){
          const ms=now/1000;
          // Layered frequencies so it reads as masonry rather than a buzz.
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

  return(
    <div ref={shakeRef} style={{position:"relative",width:"100%",
                                willChange:"transform",lineHeight:0}}>
      <img src={TEMPLE_IMG} alt=""
           style={{width:"100%",height:"auto",display:"block",borderRadius:4}}/>

      {/* A wash of the category colour, so the sanctuary picks up the hue of
          whatever knowledge is being consulted. */}
      <div aria-hidden style={{position:"absolute",inset:0,borderRadius:4,
                               pointerEvents:"none",mixBlendMode:"overlay",
                               background:`radial-gradient(ellipse at 50% 46%, ${color}30 0%, transparent 58%)`}}/>

      {/* Light seeping from the slab, pulsing like something awake behind it. */}
      <div aria-hidden style={{position:"absolute",left:"28%",right:"28%",top:"31%",bottom:"18%",
                               pointerEvents:"none",borderRadius:"3px",
                               background:`radial-gradient(ellipse, ${color}22 0%, transparent 72%)`,
                               animation:"oraclePulse 5s ease-in-out infinite",
                               transformOrigin:"center"}}/>

      {/* A soft darkening under the text: the slab has carvings and a glow of
          its own, and pale words on top of them were hard to read. */}
      <div aria-hidden style={{position:"absolute",left:"27%",right:"27%",top:"30%",bottom:"17%",
                               pointerEvents:"none",borderRadius:6,
                               background:"radial-gradient(ellipse, rgba(2,10,20,0.62) 0%, rgba(2,10,20,0.34) 62%, transparent 88%)"}}/>

      {/* ---- the oracle's writing, on the slab between the centre columns ----
          Percentages match the flat panel in the photograph: it spans roughly
          41-59% across and 36-76% down. */}
      <div style={{position:"absolute",left:"29%",right:"29%",top:"33%",bottom:"20%",
                   display:"flex",flexDirection:"column",justifyContent:"center",
                   animation:`altarSettle 1.1s cubic-bezier(.2,1.5,.4,1) ${altarDelay}ms both`,
                   transformOrigin:"50% 100%"}}>
        {children}
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
  if(ctx.state==="suspended"){
    // Fire and forget: if it cannot resume, the lead below still applies and
    // the visuals simply run without sound rather than out of step with it.
    ctx.resume().catch(()=>{});
  }

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
  // Generous enough to cover resuming the context and the first, always
  // slower, animation frame.
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
  stop.lead=LEAD;
  return stop;
}


// ---------------------------------------------------------------------------
// Manual view control for the 3D scenes. Touch users can flick the sphere, but
// on a monitor, a TV or a projector there is no gesture at all - so the same
// state is driven by dragging, the arrow keys and on-screen buttons.
// ---------------------------------------------------------------------------
function useViewControl(){
  const ref=React.useRef({yaw:0,pitch:0,spin:true});
  const [ui,setUi]=React.useState({spin:true});

  const nudge=React.useCallback((dYaw,dPitch)=>{
    const v=ref.current;
    v.yaw+=dYaw;
    // Clamped so the sphere never flips past the poles, which is disorienting.
    v.pitch=Math.max(-0.85,Math.min(0.85,v.pitch+dPitch));
  },[]);

  const toggleSpin=React.useCallback(()=>{
    ref.current.spin=!ref.current.spin;
    setUi({spin:ref.current.spin});
  },[]);

  const reset=React.useCallback(()=>{
    ref.current.yaw=0; ref.current.pitch=0; ref.current.spin=true;
    setUi({spin:true});
  },[]);

  // Dragging with a mouse, and the arrow keys for remotes and keyboards.
  const attach=React.useCallback((el)=>{
    if(!el) return;
    let dragging=false,lastX=0,lastY=0,moved=0;

    const down=(e)=>{
      if(e.pointerType==="touch") return;      // touch already has its own feel
      dragging=true; moved=0;
      lastX=e.clientX; lastY=e.clientY;
      el.setPointerCapture&&el.setPointerCapture(e.pointerId);
      el.style.cursor="grabbing";
    };
    const move=(e)=>{
      if(!dragging) return;
      const dx=e.clientX-lastX, dy=e.clientY-lastY;
      lastX=e.clientX; lastY=e.clientY;
      moved+=Math.abs(dx)+Math.abs(dy);
      nudge(dx*0.006,-dy*0.005);
    };
    const up=(e)=>{
      if(!dragging) return;
      dragging=false;
      el.style.cursor="grab";
      // A drag should not also register as a tap on whatever is underneath.
      if(moved>6){ e.preventDefault(); e.stopPropagation(); }
    };
    const wheel=(e)=>{
      if(!e.shiftKey) return;                 // plain scroll still scrolls
      e.preventDefault();
      nudge(e.deltaY*0.002,0);
    };
    const key=(e)=>{
      const step=0.12;
      if(e.key==="ArrowLeft"){nudge(-step,0);e.preventDefault();}
      else if(e.key==="ArrowRight"){nudge(step,0);e.preventDefault();}
      else if(e.key==="ArrowUp"){nudge(0,step);e.preventDefault();}
      else if(e.key==="ArrowDown"){nudge(0,-step);e.preventDefault();}
      else if(e.key===" "){toggleSpin();e.preventDefault();}
    };

    el.style.cursor="grab";
    el.addEventListener("pointerdown",down);
    el.addEventListener("pointermove",move);
    el.addEventListener("pointerup",up);
    el.addEventListener("pointercancel",up);
    el.addEventListener("wheel",wheel,{passive:false});
    window.addEventListener("keydown",key);
    return()=>{
      el.removeEventListener("pointerdown",down);
      el.removeEventListener("pointermove",move);
      el.removeEventListener("pointerup",up);
      el.removeEventListener("pointercancel",up);
      el.removeEventListener("wheel",wheel);
      window.removeEventListener("keydown",key);
    };
  },[nudge,toggleSpin]);

  return {ref,ui,nudge,toggleSpin,reset,attach};
}

// The on-screen pad. Only worth showing where there is no touchscreen.
function ViewPad({onNudge,onToggle,onReset,spinning,color="#00cfff"}){
  const hasTouch=typeof window!=="undefined"&&
    (("ontouchstart" in window)||navigator.maxTouchPoints>0);
  if(hasTouch) return null;

  const btn={
    width:30,height:30,borderRadius:6,cursor:"pointer",
    border:"1px solid "+color+"44",background:"rgba(0,8,20,0.75)",
    color:color,fontFamily:"monospace",fontSize:13,lineHeight:1,
    display:"flex",alignItems:"center",justifyContent:"center",
    transition:"all .2s var(--ease-soft)",
  };
  const hold=(fn)=>({
    onPointerDown:(e)=>{
      e.preventDefault(); fn();
      const id=setInterval(fn,90);            // repeats while held down
      const stop=()=>{clearInterval(id);window.removeEventListener("pointerup",stop);};
      window.addEventListener("pointerup",stop);
    },
  });

  return(
    <div style={{position:"absolute",right:14,bottom:14,zIndex:6,
                 display:"flex",flexDirection:"column",alignItems:"center",gap:4,
                 background:"rgba(0,5,14,0.55)",padding:8,borderRadius:10,
                 backdropFilter:"blur(6px)",border:"1px solid "+color+"22"}}>
      <button style={btn} title="Girar arriba" {...hold(()=>onNudge(0,0.09))}>▲</button>
      <div style={{display:"flex",gap:4}}>
        <button style={btn} title="Girar izquierda" {...hold(()=>onNudge(-0.09,0))}>◀</button>
        <button style={{...btn,background:spinning?color+"22":"rgba(0,8,20,0.75)"}}
          title={spinning?"Detener rotación":"Reanudar rotación"}
          onClick={onToggle}>{spinning?"❚❚":"▶"}</button>
        <button style={btn} title="Girar derecha" {...hold(()=>onNudge(0.09,0))}>▶</button>
      </div>
      <button style={btn} title="Girar abajo" {...hold(()=>onNudge(0,-0.09))}>▼</button>
      <button style={{...btn,width:"100%",height:22,fontSize:9.5,marginTop:2}}
        title="Volver a la vista inicial" onClick={onReset}>CENTRAR</button>
      <span style={{fontFamily:"monospace",fontSize:8,color:color+"77",marginTop:2}}>
        arrastra o ←↑↓→
      </span>
    </div>
  );
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
  const view=useViewControl();
  const viewRef=view.ref;
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
      const view=viewRef.current;
      const rotY=t*0.64*(view.spin?1:0)+view.yaw;
      const tiltX=0.40+view.pitch;
      const wob=view.spin?Math.sin(t*0.8)*0.16:0;

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

    const touchStart={current:null};
    const onTouchStart=(e)=>{
      const t=e.touches&&e.touches[0];
      if(t) touchStart.current={x:t.clientX,y:t.clientY,at:Date.now()};
    };
    canvas.addEventListener("touchstart",onTouchStart,{passive:true});

    const pos=(e)=>{const rc=canvas.getBoundingClientRect();const tc=e.touches?.[0];return tc?[tc.clientX-rc.left,tc.clientY-rc.top]:[e.clientX-rc.left,e.clientY-rc.top];};
    const onMove=(e)=>{const[mx,my]=pos(e);let best=null,bd=1e9;stateRef.current.stars.forEach(s=>{s.hovered=false;const dx=mx-s.x,dy=my-s.y;const d=Math.sqrt(dx*dx+dy*dy);if(d<s.size*1.6&&s.z>-0.3&&d<bd){bd=d;best=s;}});if(best)best.hovered=true;};
    const onTap=(e)=>{
      // Ignore taps that were really scroll gestures.
      if(e.changedTouches&&e.changedTouches[0]){
        const t0=touchStart.current;
        if(t0){
          const dx=e.changedTouches[0].clientX-t0.x;
          const dy=e.changedTouches[0].clientY-t0.y;
          if(Math.hypot(dx,dy)>14) return;
          if(Date.now()-t0.at>700) return;      // a long press is not a tap
        }
      }
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
    canvas.addEventListener("click",onTap);
    canvas.addEventListener("touchend",onTap);
    const detachView=view.attach(canvas);
    return()=>{cancelAnimationFrame(rafRef.current);window.removeEventListener("resize",resize);detachView&&detachView();};
  },[section,color,icon]);

  return(
    <div style={{position:"relative",width:"100%",height:"calc(100vh - 150px)",minHeight:340,animation:"fadeIn .45s var(--ease-out) both"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 4px 0"}}>
        <button onClick={onBack} style={{background:"rgba(0,8,20,0.8)",border:"1px solid "+color+"44",color:color,padding:"5px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontFamily:"monospace"}}>← VOLVER</button>
        <span style={{fontFamily:"monospace",fontSize:12,color:color,textShadow:"0 0 8px "+color,letterSpacing:"0.1em"}}>{icon} {label}</span>
        <span style={{fontFamily:"monospace",fontSize:10,color:"#444",marginLeft:"auto"}}>// TOCA UNA ESTRELLA</span>
      </div>
      <canvas ref={canvasRef} style={{width:"100%",height:"calc(100% - 28px)",cursor:"pointer",touchAction:"pan-y",display:"block"}}/>
      <ViewPad onNudge={view.nudge} onToggle={view.toggleSpin} onReset={view.reset}
               spinning={view.ui.spin} color={color}/>
    </div>
  );
}

function OrbitalHome({onSelect}){
  const view=useViewControl();
  const viewRef=view.ref;
  const canvasRef=React.useRef(null);
  const stateRef=React.useRef(null);
  const rafRef=React.useRef(null);
  const [subSpheres,setSubSpheres]=React.useState(null);
  const [selected,setSelected]=React.useState(null);

  const MAIN_ORBS=SECTIONS.map((sec,i)=>({
    label:sec.label.split("//")[1]?.trim()||sec.label,
    color:sec.color, section:sec,
    icon:["🏠","⚡","🚗","⚙️","💻","🌿","⚕️","🎨","🏅","📜","⚖️","⚛️","💹","🧠","📖","⚔️","🛡️"][i]||"🔵"
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

    // The oracle is drawn into the canvas rather than layered over it, so the
    // painter's algorithm can put the far orbs behind him and the near ones in
    // front - which is what makes the spheres look like they orbit the figure
    // instead of merely passing over a picture of him.
    const oracleImg=new Image();
    let oracleReady=false;
    oracleImg.onload=()=>{oracleReady=true;};
    oracleImg.src=ORACLE_IMG;

    // Draws one category orb: a lit 3D sphere with its icon and label. This is
    // the function the painter's algorithm calls for each half of the orbit.
    const drawSphere3D=(o,t)=>{
      const r=o.size*o.scale;
      if(r<1) return;
      const alpha=Math.min(1,0.35+o.depth*0.5);
      const col=o.color||"#00cfff";
      const hex=(v)=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0");

      ctx.save();
      ctx.translate(o.x,o.y);

      // Outer glow, stronger when hovered
      const glow=ctx.createRadialGradient(0,0,r*0.6,0,0,r*2.3);
      glow.addColorStop(0,col+hex((o.hovered?110:70)*alpha));
      glow.addColorStop(0.4,col+hex(30*alpha));
      glow.addColorStop(1,"transparent");
      ctx.beginPath();ctx.arc(0,0,r*2.3,0,Math.PI*2);
      ctx.fillStyle=glow;ctx.fill();

      // The sphere body, lit from the upper left
      const body=ctx.createRadialGradient(-r*0.3,-r*0.32,r*0.05,0,0,r);
      body.addColorStop(0,   "rgba(255,255,255,"+(0.85*alpha)+")");
      body.addColorStop(0.22,col+hex(245*alpha));
      body.addColorStop(0.62,col+hex(175*alpha));
      body.addColorStop(1,   "rgba(0,0,0,"+(0.45*alpha)+")");
      ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);
      ctx.fillStyle=body;ctx.fill();

      // Rim light, which is what reads as curvature
      ctx.beginPath();ctx.arc(0,0,r*0.98,0,Math.PI*2);
      ctx.strokeStyle="rgba(255,255,255,"+(0.35*alpha)+")";
      ctx.lineWidth=Math.max(0.7,r*0.06);
      ctx.stroke();

      // Specular highlight
      ctx.beginPath();
      ctx.ellipse(-r*0.32,-r*0.34,r*0.24,r*0.16,-0.6,0,Math.PI*2);
      ctx.fillStyle="rgba(255,255,255,"+(0.5*alpha)+")";
      ctx.fill();

      ctx.restore();

      // The section emblem. These top-level orbs carry an emoji rather than a
      // vector icon, so it is drawn as text centred on the sphere.
      if(o.icon&&r>8){
        ctx.save();
        ctx.font=Math.round(r*0.92)+"px serif";
        ctx.textAlign="center";
        ctx.textBaseline="middle";
        ctx.globalAlpha=alpha;
        ctx.fillText(o.icon,o.x,o.y+r*0.04);
        ctx.restore();
      }

      // Label beneath, only for orbs near enough to read
      if(o.depth>0.85&&r>10){
        ctx.save();
        ctx.font="bold "+Math.max(9,Math.round(r*0.40))+"px monospace";
        ctx.textAlign="center";
        ctx.textBaseline="top";
        const label=(o.label||"").replace(/^[^\w\sÁÉÍÓÚÜÑáéíóúüñ]+\s*/,"");
        ctx.shadowColor="rgba(0,0,0,0.9)";
        ctx.shadowBlur=6;
        ctx.fillStyle=o.hovered?"#ffffff":col;
        ctx.globalAlpha=Math.min(1,(o.depth-0.85)*3.2);
        ctx.fillText(label,o.x,o.y+r*1.35);
        ctx.restore();
      }
    };

    // Central avatar: the oracle himself, with the halo that seats him in the
    // scene. Falls back to a glowing core until the image has decoded.
    const drawAvatar=(cx,cy,t)=>{
      const breathe=1+Math.sin(t*0.8)*0.035;
      const bob=Math.sin(t*0.9)*6;
      const R=Math.min(W,H)*0.30;              // sits inside the orbit radius

      // Halo behind him
      const g=ctx.createRadialGradient(cx,cy+bob,0,cx,cy+bob,R*0.95);
      g.addColorStop(0,"rgba(0,207,255,0.22)");
      g.addColorStop(0.42,"rgba(0,140,220,0.10)");
      g.addColorStop(1,"rgba(0,120,200,0)");
      ctx.beginPath();
      ctx.arc(cx,cy+bob,R*0.95,0,Math.PI*2);
      ctx.fillStyle=g;
      ctx.globalAlpha=0.72+Math.sin(t*1.3)*0.16;
      ctx.fill();
      ctx.globalAlpha=1;

      if(oracleReady){
        const w=R*1.42*breathe;
        const h=w*(oracleImg.height/oracleImg.width);
        ctx.save();
        ctx.shadowColor="rgba(0,180,255,0.55)";
        ctx.shadowBlur=26;
        ctx.globalAlpha=0.97;
        ctx.drawImage(oracleImg,cx-w/2,cy+bob-h/2,w,h);
        ctx.restore();
      }else{
        // Placeholder while decoding, so the centre is never empty
        const s2=R*0.24;
        ctx.beginPath();
        ctx.arc(cx,cy+bob,s2,0,Math.PI*2);
        const c=ctx.createRadialGradient(cx,cy+bob,0,cx,cy+bob,s2);
        c.addColorStop(0,"rgba(255,255,255,0.9)");
        c.addColorStop(1,"rgba(0,180,255,0.15)");
        ctx.fillStyle=c; ctx.fill();
      }
    };

    // Frame clock. These were lost when the avatar block was replaced, and the
    // loop referenced them on its very first frame - which threw before
    // anything was drawn, leaving the canvas blank.
    let t=0, lastTime=performance.now(), lastFrame=0;

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
      // Automatic drift plus whatever the user has dialled in. On a phone the
      // sphere can be flicked directly, but with a mouse, a remote or a
      // trackpad there was no way to look around at all.
      const view=viewRef.current;
      const rotY=t*0.56*(view.spin?1:0)+view.yaw;
      const tiltX=0.42+view.pitch;
      const wob=view.spin?Math.sin(t*0.70)*0.14:0;

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

    const touchStart={current:null};
    const onTouchStart=(e)=>{
      const t=e.touches&&e.touches[0];
      if(t) touchStart.current={x:t.clientX,y:t.clientY,at:Date.now()};
    };
    canvas.addEventListener("touchstart",onTouchStart,{passive:true});

    const pos=(e)=>{const r=canvas.getBoundingClientRect();const tc=e.touches?.[0];return tc?[tc.clientX-r.left,tc.clientY-r.top]:[e.clientX-r.left,e.clientY-r.top];};
    const onMove=(e)=>{const[mx,my]=pos(e);let best=null,bd=1e9;stateRef.current.orbs.forEach(o=>{o.hovered=false;const dx=mx-o.x,dy=my-o.y;const d=Math.sqrt(dx*dx+dy*dy);if(d<o.size*1.5&&o.z>-0.3&&d<bd){bd=d;best=o;}});if(best)best.hovered=true;};
    const onTap=(e)=>{
      // A swipe that ends on an orb should scroll, not open it.
      if(e.changedTouches&&e.changedTouches[0]){
        const t0=touchStart.current;
        if(t0){
          const dx=e.changedTouches[0].clientX-t0.x;
          const dy=e.changedTouches[0].clientY-t0.y;
          if(Math.hypot(dx,dy)>14) return;
          if(Date.now()-t0.at>700) return;
        }
      }
      const[mx,my]=pos(e);
      let best=null,bd=1e9;
      stateRef.current.orbs.forEach(o=>{
        const dx=mx-o.x,dy=my-o.y;
        const d=Math.sqrt(dx*dx+dy*dy);
        if(d<o.size*1.7&&o.z>-0.3&&d<bd){bd=d;best=o;}
      });
      if(best){setSelected(best);setSubSpheres(best.section);}
    };
    const resize=()=>{
      const d=pixelRatio();
      W=canvas.offsetWidth; H=canvas.offsetHeight;
      canvas.width=W*d; canvas.height=H*d;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.scale(d,d);
    };
    window.addEventListener("resize",resize);
    canvas.addEventListener("mousemove",onMove);
    canvas.addEventListener("click",onTap);
    canvas.addEventListener("touchend",onTap);
    const detachView=view.attach(canvas);
    return()=>{
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize",resize);detachView&&detachView();
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
    <div style={{position:"relative",width:"100%",height:"calc(100vh - 150px)",minHeight:340}}>
      <p style={{fontFamily:"monospace",fontSize:10,color:"#444",letterSpacing:"0.15em",textAlign:"center",paddingTop:6}}>// TOCA UNA ESFERA PARA EXPLORAR</p>
      <canvas ref={canvasRef} style={{width:"100%",height:"calc(100% - 24px)",cursor:"pointer",touchAction:"pan-y",display:"block"}}/>

      <ViewPad onNudge={view.nudge} onToggle={view.toggleSpin} onReset={view.reset}
               spinning={view.ui.spin}/>
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
    "Revisando la guía"];
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
  const [photos,setPhotos]=useState([]);
  const [photoBusy,setPhotoBusy]=useState(false);

  const addPhotos=async(fileList)=>{
    const files=Array.from(fileList||[]).slice(0,MAX_PHOTOS);
    if(!files.length) return;
    setPhotoBusy(true);
    try{
      const room=MAX_PHOTOS-photos.length;
      if(room<=0){ alert(`Puedes adjuntar como máximo ${MAX_PHOTOS} fotos.`); return; }
      const prepared=[];
      for(const f of files.slice(0,room)){
        try{ prepared.push(await prepareImage(f)); }
        catch(e){ alert(`No se pudo usar "${f.name}": ${e.message}`); }
      }
      if(prepared.length) setPhotos(p=>[...p,...prepared]);
    } finally { setPhotoBusy(false); }
  };
  const removePhoto=(id)=>setPhotos(p=>p.filter(x=>x.id!==id));
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
        ...(item.guide?.herramientas||[])].map(norm).join(" ");
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
    // A photo on its own is a valid request: the model can see the fault.
    if(!problem.trim()&&!photos.length) return;
    setLoading(true);setScreen("guide");setCompletedSteps([]);setGuide(null);
    const lvlStr=level==="simple"?"Use very simple language for beginners, avoid technical terms, max 5 steps":level==="experto"?"Use technical professional language with advanced detail, 7-8 steps":"Use clear practical language, 5-7 steps";
    // The JSON keys stay in Spanish because the app reads them; only the values
    // are translated. Saying so explicitly avoids the model renaming the keys.
    const sys="You are a universal expert. Respond ONLY with valid JSON. Keys (keep these key names exactly as given, in Spanish): titulo, dificultad, tiempo, herramientas (array), pasos (array of {titulo,descripcion,consejo}), advertencia, cuando_llamar_profesional. "
      +lvlStr+". Write ALL values in "+langInfo.label+" ("+langInfo.native+"). "
      +"The dificultad value must be one of: Facil, Moderado, Dificil, Experto - keep those in Spanish.";
    const usr="Categoria: "+selectedCategory.label+". Consulta: "+problem
      +(photos.length?` El usuario adjunta ${photos.length} foto${photos.length>1?"s":""} del problema: examínala${photos.length>1?"s":""} y basa la guía en lo que se ve.`:"")
      +" Solo JSON.";
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
              body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:4000,system:sys,
                messages:[{role:"user",content:
                  photos.length
                    ? [...photos.map(p=>({type:"image",source:{type:"base64",media_type:p.media,data:p.data}})),
                       {type:"text",text:usr}]
                    : usr }]})});
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
                 body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},
                   contents:[{parts:[
                     ...photos.map(p=>({inlineData:{mimeType:p.media,data:p.data}})),
                     {text:usr}
                   ]}],generationConfig:{maxOutputTokens:4000}})});
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
                     body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},
                   contents:[{parts:[
                     ...photos.map(p=>({inlineData:{mimeType:p.media,data:p.data}})),
                     {text:usr}
                   ]}],generationConfig:{maxOutputTokens:4000}})});
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
      const newEntry={id:Date.now(),category:selectedCategory,problem,guide:parsed,
        date:new Date().toLocaleDateString("es-ES"),ai:aiProvider,lang:guideLang,
        // Only the small previews are kept; the full base64 would blow the
        // storage quota after a handful of guides.
        thumbs:photos.map(p=>p.preview).slice(0,MAX_PHOTOS)};
      setActiveGuideId(newEntry.id);
      setHistory(prev=>[newEntry,...prev.slice(0,49)]);
    }catch(e){setGuide({error:true,msg:e.message||"Error de red."});}
    finally{setLoading(false);setLoadingNote("");}
  };

  // --- follow-up questions --------------------------------------------------
  // Each question is answered on its own: the guide goes along for context but
  // previous answers do not, which keeps every request small and cheap.
  const [followUps,setFollowUps]=useState([]);      // {q, a, photos, at}
  const [question,setQuestion]=useState("");
  const [qPhotos,setQPhotos]=useState([]);
  const [asking,setAsking]=useState(false);

  const addQPhotos=async(fileList)=>{
    const files=Array.from(fileList||[]).slice(0,MAX_PHOTOS);
    if(!files.length) return;
    const room=MAX_PHOTOS-qPhotos.length;
    if(room<=0){ alert(`Máximo ${MAX_PHOTOS} fotos por pregunta.`); return; }
    const out=[];
    for(const f of files.slice(0,room)){
      try{ out.push(await prepareImage(f)); }
      catch(e){ alert(`No se pudo usar "${f.name}": ${e.message}`); }
    }
    if(out.length) setQPhotos(p=>[...p,...out]);
  };

  const askFollowUp=async()=>{
    const q=question.trim();
    if(!q&&!qPhotos.length) return;
    if(!guide||guide.error) return;
    setAsking(true);

    // A compact digest of the guide: enough for the model to answer in context
    // without resending every word of it.
    const resumen=[
      "Guía: "+(guide.titulo||""),
      guide.herramientas?.length?("Herramientas: "+guide.herramientas.join(", ")):"",
      "Pasos: "+(guide.pasos||[]).map((p,i)=>(i+1)+". "+p.titulo).join("; "),
      guide.advertencia?("Advertencia: "+guide.advertencia):""].filter(Boolean).join("\n");

    const sys="Eres un experto en "+(selectedCategory?.label||"la materia")
      +". El usuario sigue una guía tuya y tiene una duda concreta. "
      +"Responde en "+langInfo.label+", de forma directa y práctica, en texto plano sin JSON ni markdown. "
      +"Máximo 6 frases. Si la duda revela un riesgo, adviértelo primero.";
    const usr=resumen+"\n\nPregunta del usuario: "+(q||"(mira las fotos adjuntas)")
      +(qPhotos.length?` Adjunta ${qPhotos.length} foto${qPhotos.length>1?"s":""}: examínala${qPhotos.length>1?"s":""}.`:"");

    let answer="";
    try{
      if(aiProvider==="claude"){
        const h={"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"};
        if(apiKeys.claude) h["x-api-key"]=apiKeys.claude;
        const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:h,
          body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:700,system:sys,
            messages:[{role:"user",content: qPhotos.length
              ? [...qPhotos.map(p=>({type:"image",source:{type:"base64",media_type:p.media,data:p.data}})),
                 {type:"text",text:usr}]
              : usr }]})});
        if(!r.ok) throw new Error("La IA no pudo responder ahora mismo.");
        const d=await r.json();
        answer=d.content.map(b=>b.text||"").join("").trim();
      } else {
        if(!apiKeys.gemini) throw new Error("Añade tu clave de Gemini en ⚙️.");
        let list=["gemini-3.7-flash","gemini-flash-latest","gemini-2.5-flash"];
        try{
          const c=JSON.parse(localStorage.getItem("maestro_gemini_models")||"null");
          if(c&&Array.isArray(c.list)) list=c.list;
        }catch(e){}
        let r=null;
        for(const m of list){
          r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+m+":generateContent?key="+apiKeys.gemini,
            {method:"POST",headers:{"Content-Type":"application/json"},
             body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},
               contents:[{parts:[
                 ...qPhotos.map(p=>({inlineData:{mimeType:p.media,data:p.data}})),
                 {text:usr}]}],
               generationConfig:{maxOutputTokens:700}})});
          if(r.ok) break;
        }
        if(!r||!r.ok) throw new Error("La IA no pudo responder ahora mismo.");
        const d=await r.json();
        answer=(d?.candidates?.[0]?.content?.parts?.[0]?.text||"").trim();
      }
      if(!answer) throw new Error("Respuesta vacía.");
      setFollowUps(f=>[...f,{q:q||"(consulta sobre las fotos)",a:answer,
                             photos:qPhotos.map(p=>p.preview),at:Date.now()}]);
      setQuestion(""); setQPhotos([]);
    }catch(e){
      setFollowUps(f=>[...f,{q:q||"(consulta sobre las fotos)",
                             a:"⚠️ "+(e.message||"No se pudo responder."),error:true,
                             photos:qPhotos.map(p=>p.preview),at:Date.now()}]);
    } finally { setAsking(false); }
  };

  const toggleStep=i=>setCompletedSteps(prev=>{
    const next=prev.includes(i)?prev.filter(s=>s!==i):[...prev,i];
    if(activeGuideId) setProgress(p=>({...p,[activeGuideId]:next}));
    return next;
  });
  const reset=()=>{setScreen("home");setSelectedCategory(null);setProblem("");setPhotos([]);setGuide(null);setFollowUps([]);setQuestion("");setQPhotos([]);setCompletedSteps([]);setViewHistory(false);setSearch("");setEnteredByStar(false);setJourney(null);setHistQuery("");setHistFilter("todas");};

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
    setFollowUps([]); setQuestion(""); setQPhotos([]);
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

      {/* zIndex sits above the journey canvas, which otherwise covered this
          panel. Only one scrolling container: nesting two of them made touch
          gestures unpredictable on mobile. */}
      {showKeys&&(
        <div style={{position:"fixed",inset:0,zIndex:300,background:"rgba(0,0,0,0.78)",
                     display:"block",overflowY:"auto",WebkitOverflowScrolling:"touch",
                     padding:"14px"}}
             onClick={()=>setShowKeys(false)}>
          <div style={{background:"#050d18",border:"1px solid rgba(0,180,255,0.3)",
                       borderRadius:8,width:"100%",maxWidth:440,
                       margin:"0 auto",position:"relative"}}
               onClick={e=>e.stopPropagation()}>
            {/* Header stays put while the settings themselves scroll. */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                         padding:"16px 22px 12px",borderBottom:"1px solid rgba(0,180,255,0.12)",
                         position:"sticky",top:0,background:"#050d18",zIndex:2,
                         borderRadius:"8px 8px 0 0"}}>
              <h3 style={{fontFamily:"monospace",color:"#00cfff",fontSize:16,margin:0}}>⚙️ Ajustes</h3>
              <button onClick={()=>setShowKeys(false)}
                style={{background:"none",border:"none",color:"#667",fontSize:20,
                        cursor:"pointer",lineHeight:1,padding:"0 4px"}}>✕</button>
            </div>
            <div style={{padding:"18px 22px 22px"}}>
            <p style={{fontFamily:"monospace",fontSize:11,color:"#00cfff",
                       letterSpacing:"0.1em",marginBottom:10}}>🔑 CLAVES DE IA</p>

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
                      const txt=await readText();
                      if(txt) setApiKeys(k=>({...k,gemini:txt}));
                      else alert("Tu navegador no permite pegar automáticamente aquí.\n\nMantén pulsado el campo de texto y elige Pegar.");
                    }catch(e){
                      alert("Mantén pulsado el campo de texto y elige Pegar.");
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
            <button onClick={()=>setShowKeys(false)}
              style={{width:"100%",padding:"12px",border:"none",borderRadius:4,
                      background:"rgba(0,180,255,0.18)",color:"#00cfff",
                      fontFamily:"monospace",fontSize:14,cursor:"pointer",fontWeight:"bold",
                      position:"sticky",bottom:8,zIndex:2,
                      boxShadow:"0 6px 20px rgba(5,13,24,0.95)"}}>
              ✓ Guardar y cerrar
            </button>
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
                          copyText(txt).then(ok=>{
                            alert(ok?"Registro copiado. Pégalo en el chat."
                                   :"No se pudo copiar. Registro:\n\n"+txt.slice(0,1200));
                          });
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
              {/* Only the writing goes on the slab. The controls used to live
                  here too, but the panel in the photograph is far narrower than
                  the old drawn altar, so they overlapped and spilled out. */}
              <textarea
                style={{width:"100%",height:"100%",background:"transparent",border:"none",
                        outline:"none",color:"#dfe9f5",fontSize:"clamp(10px, 2.4vw, 14px)",
                        padding:0,fontFamily:"Georgia,serif",resize:"none",
                        boxSizing:"border-box",lineHeight:1.45,overflowY:"auto",
                        textAlign:"center",
                        textShadow:`0 0 12px ${accentColor}88, 0 1px 3px rgba(0,0,0,.95)`}}
                placeholder="Describe el problema..."
                value={problem} onChange={e=>setProblem(e.target.value)}/>
            </ColumnFrame>

            {/* Controls below the sanctuary, where there is room for them. */}
            <div style={{display:"flex",flexDirection:"column",gap:9,marginTop:12}}>
              {photos.length>0&&(
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {photos.map(p=>(
                    <div key={p.id} style={{position:"relative",width:52,height:52,
                                            borderRadius:4,overflow:"hidden",
                                            border:`1px solid ${accentColor}55`}}>
                      <img src={p.preview} alt={p.name}
                           style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                      <button onClick={()=>removePhoto(p.id)} title="Quitar"
                        style={{position:"absolute",top:1,right:1,width:17,height:17,
                                borderRadius:"50%",border:"none",background:"rgba(0,0,0,0.72)",
                                color:"#fff",fontSize:11,lineHeight:1,cursor:"pointer",padding:0}}>×</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                <button onClick={()=>listening?stopListening():startListening(t=>setProblem(p=>p?p+" "+t:t))}
                  title="Dictar"
                  style={{width:40,height:40,borderRadius:"50%",flexShrink:0,
                          border:`2px solid ${listening?"#ff6b6b":accentColor+"66"}`,
                          background:listening?"rgba(255,80,80,0.2)":`${accentColor}14`,
                          color:listening?"#ff6b6b":accentColor,fontSize:16,cursor:"pointer"}}>
                  {listening?"⏹":"🎤"}
                </button>
                <label title="Hacer una foto"
                  style={{padding:"11px 13px",borderRadius:4,flexShrink:0,
                          border:`1px solid ${accentColor}55`,background:`${accentColor}14`,
                          color:accentColor,fontSize:14,
                          cursor:photos.length>=MAX_PHOTOS?"not-allowed":"pointer",
                          opacity:photos.length>=MAX_PHOTOS?0.4:1}}>
                  📷
                  <input type="file" accept="image/*" capture="environment"
                    disabled={photos.length>=MAX_PHOTOS} style={{display:"none"}}
                    onChange={e=>{addPhotos(e.target.files);e.target.value="";}}/>
                </label>
                <label title="Elegir de la galería"
                  style={{padding:"11px 13px",borderRadius:4,flexShrink:0,
                          border:`1px solid ${accentColor}55`,background:"transparent",
                          color:accentColor,fontSize:14,
                          cursor:photos.length>=MAX_PHOTOS?"not-allowed":"pointer",
                          opacity:photos.length>=MAX_PHOTOS?0.4:1}}>
                  🖼
                  <input type="file" accept="image/*" multiple
                    disabled={photos.length>=MAX_PHOTOS} style={{display:"none"}}
                    onChange={e=>{addPhotos(e.target.files);e.target.value="";}}/>
                </label>
                <span style={{fontFamily:"monospace",fontSize:10,color:"#667",flex:1,minWidth:90}}>
                  {photoBusy ? "preparando…"
                    : photos.length ? `${photos.length}/${MAX_PHOTOS} foto${photos.length>1?"s":""}`
                    : "adjunta una foto"}
                </span>
              </div>

              <button
                style={{width:"100%",padding:"15px 20px",border:"none",borderRadius:4,
                        color:"#001018",fontSize:"clamp(12px, 3.4vw, 15px)",fontWeight:"bold",
                        cursor:"pointer",background:accentColor,fontFamily:"monospace",
                        letterSpacing:"0.02em",whiteSpace:"nowrap",
                        opacity:(problem.trim()||photos.length)?1:0.4}}
                onClick={fetchGuide} disabled={!problem.trim()&&!photos.length}>
                GENERAR GUÍA →
              </button>
            </div>

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

                          {/* Free tools and libraries, chosen by what this
                              particular step is about rather than listed wholesale. */}
                          {selectedCategory?.id==="cine_tv" &&
                            filmResourcesFor(paso.titulo+" "+(paso.descripcion||"")+" "+(paso.consejo||""))
                              .map(r=>(
                                <a key={r.label} href={r.url} target="_blank" rel="noopener noreferrer"
                                   onClick={e=>e.stopPropagation()} title={r.what}
                                   style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",
                                           borderRadius:4,background:"rgba(90,72,40,0.13)",
                                           border:"1px solid rgba(120,98,58,0.35)",color:"#5f4c2e",
                                           fontSize:12,fontFamily:"Georgia,'Times New Roman',serif",
                                           textDecoration:"none",fontWeight:"600"}}>
                                  ⬡ {r.label}
                                </a>
                              ))}
                        </div>}
                      </div>
                    );
                  })}
                </div>

                {/* A full index at the end, for anything the individual steps
                    did not happen to surface. */}
                {selectedCategory?.id==="cine_tv"&&(
                  <div style={{background:"rgba(160,138,90,0.12)",border:"1px solid rgba(120,98,58,0.30)",
                               borderRadius:4,padding:"16px 20px",marginBottom:24}}>
                    <h3 style={{fontSize:13,fontWeight:"bold",color:"#5f4c2e",margin:"0 0 4px",
                                fontFamily:"Georgia,'Times New Roman',serif",letterSpacing:"0.06em",
                                textTransform:"uppercase"}}>🎬 Recursos gratuitos</h3>
                    <p style={{fontSize:11,color:"#6b5636",margin:"0 0 12px",
                               fontFamily:"Georgia,'Times New Roman',serif"}}>
                      Herramientas y bibliotecas libres para cada fase del trabajo
                    </p>
                    <div style={{display:"flex",flexDirection:"column",gap:7}}>
                      {FILM_RESOURCES.map(r=>(
                        <a key={r.label} href={r.url} target="_blank" rel="noopener noreferrer"
                           style={{display:"flex",alignItems:"baseline",gap:8,textDecoration:"none",
                                   padding:"6px 10px",borderRadius:4,
                                   background:"rgba(120,98,58,0.10)",
                                   border:"1px solid rgba(120,98,58,0.22)"}}>
                          <span style={{fontSize:13,fontWeight:"bold",color:"#4a3c24",
                                        fontFamily:"Georgia,'Times New Roman',serif",flexShrink:0}}>
                            {r.label}
                          </span>
                          <span style={{fontSize:11,color:"#6b5636",
                                        fontFamily:"Georgia,'Times New Roman',serif"}}>
                            {r.what}
                          </span>
                          <span style={{marginLeft:"auto",color:"#8a7550",fontSize:12,flexShrink:0}}>↗</span>
                        </a>
                      ))}
                    </div>
                    <p style={{fontSize:10,color:"#7a6440",margin:"11px 0 0",
                               fontFamily:"Georgia,'Times New Roman',serif",lineHeight:1.5}}>
                      Comprueba siempre la licencia de cada material antes de publicar tu obra.
                    </p>
                  </div>
                )}

                {guide.cuando_llamar_profesional&&<div style={{background:"rgba(160,138,90,0.12)",border:"1px solid rgba(120,98,58,0.30)",borderRadius:4,padding:"16px 20px",marginBottom:28}}><h3 style={{fontSize:13,fontWeight:"bold",color:"#5f4c2e",margin:"0 0 10px",fontFamily:"Georgia,'Times New Roman',serif",textTransform:"uppercase",letterSpacing:"0.06em"}}>👷 ¿Cuándo llamar a un profesional?</h3><p style={{margin:0,fontSize:14,color:"#5c4a2c",lineHeight:1.6,fontFamily:"Georgia,'Times New Roman',serif"}}>{guide.cuando_llamar_profesional}</p></div>}

                {/* Ask about anything the guide did not cover. Answers are
                    independent of each other, so each request stays small. */}
                <div style={{background:"rgba(160,138,90,0.12)",border:"1px solid rgba(120,98,58,0.30)",
                             borderRadius:4,padding:"16px 20px",marginBottom:28}}>
                  <h3 style={{fontSize:13,fontWeight:"bold",color:"#5f4c2e",margin:"0 0 4px",
                              fontFamily:"Georgia,'Times New Roman',serif",letterSpacing:"0.06em",
                              textTransform:"uppercase"}}>💬 ¿Alguna duda?</h3>
                  <p style={{fontSize:11,color:"#6b5636",margin:"0 0 12px",
                             fontFamily:"Georgia,'Times New Roman',serif"}}>
                    Pregunta lo que necesites sobre esta guía, o enseña una foto de cómo va
                  </p>

                  {followUps.map((f,i)=>(
                    <div key={f.at+"_"+i} style={{marginBottom:14}}>
                      <div style={{display:"flex",gap:8,marginBottom:6}}>
                        <span style={{fontSize:13,flexShrink:0}}>❓</span>
                        <p style={{margin:0,fontSize:13,color:"#3b2f1c",fontWeight:"bold",
                                   fontFamily:"Georgia,'Times New Roman',serif",lineHeight:1.45}}>{f.q}</p>
                      </div>
                      {f.photos?.length>0&&(
                        <div style={{display:"flex",gap:5,margin:"0 0 7px 21px"}}>
                          {f.photos.map((src,k)=>(
                            <img key={k} src={src} alt=""
                                 style={{width:42,height:42,objectFit:"cover",borderRadius:3,
                                         border:"1px solid rgba(120,98,58,0.4)"}}/>
                          ))}
                        </div>
                      )}
                      <div style={{display:"flex",gap:8,marginLeft:0}}>
                        <span style={{fontSize:13,flexShrink:0}}>{f.error?"⚠️":"⬡"}</span>
                        <p style={{margin:0,fontSize:13,lineHeight:1.6,
                                   color:f.error?"#8a2f18":"#3f331e",
                                   fontFamily:"Georgia,'Times New Roman',serif",
                                   whiteSpace:"pre-wrap"}}>{f.a}</p>
                      </div>
                    </div>
                  ))}

                  {qPhotos.length>0&&(
                    <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap"}}>
                      {qPhotos.map(p=>(
                        <div key={p.id} style={{position:"relative",width:44,height:44,
                                                borderRadius:3,overflow:"hidden",
                                                border:"1px solid rgba(120,98,58,0.45)"}}>
                          <img src={p.preview} alt=""
                               style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                          <button onClick={()=>setQPhotos(x=>x.filter(y=>y.id!==p.id))}
                            style={{position:"absolute",top:0,right:0,width:15,height:15,border:"none",
                                    background:"rgba(0,0,0,0.7)",color:"#fff",fontSize:10,
                                    cursor:"pointer",padding:0,lineHeight:1}}>×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <textarea value={question} onChange={e=>setQuestion(e.target.value)}
                    placeholder="Escribe tu duda..." rows={2} disabled={asking}
                    style={{width:"100%",background:"rgba(255,255,255,0.30)",
                            border:"1px solid rgba(120,98,58,0.35)",borderRadius:4,
                            color:"#3b2f1c",fontSize:13,padding:"9px 11px",
                            fontFamily:"Georgia,'Times New Roman',serif",resize:"vertical",
                            boxSizing:"border-box",lineHeight:1.5,marginBottom:8}}/>

                  <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                    <label title="Hacer una foto"
                      style={{padding:"8px 11px",borderRadius:4,border:"1px solid rgba(120,98,58,0.35)",
                              background:"rgba(120,98,58,0.10)",color:"#5f4c2e",fontSize:13,
                              cursor:qPhotos.length>=MAX_PHOTOS?"not-allowed":"pointer",
                              opacity:qPhotos.length>=MAX_PHOTOS?0.4:1}}>
                      📷
                      <input type="file" accept="image/*" capture="environment"
                        disabled={qPhotos.length>=MAX_PHOTOS||asking} style={{display:"none"}}
                        onChange={e=>{addQPhotos(e.target.files);e.target.value="";}}/>
                    </label>
                    <label title="Elegir de la galería"
                      style={{padding:"8px 11px",borderRadius:4,border:"1px solid rgba(120,98,58,0.35)",
                              background:"transparent",color:"#5f4c2e",fontSize:13,
                              cursor:qPhotos.length>=MAX_PHOTOS?"not-allowed":"pointer",
                              opacity:qPhotos.length>=MAX_PHOTOS?0.4:1}}>
                      🖼
                      <input type="file" accept="image/*" multiple
                        disabled={qPhotos.length>=MAX_PHOTOS||asking} style={{display:"none"}}
                        onChange={e=>{addQPhotos(e.target.files);e.target.value="";}}/>
                    </label>
                    <button onClick={()=>listening?stopListening():startListening(t=>setQuestion(p=>p?p+" "+t:t))}
                      title="Dictar" disabled={asking}
                      style={{padding:"8px 11px",borderRadius:4,
                              border:`1px solid ${listening?"rgba(150,60,30,0.5)":"rgba(120,98,58,0.35)"}`,
                              background:listening?"rgba(150,60,30,0.14)":"transparent",
                              color:listening?"#8a2f18":"#5f4c2e",fontSize:13,cursor:"pointer"}}>
                      {listening?"⏹":"🎤"}
                    </button>
                    <button onClick={askFollowUp}
                      disabled={asking||(!question.trim()&&!qPhotos.length)}
                      style={{flex:1,minWidth:130,padding:"9px 16px",border:"none",borderRadius:4,
                              background:"#5c4a2c",color:"#f2e8cd",fontSize:13,fontWeight:"bold",
                              fontFamily:"Georgia,'Times New Roman',serif",
                              cursor:asking?"wait":"pointer",
                              opacity:(asking||(!question.trim()&&!qPhotos.length))?0.45:1}}>
                      {asking?"Consultando…":"Preguntar →"}
                    </button>
                  </div>
                </div>

                {guide.pasos&&completedSteps.length===guide.pasos.length&&(
                  <div style={{textAlign:"center",background:"rgba(160,138,90,0.12)",border:"1px solid rgba(120,98,58,0.30)",borderRadius:4,padding:"32px 24px"}}>
                    <span style={{fontSize:48}}>🎉</span>
                    <h3 style={{fontSize:22,margin:"12px 0 8px",fontFamily:"Georgia,'Times New Roman',serif"}}>¡Problema resuelto!</h3>
                    <p style={{color:"#584627",margin:0,fontFamily:"Georgia,'Times New Roman',serif"}}>Has completado todos los pasos.</p>
                    <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginTop:12}}>
                      <button style={{padding:"12px 18px",border:"1px solid rgba(0,180,255,0.3)",borderRadius:4,color:"#3b2f1c",fontSize:14,cursor:"pointer",background:"transparent",fontFamily:"Georgia,'Times New Roman',serif"}} onClick={()=>{const t=guide.titulo+(guide.pasos?.map((p,i)=>"\n"+(i+1)+". "+p.titulo+"\n"+p.descripcion)||[]).join("");copyText(t).then(ok=>alert(ok?"¡Copiado!":"No se pudo copiar automáticamente. Mantén pulsado el texto de la guía para seleccionarlo."));}}>📋 COPIAR</button>
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
        @keyframes oracleFloat{0%,100%{transform:translate(-50%,-50%) translateY(0);}50%{transform:translate(-50%,-50%) translateY(-9px);}}
        @keyframes oraclePulse{0%,100%{opacity:.55;transform:translate(-50%,-50%) scale(1);}50%{opacity:1;transform:translate(-50%,-50%) scale(1.07);}}
        @keyframes scan{0%,100%{opacity:0;transform:translateX(-100%);}50%{opacity:1;transform:translateX(100%);}}
        textarea:focus,input:focus{outline:none;border-color:rgba(0,255,65,0.5)!important;box-shadow:0 0 10px rgba(0,255,65,0.15)!important;}
        textarea{color:#00ff41!important;}input{color:#00ff41!important;}
        ::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:#000;}::-webkit-scrollbar-thumb{background:#1a3a1a;border-radius:3px;}
      `}</style>
    </div>
  );
}
  const btnStyle={background:"rgba(0,8,20,0.8)",border:"1px solid rgba(0,180,255,0.2)",color:"#00aaee",padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontFamily:"monospace"};
