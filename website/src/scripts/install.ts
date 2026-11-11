// @ts-nocheck  (ported from the tested demo)
import {clamp,RM} from './core';
import {STEPS as ST} from '../data/install';
export function i2(stage,ctx){
 const {O}=ctx;
 const $=(s,r=stage)=>r.querySelector(s),$$=(s,r=stage)=>[...r.querySelectorAll(s)];
  stage.innerHTML=`<div class="guide"><div><div class="f1list" id="gl" role="tablist" aria-label="Install steps" style="flex-direction:column;overflow:visible">${ST.map((s,i)=>`<button class="chap" role="tab" aria-selected="${i===0}" data-i="${i}" style="flex:1 1 auto"><b>${i+1}. ${s.t}</b><small>${s.d}</small></button>`).join('')}</div>
  <div class="gnav"><button class="btn tonal sm2" id="gb">Back</button><div class="gdots" id="gd">${ST.map(()=>'<i></i>').join('')}</div><button class="btn primary sm2" id="gn">Next</button></div></div>
  <div class="rep" id="rep" aria-label="A picture of the Chrome extensions page" role="img"><div class="tb2"><div class="addr" id="ad"></div></div>
   <div id="s-gh" class="body2" hidden><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>Resolute for YouTube</b><span id="dl" style="padding:8px 14px;border-radius:8px;background:#b3261e;color:#fff;font-size:13px">Download ZIP for Chrome</span></div><p style="margin-top:14px;color:#5f6368;font-size:13px">resolute-chrome.zip</p></div>
   <div id="s-fold" class="body2" hidden><div class="ecard on" id="fd"><span style="font-size:22px;line-height:1">▤</span><div><b>resolute-for-youtube-main</b><div style="color:#5f6368;font-size:12.5px">manifest.json · and the other files</div></div></div></div>
   <div id="s-ext" hidden><div class="hd"><span>Extensions</span><span class="sp"></span><span class="devl" id="dv">Developer mode <button class="sw" role="switch" aria-checked="false" tabindex="-1" aria-label="Developer mode"></button></span></div>
    <div class="tools" id="tools"><span id="ld2">Load unpacked</span><span>Pack extension</span><span>Update</span></div>
    <div class="body2"><div class="ecard" id="ec"><span style="width:36px;height:36px;border-radius:10px;background:#232428;display:grid;place-items:center"><svg viewBox="0 0 32 32" style="width:22px;height:22px"><rect x="7" y="16" width="5" height="9" rx="2.5" fill="#fff"/><rect x="14" y="12" width="5" height="13" rx="2.5" fill="#fff"/><rect x="21" y="6" width="5" height="19" rx="2.5" fill="#3b9cff"/></svg></span><div><b>Resolute for YouTube</b><div style="color:#5f6368;font-size:12.5px">On</div></div></div>
    <div class="dlg" id="dg"><b>Select a folder</b><div class="fold" style="margin-top:8px">▤ resolute-for-youtube-main &nbsp;<span style="margin-left:auto;font-size:12.5px">contains manifest.json</span></div></div></div></div></div></div>`;
 const rep=$('#rep');let i=0,touched=false,dlT=0;
 const hlSet=k=>{$$('.hl2',rep).forEach(e=>e.classList.remove('hl2'));const t={addr:'#ad',dev:'#dv',load:'#ld2'}[k];if(t)$(t,rep).classList.add('hl2');if(k==='')return};
 const show=n=>{i=clamp(n,0,ST.length-1);const s=ST[i];
  $$('.chap',$('#gl')).forEach((b,j)=>b.setAttribute('aria-selected',String(j===i)));$$('#gd i').forEach((d,j)=>d.classList.toggle('on',j<=i));
  $('#ad').textContent=s.a;['gh','fold','ext'].forEach(k=>$('#s-'+k).hidden=k!==s.sc);
  hlSet(s.hl||'');if(s.sc==='gh')$('#dl').classList.add('hl2');else $('#dl').classList.remove('hl2');
  $('#dv .sw').setAttribute('aria-checked',String(!!s.dev));$('#tools').classList.toggle('on',!!s.dev);
  clearTimeout(dlT);$('#dg').classList.toggle('on',!!s.dlg);$('#ec').classList.remove('on');
  if(s.dlg)dlT=setTimeout(()=>{$('#dg').classList.remove('on');$('#ec').classList.add('on');hlSet('')},RM()?0:2200);
  $('#gb').disabled=i===0;$('#gb').style.opacity=i===0?.45:1;$('#gn').textContent=i===ST.length-1?'Again':'Next'};
 ctx.cl.push(()=>clearTimeout(dlT));
 $$('.chap',$('#gl')).forEach((b,j)=>b.addEventListener('click',()=>{touched=true;show(j)},O));
 $('#gb').addEventListener('click',()=>{touched=true;show(i-1)},O);
 $('#gn').addEventListener('click',()=>{touched=true;show(i===ST.length-1?0:i+1)},O);
 const w=ctx.watch(stage);ctx.every(()=>{if(w.live()&&!touched)show((i+1)%ST.length)},4800);
 show(0);
}

