// @ts-nocheck  (ported from the tested demo)
import {clamp,RM,ic,poster,SCENES,NAMES,MENU,ROWS,buildScene,attachEngine,sheen,fmt} from './core';
/* ---------- HERO: A (the real pill) + B (the page takes the video's colours) ---------- */
export function heroSetup(stage,ctx){
 const $=(s,r=stage)=>r.querySelector(s),$$=(s,r=stage)=>[...r.querySelectorAll(s)];
 const {site,O}=ctx;
 stage.innerHTML=`<div class="pwrap dk" id="pw"><div class="glowbox"><canvas class="halo" id="halo" width="64" height="36" aria-hidden="true"></canvas><div class="frame" id="frame">${poster()}<canvas aria-hidden="true"></canvas><i class="sheen"></i>
 <div class="ytbar"><div class="prog"><i></i></div><div class="ytrow">${ic('play')}<span>3:42 / 10:15 <span class="tl">· <span id="left">6:33</span> left</span></span><span class="sp"></span>
 <div class="split"><button class="spd" id="spd" aria-label="Playback speed">1×</button><button class="qlt pulse" id="qlt" aria-haspopup="dialog" aria-expanded="false" aria-label="Quality"><span id="ql">144p</span><i class="dot" id="dot"></i></button></div>${ic('gear')}${ic('full')}</div></div></div></div>
 <div class="mwrap" id="mw">${MENU(ROWS)}</div></div>
 <div class="scenes" id="scenes" role="group" aria-label="Pick a video">${SCENES.map((s,i)=>`<button class="scn" aria-pressed="${i===0}" aria-label="${s.name}" data-i="${i}" style="background:linear-gradient(135deg,${s.g.join(',')})"><canvas width="96" height="54"></canvas><span>${s.name}</span></button>`).join('')}</div>
 <p class="cap" id="cap" aria-live="polite"></p>`;
 const frame=$('#frame'),pw=$('#pw'),mw=$('#mw'),qlt=$('#qlt'),spd=$('#spd'),cap=$('#cap'),dot=$('#dot'),halo=$('#halo');
 const srcs=[];const getSrc=i=>srcs[i]||(srcs[i]=(()=>{try{return buildScene(SCENES[i])}catch(e){return null}})());
 let idx=0,sel=0,mode='yt',open=false,touched=false,locked=false,vOn=false,cOn=false,aOn=false,si=0,hover=false,ran=false,cycle=0;
 const SP=[1,1.25,1.5,2];
 const impl={};const eng=attachEngine(frame,pw,ctx.local,impl,O,()=>getSrc(idx));
 eng.shown=eng.target=0;eng.k=9;
 const tgt=()=>mode==='max'?7:mode==='auto'?2:mode==='q'?sel:0;
 const label=v=>mode==='max'?'Max':mode==='auto'?'Auto':mode==='q'?NAMES[sel]:NAMES[clamp(Math.round(v),0,7)];
 const ui=v=>{const i=clamp(Math.round(v),0,7);$('.playing',mw).textContent='Playing '+NAMES[i];$('#ql').textContent=label(v);
  $$('.chip',mw).forEach(b=>b.setAttribute('aria-checked',String(mode==='q'&&+b.dataset.i===sel)));$$('.mode',mw).forEach(b=>b.setAttribute('aria-checked',String(b.dataset.m===mode)));
  const lk=v>6.97;if(lk!==locked){locked=lk;if(lk)sheen(frame)}
  cap.textContent=v>6.97?`Playing 4K on ${SCENES[idx].name}. The page took its colours.`:v<2.5?'YouTube picked a low quality. Tap the pill, or pick another video.':`Playing ${NAMES[i]}.`;
  $('.vv',mw).textContent=vOn?NAMES[i]:'Off';$('.cv',mw).textContent=cOn?'Remove':'Off';$('.av',mw).textContent=aOn?'Remove':'Off';
  dot.className='dot'+(cOn?' c':vOn?' v':'');$('.chan',mw).classList.toggle('on',cOn);
  $$('.mrow',mw).forEach(r=>r.classList.toggle('on',r.dataset.r==='v'?vOn:r.dataset.r==='c'?cOn:aOn))};
 eng.onFrame=ui;
 const paint=()=>{const S=SCENES[idx];site.style.setProperty('--b1',S.w[0]);site.style.setProperty('--b2',S.w[1]);site.style.setProperty('--b3',S.w[2]);
  const po=$('.poster',frame);if(po)po.style.background=`linear-gradient(135deg,${S.g.join(',')})`;
  const hg=halo.getContext('2d'),s=srcs[idx];if(s)hg.drawImage(s,0,0,64,36);else{hg.fillStyle=S.g[1];hg.fillRect(0,0,64,36)}
  $$('.scn',stage).forEach((b,i)=>b.setAttribute('aria-pressed',String(i===idx)))};
 const setOpen=o=>{open=o;mw.classList.toggle('open',o);qlt.setAttribute('aria-expanded',String(o))};
 const touch=()=>{touched=true;qlt.classList.remove('pulse');ctx.timers.splice(0).forEach(clearTimeout);clearInterval(cycle)};
 const go=(i,user)=>{idx=i;if(user){touch();if(mode==='yt')mode='max'}const s=getSrc(i);paint();if(s&&eng.src){eng.src=s;eng.drawn=-1}
  const t=tgt();eng.shown=RM()?t:Math.min(3,t);eng.target=t;eng.k=3.2;eng.kick();ui(eng.shown)};
 qlt.addEventListener('click',()=>{touch();setOpen(!open)},O);
 document.addEventListener('pointerdown',e=>{if(open&&!mw.contains(e.target)&&!qlt.contains(e.target))setOpen(false)},O);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){setOpen(false);qlt.focus()}},O);
 $$('.chip',mw).forEach(b=>b.addEventListener('click',()=>{touch();mode='q';sel=+b.dataset.i;eng.k=9;eng.target=sel;eng.kick();ui(eng.shown)},O));
 $$('.mode',mw).forEach(b=>b.addEventListener('click',()=>{touch();mode=b.dataset.m;eng.k=9;eng.target=tgt();eng.kick();ui(eng.shown)},O));
 $$('.mrow',mw).forEach(b=>b.addEventListener('click',()=>{touch();const r=b.dataset.r;if(r==='v')vOn=!vOn;if(r==='c')cOn=!cOn;if(r==='a')aOn=!aOn;ui(eng.shown)},O));
 spd.addEventListener('click',()=>{touch();si=(si+1)%SP.length;spd.textContent=SP[si]+'×';$('#left').textContent=fmt(393/SP[si])},O);
 $$('.scn',stage).forEach(b=>b.addEventListener('click',()=>go(+b.dataset.i,true),O));
 [pw,$('#scenes')].forEach(el=>{el.addEventListener('pointerenter',()=>hover=true,O);el.addEventListener('pointerleave',()=>hover=false,O)});
 const startCycle=()=>{if(cycle||touched||RM())return;cycle=setInterval(()=>{if(eng.ok()&&!touched&&!hover&&!open&&eng.src)go((idx+1)%SCENES.length,false)},6000);ctx.cl.push(()=>clearInterval(cycle))};
 impl.onVisible=()=>{if(ran||touched||!eng.src)return;ran=true;
  ctx.T(()=>{if(!touched)setOpen(true)},1300);
  ctx.T(()=>{if(touched)return;mode='max';sel=7;[3,4,5,6,7].forEach((t,i)=>ctx.T(()=>{if(touched)return;eng.k=14;eng.target=t;eng.kick()},RM()?0:i*190));ui(eng.shown)},2300);
  ctx.T(()=>{if(!touched)setOpen(false)},4700);
  ctx.T(startCycle,5200)};
 const idle=[];
 impl.onReady=()=>{paint();ui(eng.shown);
  SCENES.forEach((s,i)=>idle.push(setTimeout(()=>{const src=getSrc(i),b=$$('.scn canvas',stage)[i];if(src&&b)b.getContext('2d').drawImage(src,0,0,96,54)},60+i*140)));
  impl.onVisible()};
 ctx.cl.push(()=>idle.forEach(clearTimeout));
 ctx.cl.push(()=>{impl.destroy&&impl.destroy();['--b1','--b2','--b3'].forEach(p=>site.style.removeProperty(p))});
 paint();ui(0);
 return impl;
}

