// @ts-nocheck  (ported from the tested demo)
export const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),lerp=(a,b,t)=>a+(b-a)*t;
export const NAMES=['144p','240p','360p','480p','720p','1080p','1440p','4K'],WIDTHS=[30,54,80,116,176,300,520,960];
export const P=new URLSearchParams(location.search);
export const NOCANVAS=P.get('nocanvas')==='1';
export const RM=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
export const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export const IC={check:'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',pin:'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',person:'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',star:'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',play:'M8 5v14l11-7z',full:'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',gear:'M19.4 13a7.6 7.6 0 000-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-1.7-1L15 3.4h-4l-.4 2.6a7.5 7.5 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 000 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 001.7 1l.4 2.6h4l.4-2.6a7.5 7.5 0 001.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z',speed:'M20.38 8.57l-1.23 1.85a8 8 0 01-.22 7.58H5.07A8 8 0 0115.58 6.85l1.85-1.23A10 10 0 003.35 19a2 2 0 001.72 1h13.85a2 2 0 001.74-1 10 10 0 00-.27-10.44zM10.59 15.41a2 2 0 002.83 0l5.66-8.49-8.49 5.66a2 2 0 000 2.83z',pause:'M6 19h4V5H6zm8-14v14h4V5z',skip:'M6 18l8.5-6L6 6zm9-12v12h2V6z',queue:'M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z',leaf:'M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8z',sparkle:'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z',contrast:'M12 2a10 10 0 100 20 10 10 0 000-20zm0 18V4a8 8 0 010 16z',sun:'M12 7a5 5 0 100 10 5 5 0 000-10zM2 13h2v-2H2zm18 0h2v-2h-2zM11 2v2h2V2zm0 18v2h2v-2z',moon:'M12 3a9 9 0 109 9 7 7 0 01-9-9z'};
export const ic=(k,c='')=>`<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true"><path d="${IC[k]}"/></svg>`;

/* ---------- painted sample video (abstract, colourful, with fine details that vanish at low quality) ---------- */
export function rng(s){return()=>(s=(s*1664525+1013904223)>>>0)/4294967296}
export const W=960,H=540;
export const SCENES=[
 {name:'Sunset drive',g:['#ffd23f','#1fb5c9','#5b1e8c','#ff7a2f'],sun:'#fff3b0',m:['#3a1a63','#1d0d3a'],w:['#ff7a2f','#5b1e8c','#1fb5c9']},
 {name:'Forest rain',g:['#d9f2a6','#4fbf8a','#17695e','#0c3b4a'],sun:'#f4ffd0',m:['#0e4a47','#082f33'],w:['#4fbf8a','#17695e','#9be15d']},
 {name:'Night city',g:['#15153d','#3b2a8a','#c13fa0','#ff7d6b'],sun:'#ffe9f3',m:['#1b1250','#0b0830'],w:['#c13fa0','#3b2a8a','#ff7d6b']},
 {name:'Golden hour',g:['#fff0a8','#ffb347','#ff6a3d','#b8264b'],sun:'#fffbe0',m:['#7a1f3d','#431028'],w:['#ffb347','#ff6a3d','#ffe27a']}
];
export function buildScene(S){
 const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d'),R=rng(5);
 const gr=g.createLinearGradient(0,0,W,H);S.g.forEach((col,i)=>gr.addColorStop(i/3,col));g.fillStyle=gr;g.fillRect(0,0,W,H);
 for(let i=0;i<26;i++){g.fillStyle=`rgba(255,255,255,${.05+R()*.1})`;g.beginPath();g.arc(R()*W,R()*H*.7,10+R()*38,0,6.283);g.fill()}
 const rg=g.createRadialGradient(690,170,10,690,170,200);rg.addColorStop(0,'rgba(255,255,255,.5)');rg.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=rg;g.fillRect(0,0,W,H);
 g.fillStyle=S.sun;g.beginPath();g.arc(690,170,62,0,6.283);g.fill();
 [[0,330,38,.006,1.4],[1,395,26,.009,4.1]].forEach(([k,b,a,f,p])=>{g.fillStyle=S.m[k];g.beginPath();g.moveTo(0,H);for(let x=0;x<=W;x+=6)g.lineTo(x,b+Math.sin(x*f+p)*a+Math.sin(x*f*2.7)*a*.35);g.lineTo(W,H);g.fill()});
 for(let i=0;i<46;i++){const x=20+i*20,h=40+R()*92,w=10+R()*8;g.fillStyle=`rgba(8,6,24,${.75+R()*.2})`;g.fillRect(x,H-h-6,w,h+6);
  for(let k=0;k<h/9;k++)if(R()<.45){g.fillStyle=`rgba(255,${200+R()*50|0},120,${.6+R()*.4})`;g.fillRect(x+2+(R()<.5?0:5),H-h+k*9,2,3)}}
 g.strokeStyle='rgba(255,255,255,.55)';g.lineWidth=1;for(let i=0;i<5;i++){g.beginPath();g.moveTo(0,300+i*8);g.quadraticCurveTo(W/2,360+i*6,W,290+i*10);g.stroke()}
 g.fillStyle='rgba(255,255,255,.85)';for(let i=0;i<60;i++)g.fillRect(R()*W,R()*H*.45,1.5,1.5);
 return c;
}
export const poster=()=>`<div class="poster" aria-hidden="true" style="background:linear-gradient(135deg,var(--s0,#ffd23f),var(--s1,#1fb5c9) 45%,var(--s2,#5b1e8c) 75%,var(--s3,#ff7a2f))"></div>`;

/* ---------- engine ---------- */
export class Engine{
 constructor(frame,cv){Object.assign(this,{frame,cv,onFrame:null,shown:0,target:0,k:10,visible:true,raf:0,last:0,drawn:-1,src:null,dead:false});this.small=document.createElement('canvas')}
 ok(){return this.visible&&!document.hidden&&!this.dead}
 kick(){if(this.raf||!this.ok())return;this.last=performance.now();this.raf=requestAnimationFrame(this.step)}
 step=now=>{this.raf=0;const dt=clamp((now-this.last)/1000,0,.05);this.last=now;
  if(RM())this.shown=this.target;else{this.shown+=(this.target-this.shown)*(1-Math.exp(-dt*this.k));if(Math.abs(this.target-this.shown)<.004)this.shown=this.target}
  this.shown=clamp(this.shown,0,7);this.render();if(this.shown!==this.target)this.kick()}
 stop(){this.dead=true;cancelAnimationFrame(this.raf)}
 fit(){const w=Math.max(2,Math.round(this.frame.clientWidth*Math.min(devicePixelRatio||1,2)));this.cv.width=w;this.cv.height=Math.round(w*9/16);this.drawn=-1;this.render()}
 render(){const v=this.shown;if(this.src&&Math.abs(v-this.drawn)>1e-4){this.draw(v);this.drawn=v}this.onFrame&&this.onFrame(v)}
 draw(q){q=clamp(q,0,7);const g=this.cv.getContext('2d'),cw=this.cv.width,ch=this.cv.height;
  if(q>=6.97){g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(this.src,0,0,cw,ch);return}
  const i=Math.floor(q),f=q-i,w=Math.round(Math.exp(lerp(Math.log(WIDTHS[i]),Math.log(WIDTHS[Math.min(7,i+1)]),f))),h=Math.max(2,Math.round(w*9/16));
  const s=this.small;s.width=w;s.height=h;const sg=s.getContext('2d');sg.imageSmoothingEnabled=true;sg.imageSmoothingQuality='medium';sg.drawImage(this.src,0,0,w,h);
  g.imageSmoothingEnabled=false;g.drawImage(s,0,0,cw,ch)}
}
export const afterFirstPaint=fn=>requestAnimationFrame(()=>requestAnimationFrame(()=>(window.requestIdleCallback||(f=>setTimeout(f,60)))(fn,{timeout:400})));
export function sheen(frame){const s=$('.sheen',frame);if(!s||RM())return;s.classList.remove('go');void s.offsetWidth;s.classList.add('go')}
export const fmt=s=>{s=Math.round(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};

/* ---------- shared menu markup (the extension's quality menu) ---------- */
export const chipsHTML=()=>NAMES.map((n,i)=>`<button class="chip" role="radio" aria-checked="false" data-i="${i}">${ic('check')}${n}</button>`).join('');
export const MENU=(extra)=>`<div class="qmenu" role="dialog" aria-label="Quality"><div class="mhead"><span>Quality</span><small class="playing">Playing 144p</small></div><span class="chan">Orbit Lab · channel default</span>
 <div class="modes" role="radiogroup" aria-label="Mode"><button class="mode" role="radio" aria-checked="false" data-m="auto">Auto</button><button class="mode" role="radio" aria-checked="false" data-m="max">Highest <small style="opacity:.7">4K</small></button></div>
 <div class="grid4" role="radiogroup" aria-label="Quality">${chipsHTML()}</div>${extra||''}</div>`;
export const ROWS=`<div class="hr"></div><button class="mrow v" data-r="v">${''}<span class="ib">${ic('pin')}</span><span>Remember for this video</span><small class="vv">Off</small></button><button class="mrow c" data-r="c"><span class="ib">${ic('person')}</span><span>Default for Orbit Lab</span><small class="cv">Off</small></button><button class="mrow a" data-r="a"><span class="ib">${ic('star')}</span><span>Make default for all videos</span><small class="av">Off</small></button>`;

IC.chev='M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z';
IC.lock='M18 8h-1V6A5 5 0 007 6v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2zM9 6a3 3 0 016 0v2H9z';
IC.x='M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';
IC.bell='M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 00-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1z';
IC.globe='M12 2a10 10 0 100 20 10 10 0 000-20zm6.93 6h-2.95a15.65 15.65 0 00-1.38-3.56A8.03 8.03 0 0118.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a8.2 8.2 0 010-4h3.38a16.5 16.5 0 000 4zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 015.07 16zm2.95-8H5.07a7.99 7.99 0 014.33-3.56A15.65 15.65 0 008.02 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66a14.7 14.7 0 010-4h4.68a14.7 14.7 0 010 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14a16.5 16.5 0 000-4h3.38a8.2 8.2 0 010 4z';

/* ---------- context: timers, observers, abort ---------- */
export function makeCtx(site,local){local=local||site;
 const ac=new AbortController(),cl=[],timers=[];
 return{site,local,O:{signal:ac.signal},timers,cl,
  T(fn,ms){const id=setTimeout(fn,ms);timers.push(id);return id},
  every(fn,ms){const id=setInterval(fn,ms);cl.push(()=>clearInterval(id));return id},
  watch(el){const w={vis:true};const io=new IntersectionObserver(es=>{w.vis=es[0].isIntersecting;local.classList.toggle('paused',!w.vis)},{threshold:.1});io.observe(el);cl.push(()=>io.disconnect());w.live=()=>w.vis&&!document.hidden;return w},
  destroy(){ac.abort();cl.splice(0).forEach(f=>f());timers.splice(0).forEach(clearTimeout)}};
}
export const AMO='https://addons.mozilla.org/en-US/firefox/addon/resolute-video-quality-control/';

/* ---------- the engine hooks (same as the earlier demo) ---------- */
export function attachEngine(frame,wrap,site,impl,O,flagScene){
 const cv=$('canvas',frame),eng=new Engine(frame,cv);impl.eng=eng;
 const seen=new Map();const io=new IntersectionObserver(es=>{es.forEach(e=>seen.set(e.target,e.isIntersecting));const v=[...seen.values()].some(Boolean);eng.visible=v;site.classList.toggle('paused',!v);if(v){eng.kick();impl.onVisible&&seen.get(wrap)&&impl.onVisible()}},{threshold:.2});io.observe(wrap);
 const ro=new ResizeObserver(()=>{if(eng.src)eng.fit()});ro.observe(frame);
 document.addEventListener('visibilitychange',()=>{document.documentElement.classList.toggle('tabhidden',document.hidden);eng.kick()},O);
 impl.destroy=()=>{eng.stop();io.disconnect();ro.disconnect()};
 afterFirstPaint(()=>{if(O.signal.aborted)return;try{if(NOCANVAS||!cv.getContext('2d'))throw 0;eng.src=flagScene();if(!eng.src)throw 0;eng.fit();frame.classList.add('ready');impl.onReady&&impl.onReady()}catch(e){}});
 return eng;
}

