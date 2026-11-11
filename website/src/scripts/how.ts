// @ts-nocheck  (ported from the tested demo)
import {pic} from './real/player';
import {VID_BG} from './features';
/* ================= HOW IT WORKS (real menu rows and pills) ================= */
const MENU_FORCE='position:static;opacity:1;visibility:visible;transform:none;width:100%;max-width:none;min-width:0;';
const darkBox=(inner,css)=>`<div class="mp" style="border-radius:22px;padding:18px;background:${VID_BG};${css||''}"><div class="yqx-menu yqx-open" style="${MENU_FORCE}">${inner}</div></div>`;
const row=(cls,ico,label,note,ex)=>`<div class="yqx-item yqx-action ${cls}" ${ex||''}><span class="yqx-iconbox">${pic(ico)}</span><span class="yqx-label">${label}</span><span class="yqx-note">${note}</span></div>`;
export function h1(stage,ctx){const {O}=ctx;
 const V={now:'480p',rem:'1080p',chan:'4K',def:'720p'};const on={now:false,rem:false,chan:false,def:true};
 stage.innerHTML=`<div class="chp4" style="grid-template-columns:1fr 240px"><div id="lad"></div><div style="display:grid;gap:12px;align-content:start"><div class="mp" style="padding:20px;border-radius:22px;background:${VID_BG};text-align:center"><span class="yqx-pill" id="rp" style="font-size:15px;height:34px;padding:0 16px">Auto</span></div><p class="cap4" id="rs" aria-live="polite"></p></div></div>`;
 const $=s=>stage.querySelector(s);
 const paint=()=>{const k=['now','rem','chan','def'].find(x=>on[x]);const pill=$('#rp');pill.textContent=k?V[k]:'Auto';pill.dataset.from=k==='now'?'now':k==='rem'?'remembered':k==='chan'?'channel':'';
  $('#rs').textContent=k==='now'?'The chip you picked just now wins. It is not saved.':k==='rem'?'Remembered for this video wins over the channel and the default.':k==='chan'?'The channel’s default wins over the global default.':k==='def'?'Nothing else is set, so your default for all videos is used.':'Nothing is set. YouTube decides (Auto).';
  $('#lad').innerHTML=darkBox(`<div class="yqx-head"><div class="yqx-headrow"><span class="yqx-title">Quality</span><span class="yqx-now">Orbit Lab</span></div></div><div class="yqx-foot" style="border:0;margin:0;padding:0"><div class="yqx-grid" style="margin:0 0 8px">${['480p','720p','1080p','4K'].map(q=>`<div class="yqx-item yqx-chip ${on.now&&V.now===q?'yqx-checked':''}" data-chip="${q}"><span class="yqx-check">${pic('check',16)}</span><span class="yqx-label">${q}</span></div>`).join('')}</div>${row('yqx-remember '+(on.rem?'yqx-on':''),'pin','Remember for this video',V.rem,'data-k="rem"')}${row('yqx-channel '+(on.chan?'yqx-on':''),'person','Default for Orbit Lab',V.chan,'data-k="chan"')}${row('yqx-default '+(on.def?'yqx-on':''),'star','Make default for all videos',V.def,'data-k="def"')}</div>`)};
 stage.addEventListener('click',e=>{const ch=e.target.closest('[data-chip]');if(ch){const q=ch.dataset.chip;if(on.now&&V.now===q)on.now=false;else{V.now=q;on.now=true}paint();return}const r=e.target.closest('[data-k]');if(!r)return;on[r.dataset.k]=!on[r.dataset.k];paint()},O);paint();
 let step=0,touched=false;stage.addEventListener('click',()=>touched=true,O);const w=ctx.watch(stage);
 ctx.every(()=>{if(!w.live()||touched)return;const seq=[['def',1],['chan',1],['rem',1],['now',1],['now',0],['rem',0],['chan',0]];const [k,v]=seq[step++%seq.length];on[k]=!!v;paint()},1800);
}
export function h2(stage,ctx){const {O}=ctx;
 const D=[{k:'',t:'No dot',s:'Your default for all videos, or Auto. Nothing special was set for this video.'},{k:'now',t:'Hollow ring',s:'You picked it just now, for this video only. It is not saved.'},{k:'remembered',t:'Pink dot',s:'Remembered for this video.'},{k:'channel',t:'Gold dot',s:'The default you set for this channel.'}];
 stage.innerHTML=`<div class="chp4" style="grid-template-columns:1fr 1fr"><div class="mp" style="padding:26px;border-radius:22px;background:${VID_BG};display:grid;place-items:center;min-height:200px"><span class="yqx-pill" id="bp" style="font-size:18px;height:40px;padding:0 22px">1080p</span></div><div class="cl" id="lg"></div></div><p class="cap4" id="ds"></p>`;
 const $=s=>stage.querySelector(s);let i=0,touched=false;
 const set=n=>{i=n;$('#bp').dataset.from=D[n].k;$('#ds').textContent=D[n].s;$('#lg').querySelectorAll('.cb').forEach((b,j)=>b.setAttribute('aria-pressed',String(j===n)))};
 $('#lg').innerHTML=D.map((d,j)=>`<button class="cb" data-i="${j}" aria-pressed="false"><b>${d.t}</b></button>`).join('');
 $('#lg').querySelectorAll('.cb').forEach(b=>b.addEventListener('click',()=>{touched=true;set(+b.dataset.i)},O));
 const w=ctx.watch(stage);ctx.every(()=>{if(w.live()&&!touched)set((i+1)%4)},3200);set(0);
}
