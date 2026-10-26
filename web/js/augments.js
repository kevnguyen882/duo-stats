// Augment icons (from the game) with a hover card showing the name, rarity and wiki description.
// The hover card (#tip) is shared: badges use it too.

let augNames = null;   // augment id -> {name, rarity, desc}
function loadAugNames(){
  if(augNames !== null) return;
  augNames = {};
  api('/api/augments').then(a=>{ augNames = a || {}; if(lastData) render(lastData); }).catch(()=>{});
}
const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function augIcons(ids){
  if(!ids || !ids.length) return '';
  return `<div class="augrow">${ids.map(id=>{ const a = (augNames||{})[id] || {};
    return `<img class="augic ${esc(a.rarity||'')}" src="/api/augicon/${encodeURIComponent(id)}" alt="${esc(a.name||'Augment')}" data-aug="${esc(id)}"
      onerror="this.onerror=null;this.alt='';this.src='${BLANK_GIF}'">`; }).join('')}</div>`;
}

const tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip);
// the same hover card also shows anything marked data-tip-title / data-tip (badges, for one), or ready-made data-tip-html.
// data-tip-delay="500" waits that many ms of hovering first.
let tipTimer = null, tipEl = null;
function hideTip(){ clearTimeout(tipTimer); tipTimer = null; tipEl = null; tip.classList.remove('on'); }
function showTip(e){
  const el = e.target.closest && e.target.closest('[data-aug],[data-tip],[data-tip-html]');
  if(el && el === tipEl) return;   // still over the same thing
  hideTip();
  if(!el) return;
  tipEl = el;
  const delay = +el.dataset.tipDelay || 0;
  if(delay && e.type !== 'focusin') tipTimer = setTimeout(()=>{ tipTimer = null; placeTip(el); }, delay);
  else placeTip(el);
}
function placeTip(el){
  if(el.dataset.tipHtml != null){
    tip.innerHTML = el.dataset.tipHtml;
  }else if(el.dataset.tip != null){
    tip.innerHTML = `<b>${esc(el.dataset.tipTitle||'')}</b><p>${esc(el.dataset.tip)}</p>`;
  }else{
    const a = (augNames||{})[el.dataset.aug] || {};
    const desc = esc(a.desc).replace(/\n{2,}/g,'<br><span style="display:block;height:5px"></span>').replace(/\n/g,'<br>');
    tip.innerHTML = `<b>${esc(a.name || 'Augment #'+el.dataset.aug)}</b>${a.rarity?`<div class="rar ${esc(a.rarity)}">${esc(a.rarity)} augment</div>`:''}`
      + (a.desc ? `<p>${desc}</p><div class="src">Description: League of Legends Wiki (CC BY-SA 3.0)</div>`
                : (a.name ? '<p>No description on the League of Legends Wiki yet.</p>' : ''));
  }
  const r = el.getBoundingClientRect(); tip.classList.add('on');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width/2 - w/2), innerWidth - w - 8);
  let y = r.top - h - 8; if(y < 8) y = r.bottom + 8;
  tip.style.left = x+'px'; tip.style.top = y+'px';
}
document.addEventListener('mouseover', showTip);
document.addEventListener('focusin', showTip);
addEventListener('scroll', hideTip, {passive:true, capture:true});
