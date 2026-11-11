// @ts-nocheck  (ported from the tested demo)
import {makeAutoplay} from './real/autoplay';
import {makePlayer,addResume} from './real/player';
import {CHAPTERS} from '../data/features';
export const VID_BG='linear-gradient(135deg,#25508f,#7b5cb0 55%,#e0856b)';
export function ytw(stage,ctx,o){o=o||{};
 stage.innerHTML=`<div class="ytw ${o.bare?'bare':''}">${o.tabs===false?'':'<div class="tabs4"><div class="tb4"><i></i><span class="tt">Tidepool Study, a short film</span></div><div class="tb4 tb24"><span>Lecture notes, week 6</span></div></div>'}<div class="ytm"><span class="lg4"><b></b>YouTube</span><div class="ctr"><div class="sb">Search</div><div class="sbb"></div><div class="mic"></div></div><span class="av4"></span></div>${o.noPlayer?'':'<div class="ytb"><div class="stg"><div class="glowL"></div></div></div><span class="kept">16:9 video kept whole</span>'}</div>`;
 const el=stage.firstChild,ctr=el.querySelector('.ctr'),m=el.querySelector('.ytm'),W={el,m};
 const A=makeAutoplay(el,o.ap||{});ctr.append(A.btn);el.append(A.menu);W.A=A;
 if(!o.noPlayer){const stg=el.querySelector('.stg');const P=makePlayer(stg,Object.assign({css:'width:100%;height:clamp(430px,50vw,470px)',bg:VID_BG,rate:1,channel:'Orbit Lab'},o.p||{}));W.P=P;W.R=addResume(P,{at:754,of:2480});W.R.lay.style.display='none';W.R.rb.hidden=true}
 const fit=()=>{const n=el.clientWidth<760;m.classList.toggle('narrow',n);A.btn.classList.toggle('yqx-ap-end',n);A.layout();W.P&&W.P.resize()};
 const ro=new ResizeObserver(fit);ro.observe(el);ctx.cl.push(()=>ro.disconnect());fit();
 W.tab=(t,away)=>{const tt=el.querySelector('.tt');if(tt)tt.textContent=t};
 return W}
const $q=(r,s)=>r.querySelector(s);
export function f1(stage,ctx){const {O}=ctx;
  const CH=CHAPTERS,TX=Object.fromEntries(CHAPTERS.map(c=>[c.k,c.text]));
 stage.innerHTML=`<div class="cl" id="cl" style="flex-direction:row;flex-wrap:wrap;gap:8px;margin-bottom:14px"></div><div id="yw"></div><p class="cap4" id="fcap" aria-live="polite"></p>`;
 const $=s=>stage.querySelector(s);
 $('#cl').innerHTML=CH.map((c,i)=>`<button class="cb" data-i="${i}" aria-pressed="false" title="${c.s}"><b>${c.t}${c.opt?'<span class="opt">Optional</span>':''}</b></button>`).join('');
 const W=ytw($('#yw'),ctx,{});const {P,R,A,el}=W;let tok=0,idx=-1,touched=false;
 const reset=()=>{tok++;P.close();R.closeM();R.hideToast();R.hover(false);R.lay.style.display='none';R.rb.hidden=true;A.closeMenu();A.mast.hover=false;A.mast.hi=-1;A.mast.timer&&clearTimeout(A.mast.timer);A.mast.timer=0;A.fold();
  el.classList.remove('cin4','bar4','glow4','g2');Object.assign(P.S,{q:'1080p',from:'none',rate:1,vidRate:null,chRate:null,chq:null,pos:127,dur:634,playing:true});P.offer(false);W.tab('Tidepool Study, a short film');W.el.querySelector('.tb24').style.opacity='';el.querySelector('.tb4').style.opacity='';
  A.setMode('opened','wait');A.setMode('noQueue','wait');A.setMode('queue','play');R.place()};
 const go=i=>{idx=i;reset();const my=tok,T=(f,ms)=>ctx.T(()=>{if(my===tok)f()},ms),c=CH[i];
  $('#cl').querySelectorAll('.cb').forEach((b,j)=>b.setAttribute('aria-pressed',String(j===i)));$('#fcap').textContent=TX[c.k];
  const click=(r,s)=>{const e=r.querySelector(s);e&&e.click()};
  if(c.k==='quality'){T(()=>P.openQ(),500);T(()=>click(P.qm,'[data-q="4K"]'),1700);T(()=>click(P.qm,'[data-a="rem"]'),3000)}
  if(c.k==='speed'){T(()=>P.openS(),500);T(()=>click(P.sm,'[data-r="1.5"]'),1500);T(()=>P.offer(true),1900);T(()=>click(P.sm,'[data-a="keep"]'),3600)}
  if(c.k==='time'){P.set('rate',1.5);P.set('pos',127);W.el.querySelector('.tb4').style.opacity='.6';W.el.querySelector('.tb24').style.opacity='1';[600,1500,2400,3300].forEach((ms,n)=>T(()=>{P.S.pos=127+9*(n+1);P.paint();W.tab('⏱ '+Math.ceil((P.S.dur-P.S.pos)/P.S.rate/60)+'m · Tidepool Study, a short film')},ms));T(()=>W.tab('⏱ 6m · Tidepool Study, a short film'),300)}
  if(c.k==='resume'){P.S.pos=754;P.S.dur=2480;P.set('rate',1);R.lay.style.display='';R.rb.hidden=false;R.place();T(()=>R.hover(true),500);T(()=>{R.hover(false);R.openM()},1800);T(()=>R.closeM(),4300);T(()=>R.showBack(100),4600)}
  if(c.k==='auto'){T(()=>{A.mast.hover=true;A.unfold()},400);T(()=>{A.mast.hi=0;A.layout()},1100);T(()=>{A.mast.hi=1;A.layout()},2000);T(()=>{A.mast.hi=2;A.layout()},2900);T(()=>{A.mast.hover=false;A.mast.hi=-1;A.openMenu()},3700);T(()=>A.setMode('queue','wait'),5000)}
  if(c.k==='cinema'){T(()=>el.classList.add('cin4'),500);T(()=>el.classList.add('bar4'),3300);T(()=>el.classList.remove('bar4'),4700)}
  if(c.k==='glow'){T(()=>el.classList.add('glow4'),300);T(()=>el.classList.add('g2'),3200)}};
 $('#cl').querySelectorAll('.cb').forEach(b=>b.addEventListener('click',()=>{touched=true;go(+b.dataset.i)},O));
 const w=ctx.watch(stage);ctx.every(()=>{if(w.live()&&!touched)go((idx+1)%CH.length)},9000);
 go(0);
}
