// @ts-nocheck  (ported verbatim from the tested demo; see website/README.md)
/* A drawn YouTube player using Resolute's real classes/CSS (real/player.css, real/resume.css). */
const P_IC={
pin:'M16 9V4h1V2H7v2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',
person:'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
star:'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
close:'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
check:'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
hist:'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
skipprev:'M6 6h2v12H6zm3.5 6 8.5 6V6z',
ban:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8z',
trash:'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
undo:'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
play:'M8 5v14l11-7z',pause:'M6 19h4V5H6v14zm8-14v14h4V5h-4z',gear:'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
full:'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'};
export const pic=(k,s)=>`<svg viewBox="0 0 24 24" width="${s||18}" height="${s||18}" fill="currentColor" aria-hidden="true"><path d="${P_IC[k]}"/></svg>`;
const pclock=s=>{s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
export function makePlayer(host,o){o=o||{};
const S={q:o.q||'1080p',from:o.from||'now',rate:o.rate||1,pos:o.pos||127,dur:o.dur||634,channel:o.channel||'Orbit Lab',chq:o.chq||null,chRate:o.chRate||null,vidRate:o.vidRate||null,playing:o.playing!==false,defQ:o.defQ||'720p'};
const QS=['144p','240p','360p','480p','720p','1080p','1440p','4K'],RS=[.75,1,1.25,1.5,1.75,2,2.5,3];
const rl=r=>String(+r.toFixed(2))+'×';
const root=document.createElement('div');root.className='mp';root.style.cssText='position:relative;overflow:hidden;border-radius:'+(o.radius||14)+'px;background:#111;color:#fff;font:400 13px/1.3 "YouTube Sans",Roboto,Arial,sans-serif;'+(o.css||'');
root.innerHTML=`<div class="mp-video" style="position:absolute;inset:0;background:${o.bg||'linear-gradient(135deg,#25508f,#7b5cb0 55%,#e0856b)'}"></div>
<div class="mp-shade" style="position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(transparent,rgba(0,0,0,.65))"></div>
<div class="mp-prog" style="position:absolute;left:12px;right:12px;bottom:46px;height:4px;background:rgba(255,255,255,.3);border-radius:2px"><i class="mp-played" style="position:absolute;left:0;top:0;bottom:0;background:#f03;border-radius:2px"></i><i class="mp-dot" style="position:absolute;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#f03"></i></div>
<div class="mp-bar" style="position:absolute;left:12px;right:12px;bottom:6px;height:36px;display:flex;align-items:center;gap:4px">
<button class="mp-play" aria-label="Play or pause (illustration)" style="all:unset;cursor:pointer;width:36px;height:36px;display:grid;place-items:center">${pic('pause',24)}</button>
<span class="mp-clock" style="display:inline-flex;align-items:center;height:28px;padding:0 10px;border-radius:14px;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap"><span class="mp-t"></span></span>
<span style="flex:1"></span><span class="mp-pills" style="display:inline-flex;align-items:center"></span>
<span style="width:36px;height:36px;display:grid;place-items:center;opacity:.95">${pic('gear',22)}</span></div>`;
host.append(root);
const $=s=>root.querySelector(s);
const t=$('.mp-t');
const left=document.createElement('span');left.className='yqx-left';const lt=document.createTextNode(''),lx=document.createElement('span');lx.className='yqx-left-x';left.append(lt,lx);$('.mp-clock').append(left);
// pills: speed (left half) + quality (right half)
const pills=$('.mp-pills');
const mkBtn=(cls,label)=>{const b=document.createElement('span');b.className='yqx-button '+cls;b.setAttribute('role','button');b.tabIndex=0;b.style.cssText='height:36px;display:inline-flex;align-items:center';b.innerHTML='<span class="yqx-pill"></span>';return b};
const sB=mkBtn('yqs-button'),qB=mkBtn('yqx-joined');pills.append(sB,qB);
const sP=sB.firstChild,qP=qB.firstChild;
// quality menu
const qm=document.createElement('div');qm.className='yqx-menu';root.append(qm);
const sm=document.createElement('div');sm.className='yqx-menu yqs-menu';root.append(sm);
const iconRow=(cls,ico,label,note,ex)=>`<div class="yqx-item yqx-action ${cls}" role="menuitem" ${ex||''}><span class="yqx-iconbox">${ico}</span><span class="yqx-label">${label}</span><span class="yqx-note">${note}</span></div>`;
function resolved(){return S.from}
function paint(){
 sP.textContent=rl(S.rate);qP.textContent=S.q;
 qP.dataset.from=S.from==='none'?'':S.from;
 sP.dataset.from=S.vidRate?'remembered':S.chRate?'channel':'';
 o.noSpeed?sB.style.setProperty('display','none','important'):sB.style.removeProperty('display');
 qB.classList.toggle('yqx-joined',!o.noSpeed);
 const secs=(S.dur-S.pos)/S.rate;lt.data='· '+pclock(secs)+' left';lx.textContent=S.rate===1?'':' '+rl(S.rate);
 t.textContent=pclock(S.pos)+' / '+pclock(S.dur);
 const p=S.pos/S.dur*100;$('.mp-played').style.width=p+'%';$('.mp-dot').style.left=p+'%';
 left.hidden=o.noLeft||root.clientWidth<520;
 paintQ();paintS();
}
function paintQ(){
 const ch=S.channel?`<span class="yqx-chan ${S.chq?'yqx-chan-set':''}">${S.channel}${S.chq?' · channel default '+S.chq:''}</span>`:'';
 qm.innerHTML=`<div class="yqx-head"><div class="yqx-headrow"><span class="yqx-title">Quality</span><span class="yqx-now">Playing ${S.q==='1080p'?'1080p60':S.q}</span></div>${ch}</div>
 <div class="yqx-list"><div class="yqx-seg"><div class="yqx-item yqx-mode" data-q="auto"><span class="yqx-label">Auto</span></div><div class="yqx-item yqx-mode" data-q="4K"><span class="yqx-label">Highest</span><span class="yqx-note">4K</span></div></div>
 <div class="yqx-grid">${QS.map(q=>`<div class="yqx-item yqx-chip ${q===S.q?'yqx-checked':''}" data-q="${q}"><span class="yqx-check">${pic('check',16)}</span><span class="yqx-label">${q}</span></div>`).join('')}</div></div>
 <div class="yqx-foot">${iconRow('yqx-remember '+(S.from==='remembered'?'yqx-on':''),pic('pin'),'Remember for this video',S.from==='remembered'?'Remove':S.q,'data-a="rem"')}
 ${S.channel?iconRow('yqx-channel '+(S.chq?'yqx-on':''),pic('person'),'Default for '+S.channel,S.chq?'Remove':S.q,'data-a="chan"'):''}
 ${iconRow('yqx-default '+(S.defQ===S.q?'yqx-on':''),pic('star'),'Make default for all videos',S.q,'data-a="def"')}</div>`;
}
function paintS(){
 const mins=r=>{const m=Math.round((S.dur-S.pos)/60*(1-1/r));return r===1?'normal':(m>0?'−':'+')+Math.abs(m)+'m'};
 const src=S.vidRate?'this video':S.chRate?'channel':'default';
 const off=o.offer?`<div class="yqs-offer"><span class="yqs-offer-text">You watched 3 of your last 4 videos here at ${rl(S.rate)}. Keep it for ${S.channel}?</span><div class="yqx-item yqs-keep" data-a="keep">Keep</div><div class="yqx-item" data-a="no">No</div></div>`:'';
 sm.innerHTML=`<div class="yqx-head"><div class="yqx-headrow"><span class="yqx-title">Speed</span><span class="yqx-now">${rl(S.rate)} · ${src}</span></div><span class="yqx-chan ${S.chRate?'yqx-chan-set':''}">${S.channel} · ${S.chRate?'channel speed '+rl(S.chRate):'no channel speed'}</span>${off}</div>
 <div class="yqx-list"><div class="yqx-grid">${RS.map(r=>`<div class="yqx-item yqx-chip ${r===S.rate?'yqx-checked':''}" data-r="${r}"><span class="yqx-label">${rl(r)}</span><span class="yqx-note">${mins(r)}</span></div>`).join('')}</div>
 <label class="yqs-fine"><span class="yqs-end">0.25×</span><input type="range" min="0.25" max="3" step="0.05" value="${S.rate}"><span class="yqs-end">3×</span><output>${rl(S.rate)}</output></label></div>
 <div class="yqx-foot">${iconRow('yqs-forget',pic('close'),'Forget this video’s speed',S.vidRate?rl(S.vidRate):'',S.vidRate?'':'aria-disabled="true"')}${iconRow('yqs-channel '+(S.chRate?'yqx-on':''),pic('person'),'Use '+rl(S.rate)+' for '+S.channel,'','data-a="rchan"')}${iconRow('yqs-default',pic('star'),'Make '+rl(S.rate)+' the default','','data-a="rdef"')}</div>`;
}
const place=(m,btn)=>{const rr=root.getBoundingClientRect(),br=btn.getBoundingClientRect(),sc=rr.width/root.offsetWidth||1;m.style.right=Math.max(8,(rr.right-br.right)/sc-6)+'px';m.style.bottom='58px';m.style.left='auto'};
let openM=null;
const close=()=>{if(openM){openM.classList.remove('yqx-open');openM.btn.setAttribute('aria-expanded','false');openM=null}};
const open=(m,btn)=>{if(openM===m){close();return}close();place(m,btn);m.classList.add('yqx-open');m.btn=btn;btn.setAttribute('aria-expanded','true');openM=m};
qB.onclick=e=>{e.stopPropagation();open(qm,qB)};sB.onclick=e=>{e.stopPropagation();open(sm,sB)};
root.addEventListener('click',e=>{const a=e.target.closest('[data-q],[data-r],[data-a]');if(!a){if(!e.target.closest('.yqx-menu'))close();return}
 if(a.dataset.q){const q=a.dataset.q;if(q==='auto')S.q='1080p';else S.q=q;S.from='now';}
 else if(a.dataset.r){S.rate=+a.dataset.r;S.vidRate=null}
 else{const k=a.dataset.a;
  if(k==='rem'){S.from=S.from==='remembered'?'now':'remembered'}
  else if(k==='chan'){S.chq=S.chq?null:S.q;S.from=S.chq?'channel':'now'}
  else if(k==='def'){S.defQ=S.q;S.from='none'}
  else if(k==='rchan'){S.chRate=S.chRate?null:S.rate}
  else if(k==='rdef'){}
  else if(k==='keep'){S.chRate=S.rate;o.offer=false}
  else if(k==='no'){o.offer=false}}
 paint();o.onChange&&o.onChange(S)});
root.addEventListener('input',e=>{if(e.target.matches('.yqs-fine input')){S.rate=+e.target.value;S.vidRate=null;const out=sm.querySelector('output');out.textContent=rl(S.rate);sP.textContent=rl(S.rate);const secs=(S.dur-S.pos)/S.rate;lt.data='· '+pclock(secs)+' left';lx.textContent=S.rate===1?'':' '+rl(S.rate)}});
document.addEventListener('pointerdown',e=>{if(openM&&!root.contains(e.target))close()});
paint();
return {root,S,paint,open,close,qm,sm,qB,sB,offer(v){o.offer=v;paint()},openQ:()=>open(qm,qB),openS:()=>open(sm,sB),set(k,v){S[k]=v;paint()},resize(){paint()}};}

/* Resume: the real pill by the clock, flag on the bar, menu, toast and "Back to" chip (resume.css). */
export function addResume(P,o){o=o||{};
const root=P.root,S=P.S;let at=o.at||754,of=o.of||2480,saved='2 days ago',off=null;// off: 'video'|'channel'|null
const flag='M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z';
const lay=document.createElement('div');lay.className='yqx-rlayer';
lay.innerHTML=`<div class="yqx-fm yqx-on yqx-mkr" style="position:absolute;left:0;top:0"><i class="yqx-mk"></i><button class="yqx-mtip" aria-label="Where you stopped" style="bottom:14px"><svg viewBox="0 0 24 24"><path d="${flag}" fill="currentColor"/></svg><span class="yqx-tt"></span></button></div>
<div class="yqx-bm yqx-mkr" style="position:absolute;left:0;top:0"><i class="yqx-mk"></i><button class="yqx-mtip" aria-label="Go back to the earlier spot"><svg viewBox="0 0 24 24"><path d="${P_IC.undo}" fill="currentColor"/></svg><span class="yqx-bt"></span><i class="yqx-mdrain"></i></button></div>`;
root.append(lay);
const prog=root.querySelector('.mp-prog');
// layer positions follow the bar
function place(){const pr=prog.offsetLeft,w=prog.offsetWidth,top=prog.offsetTop+2;
 const fm=lay.querySelector('.yqx-fm'),bm=lay.querySelector('.yqx-bm');fm.style.left=(pr+w*at/of)+'px';fm.style.top=top+'px';
 fm.querySelector('.yqx-tt').textContent=pclock(at);
 if(bm._at!=null){bm.style.left=(pr+w*bm._at/of)+'px';bm.style.top=top+'px'}}
const clock=root.querySelector('.mp-clock');
const rb=document.createElement('span');rb.className='yqx-rbutton';rb.tabIndex=0;rb.style.cssText='height:36px;margin-left:4px';
rb.innerHTML='<span class="yqx-rpill"></span>';clock.after(rb);
const rp=rb.firstChild;
const menu=document.createElement('div');menu.className='yqx-rmenu';root.append(menu);
const toast=document.createElement('div');toast.className='yqx-resume';toast.innerHTML=`<span class="yqx-resume-ico">${pic('hist',17)}</span><span class="yqx-resume-txt"></span><button class="yqx-resume-btn">Start over</button><i class="yqx-resume-drain"></i>`;root.append(toast);
function paint(){rp.innerHTML=`${off?pic('ban',15):pic('hist',15)}<span>${pclock(at)}</span>`;rp.classList.toggle('yqx-nosave',!!off);
 const ch=S.channel;
 menu.innerHTML=`<div class="yqx-mh"><div><b>Left off at ${pclock(at)}</b><small>${off?'Not saved: '+(off==='channel'?ch:'this video'):'Saved '+saved+' · of '+pclock(of)}</small></div><div class="yqx-mt"><i style="width:${at/of*100}%"></i><u style="left:${at/of*100}%"></u></div></div><hr>
 <button class="yqx-rrow">${pic('hist')}<span>Jump to ${pclock(at)}</span></button>
 <button class="yqx-rrow">${pic('skipprev')}<span>Start over</span></button>
 <button class="yqx-rrow" data-k="video">${pic('ban')}<span>Don’t save this video</span></button>
 <button class="yqx-rrow yqx-two" data-k="channel">${off==='channel'?pic('check'):pic('person')}<span class="yqx-tx"><span>${off==='channel'?'Save this channel again':'Don’t save this channel'}</span><small>${ch}</small></span></button>
 <button class="yqx-rrow">${pic('trash')}<span>Forget this spot</span></button>`;place()}
const openM=()=>{const rr=root.getBoundingClientRect(),br=rb.getBoundingClientRect(),sc=rr.width/root.offsetWidth||1;menu.style.left=Math.max(8,(br.left-rr.left)/sc-4)+'px';menu.style.bottom='58px';menu.classList.add('yqx-on');rb.setAttribute('aria-expanded','true')};
const closeM=()=>{menu.classList.remove('yqx-on');rb.setAttribute('aria-expanded','false')};
rb.onclick=e=>{e.stopPropagation();menu.classList.contains('yqx-on')?closeM():openM()};
menu.onclick=e=>{const r=e.target.closest('.yqx-rrow');if(!r)return;if(r.dataset.k){off=off===r.dataset.k?null:r.dataset.k;paint()}else closeM()};
document.addEventListener('pointerdown',e=>{if(!root.contains(e.target))closeM()});
paint();addEventListener('resize',place);
let tt=0;
return {lay,rb,paint,place,openM,closeM,hover(on){lay.classList.toggle('yqx-hover',on)},
 showToast(){toast.querySelector('.yqx-resume-txt').textContent='Resumed at '+pclock(at);toast.classList.remove('yqx-on');void toast.offsetWidth;toast.classList.add('yqx-on');clearTimeout(tt);tt=setTimeout(()=>toast.classList.remove('yqx-on'),6000)},
 hideToast(){toast.classList.remove('yqx-on')},
 showBack(t){const bm=lay.querySelector('.yqx-bm');bm._at=t;bm.querySelector('.yqx-bt').textContent='Back to '+pclock(t);place();bm.classList.remove('yqx-on');void bm.offsetWidth;bm.classList.add('yqx-on')},
 setOff(v){off=v;paint()},toast};}
