// Duck Utopia (utopia.html): the race head to head, each player's utopia as a little pixel scene, and what you can do
// in your own. All the rules live on the Mac running the app (duostats/utopia.py); this page shows the state, counts
// breadcrumbs up between checks, and sends your choices. As with showcases, only your own utopia can be changed:
// player 1 from the Mac running the app, player 2 from another computer.

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} },
};
async function api(path, body){
  const r = await fetch(path, {method: body ? 'POST' : 'GET', headers: {'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(()=>({error: 'The app sent back something unexpected.'}));
  if(!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
const shortName = id => String(id).split('#')[0];
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? (n/1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k' : Math.floor(n).toLocaleString();
const COLORS = ['var(--p1)', 'var(--p2)'];
const BUILD_INFO = {   // building -> (art for its level, what it does)
  nests: [l=>`nests-${l >= 7 ? '3-skyline' : l >= 4 ? '2-village' : '1-nests'}`, (p)=>`Room for ${p.nestSpace} ducklings while they grow`],
  pond: [l=>`pond-${l >= 7 ? '3-lagoon' : l >= 4 ? '2-lake' : '1-pond'}`, (p)=>`Room for ${p.pondSpace} ducks; only ducks in the pond collect breadcrumbs`],
  bakery: [l=>`bakery-${Math.min(3, Math.max(1, Math.ceil(l / 3)))}`, (p)=>p.levels.bakery ? `+${p.levels.bakery * 25}% breadcrumbs (+25% a level)` : 'Makes breadcrumbs faster: +25% a level'],
  spa: [l=>l >= 2 ? 'spa-2-hotsprings' : 'spa-1-spa', ()=>'Luxury and bragging rights: a big boost to your Utopia Score'],
  fence: [()=>'tile-mud', (p)=>p.levels.fence ? `Geese bite ${Math.round(Math.min(.06 * p.levels.fence, .5) * 100)}% softer in raids` : 'Goose defences: geese bite 6% softer a level in raids'],
};
const CLASS_NAME = {tank: 'Tank', mage: 'Mage', marksman: 'Marksman', support: 'Support', fighter: 'Fighter', assassin: 'Assassin'};

let U = null;              // the latest state from the app
let clockOffset = 0;       // the app's clock minus this browser's
let viewing = null;        // index of the utopia being looked at
let picking = false;       // the squad picker is open
let practice = null;       // the last practice raid report
let busy = false;

const nowApp = () => Date.now() + clockOffset;
const mine = () => U && viewing === U.me && U.players[U.me];
function crumbsNow(p){ return p.crumbs + p.rate * Math.max(0, nowApp() - U.now) / 60000; }

// pictures as <img> (data URLs of the art canvases, made once each)
const urls = {};
function artURL(name){
  const a = art(name);
  if(!urls[name] || urls[name].src !== a){ urls[name] = {src: a, url: a.toDataURL ? a.toDataURL() : a.src}; }
  return urls[name].url;
}
const pic = (name, cls = 'pix', alt = '') => `<img class="${cls}" src="${artURL(name)}" alt="${esc(alt)}" draggable="false">`;

// champion icons, from Riot's Data Dragon
let ddVer = null;
fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r=>r.json()).then(v=>{ ddVer = v[0]; if(U) renderPanels(); }).catch(()=>{});
const champIcon = c => ddVer ? `<img class="ic" src="https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/champion/${encodeURIComponent(c === 'FiddleSticks' ? 'Fiddlesticks' : c)}.png" alt="" onerror="this.style.visibility='hidden'">` : '<span class="ic"></span>';

// ---- loading ----
async function load(){
  try{
    const s = await api('/api/utopia');
    accept(s);
  }catch(e){ $('#msg').className = 'msg err'; $('#msg').textContent = e.message; }
}
function accept(s){
  U = s; clockOffset = s.now - Date.now();
  if(!U.players.length){ $('#msg').textContent = 'Add your Riot IDs on the main page first.'; return; }
  if(viewing === null || !U.players[viewing]) viewing = U.players[+store.get('utopia_view')] ? +store.get('utopia_view') : U.me;
  if(!U.players[viewing]) viewing = 0;
  $('#msg').textContent = '';
  $('#game').classList.remove('hidden');
  renderPanels();
  scene.reset();
  founding();
}
setInterval(load, 20000);
// when the next duckling is due to grow, ask straight away rather than waiting for the next check
setInterval(()=>{ if(U && U.players.some(p=>p.ducklings.length && p.ducklings[0] <= nowApp())) load(); }, 5000);

// ---- drawing the panels ----
function renderPanels(){
  renderScore(); renderWhose(); renderResources(); renderBuild(); renderSquad(); renderRaids(); renderLog();
  if(tipEl && !tipEl.isConnected) showTip({target: document.body});   // what it was over has been redrawn
}
function renderScore(){
  const ps = U.players;
  $('#scoreboard').innerHTML = ps.map((p, i)=>`<div class="usd ${p.leading ? 'lead' : ''}" style="--c:${COLORS[i]}">
      <b>${esc(shortName(p.riotId))}${i === U.me ? ' (you)' : ''}</b>
      ${p.leading ? `<span class="crown">${pic('icon-crown')}Leading</span>` : ''}
      ${p.catchUp > 1 ? `<span class="boost" title="Catch-up boost: rewards from new games are multiplied while behind">${pic('icon-catchup')}×${p.catchUp}</span>` : ''}
      <div class="n">${fmt(p.score)}</div><div class="d">Utopia Score · ${p.raidWins} raid${p.raidWins === 1 ? '' : 's'} won</div></div>`)
    .join(ps.length > 1 ? '<div class="uvs">VS</div>' : '');
  if(ps.length < 2) $('#scoreboard').style.gridTemplateColumns = '1fr';
}
function renderWhose(){
  $('#whose').innerHTML = U.players.map((p, i)=>`<button data-view="${i}" class="${viewing === i ? 'on' : ''}" aria-pressed="${viewing === i}">${esc(shortName(p.riotId))}'s utopia${i === U.me ? ' (you)' : ''}</button>`).join('');
}
$('#whose').addEventListener('click', e=>{
  const b = e.target.closest('[data-view]'); if(!b) return;
  viewing = +b.dataset.view; store.set('utopia_view', viewing); picking = false;
  renderPanels(); scene.reset();
});

function growLeft(p){
  if(!p.ducklings.length) return '';
  const ms = Math.max(0, p.ducklings[0] - nowApp()), m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function renderResources(){
  const p = U.players[viewing];
  $('#resources').innerHTML = `
    <div>${pic('icon-breadcrumb')}<b id="crumbs">${fmt(crumbsNow(p))}</b><span>breadcrumbs · ${fmt(p.rate)}/min</span></div>
    <div>${pic('icon-feather')}<b>${p.feathers}</b><span>goose feathers</span></div>
    <div>${pic('duck-plain')}<b>${p.pond}/${p.pondSpace}</b><span>ducks in the pond</span></div>
    ${p.edge ? `<div class="warn">${pic('duck-plain')}<b>${p.edge}</b><span>waiting at the pond's edge (upgrade the pond)</span></div>` : ''}
    <div>${pic('duckling')}<b>${p.ducklings.length}/${p.nestSpace}</b><span>ducklings in nests${p.ducklings.length ? ` · next grows in <span id="grow">${growLeft(p)}</span>` : ''}</span></div>
    ${p.lost ? `<div class="warn">${pic('duckling')}<b>${p.lost}</b><span>in the lost and found (upgrade the nests)</span></div>` : ''}
    ${p.boost ? `<div class="utipped" tabindex="0" data-tip-html="${esc(boostTip(p))}"><b>+${pctOf(p.boost)}</b><span>multikill boost</span></div>` : ''}`;
}
const pctOf = v => `${+(v * 100).toFixed(1)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function kills(t, q){ return [t && plural(t, 'triple'), q && plural(q, 'quadra')].filter(Boolean).join(', '); }
// the multikill boost's hover card: what it's made of, which champions earned most of it, and the latest games
function boostTip(p){
  const b = p.boostFrom;
  const day = ts => ts ? new Date(ts).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : '';
  return `<b>Multikill boost +${pctOf(p.boost)}</b>
    <p>Every triple kill adds ${pctOf(b.perTriple)} and every quadra kill ${pctOf(b.perQuadra)} to your breadcrumbs, for good.</p>
    <table class="utip"><tr><td>${plural(b.triples, 'triple kill')} × ${pctOf(b.perTriple)}</td><td>+${pctOf(b.fromTriples)}</td></tr>
      <tr><td>${plural(b.quadras, 'quadra kill')} × ${pctOf(b.perQuadra)}</td><td>+${pctOf(b.fromQuadras)}</td></tr>
      ${b.sinceFounding ? `<tr class="sub"><td>since Founding Day</td><td>+${pctOf(b.sinceFounding)}</td></tr>` : ''}</table>
    ${b.champions.length ? `<div class="uth">Most from</div><table class="utip">${b.champions.map(c=>`<tr><td>${esc(c.champion)} <span>${kills(c.triples, c.quadras)}</span></td><td>+${pctOf(c.boost)}</td></tr>`).join('')}</table>` : ''}
    ${b.latest.length ? `<div class="uth">Latest</div><table class="utip">${b.latest.map(g=>`<tr><td>${esc(g.champion)} <span>${kills(g.triples, g.quadras)}</span></td><td>${day(g.start)}</td></tr>`).join('')}</table>` : ''}`;
}
function renderBuild(){
  const p = U.players[viewing], own = mine();
  $('#build').innerHTML = Object.entries(p.buildings).map(([b, x])=>{
    const [img, what] = BUILD_INFO[b];
    const title = x.level ? x.name : `${x.next} (not built)`;
    const next = x.next && x.level ? (x.next === x.name ? `level ${x.level + 1}` : x.next) : '';
    const btn = x.cost == null ? '<span class="max">Fully upgraded</span>'
      : `<button data-build="${b}" ${own ? '' : 'disabled'} data-cost="${x.cost}">${pic('icon-breadcrumb')}${fmt(x.cost)}</button>`;
    return `<div class="ubld">${pic(img(Math.max(1, x.level)))}
      <div class="t"><b>${esc(title)}${x.level ? ` · level ${x.level}` : ''}</b><span>${esc(what(p))}${next ? `. Next: ${esc(next)}` : ''}</span></div>${btn}</div>`;
  }).join('') + (own ? '' : `<p class="unote">Only ${esc(shortName(p.riotId))} can build here.</p>`);
  affordable();
}
function affordable(){   // build buttons light up as breadcrumbs come in
  if(!mine()) return;
  const have = crumbsNow(U.players[viewing]);
  document.querySelectorAll('[data-build]').forEach(b=>{ b.disabled = busy || have < +b.dataset.cost; });
}
$('#build').addEventListener('click', e=>{
  const b = e.target.closest('[data-build]'); if(b) act({action: 'upgrade', building: b.dataset.build});
});

function stars(n){ return n ? `<span class="star" title="${['', 'S-', 'S', 'S+'][n]} this season">${'★'.repeat(n)}</span>` : ''; }
function renderSquad(){
  const p = U.players[viewing], own = mine();
  if(!p.squad.length){ $('#squad').innerHTML = '<p class="uempty">Defenders are champions you\'ve played together. Play a game first.</p>'; return; }
  const list = p.squad.map(d=>`<div class="udef">${pic('duck-' + d.cls, 'duck pix')}${champIcon(d.champion)}
      <div class="t"><b>${esc(d.champion)} ${stars(d.star)}</b><span>${CLASS_NAME[d.cls]} · Lv ${d.level} · ${d.hp} HP · ${d.atk} ATK${d.training ? ` · trained ${d.training}` : ''}${d.pentas ? ' · ultimate' : ''}</span></div>
      ${own ? `<button class="ghost" data-train="${esc(d.champion)}" ${p.feathers < 2 + d.training || d.training >= 10 ? 'disabled' : ''} title="Training: +10% health and attack">Train ${pic('icon-feather')}${2 + d.training}</button>` : ''}
    </div>`).join('');
  const chosen = new Set(p.squad.map(d=>d.champion));
  const picker = picking ? `<div class="upick" id="picker">${p.champions.slice(0, 40).map(c=>`<label class="${chosen.has(c.champion) ? 'on' : ''}">
      <input type="checkbox" value="${esc(c.champion)}" ${chosen.has(c.champion) ? 'checked' : ''}>${pic('duck-' + c.cls)}${esc(c.champion)} <span style="color:var(--muted)">${c.games}</span></label>`).join('')}</div>
      <div class="ubtns"><button data-squad-save>Save squad</button><button class="ghost" data-squad-cancel>Cancel</button></div>` : '';
  $('#squad').innerHTML = list + (own ? (picking ? picker : '<div class="ubtns"><button class="ghost" data-squad-open>Change squad</button></div>')
    : `<p class="unote">${esc(shortName(p.riotId))}'s squad. Stats come from their own games on each champion.</p>`)
    + '<p class="unote">Tanks soak up hits, mages hit groups, marksmen pierce armour, supports heal, assassins pick off flying geese. Each champion\'s stats come from your games on it: games played set its level, win rate its health, KDA its attack, S grades its stars.</p>';
}
$('#squad').addEventListener('click', e=>{
  if(e.target.closest('[data-squad-open]')){ picking = true; renderSquad(); }
  else if(e.target.closest('[data-squad-cancel]')){ picking = false; renderSquad(); }
  else if(e.target.closest('[data-squad-save]')){
    const squad = [...document.querySelectorAll('#picker input:checked')].map(i=>i.value);
    picking = false; act({action: 'squad', squad});
  } else { const t = e.target.closest('[data-train]'); if(t) act({action: 'train', champion: t.dataset.train}); }
});
$('#squad').addEventListener('change', e=>{
  const box = e.target.closest('#picker input'); if(!box) return;
  const on = document.querySelectorAll('#picker input:checked');
  if(on.length > 5){ box.checked = false; return; }
  box.closest('label').classList.toggle('on', box.checked);
});

const GOOSE_ART = {goose: 'goose', armoured: 'goose-armoured', goslings: 'goose-goslings', flying: 'goose-flying'};
function report(rep, who, i){
  if(!rep) return `<div class="urep"><h3><span class="who">${esc(who)}</span></h3><p class="uempty" style="color:#ffe8cc">No raid yet.</p></div>`;
  const geese = Object.entries(rep.geese).flatMap(([k, n])=>Array(k === 'goslings' ? n / 4 : n).fill(k));
  let gone = Math.round(rep.chased / rep.total * geese.length);
  return `<div class="urep ${rep.win ? '' : 'lost'}" style="--c:${COLORS[i] || COLORS[0]}">
    <h3><span class="who">${esc(who)}${rep.practice ? ' · practice' : ` · after ${esc(rep.champion || 'a game')}`}</span><span class="r">${rep.win ? 'Saved!' : 'Raided'}</span></h3>
    <div class="ugeese">${geese.map((k, j)=>`<img class="pix ${j < gone ? 'gone' : ''}" style="animation-delay:${j * 40}ms" src="${artURL(GOOSE_ART[k])}" alt="${k}" title="${k}">`).join('')}</div>
    <div>${rep.chased} of ${rep.total} geese chased off in ${rep.rounds} round${rep.rounds === 1 ? '' : 's'} · wave ${rep.wave}</div>
    <div class="sq">${rep.squad.map(d=>`<img class="pix ${d.up ? '' : 'ko'}" src="${artURL('duck-' + d.cls)}" title="${esc(d.champion)}${d.up ? '' : ' (knocked out)'}" alt="">`).join('')}</div>
    <div class="rw">${rep.practice ? 'Practice: nothing won or lost.' : rep.win ? `+${fmt(rep.reward.crumbs)} breadcrumbs, +${rep.reward.feathers} feathers` : `The geese took ${fmt(rep.stolen)} breadcrumbs.`}</div>
    <ol>${rep.log.map(l=>`<li>${esc(l)}</li>`).join('')}</ol></div>`;
}
function renderRaids(){
  const ps = U.players, latest = ps.map(p=>p.raids[0]).filter(Boolean).sort((a, b)=>b.t - a.t)[0];
  const same = latest ? ps.map(p=>p.raids.find(r=>r.matchId === latest.matchId)) : [];
  $('#raids').innerHTML = `<p class="unote" style="margin-top:0">After every game you play together, the same wave of geese raids both utopias, and each squad of five fights it automatically.
      A win brings breadcrumbs and goose feathers; a loss lets the geese steal some breadcrumbs. Buildings are never damaged.</p>
    ${latest ? `<div class="uraids">${ps.map((p, i)=>report(same[i], shortName(p.riotId), i)).join('')}</div>`
      : '<p class="uempty">No raids yet: the first one comes after your next game together.</p>'}
    ${practice ? `<h3 style="margin:14px 0 8px;font-size:14px">Practice raid</h3><div class="uraids">${report(practice, shortName(U.players[U.me].riotId), U.me)}</div>` : ''}
    ${U.players[U.me] && U.players[U.me].squad.length ? '<div class="ubtns"><button class="ghost" data-practice>Practice raid (nothing won or lost)</button></div>' : ''}`;
}
$('#raids').addEventListener('click', e=>{ if(e.target.closest('[data-practice]')) act({action: 'practice'}, true); });
function renderLog(){
  const p = U.players[viewing];
  $('#log').innerHTML = p.log.length ? `<ul class="ulog">${p.log.map(l=>`<li><time>${new Date(l.t).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}</time><span>${esc(l.text)}</span></li>`).join('')}</ul>`
    : '<p class="uempty">Nothing yet.</p>';
}

// ---- doing things in your own utopia ----
async function act(body, isPractice){
  if(busy) return;
  busy = true; affordable();
  try{
    const s = await api('/api/utopia', {...body, owner: U.players[U.me].riotId.toLowerCase()});
    if(isPractice && s.result && s.result.raid) practice = s.result.raid;
    accept(s);
    if(isPractice) document.querySelector('#raids').scrollIntoView({behavior: 'smooth', block: 'start'});
  }catch(e){ $('#msg').className = 'msg err'; $('#msg').textContent = e.message; setTimeout(()=>{ $('#msg').textContent = ''; }, 5000); }
  finally{ busy = false; affordable(); }
}

// ---- hover cards (styled by style.css's #tip, like the main page's) ----
const tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip);
let tipEl = null;
function showTip(e){
  const el = e.target.closest && e.target.closest('[data-tip-html]');
  if(el === tipEl) return;
  tipEl = el; tip.classList.toggle('on', !!el);
  if(!el) return;
  tip.innerHTML = el.dataset.tipHtml;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let y = r.top - h - 8; if(y < 8) y = r.bottom + 8;
  tip.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8) + 'px'; tip.style.top = y + 'px';
}
document.addEventListener('mouseover', showTip);
document.addEventListener('focusin', showTip);
document.addEventListener('focusout', e=>{ if(e.target === tipEl) showTip({target: document.body}); });
addEventListener('scroll', ()=>showTip({target: document.body}), {passive: true, capture: true});

// numbers that tick between checks
setInterval(()=>{
  if(!U) return;
  const p = U.players[viewing], c = $('#crumbs'), g = $('#grow');
  if(c) c.textContent = fmt(crumbsNow(p));
  if(g) g.textContent = growLeft(p);
  affordable();
}, 250);

// ---- the scene: a little pixel picture of the utopia being viewed ----
const W = 480, H = 280;
const scene = (()=>{
  const cv = $('#scene'), g = cv.getContext('2d');
  let ducks = [], t0 = performance.now();
  function size(){
    const css = cv.clientWidth || W, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr * H / W);
  }
  function pondBox(p){
    const lvl = Math.min(p.levels.pond, 12), rx = Math.min(60 + 7 * lvl, 130), ry = Math.round(rx * .55);
    return {cx: 190, cy: 150, rx, ry};
  }
  function reset(){
    if(!U) return;
    const p = U.players[viewing], b = pondBox(p);
    const n = Math.min(p.pond, 36);
    ducks = Array.from({length: n}, (_, i)=>{
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * .75;
      return {x: b.cx + Math.cos(a) * b.rx * r, y: b.cy + Math.sin(a) * b.ry * r, vx: (Math.random() < .5 ? -1 : 1) * (4 + Math.random() * 6), phase: Math.random() * 6};
    });
  }
  function label(text, x, y, align = 'center', color = '#fff'){
    g.font = 'bold 9px ui-monospace, Menlo, monospace'; g.textAlign = align; g.textBaseline = 'top';
    g.lineWidth = 3; g.strokeStyle = 'rgba(20,24,30,.85)'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
  }
  function sprite(name, x, y, w, h){ g.drawImage(art(name), Math.round(x), Math.round(y), w, h ?? w); }
  function lot(x, y, text){   // an empty plot with a sign
    g.fillStyle = 'rgba(122,90,52,.55)'; g.fillRect(x + 6, y + 30, 52, 26);
    g.fillStyle = '#8b5a2b'; g.fillRect(x + 30, y + 14, 3, 22); g.fillStyle = '#d9b77e'; g.fillRect(x + 16, y + 8, 31, 12);
    label(text, x + 32, y + 58, 'center', '#ffe8cc');
  }
  function draw(now){
    requestAnimationFrame(draw);
    if(!U) return;
    const p = U.players[viewing], dt = Math.min((now - t0) / 1000, .1); t0 = now;
    const k = cv.width / W;
    g.setTransform(k, 0, 0, k, 0, 0); g.imageSmoothingEnabled = false;
    // grass
    for(let y = 0; y < H; y += 32) for(let x = 0; x < W; x += 32) sprite('tile-grass', x, y, 32);
    // fences around the edge
    const f = p.levels.fence;
    if(f){
      const col = f >= 7 ? '#868e96' : '#8b5a2b';
      g.fillStyle = col;
      for(let x = 2; x < W; x += 14){ g.fillRect(x, 2, 4, f >= 7 ? 8 : 6); g.fillRect(x, H - 9, 4, f >= 7 ? 8 : 6); }
      for(let y = 2; y < H; y += 14){ g.fillRect(2, y, f >= 7 ? 8 : 6, 4); g.fillRect(W - 9, y, f >= 7 ? 8 : 6, 4); }
      g.fillRect(4, 4, W - 8, 2); g.fillRect(4, H - 6, W - 8, 2);
      if(f >= 4) [[12, 12], [W - 28, 12]].forEach(([x, y])=>{ g.fillStyle = '#8b5a2b'; g.fillRect(x + 7, y + 6, 2, 14); g.fillRect(x + 2, y + 9, 12, 2); g.fillStyle = '#e0a96d'; g.fillRect(x + 5, y, 6, 6); });
    }
    // the pond, and the ducks in it
    const b = pondBox(p);
    sprite(BUILD_INFO.pond[0](p.levels.pond), b.cx - b.rx, b.cy - b.ry, b.rx * 2, b.ry * 2);
    ducks.forEach(d=>{
      d.x += d.vx * dt;
      const ex = (d.x - b.cx) / (b.rx * .8), ey = (d.y - b.cy) / (b.ry * .7);
      if(ex * ex + ey * ey > 1){ d.vx = -d.vx; d.x += d.vx * dt * 2; }
      if(Math.random() < .002) d.vx = -d.vx;
      const bob = Math.sin(now / 400 + d.phase) * 1;
      g.save();
      if(d.vx < 0){ g.translate(Math.round(d.x) + 8, 0); g.scale(-1, 1); g.translate(-Math.round(d.x) - 8, 0); }
      g.drawImage(art('duck-plain'), 0, 0, 32, 24, Math.round(d.x), Math.round(d.y + bob), 16, 12);   // swimming: no feet
      g.restore();
    });
    label(`${BUILD_INFO.pond[0](p.levels.pond).split('-')[2].replace(/^./, c=>c.toUpperCase())} · ${p.pond}/${p.pondSpace} ducks`, b.cx, b.cy - b.ry - 12);
    if(p.pond > ducks.length) label(`+${p.pond - ducks.length} more`, b.cx, b.cy + b.ry - 16, 'center', '#ffe066');
    // ducks waiting at the pond's edge
    if(p.edge){
      const n = Math.min(p.edge, 16), y = b.cy + b.ry + 2;
      for(let i = 0; i < n; i++) sprite('duck-plain', b.cx - n * 7 + i * 14, y + (i % 2) * 2, 16);
      label(`${p.edge} waiting for room in the pond`, b.cx, y + 19, 'center', '#ffd8a8');
    }
    // nests, ducklings and the lost and found box
    sprite(BUILD_INFO.nests[0](p.levels.nests), 8, 6, 64);
    label(`Nests ${p.ducklings.length}/${p.nestSpace}`, 40, 70);
    for(let i = 0; i < Math.min(p.ducklings.length, 8); i++){
      const hop = Math.abs(Math.sin(now / 300 + i)) * 2;
      sprite('duckling', 8 + (i % 4) * 14, 82 + Math.floor(i / 4) * 12 - hop, 12);
    }
    if(p.lost){
      g.fillStyle = '#a47148'; g.fillRect(82, 46, 22, 18); g.fillStyle = '#6b4423'; g.fillRect(82, 46, 22, 3); g.fillRect(92, 46, 2, 18);
      label(`Lost & found: ${p.lost}`, 93, 66, 'center', '#ffd8a8');
    }
    // bakery and spa (an empty plot until built)
    if(p.levels.bakery) { sprite(BUILD_INFO.bakery[0](p.levels.bakery), 404, 6, 64); label(`Bakery ${p.levels.bakery}`, 436, 70); }
    else lot(404, 6, 'Bakery plot');
    if(p.levels.spa) { sprite(BUILD_INFO.spa[0](p.levels.spa), 404, 90, 64); label(p.levels.spa >= 2 ? 'Hot springs' : 'Spa', 436, 154); }
    else lot(404, 90, 'Spa plot');
    // districts: unlocked by real achievements only
    const D = [['penta', 'district-penta-plaza', 'Plaza', 'a penta', p.golden, 'duck-golden'],   // short: they sit close together
               ['champion', 'district-champion-quarter', 'Quarter', 'an S', Object.keys(p.champs).length, 'duck-fighter'],
               ['volcano', 'district-volcano-spa', 'Volcano', 'an S+', p.fire, 'duck-fire']];
    D.forEach(([id, img, name, need, n, duck], i)=>{
      const x = 322 + i * 54, y = 196, open = p.districts.includes(id);
      g.globalAlpha = open ? 1 : .35; sprite(img, x, y, 48); g.globalAlpha = 1;
      if(open){ sprite(duck, x + 30, y + 30, 16); label(`${name} ${n}`, x + 24, y + 50); }
      else { label('🔒', x + 24, y + 16); label(`needs ${need}`, x + 24, y + 50, 'center', '#dee2e6'); }
    });
  }
  window.addEventListener('resize', size);
  size(); requestAnimationFrame(draw);
  return {reset, size};
})();

// ---- Founding Day: the first look at each utopia replays your history together ----
function founding(){
  const p = U.players[U.me];
  if(!p || !p.founding) return;
  const key = `utopia_founded_${p.riotId.toLowerCase()}_${p.founded}`;
  if(store.get(key)) return;
  store.set(key, '1');
  const f = p.founding;
  const rows = [['duck-plain', f.wins, `win${f.wins === 1 ? '' : 's'} together became ducks`],
                ['icon-catchup', f.boosts, 'multikills became a permanent breadcrumb boost'],
                ['duck-golden', f.golden, `pentakill${f.golden === 1 ? '' : 's'}: golden ducks for Penta Plaza`],
                ['duck-fighter', f.champs, 'champions with an S grade joined the Champion Quarter'],
                ['duck-fire', f.fire, 'S+ grades lit up the Volcano Spa']].filter(r=>r[1] > 0);
  const box = $('#founding');
  box.innerHTML = `<div class="box"><canvas></canvas><h2 id="foundTitle">Founding Day</h2>
    <p>${f.games} games together, replayed. Your utopia starts from your history.</p>
    <ul>${rows.map(([img, n, text], i)=>`<li style="animation-delay:${300 + i * 450}ms">${pic(img)}<b>${n}</b><span>${text}</span></li>`).join('')}</ul>
    <p>The pond only holds ${p.pondSpace} ducks to start, so the rest wait at its edge. Upgrade the pond to put them to work.</p>
    <button data-found-close>Enter your utopia</button></div>`;
  box.classList.remove('hidden');
  box.querySelector('button').focus();
  // ducks raining down behind the list
  const cv = box.querySelector('canvas'), g = cv.getContext('2d');
  cv.width = 230; cv.height = 300;
  const drops = Array.from({length: Math.min(f.wins, 60)}, (_, i)=>({x: Math.random() * 214, y: -20 - i * 14, v: 40 + Math.random() * 40,
    name: i < f.golden ? 'duck-golden' : i < f.golden + f.fire ? 'duck-fire' : 'duck-plain'}));
  let last = performance.now();
  (function fall(t){
    if(box.classList.contains('hidden')) return;
    const dt = (t - last) / 1000; last = t;
    g.clearRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = false; g.globalAlpha = .35;
    drops.forEach(d=>{ d.y = Math.min(d.y + d.v * dt, 284); g.drawImage(art(d.name), Math.round(d.x), Math.round(d.y), 16, 16); });
    requestAnimationFrame(fall);
  })(last);
}
document.addEventListener('click', e=>{ if(e.target.closest('[data-found-close]')) $('#founding').classList.add('hidden'); });
document.addEventListener('keydown', e=>{ if(e.key === 'Escape') $('#founding').classList.add('hidden'); });

load();
