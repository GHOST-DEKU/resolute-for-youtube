// @ts-nocheck  (ported verbatim from the tested demo; see website/README.md)
/* Port of Resolute's autoplay button (page.js buildMast/layout/paintSegs/unfold/fold/openApMenu), without YouTube plumbing. */
export function makeAutoplay(host,o){o=o||{};
const NS='http://www.w3.org/2000/svg';
const el=(t,c,a)=>{const n=document.createElement(t);if(c)n.className=c;if(a)for(const k in a)n.setAttribute(k,a[k]);return n};
const svgEl=(t,a)=>{const n=document.createElementNS(NS,t);for(const k in a)n.setAttribute(k,a[k]);return n};
const ORDER=['play','wait','stop'],WORDS={play:'plays',wait:'waits',stop:'stops'};
const DEFS={noQueue:{play:'A video ends and YouTube starts another by itself, as it normally does.',wait:'The next video opens, but paused. Press play to start it.',stop:'Nothing starts after a video ends.'},queue:{play:'The next video in the queue or playlist starts by itself.',wait:'The next video in the queue or playlist opens paused. Press play.',stop:'The queue or playlist does not move on after a video ends.'}};
const SEGS=[{k:'opened',cap:'Opened'},{k:'noQueue',cap:'No queue'},{k:'queue',cap:'Queue'}];
let holdOpened=o.opened!==false,modeNo=o.noQueue||'wait',modeQ=o.queue||'play';
const stateOf=k=>k==='opened'?Number(holdOpened):ORDER.indexOf(k==='noQueue'?modeNo:modeQ);
const wordOf=k=>WORDS[ORDER[stateOf(k)]];
const SHAPES=(()=>{const N=72;const poly=f=>`polygon(${Array.from({length:N},(_,i)=>{const t=i/N*Math.PI*2,r=f(t);return `${(50+r*Math.cos(t)).toFixed(2)}% ${(50+r*Math.sin(t)).toFixed(2)}%`}).join(',')})`;
return [poly(()=>50),poly(t=>45+5*Math.cos(7*t)),poly(t=>.92*50/((Math.abs(Math.cos(t))**5+Math.abs(Math.sin(t))**5)**.2))]})();
const WAVE=(()=>{let d='';for(let i=0;i<=320;i++){const t=i/320*Math.PI*2,r=20.5+1.35*Math.sin(8*t);d+=`${i?'L':'M'}${(24+r*Math.cos(t)).toFixed(3)} ${(24+r*Math.sin(t)).toFixed(3)}`}return d+'Z'})();
const ring=cls=>{const s=svgEl('svg',{class:cls,viewBox:'0 0 48 48','aria-hidden':'true'});s.append(svgEl('circle',{class:'yqx-track',cx:'24',cy:'24',r:'20.5',pathLength:'100'}),svgEl('path',{class:'yqx-act',d:WAVE,pathLength:'100'}));return s};
const glyph=()=>{const g=el('span','yqx-ap-glyph');g.append(el('i','yqx-ap-l'),el('i','yqx-ap-r'));return g};
const QI='M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z';
function segIcon(k){if(k==='opened')return glyph();const w=el('span','yqx-segico');if(k==='noQueue'){const n=el('span','yqx-apm-next');n.append(el('i'),el('i'));w.append(n)}else{const s=svgEl('svg',{viewBox:'0 0 24 24',width:'16',height:'16'});s.append(svgEl('path',{d:QI,fill:'currentColor'}));w.append(s)}return w}
const mast={hover:false,hi:-1,open:false,held:false,flash:false,timer:0,rows:{},chips:[]};
const btn=el('span','yqx-au'),row=el('span','yqx-au-row');
const segs=SEGS.map((sg,i)=>{const b=el('button','yqx-au-lead yqx-seg',{type:'button','data-k':sg.k,'data-i':i});if(i)b.tabIndex=-1;
const ms=el('span','yqx-ms'),core=el('span','yqx-ms-core');core.append(segIcon(sg.k));if(i===0)ms.append(ring('yqx-wave'));ms.append(el('span','yqx-ms-shape'),core);if(i===0)ms.append(el('span','yqx-held-dot'),el('span','yqx-badge'));
const lbl=el('span','yqx-au-lbl'),inn=el('span','yqx-in');inn.append(el('span','cap'),el('span','st'));lbl.append(inn);b.append(ms,lbl);row.append(b);return b});
const trail=el('button','yqx-au-trail',{type:'button',tabindex:'-1','aria-haspopup':'menu','aria-expanded':'false','aria-label':'Autoplay settings'});
const chev=svgEl('svg',{class:'yqx-chev',viewBox:'0 0 12 12'});chev.append(svgEl('path',{d:'M2 4.2 6 8l4-3.8',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round'}));trail.append(chev);
const go=el('button','yqx-au-go',{type:'button',tabindex:'-1','aria-label':'Play video'});const tri=el('span','yqx-tri'),gt=el('span');gt.textContent='Play';go.append(tri,gt);
row.append(go,trail);btn.append(row);
const menu=el('div','yqx-apm',{role:'menu','aria-label':'Autoplay'});
const title=el('div','yqx-apm-title');title.textContent='Autoplay';const list=el('div','yqx-apm-list');
const iconBox=k=>{const i=el('span','yqx-apm-ico');i.append(segIcon(k));return i};
const textBox=(n,h)=>{const t=el('span','yqx-apm-text'),b=el('span','yqx-apm-name');b.textContent=n;const s=el('span','yqx-apm-hint');s.textContent=h;t.append(b,s);return t};
const r=el('div','yqx-apm-row yqx-apm-row-opened',{role:'menuitemcheckbox',tabindex:'-1','aria-checked':'false'});
const sw=el('span','yqx-apm-sw'),knob=el('i');const ck=svgEl('svg',{class:'yqx-sw-on',viewBox:'0 0 24 24'});ck.append(svgEl('path',{d:'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'}));
const cr=svgEl('svg',{class:'yqx-sw-off',viewBox:'0 0 24 24'});cr.append(svgEl('path',{d:'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'}));knob.append(ck,cr);sw.append(knob);
r.append(iconBox('opened'),textBox('Opened','A video I click or tap starts paused'),sw);r.addEventListener('click',()=>cycle('opened'));list.append(r);mast.rows.opened=r;
for(const [k,n,h] of [['noQueue','No queue or playlist','A video ends and nothing follows'],['queue','Queue or playlist','A video ends and the queue continues']]){
const pr=el('div','yqx-apm-row yqx-apm-pick',{role:'group'}),top=el('span','yqx-apm-top');top.append(iconBox(k),textBox(n,h));const chips=el('div','yqx-apm-chips');
for(const m of ORDER){const c=el('button','yqx-apm-chip',{type:'button',role:'radio',tabindex:'-1','aria-checked':'false','data-k':k,'data-m':m});c.textContent=m==='play'?'Plays':m==='wait'?'Waits':'Stops';c.title=DEFS[k][m];
c.addEventListener('pointerenter',()=>explain(DEFS[k][m]));c.addEventListener('pointerleave',()=>explain(''));c.addEventListener('click',()=>setMode(k,m));chips.append(c);mast.chips.push(c)}
pr.append(top,chips);list.append(pr)}
const foot=el('div','yqx-apm-foot');foot.textContent='Pressing play always works.';
const explain=t=>{foot.textContent=t||'Pressing play always works.'};
menu.append(title,list,foot);
Object.assign(mast,{btn,segs,go,trail,menu});
function setMode(k,m){if(k==='opened')holdOpened=m==='wait';else if(k==='noQueue')modeNo=m;else modeQ=m;update();o.onChange&&o.onChange(state())}
function cycle(k){const n=k==='opened'?2:3;setMode(k,ORDER[(stateOf(k)+1)%n])}
const state=()=>({opened:holdOpened,noQueue:modeNo,queue:modeQ});
function layout(){const open=btn.classList.contains('yqx-open')&&!btn.classList.contains('yqx-ap-end');const held=mast.held||mast.flash;const hi=held?0:mast.hi;let w;
if(!open)w=[40,0,0];else if(held)w=[40+8-3+segs[0].querySelector('.yqx-in').offsetWidth+16,0,0];
else{const H=segs.map(sg=>40+8-3+sg.querySelector('.yqx-in').offsetWidth+16);const R=Math.ceil((Math.max(...H)+80)/3);w=hi<0?[R,R,R]:H.map((h,i)=>i===hi?h:(3*R-H[hi])/2)}
segs.forEach((sg,i)=>{sg.style.width=open||i===0?`${w[i]}px`:'';sg.style.paddingLeft=open&&i!==hi?`${Math.max(0,(w[i]-40)/2)}px`:'';sg.classList.toggle('yqx-hv',open&&i===hi);if(i)sg.tabIndex=open&&!held?0:-1});paint()}
function paint(){const open=btn.classList.contains('yqx-open');const some=SEGS.filter(sg=>stateOf(sg.k)>0).length;const total=some===0?0:some===3?2:1;
segs.forEach((sg,i)=>{const l=i===0&&!open?total:stateOf(SEGS[i].k);sg.dataset.l=String(l);sg.querySelector('.yqx-ms-shape').style.clipPath=SHAPES[l]})}
function unfold(){if(btn.classList.contains('yqx-ap-end'))return;btn.classList.add('yqx-open');trail.tabIndex=0;layout()}
function fold(){if(mast.hover||mast.open||mast.timer)return;btn.classList.remove('yqx-open');trail.tabIndex=-1;layout()}
function placeMenu(){const hr=host.getBoundingClientRect(),r=trail.getBoundingClientRect(),br=btn.getBoundingClientRect();const w=menu.offsetWidth||312;
const anchor=btn.classList.contains('yqx-ap-end')?br:br;let left=(btn.classList.contains('yqx-ap-end')?anchor.right-w:anchor.left-8)-hr.left;
const sc=hr.width/host.offsetWidth||1;left=Math.min(Math.max(8,left/sc),host.offsetWidth-w-8);menu.style.left=left+'px';menu.style.top=((br.bottom-hr.top)/sc+10)+'px'}
function openMenu(){if(mast.open)return;mast.open=true;placeMenu();menu.classList.add('yqx-show');trail.setAttribute('aria-expanded','true')}
function closeMenu(){if(!mast.open)return;mast.open=false;menu.classList.remove('yqx-show');trail.setAttribute('aria-expanded','false');setTimeout(fold)}
function update(){const stops=SEGS.some(sg=>stateOf(sg.k)===2);btn.dataset.opened=String(holdOpened);btn.dataset.next=String(modeNo!=='play'&&modeQ!=='play');btn.dataset.stop=String(stops);menu.dataset.opened=String(holdOpened);
const mid=mast.held?'Video waiting':mast.flash?'Playing':'';
segs.forEach((sg,i)=>{const k=SEGS[i].k;sg.querySelector('.cap').textContent=i===0&&mid?'':SEGS[i].cap;sg.querySelector('.st').textContent=i===0&&mid?mid:wordOf(k)});
r.setAttribute('aria-checked',String(holdOpened));mast.chips.forEach(c=>c.setAttribute('aria-checked',String((c.dataset.k==='noQueue'?modeNo:modeQ)===c.dataset.m)));
layout();if(btn.classList.contains('yqx-open'))requestAnimationFrame(()=>{if(btn.classList.contains('yqx-open'))layout()})}
function markHeld(ms){clearTimeout(mast.timer);mast.held=true;mast.flash=false;btn.classList.add('yqx-held');go.tabIndex=0;update();unfold();mast.timer=setTimeout(()=>{mast.timer=0;fold()},ms||5000)}
function playHeld(){if(!mast.held)return;clearTimeout(mast.timer);mast.timer=0;mast.held=false;btn.classList.remove('yqx-held');mast.flash=true;update();unfold();mast.timer=setTimeout(()=>{mast.flash=false;mast.timer=0;fold();update()},1400);o.onPlay&&o.onPlay()}
segs.forEach((b,i)=>{b.addEventListener('click',()=>{if(mast.held&&i===0){playHeld();return}if(btn.classList.contains('yqx-ap-end')){mast.open?closeMenu():openMenu();return}cycle(SEGS[i].k)});
b.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){mast.hi=i;layout()}});b.addEventListener('pointerleave',()=>{if(mast.hi===i){mast.hi=-1;layout()}})});
trail.addEventListener('click',()=>mast.open?closeMenu():openMenu());go.addEventListener('click',playHeld);
btn.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){mast.hover=true;unfold()}});btn.addEventListener('pointerleave',()=>{mast.hover=false;mast.hi=-1;fold()});
document.addEventListener('pointerdown',e=>{if(mast.open&&!menu.contains(e.target)&&!btn.contains(e.target))closeMenu()});
update();
return {btn,menu,unfold,fold,openMenu,closeMenu,markHeld,playHeld,setMode,cycle,state,update,layout,mast,get open(){return mast.open}};}
