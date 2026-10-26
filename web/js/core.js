// Small helpers used by every part of the page.

const $ = s => document.querySelector(s);
const REGIONS = ["NA","EUW","EUNE","KR","BR","LAN","LAS","OCE","JP","TR","RU","ME","PH","SG","TH","TW","VN"];
const QUEUES = {400:"Normal Draft",420:"Ranked Solo/Duo",430:"Normal Blind",440:"Ranked Flex",450:"ARAM",480:"Swiftplay",
  490:"Quickplay",700:"Clash",900:"URF",1700:"Arena",1900:"URF",1300:"Nexus Blitz",2400:"ARAM Mayhem"};
const COLORS = ['var(--p1)','var(--p2)'];   // player 1 blue, player 2 pink
const GRADES = ["S+","S","S-","A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-"];

// browser storage can be unavailable (private windows etc.), so every use is guarded
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} },
};

// the data the page is showing right now (set by app.js)
let lastData = null;
// true when this page is open on another computer on the network: it can look but not change anything
let viewer = false;

// ---- talking to the app ----
async function api(path, body){
  const r = await fetch(path, {method: body ? 'POST' : 'GET', headers: {'Content-Type':'application/json'},
    body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(()=>({error:'The app sent back something unexpected.'}));
  if(!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
function msg(html, cls=''){ $('#msg').className = 'msg '+cls; $('#msg').innerHTML = html; }

// ---- formatting ----
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const pct = v => v==null ? '–' : Math.round(v*100)+'%';
const f1 = v => v==null ? '–' : v.toFixed(1);
const f2 = v => v==null ? '–' : v.toFixed(2);
const f0 = v => v==null ? '–' : Math.round(v).toLocaleString();
const shortName = riotId => riotId.split('#')[0];
function fmtDate(ts){ return new Date(ts).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function timeAgo(ts){
  const s = (Date.now()-ts)/1000;
  if(s < 3600) return Math.max(1, Math.round(s/60))+'m ago';
  if(s < 86400) return Math.round(s/3600)+'h ago';
  return Math.round(s/86400)+'d ago';
}
function fmtTime(sec){ const m = Math.round(sec/60), h = Math.floor(m/60); return h ? `${h}h ${m%60}m` : `${m}m`; }
function grade_rank(g){ const i = GRADES.indexOf(String(g||'').toUpperCase()); return i < 0 ? 99 : i; }

// ---- champion icons (from Riot's Data Dragon) ----
let ddVer = null;
fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r=>r.json())
  .then(v=>{ ddVer = v[0]; if(lastData) render(lastData); }).catch(()=>{});
function champImage(alias){   // the game's champion alias -> its Data Dragon picture
  return `https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/champion/${encodeURIComponent(alias==='FiddleSticks' ? 'Fiddlesticks' : alias)}.png`;
}
function icon(c){
  if(!ddVer) return '<span class="ic"></span>';
  return `<img class="ic" src="${champImage(c)}" onerror="this.style.visibility='hidden'" alt="">`;
}

// ---- a pop-up in the corner ----
function toast(title, html, ms = 9000, cls = ''){
  const t = document.createElement('div'); t.className = 'toast ' + cls; t.setAttribute('role', 'status');
  t.innerHTML = `<button class="toastx" aria-label="Dismiss" title="Dismiss">×</button><b>${title}</b><div>${html}</div>`;
  document.body.appendChild(t); requestAnimationFrame(()=>t.classList.add('on'));
  setTimeout(()=>closeToast(t), ms);
  return t;
}
function closeToast(t){ t.classList.remove('on'); setTimeout(()=>t.remove(), 400); }
document.addEventListener('click', e=>{ const x = e.target.closest('.toastx'); if(x) closeToast(x.closest('.toast')); });

// ---- theme ----
function setTheme(t){
  document.documentElement.dataset.theme = t; store.set('duo_theme', t);
  document.querySelectorAll('[data-theme-set]').forEach(b=>b.classList.toggle('on', b.dataset.themeSet===t));
}
document.querySelectorAll('[data-theme-set]').forEach(b=>b.onclick = ()=>setTheme(b.dataset.themeSet));
setTheme(document.documentElement.dataset.theme);   // chosen in <head> before the page drew

// clicks and keys inside the results area are handled by each tab's file through these
const out = document.getElementById('out');
function onClick(selector, fn){ out.addEventListener('click', e=>{ const el = e.target.closest(selector); if(el) fn(el, e); }); }
function onActivate(selector, fn){   // click, or Enter/Space for things that act like buttons
  onClick(selector, fn);
  out.addEventListener('keydown', e=>{ const el = e.target.closest && e.target.closest(selector);
    if(el && (e.key==='Enter' || e.key===' ')){ e.preventDefault(); fn(el, e); } });
}
