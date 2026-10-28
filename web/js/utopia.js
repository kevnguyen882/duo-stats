// Ducktopia (utopia.html): the race head to head, each player's utopia as a little pixel scene, and what you can do
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
  pond: [l=>`pond-${l >= 7 ? '3-lagoon' : l >= 4 ? '2-lake' : '1-pond'}`, (p)=>`Room for ${p.pondSpace} ducks; only ducks in the pond collect breadcrumbs`],
  bakery: [l=>`bakery-${Math.min(3, Math.max(1, Math.ceil(l / 3)))}`, (p)=>p.levels.bakery ? `+${p.levels.bakery * 25}% breadcrumbs (+25% a level)` : 'Makes breadcrumbs faster: +25% a level'],
  spa: [l=>l >= 2 ? 'spa-2-hotsprings' : 'spa-1-spa', ()=>'Luxury and bragging rights: a big boost to your Ducktopia Score'],
  fence: [()=>'tile-mud', (p)=>p.levels.fence ? `Geese bite ${Math.round(Math.min(.06 * p.levels.fence, .5) * 100)}% softer in raids` : 'Goose defences: geese bite 6% softer a level in raids'],
};
const LAB = ['nests', 'incubation'];   // the Duck Infirmary's upgrades, shown in its lab rather than under Build
const fmtMin = m => { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`; };
const clock = ms => { const m = Math.floor(Math.max(0, ms) / 60000), sec = Math.floor(Math.max(0, ms) / 1000) % 60; return `${m}:${String(sec).padStart(2, '0')}`; };
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
const champURL = c => `https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/champion/${encodeURIComponent(c === 'FiddleSticks' ? 'Fiddlesticks' : c)}.png`;
const champIcon = c => ddVer ? `<img class="ic" src="${champURL(c)}" alt="" onerror="this.style.visibility='hidden'">` : '<span class="ic"></span>';

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
  scene.reset(); plaza.reset(); lab.reset(); quarter.reset(); volcano.reset();
  founding(); checkFireDucks();
  // the main page's fire duck pop-up links here: #volcano=<player index> opens that player's Volcano Spa
  const link = !openedFromLink && /^#volcano(?:=(\d))?$/.exec(location.hash);
  if(link){
    openedFromLink = true;
    if(link[1] && U.players[+link[1]] && +link[1] !== viewing){ viewing = +link[1]; renderPanels(); scene.reset(); plaza.reset(); lab.reset(); quarter.reset(); volcano.reset(); }
    show('volcano');
  }
}
let openedFromLink = false;
setInterval(load, 20000);
// when the next duckling is due to grow, ask straight away rather than waiting for the next check
setInterval(()=>{ if(U && U.players.some(p=>p.ducklings.length && p.ducklings[0] <= nowApp())) load(); }, 5000);

// ---- drawing the panels ----
function renderPanels(){
  renderScore(); renderWhose(); renderResources(); renderBuild(); renderLab(); renderQuarter(); renderVolcano(); renderSquad(); renderRaids(); renderLog();
  if(tipEl && !tipEl.isConnected) showTip({target: document.body});   // what it was over has been redrawn
}
function renderScore(){
  const ps = U.players;
  $('#scoreboard').innerHTML = ps.map((p, i)=>`<div class="usd ${p.leading ? 'lead' : ''}" style="--c:${COLORS[i]}">
      <b>${esc(shortName(p.riotId))}${i === U.me ? ' (you)' : ''}</b>
      ${p.leading ? `<span class="crown">${pic('icon-crown')}Leading</span>` : ''}
      ${p.catchUp > 1 ? `<span class="boost" title="Catch-up boost: rewards from new games are multiplied while behind">${pic('icon-catchup')}×${p.catchUp}</span>` : ''}
      <div class="n">${fmt(p.score)}</div><div class="d">Ducktopia Score · ${p.raidWins} raid${p.raidWins === 1 ? '' : 's'} won</div></div>`)
    .join(ps.length > 1 ? '<div class="uvs">VS</div>' : '');
  if(ps.length < 2) $('#scoreboard').style.gridTemplateColumns = '1fr';
}
function renderWhose(){
  $('#whose').innerHTML = U.players.map((p, i)=>`<button data-view="${i}" class="${viewing === i ? 'on' : ''}" aria-pressed="${viewing === i}">${esc(shortName(p.riotId))}'s Ducktopia${i === U.me ? ' (you)' : ''}</button>`).join('');
}
$('#whose').addEventListener('click', e=>{
  const b = e.target.closest('[data-view]'); if(!b) return;
  viewing = +b.dataset.view; store.set('utopia_view', viewing); picking = false;
  renderPanels(); scene.reset(); plaza.reset(); lab.reset(); quarter.reset(); volcano.reset();
});

function growLeft(p){ return p.ducklings.length ? clock(p.ducklings[0] - nowApp()) : ''; }
function renderResources(){
  const p = U.players[viewing];
  $('#resources').innerHTML = `
    <div>${pic('icon-breadcrumb')}<b id="crumbs">${fmt(crumbsNow(p))}</b><span>breadcrumbs · ${fmt(p.rate)}/min</span></div>
    <div>${pic('icon-feather')}<b>${p.feathers}</b><span>goose feathers</span></div>
    <div>${pic('duck-plain')}<b>${p.pond}/${p.pondSpace}</b><span>ducks in the pond</span></div>
    ${p.edge ? `<div class="warn">${pic('duck-plain')}<b>${p.edge}</b><span>waiting at the pond's edge (upgrade the pond)</span></div>` : ''}
    <div>${pic('duckling')}<b>${p.ducklings.length}/${p.nestSpace}</b><span>ducklings growing in the infirmary${p.ducklings.length ? ` · next grows in <span id="grow">${growLeft(p)}</span>` : ''}</span></div>
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
// one upgrade's row: its picture, name and level, what it does, and the button
function buildRow(b, x, p, own, img, what, next){
  const btn = x.cost == null ? '<span class="max">Fully upgraded</span>'
    : `<button data-build="${b}" ${own ? '' : 'disabled'} data-cost="${x.cost}">${pic('icon-breadcrumb')}${fmt(x.cost)}</button>`;
  return `<div class="ubld">${pic(img)}<div class="t"><b>${esc(x.level ? `${x.name} · level ${x.level}` : b === 'incubation' ? `${x.next} · not upgraded yet` : `${x.next} (not built)`)}</b>
    <span>${esc(what)}${next ? `. Next: ${esc(next)}` : ''}</span></div>${btn}</div>`;
}
function renderBuild(){
  const p = U.players[viewing], own = mine();
  $('#build').innerHTML = Object.entries(p.buildings).filter(([b])=>!LAB.includes(b)).map(([b, x])=>{
    const [img, what] = BUILD_INFO[b];
    return buildRow(b, x, p, own, img(Math.max(1, x.level)), what(p), x.next && x.level ? (x.next === x.name ? `level ${x.level + 1}` : x.next) : '');
  }).join('') + (own ? '' : `<p class="unote">Only ${esc(shortName(p.riotId))} can build here.</p>`)
    + '<p class="unote">The nests and spawning ducklings are in the Duck Infirmary: click it in your Ducktopia.</p>';
  affordable();
}
function renderLab(){
  const p = U.players[viewing], own = mine(), L = p.lab, bs = p.buildings;
  const free = p.nestSpace - p.ducklings.length - p.lost, full = free <= 0;
  $('#labBuild').innerHTML = `<div class="ubld">${pic('duckling')}<div class="t"><b>Spawn a duckling</b>
      <span>${full ? 'The nests are full: upgrade the nests, or wait for a duckling to grow' : `Into a free nest (${free} free), where it grows for ${fmtMin(L.grow)}`}.
        Each one costs a little more (${p.spawned} spawned so far).</span></div>
      <button data-spawn data-cost="${L.spawnCost}" data-full="${full ? 1 : ''}" ${own && !full ? '' : 'disabled'}>${pic('icon-breadcrumb')}${fmt(L.spawnCost)}</button></div>`
    + buildRow('nests', bs.nests, p, own, 'lab-chamber', `Room for ${p.nestSpace} ducklings to grow, one per chamber`, bs.nests.cost != null ? `room for ${L.nestSpaceNext}` : '')
    + buildRow('incubation', bs.incubation, p, own, 'egg', `Ducklings grow into ducks in ${fmtMin(L.grow)}`, L.growNext ? fmtMin(L.growNext) : '')
    + (own ? '' : `<p class="unote">Only ${esc(shortName(p.riotId))} can use this infirmary.</p>`);
  $('#labNote').textContent = `Spawn ducklings into the infirmary's nests for breadcrumbs. Each one grows in its fluid chamber for ${fmtMin(L.grow)}, then joins the pond. While every nest is full you can't spawn more: upgrade the nests for room, and the incubation time to grow them faster.`;
  affordable();
}
$('#labBuild').addEventListener('click', e=>{
  if(e.target.closest('[data-spawn]')) return act({action: 'spawn'});
  const b = e.target.closest('[data-build]'); if(b) act({action: 'upgrade', building: b.dataset.build});
});
function affordable(){   // build buttons light up as breadcrumbs come in
  if(!mine()) return;
  const have = crumbsNow(U.players[viewing]);
  document.querySelectorAll('[data-build], [data-spawn], [data-hatbuy]').forEach(b=>{ b.disabled = busy || have < +b.dataset.cost || !!b.dataset.full; });
}
$('#build').addEventListener('click', e=>{
  const b = e.target.closest('[data-build]'); if(b) act({action: 'upgrade', building: b.dataset.build});
});

// ---- the Champion Quarter: each defender's stats and hats ----
let qSel = null;   // the defender picked in the lounge
const hatOf = (p, c) => (p.hats[c] || {}).on || null;
// a duck, wearing its hat if it has one (hats are 10x6 maps whose bottom row sits on a 16x16 duck's head)
function duckWithHat(g, cls, hat, x, y, size){
  g.drawImage(art('duck-' + cls), Math.round(x), Math.round(y), size, size);
  if(hat) g.drawImage(art('hat-' + hat), Math.round(x + size * 6 / 16), Math.round(y - size * 3 / 16), Math.round(size * 10 / 16), Math.round(size * 6 / 16));
}
function quarterPick(p){
  if(!p.squad.length) return null;
  if(!p.squad.some(d=>d.champion === qSel)) qSel = p.squad[0].champion;
  return p.squad.find(d=>d.champion === qSel);
}
function renderQuarter(){
  const p = U.players[viewing], own = mine(), open = p.districts.includes('champion'), d = open && quarterPick(p);
  $('#quarterNote').textContent = open
    ? 'Your five defenders rest here between goose raids. Click one to see its stats and buy it hats (just for looks). Choose who defends in the Defenders panel in your Ducktopia.'
    : 'Opens with your first S-, S or S+ together. Your defenders will rest here between goose raids.';
  if(!d){ $('#quarterDetail').innerHTML = open ? '<p class="uempty">No defenders yet: play a game together first.</p>' : ''; return; }
  const mineHats = p.hats[d.champion] || {owned: [], on: null}, have = crumbsNow(p);
  const rows = [['Class', CLASS_NAME[d.cls]], ['Level', `${d.level} (from ${plural(d.games, 'game')} together)`], ['Health', `${d.hp} HP`],
    ['Attack', `${d.atk} ATK`], ['Win rate', `${Math.round(d.winRate * 100)}%`], ['KDA', d.kda.toFixed(2)], ['Best grade', d.grade || 'none yet'],
    ['Training', d.training ? `${d.training} of 10 (+${d.training * 10}% health and attack)` : 'none yet'],
    ['Multikills', kills(d.triples, d.quadras) + (d.pentas ? `${d.triples || d.quadras ? ', ' : ''}${plural(d.pentas, 'penta')}` : '') || 'none yet'],
    ['Pentakill ultimate', d.pentas ? 'yes: hits the whole wave in a raid' : 'no (needs a pentakill on it)']];
  $('#quarterDetail').innerHTML = `<div class="uqpick" role="group" aria-label="Defenders">${p.squad.map(x=>`<button class="ghost ${x.champion === d.champion ? 'on' : ''}" data-qsel="${esc(x.champion)}" aria-pressed="${x.champion === d.champion}">${champIcon(x.champion)}${esc(x.champion)}</button>`).join('')}</div>
    <div class="uqd"><div>
      <div class="uqd-head"><canvas id="qPreview" width="48" height="48"></canvas>${champIcon(d.champion)}<div><b>${esc(d.champion)} ${stars(d.star)}</b><span>${CLASS_NAME[d.cls]} · Lv ${d.level}${hatOf(p, d.champion) ? ` · wearing a ${esc(U.hatShop.find(h=>h.id === hatOf(p, d.champion)).name.toLowerCase())}` : ''}</span></div></div>
      <h3>Stats</h3><table class="uqstats">${rows.map(([k, v])=>`<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>
      <p class="unote">Stats come from ${esc(shortName(p.riotId))}'s own games on ${esc(d.champion)}: games set its level, win rate its health, KDA its attack, S grades its stars.</p>
    </div><div><h3>Hats</h3><div class="uhats">${U.hatShop.map(h=>{
      const owned = mineHats.owned.includes(h.id), on = mineHats.on === h.id;
      const btn = on ? `<button class="ghost" data-hat="${h.id}" data-op="off" ${own ? '' : 'disabled'}>Take off</button>`
        : owned ? `<button class="ghost" data-hat="${h.id}" data-op="wear" ${own ? '' : 'disabled'}>Wear</button>`
        : `<button data-hat="${h.id}" data-op="buy" data-hatbuy data-cost="${h.cost}" ${own && have >= h.cost ? '' : 'disabled'}>${pic('icon-breadcrumb')}${fmt(h.cost)}</button>`;
      return `<div class="uhat ${on ? 'on' : ''}">${pic('hat-' + h.id, 'pix', h.name)}<span>${esc(h.name)}</span>${btn}</div>`;
    }).join('')}</div>${own ? '<p class="unote">Hats belong to the champion: it keeps them even if it leaves the squad.</p>' : `<p class="unote">Only ${esc(shortName(p.riotId))} can buy hats here.</p>`}</div></div>`;
  const g = $('#qPreview').getContext('2d'); g.imageSmoothingEnabled = false;
  for(let y = 0; y < 48; y += 32) for(let x = 0; x < 48; x += 32) g.drawImage(art('tile-wood'), x, y, 32, 32);
  duckWithHat(g, d.cls, hatOf(p, d.champion), 8, 12, 32);
  affordable();
}
$('#quarterDetail').addEventListener('click', e=>{
  const pickBtn = e.target.closest('[data-qsel]');
  if(pickBtn){ qSel = pickBtn.dataset.qsel; renderQuarter(); return; }
  const h = e.target.closest('[data-hat]');
  if(h) act({action: 'hat', champion: qSel, hat: h.dataset.hat, op: h.dataset.op});
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
  $('#raids').innerHTML = `<p class="unote" style="margin-top:0">After every game you play together, the same wave of geese raids both Ducktopias, and each squad of five fights it automatically.
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
    // the Duck Infirmary, where ducklings grow, and the lost and found box
    sprite('building-infirmary', 8, 6, 64);
    label(`Infirmary ${p.ducklings.length}/${p.nestSpace}`, 40, 70);
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
  // clicking the Duck Infirmary or a district visits it
  const SPOTS = [{view: 'lab', x: 8, y: 6, w: 64, h: 76}, {view: 'plaza', x: 322, y: 196, w: 48, h: 66}, {view: 'quarter', x: 376, y: 196, w: 48, h: 66},
                 {view: 'volcano', x: 430, y: 196, w: 48, h: 66}];
  const spotAt = e => {
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    return SPOTS.find(o=>x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
  };
  cv.addEventListener('mousemove', e=>cv.classList.toggle('go', !!spotAt(e)));
  cv.addEventListener('click', e=>{ const o = spotAt(e); if(o) show(o.view); });
  window.addEventListener('resize', size);
  size(); requestAnimationFrame(draw);
  return {reset, size};
})();

// ---- Penta Plaza: one golden duck for each game with a pentakill, carrying that champion's banner ----
const PW = 480, PH = 200, FOUNTAIN = {x: PW / 2 - 32, y: 8, w: 64, h: 64}, MAX_PLAZA = 40;
const plaza = (()=>{
  const cv = $('#plazaScene'), g = cv.getContext('2d');
  let ducks = [], key = null, hover = null, t0 = performance.now();
  const icons = {};   // champion -> its icon, once loaded
  function icon(c){
    if(!ddVer) return null;
    if(!icons[c]){ icons[c] = new Image(); icons[c].src = champURL(c); }
    return icons[c].complete && icons[c].naturalWidth ? icons[c] : null;
  }
  function size(){
    const css = cv.clientWidth || PW, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr * PH / PW);
  }
  const spot = () => {   // somewhere to stand, clear of the fountain
    for(;;){
      const x = 12 + Math.random() * (PW - 60), y = 40 + Math.random() * (PH - 90);
      if(x + 48 < FOUNTAIN.x - 4 || x > FOUNTAIN.x + FOUNTAIN.w + 4 || y > FOUNTAIN.y + FOUNTAIN.h) return {x, y};
    }
  };
  function reset(){
    if(!U) return;
    const p = U.players[viewing], games = p.plaza || [];
    const k = viewing + ':' + games.map(x=>x.matchId).join(',');
    if(k === key) return;   // the same residents: let them keep walking
    key = k; hover = null;
    ducks = games.slice(-MAX_PLAZA).map(game=>{
      const at = spot(), to = spot();
      return {game, big: game.pentas > 1, x: at.x, y: at.y, tx: to.x, ty: to.y, wait: Math.random() * 3, face: 1, phase: Math.random() * 6};
    });
    const n = games.length, pentas = p.golden;
    cv.setAttribute('aria-label', n ? `Penta Plaza: ${plural(n, 'golden duck')}, ${games.map(x=>`${x.champion}${x.pentas > 1 ? ` (${x.pentas} pentakills)` : ''}`).join(', ')}` : 'Penta Plaza, locked');
    $('#plazaNote').textContent = n
      ? `${plural(n, 'game')} with a pentakill, ${plural(pentas, 'pentakill')} in all. Each golden duck carries the banner of the champion who scored it. A game with more than one pentakill makes one big duck with a crown and cape, worth a golden duck for each. Golden ducks collect ${U.goldenRate} breadcrumbs a minute each, no pond needed. Hover a duck to see its game.`
      : `Opens with your first pentakill together. Every game with a pentakill sends a golden duck here, carrying that champion's banner.`;
  }
  const dims = d => d.big ? {s: 48, pole: 36, fw: 24, fh: 26} : {s: 32, pole: 26, fw: 18, fh: 20};
  function bounds(d){   // the duck and its banner, for hovering
    const m = dims(d);
    return {x: d.x - 4, y: d.y + m.s * .4 - m.pole - 2, w: m.s + 8, h: m.s * .6 + m.pole + 2};
  }
  function label(text, x, y, color = '#fff'){
    g.font = 'bold 9px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.lineWidth = 3; g.strokeStyle = 'rgba(20,24,30,.85)'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
  }
  function banner(d, bob){   // a pole from the duck's back, and a flag with the champion's icon
    const m = dims(d), back = d.face > 0 ? d.x + m.s * .22 : d.x + m.s * .78;
    const top = Math.round(d.y + m.s * .42 - m.pole + bob), px = Math.round(back);
    g.fillStyle = '#6b4423'; g.fillRect(px - 1, top, 2, m.pole);
    g.fillStyle = '#fcc419'; g.fillRect(px - 2, top - 3, 4, 3);
    const fx = d.face > 0 ? px - m.fw - 1 : px + 1, fy = top + 1;   // the flag streams out behind
    g.fillStyle = d.big ? '#c92a2a' : '#c8aa6e'; g.fillRect(fx, fy, m.fw, m.fh);
    g.fillStyle = d.big ? '#fcc419' : '#8d6e2f'; g.fillRect(fx, fy + m.fh - 2, m.fw, 2);
    const is = m.fw - 4, ic = icon(d.game.champion);
    if(ic){ g.imageSmoothingEnabled = true; g.drawImage(ic, fx + 2, fy + 2, is, is); g.imageSmoothingEnabled = false; }
    else { g.fillStyle = '#1f2937'; g.fillRect(fx + 2, fy + 2, is, is); }
    if(d.big) label(`×${d.game.pentas}`, fx + m.fw / 2, fy + m.fh + 1, '#ffe066');
  }
  function draw(now){
    requestAnimationFrame(draw);
    if(!U) return;
    const dt = Math.min((now - t0) / 1000, .1); t0 = now;
    const k = cv.width / PW;
    g.setTransform(k, 0, 0, k, 0, 0); g.imageSmoothingEnabled = false;
    for(let y = 0; y < PH; y += 32) for(let x = 0; x < PW; x += 32) g.drawImage(art('tile-plaza'), x, y, 32, 32);
    g.drawImage(art('plaza-fountain'), FOUNTAIN.x, FOUNTAIN.y, FOUNTAIN.w, FOUNTAIN.h);
    if(!ducks.length){
      g.fillStyle = 'rgba(20,24,30,.45)'; g.fillRect(0, 0, PW, PH);
      label('🔒', PW / 2, 92); label('Opens with your first pentakill together', PW / 2, 110, '#ffe8cc');
      return;
    }
    ducks.forEach(d=>{   // stroll to a spot, stop a while, pick another; the hovered duck stands still
      if(d === hover) return;
      if(d.wait > 0){ d.wait -= dt; return; }
      const dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy), v = (d.big ? 9 : 13) * dt;
      if(dist <= v){ d.x = d.tx; d.y = d.ty; d.wait = 1.5 + Math.random() * 4; const to = spot(); d.tx = to.x; d.ty = to.y; return; }
      d.x += dx / dist * v; d.y += dy / dist * v;
      if(Math.abs(dx) > 1) d.face = dx > 0 ? 1 : -1;
    });
    [...ducks].sort((a, b)=>(a.y + dims(a).s) - (b.y + dims(b).s)).forEach(d=>{
      const m = dims(d), walking = d.wait <= 0 && d !== hover;
      const bob = walking ? -Math.abs(Math.sin(now / 140 + d.phase)) * 1.5 : 0;
      g.fillStyle = 'rgba(80,55,10,.25)'; g.fillRect(Math.round(d.x + m.s * .2), Math.round(d.y + m.s * .84), Math.round(m.s * .6), 3);   // shadow
      if(d === hover){ g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(Math.round(d.x + m.s * .1), Math.round(d.y + m.s * .82), Math.round(m.s * .8), 5); }
      banner(d, bob);
      g.save();
      const x = Math.round(d.x), y = Math.round(d.y + bob);
      if(d.face < 0){ g.translate(x + m.s / 2, 0); g.scale(-1, 1); g.translate(-x - m.s / 2, 0); }
      g.drawImage(art(d.big ? 'duck-golden-champion' : 'duck-golden'), x, y, m.s, m.s);
      g.restore();
      if(d.big) for(let i = 0; i < 3; i++){   // sparkles
        const a = now / 700 + i * 2.1 + d.phase, on = Math.sin(now / 180 + i * 1.7 + d.phase) > .2;
        if(on){ g.fillStyle = i % 2 ? '#fff' : '#ffe066'; g.fillRect(Math.round(d.x + m.s / 2 + Math.cos(a) * m.s * .55), Math.round(d.y + m.s * .55 + Math.sin(a) * m.s * .35), 2, 2); }
      }
    });
    const extra = (U.players[viewing].plaza || []).length - ducks.length;
    if(extra > 0) label(`+${extra} more`, PW - 30, PH - 14, '#fff3bf');
  }
  // hover cards for the ducks (drawn here, not by showTip, since they move)
  const day = ts => ts ? new Date(ts).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : 'an earlier game';
  function card(game){
    const n = game.pentas;
    return `<b class="ugold">${n > 1 ? `${n} pentakills` : 'Pentakill'} on ${esc(game.champion)}</b>
      <p>${day(game.start)} · ${game.win ? 'Win' : 'Loss'} · ${game.kills}/${game.deaths}/${game.assists}${game.grade ? ` · ${esc(game.grade)}` : ''}</p>
      <p>${n > 1 ? `More than one pentakill in one game: this duck counts as ${n} golden ducks, ${n * U.goldenRate} breadcrumbs a minute.` : `Collects ${U.goldenRate} breadcrumbs a minute.`}</p>`;
  }
  function hideCard(){ if(hover){ hover = null; tip.classList.remove('on'); cv.classList.remove('over'); } }
  cv.addEventListener('mousemove', e=>{
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * PW / r.width, y = (e.clientY - r.top) * PH / r.height;
    const hit = [...ducks].sort((a, b)=>b.y - a.y).find(d=>{ const o = bounds(d); return x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h; });
    if(!hit){ hideCard(); return; }
    if(hit !== hover){ hover = hit; tip.innerHTML = card(hit.game); tip.classList.add('on'); cv.classList.add('over'); }
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let ty = e.clientY - h - 16; if(ty < 8) ty = e.clientY + 20;
    tip.style.left = Math.min(Math.max(8, e.clientX - w / 2), innerWidth - w - 8) + 'px'; tip.style.top = ty + 'px';
  });
  cv.addEventListener('mouseleave', hideCard);
  addEventListener('scroll', hideCard, {passive: true, capture: true});
  window.addEventListener('resize', size);
  size(); requestAnimationFrame(draw);
  return {reset, size};
})();
// ---- the Duck Infirmary: a lab whose nests are fluid chambers, one duckling growing in each ----
const LW = 480, LH = 200;
const lab = (()=>{
  const cv = $('#labScene'), g = cv.getContext('2d');
  let hover = -1;
  function size(){   // (also called when the lab is shown)
    hover = -1;
    const css = cv.clientWidth || LW, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr * LH / LW);
  }
  function reset(){
    if(!U) return;
    const p = U.players[viewing];
    cv.setAttribute('aria-label', `Duck Infirmary: ${p.ducklings.length} of ${p.nestSpace} nests have a duckling growing`);
  }
  function label(text, x, y, color = '#fff', align = 'center'){
    g.font = 'bold 9px ui-monospace, Menlo, monospace'; g.textAlign = align; g.textBaseline = 'top';
    g.lineWidth = 3; g.strokeStyle = 'rgba(10,20,26,.9)'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
  }
  // where each chamber goes: one row of up to 13, a second row beyond that, shrunk to fit
  function layout(n){
    const cols = Math.min(n, 13), rows = Math.ceil(n / cols), gap = 26;
    const k = Math.min(1, (LW - 24) / (cols * 40 + (cols - 1) * gap), ((LH - 66) / rows - 14) / 112);
    const w = 40 * k, h = 112 * k, x0 = (LW - (cols * w + (cols - 1) * gap * k)) / 2;
    return Array.from({length: n}, (_, i)=>({x: x0 + (i % cols) * (w + gap * k), y: 44 + Math.floor(i / cols) * (h + 14), w, h, k}));
  }
  const left = (p, i) => Math.max(0, p.ducklings[i] - nowApp());
  const progress = (p, i) => Math.min(1, Math.max(0, 1 - left(p, i) / (p.lab.grow * 60000)));
  function chamber(c, growing, prog, now, i){   // drawn at full size (40x112), scaled by c.k
    g.save(); g.translate(c.x, c.y); g.scale(c.k, c.k);
    const top = 10, h = 86, fy = top + h * (growing ? 0 : .75);
    g.fillStyle = 'rgba(10,25,32,.7)'; g.fillRect(4, top, 32, h);                                   // inside the glass
    g.fillStyle = growing ? (prog >= 1 ? 'rgba(99,230,190,.6)' : 'rgba(116,192,252,.6)') : 'rgba(73,80,87,.45)';
    g.fillRect(5, fy, 30, top + h - fy);                                                              // the fluid
    for(let b = 0; b < 4; b++){                                                                       // bubbles rising
      const rise = (now / 1000 * (growing ? 14 : 6) + b * 23 + i * 11) % (top + h - fy);
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(9 + ((b * 7 + i * 5) % 22), Math.round(top + h - rise - 2), 2, 2);
    }
    if(growing){   // an egg at first, then a duckling that gets bigger
      const bob = Math.sin(now / 600 + i) * 3, cy = top + h / 2;
      if(prog < .3){ const sz = Math.round(10 + 20 * prog); g.drawImage(art('egg'), Math.round(20 - sz / 2), Math.round(cy - sz / 2 + bob), sz, sz); }
      else { const sz = Math.round(14 + 14 * (prog - .3) / .7); g.drawImage(art('duckling'), Math.round(20 - sz / 2), Math.round(cy - sz / 2 + bob), sz, sz); }
    }
    g.drawImage(art('lab-chamber'), 0, 0, 40, 112);
    g.fillStyle = growing ? '#fcc419' : '#495057'; g.fillRect(18, 104, 4, 3);                        // a status light
    if(i === hover){ g.strokeStyle = '#c5f6fa'; g.lineWidth = 2; g.strokeRect(-1, -1, 42, 114); }
    g.restore();
  }
  const short = ms => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`; };
  function draw(now){
    requestAnimationFrame(draw);
    if(!U || view !== 'lab') return;
    const p = U.players[viewing], L = p.lab;
    const k = cv.width / LW;
    g.setTransform(k, 0, 0, k, 0, 0); g.imageSmoothingEnabled = false;
    for(let y = 0; y < LH; y += 32) for(let x = 0; x < LW; x += 32) g.drawImage(art('lab-tile'), x, y, 32, 32);
    g.fillStyle = '#16303a'; g.fillRect(0, 0, LW, 36); g.fillStyle = '#2b5563'; g.fillRect(0, 36, LW, 2);   // the back wall
    const cs = layout(p.nestSpace);
    cs.forEach((c, i)=>{
      g.fillStyle = '#5c636a'; g.fillRect(Math.round(c.x + c.w / 2 - 2), 30, 4, Math.round(c.y - 30));      // pipes from the ceiling
      const growing = i < p.ducklings.length;
      chamber(c, growing, growing ? progress(p, i) : 0, now, i);
      if(c.k >= .6) label(growing ? short(left(p, i)) : 'empty', c.x + c.w / 2, c.y + c.h + 3, growing ? '#ffe066' : '#adb5bd');
    });
    g.fillStyle = '#5c636a'; g.fillRect(0, 29, LW, 3);
    const free = p.nestSpace - p.ducklings.length - p.lost;
    label(free > 0 ? `${free} free nest${free === 1 ? '' : 's'}: spawn a duckling below` : 'Every nest is full: upgrade the nests to spawn more',
          LW / 2, 10, free > 0 ? '#c5f6fa' : '#ffd8a8');
    label(`${p.spawned} spawned so far`, 10, LH - 14, '#dee2e6', 'left');
    label(`Ducklings grow in ${fmtMin(L.grow)}`, LW - 10, LH - 14, '#dee2e6', 'right');
  }
  // hover a chamber to see how long its duckling has left
  cv.addEventListener('mousemove', e=>{
    const p = U && U.players[viewing]; if(!p) return;
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * LW / r.width, y = (e.clientY - r.top) * LH / r.height;
    hover = layout(p.nestSpace).findIndex(c=>x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
    if(hover < 0){ tip.classList.remove('on'); return; }
    tip.innerHTML = hover < p.ducklings.length
      ? `<b>A duckling, growing</b><p>Becomes a duck in ${fmtMin(left(p, hover) / 60000)} (${Math.floor(progress(p, hover) * 100)}% grown), then moves to the pond.</p>`
      : `<b>An empty nest</b><p>Spawn a duckling to fill it.</p>`;
    tip.classList.add('on');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let ty = e.clientY - h - 16; if(ty < 8) ty = e.clientY + 20;
    tip.style.left = Math.min(Math.max(8, e.clientX - w / 2), innerWidth - w - 8) + 'px'; tip.style.top = ty + 'px';
  });
  cv.addEventListener('mouseleave', ()=>{ hover = -1; tip.classList.remove('on'); });
  window.addEventListener('resize', size);
  size(); requestAnimationFrame(draw);
  return {reset, size};
})();

// ---- the Champion Quarter: a lounge where the defenders rest ----
const QW = 480, QH = 220;
const SEATS = [   // where each defender rests: the duck's top-left at 32px, and how
  {x: 44, y: 86, how: 'sofa'}, {x: 92, y: 86, how: 'sofa'}, {x: 346, y: 100, how: 'armchair'},
  {x: 76, y: 150, how: 'beanbag'}, {x: 236, y: 124, how: 'asleep'},
];
const quarter = (()=>{
  const cv = $('#quarterScene'), g = cv.getContext('2d');
  let hover = -1;
  function size(){   // (also called when the lounge is shown)
    hover = -1;
    const css = cv.clientWidth || QW, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr * QH / QW);
  }
  function reset(){
    if(!U) return;
    const p = U.players[viewing];
    cv.setAttribute('aria-label', `Champion Quarter: ${p.squad.map(d=>d.champion).join(', ') || 'no defenders yet'}, resting in the lounge`);
  }
  function label(text, x, y, color = '#fff'){
    g.font = 'bold 9px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.lineWidth = 3; g.strokeStyle = 'rgba(30,16,10,.9)'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
  }
  function draw(now){
    requestAnimationFrame(draw);
    if(!U || view !== 'quarter') return;
    const p = U.players[viewing], k = cv.width / QW;
    g.setTransform(k, 0, 0, k, 0, 0); g.imageSmoothingEnabled = false;
    // the room: wallpaper, a skirting board, a wooden floor and a rug
    for(let y = 0; y < 84; y += 32) for(let x = 0; x < QW; x += 32) g.drawImage(art('tile-wallpaper'), x, y, 32, 32);
    for(let y = 84; y < QH; y += 32) for(let x = 0; x < QW; x += 32) g.drawImage(art('tile-wood'), x, y, 32, 32);
    g.fillStyle = '#4a2a1a'; g.fillRect(0, 80, QW, 5);
    g.fillStyle = '#9c2f3f'; g.fillRect(160, 138, 170, 58); g.fillStyle = '#c8aa6e'; g.fillRect(164, 142, 162, 2); g.fillRect(164, 190, 162, 2);
    // furniture
    g.drawImage(art('lounge-window'), 380, 8, 64, 64);
    g.drawImage(art('lounge-fireplace'), 196, -4, 96, 96);
    const flick = Math.sin(now / 90) + Math.sin(now / 37);
    [['#e8590c', 0, 14], ['#ff922b', 3, 10], ['#ffd43b', 6, 5]].forEach(([c, inset, h])=>{
      g.fillStyle = c; g.fillRect(228 + inset, 78 - h - Math.round(flick), 32 - inset * 2, h + Math.round(flick));
    });
    const glow = g.createRadialGradient(244, 80, 4, 244, 80, 120);
    glow.addColorStop(0, 'rgba(255,170,70,.22)'); glow.addColorStop(1, 'rgba(255,170,70,0)');
    g.fillStyle = glow; g.fillRect(124, 0, 240, 200);
    g.drawImage(art('lounge-plant'), 150, 40, 48, 48);
    g.drawImage(art('lounge-plant'), 432, 108, 48, 48);
    g.drawImage(art('lounge-sofa'), 24, 58, 96, 96);
    g.drawImage(art('lounge-armchair'), 330, 72, 64, 64);
    g.drawImage(art('lounge-beanbag'), 68, 146, 48, 48);
    g.drawImage(art('lounge-table'), 212, 150, 64, 64);
    if(!p.districts.includes('champion')){
      g.fillStyle = 'rgba(20,12,8,.55)'; g.fillRect(0, 0, QW, QH);
      label('🔒', QW / 2, 96); label('Opens with your first S grade together', QW / 2, 114, '#ffe8cc');
      return;
    }
    // the defenders, resting
    const sel = quarterPick(p);
    p.squad.slice(0, SEATS.length).forEach((d, i)=>{
      const st = SEATS[i], asleep = st.how === 'asleep', bob = asleep ? Math.sin(now / 900 + i) * .8 : Math.sin(now / 700 + i * 1.3) * 1.2;
      if(i === hover || d === sel){ g.fillStyle = d === sel ? 'rgba(255,212,59,.35)' : 'rgba(255,255,255,.25)'; g.fillRect(st.x + 2, st.y + 28, 28, 4); }
      duckWithHat(g, d.cls, hatOf(p, d.champion), st.x, st.y + bob, 32);
      if(asleep) [0, 1, 2].forEach(z=>{   // z z z, drifting up
        const t = (now / 1400 + z / 3) % 1;
        g.globalAlpha = 1 - t; label('z', st.x + 30 + t * 10 + z * 2, st.y - 4 - t * 18, '#e7f5ff'); g.globalAlpha = 1;
      });
      if(d === sel){ g.fillStyle = '#ffd43b'; const ay = st.y - 14 + Math.round(Math.abs(Math.sin(now / 250)) * -3); g.fillRect(st.x + 13, ay, 6, 2); g.fillRect(st.x + 14, ay + 2, 4, 2); g.fillRect(st.x + 15, ay + 4, 2, 2); }
      label(d.champion, st.x + 16, st.y + 33, d === sel ? '#ffe066' : '#fff3e0');
    });
  }
  const seatAt = e => {
    const p = U && U.players[viewing]; if(!p || !p.districts.includes('champion')) return -1;
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * QW / r.width, y = (e.clientY - r.top) * QH / r.height;
    return p.squad.slice(0, SEATS.length).findIndex((d, i)=>x >= SEATS[i].x && x < SEATS[i].x + 32 && y >= SEATS[i].y - 6 && y < SEATS[i].y + 44);
  };
  cv.addEventListener('mousemove', e=>{ hover = seatAt(e); cv.classList.toggle('over', hover >= 0); });
  cv.addEventListener('mouseleave', ()=>{ hover = -1; });
  cv.addEventListener('click', e=>{
    const i = seatAt(e); if(i < 0) return;
    qSel = U.players[viewing].squad[i].champion; renderQuarter();
  });
  window.addEventListener('resize', size);
  size(); requestAnimationFrame(draw);
  return {reset, size};
})();

// ---- the Volcano Spa: one fire duck for each game with an S+, soaking in hot springs under a smoking volcano ----
const VW = 480, VH = 220, MAX_SPA = 45;
const POOLS = [{cx: 100, cy: 170, rx: 72, ry: 25}, {cx: 246, cy: 190, rx: 84, ry: 22}, {cx: 392, cy: 168, rx: 70, ry: 25}];
const volcano = (()=>{
  const cv = $('#volcanoScene'), g = cv.getContext('2d');
  let ducks = [], key = null, hover = null, t0 = performance.now();
  function size(){
    hover = null;
    const css = cv.clientWidth || VW, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr * VH / VW);
  }
  function reset(){
    if(!U) return;
    const p = U.players[viewing], games = p.volcano || [];
    const k = viewing + ':' + games.map(x=>x.matchId).join(',');
    if(k === key) return;   // the same residents: let them keep soaking
    key = k; hover = null;
    ducks = games.slice(-MAX_SPA).map((game, i)=>{
      const pool = POOLS[i % POOLS.length], a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * .6;
      return {game, pool, x: pool.cx + Math.cos(a) * pool.rx * r - 12, y: pool.cy + Math.sin(a) * pool.ry * r - 12,
              vx: (Math.random() < .5 ? -1 : 1) * (2 + Math.random() * 3), phase: Math.random() * 6};
    });
    cv.setAttribute('aria-label', games.length ? `Volcano Spa: ${plural(games.length, 'fire duck')}, from S+ games on ${games.map(x=>x.champion).join(', ')}` : 'Volcano Spa, locked');
  }
  function label(text, x, y, color = '#fff'){
    g.font = 'bold 9px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.lineWidth = 3; g.strokeStyle = 'rgba(24,10,8,.9)'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
  }
  function draw(now){
    requestAnimationFrame(draw);
    if(!U || view !== 'volcano') return;
    const dt = Math.min((now - t0) / 1000, .1); t0 = now;
    const k = cv.width / VW;
    g.setTransform(k, 0, 0, k, 0, 0); g.imageSmoothingEnabled = false;
    // a smoky evening sky, and the volcano's glow
    const sky = g.createLinearGradient(0, 0, 0, 120);
    sky.addColorStop(0, '#24152b'); sky.addColorStop(1, '#7a2e1f'); g.fillStyle = sky; g.fillRect(0, 0, VW, 120);
    const glow = g.createRadialGradient(240, 34, 4, 240, 34, 150);
    glow.addColorStop(0, `rgba(255,120,40,${.38 + Math.sin(now / 700) * .06})`); glow.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = glow; g.fillRect(80, 0, 320, 140);
    g.drawImage(art('volcano-peak'), 160, -26, 160, 160);
    // smoke rising from the crater
    for(let i = 0; i < 6; i++){
      const t = (now / 5200 + i / 6) % 1, x = 240 + Math.sin(t * 5 + i) * 10 + t * 30, y = 34 - t * 60, r = 4 + t * 14;
      g.fillStyle = `rgba(120,108,112,${.5 * (1 - t)})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // sparks flying out
    for(let i = 0; i < 8; i++){
      const t = (now / 1300 + i * .37) % 1, dir = i % 2 ? 1 : -1;
      g.fillStyle = i % 3 ? '#ffd43b' : '#ff6b1a';
      g.fillRect(Math.round(240 + dir * (8 + i * 3) * t), Math.round(36 - 34 * t + 50 * t * t), 2, 2);
    }
    // volcanic ground, and the hot springs
    for(let y = 112; y < VH; y += 32) for(let x = 0; x < VW; x += 32) g.drawImage(art('tile-volcanic'), x, y, 32, 32);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 112, VW, 3);
    POOLS.forEach((o, i)=>{
      g.fillStyle = '#2b2326'; g.beginPath(); g.ellipse(o.cx, o.cy, o.rx + 6, o.ry + 5, 0, 0, Math.PI * 2); g.fill();
      const w = g.createRadialGradient(o.cx, o.cy - 4, 4, o.cx, o.cy, o.rx);
      w.addColorStop(0, '#9be7e2'); w.addColorStop(.6, '#4fb3bf'); w.addColorStop(1, '#2b8a99');
      g.fillStyle = w; g.beginPath(); g.ellipse(o.cx, o.cy, o.rx, o.ry, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,140,60,.18)'; g.beginPath(); g.ellipse(o.cx, o.cy - o.ry * .45, o.rx * .7, o.ry * .25, 0, 0, Math.PI * 2); g.fill();   // the lava's glow on the water
      for(let s = 0; s < 4; s++){   // steam
        const t = (now / 3000 + s / 4 + i * .2) % 1, x = o.cx - o.rx * .6 + s * o.rx * .4 + Math.sin(t * 6 + s) * 4;
        g.fillStyle = `rgba(255,255,255,${.3 * (1 - t)})`; g.fillRect(Math.round(x), Math.round(o.cy - 6 - t * 30), 3, 3);
      }
    });
    if(!ducks.length){
      g.fillStyle = 'rgba(20,10,8,.5)'; g.fillRect(0, 0, VW, VH);
      label('🔒', VW / 2, 92); label('Opens with your first S+ together', VW / 2, 110, '#ffe8cc');
      return;
    }
    // the fire ducks, soaking (the hovered one stays put)
    ducks.forEach(d=>{
      if(d === hover) return;
      d.x += d.vx * dt;
      const o = d.pool, ex = (d.x + 12 - o.cx) / (o.rx * .78), ey = (d.y + 12 - o.cy) / (o.ry * .62);
      if(ex * ex + ey * ey > 1){ d.vx = -d.vx; d.x += d.vx * dt * 2; }
      if(Math.random() < .002) d.vx = -d.vx;
    });
    [...ducks].sort((a, b)=>a.y - b.y).forEach(d=>{
      const bob = Math.sin(now / 500 + d.phase) * 1.2, x = Math.round(d.x), y = Math.round(d.y + bob);
      if(d === hover){ g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.ellipse(x + 12, y + 18, 14, 4, 0, 0, Math.PI * 2); g.fill(); }
      g.save();
      if(d.vx < 0){ g.translate(x + 12, 0); g.scale(-1, 1); g.translate(-x - 12, 0); }
      g.drawImage(art('duck-fire'), 0, 0, 32, 24, x, y, 24, 18);   // soaking: no feet
      g.restore();
      if(Math.sin(now / 160 + d.phase * 3) > .6){ g.fillStyle = '#ffd43b'; g.fillRect(x + 12 + Math.round(Math.sin(d.phase) * 3), y - 3, 2, 2); }   // an ember
    });
    const extra = (U.players[viewing].volcano || []).length - ducks.length;
    if(extra > 0) label(`+${extra} more`, VW - 30, VH - 14, '#ffe8cc');
  }
  // hover cards for the ducks (drawn here, not by showTip, since they move)
  function hideCard(){ if(hover){ hover = null; tip.classList.remove('on'); cv.classList.remove('over'); } }
  cv.addEventListener('mousemove', e=>{
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * VW / r.width, y = (e.clientY - r.top) * VH / r.height;
    const hit = [...ducks].sort((a, b)=>b.y - a.y).find(d=>x >= d.x - 2 && x < d.x + 26 && y >= d.y - 4 && y < d.y + 20);
    if(!hit){ hideCard(); return; }
    if(hit !== hover){ hover = hit; tip.innerHTML = fireCard(hit.game); tip.classList.add('on'); cv.classList.add('over'); }
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let ty = e.clientY - h - 16; if(ty < 8) ty = e.clientY + 20;
    tip.style.left = Math.min(Math.max(8, e.clientX - w / 2), innerWidth - w - 8) + 'px'; tip.style.top = ty + 'px';
  });
  cv.addEventListener('mouseleave', hideCard);
  addEventListener('scroll', hideCard, {passive: true, capture: true});
  window.addEventListener('resize', size);
  size(); requestAnimationFrame(draw);
  return {reset, size};
})();
const fireDay = ts => ts ? new Date(ts).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : 'an earlier game';
function fireCard(game){
  return `<b class="ufire">S+ on ${esc(game.champion)}</b>
    <p>${fireDay(game.start)} · ${game.win ? 'Win' : 'Loss'} · ${game.kills}/${game.deaths}/${game.assists}</p>
    <p>A fire duck: collects ${U.fireRate} breadcrumbs a minute, no pond needed.</p>`;
}
// every fire duck, newest first, under the scene
function renderVolcano(){
  const p = U.players[viewing], games = p.volcano || [];
  $('#volcanoNote').textContent = games.length
    ? `${plural(games.length, 'fire duck')}, one for each game with an S+. Each collects ${U.fireRate} breadcrumbs a minute, wherever it is. Hover a duck to see its game.`
    : 'Opens with your first S+ together. Every game with an S+ sends a fire duck here to soak in the hot springs.';
  $('#volcanoList').innerHTML = games.length ? `<div class="uvlist">${games.slice().reverse().map(x=>`<div class="uvduck" tabindex="0" data-tip-html="${esc(fireCard(x))}">
      ${pic('duck-fire')}${champIcon(x.champion)}<div><b>${esc(x.champion)}</b><span>${fireDay(x.start)} · ${x.win ? 'Win' : 'Loss'} · ${x.kills}/${x.deaths}/${x.assists}</span></div></div>`).join('')}</div>` : '';
}

// ---- a pop-up when a new fire duck arrives (either of you). The main page shows the same one; whichever page sees it
// first marks it seen in this browser, so it only pops up once.
const FIRE_SEEN = 'ducktopia_fire_seen';
function checkFireDucks(){
  let seen; try{ seen = JSON.parse(store.get(FIRE_SEEN) || '{}') || {}; }catch(e){ seen = {}; }
  const gained = [];
  U.players.forEach((p, i)=>{
    const k = p.riotId.toLowerCase();
    if(seen[k] != null && p.fire > seen[k]) gained.push({p, i, n: p.fire - seen[k]});
    seen[k] = p.fire;
  });
  store.set(FIRE_SEEN, JSON.stringify(seen));
  if(!gained.length) return;
  const t = document.createElement('div'); t.className = 'toast firetoast'; t.setAttribute('role', 'status');
  t.innerHTML = `<button class="toastx" aria-label="Dismiss" title="Dismiss">×</button><b>🔥 New fire duck!</b>${gained.map(({p, i, n})=>{
      const champs = (p.volcano || []).slice(-n).map(x=>x.champion);
      return `<div class="uvtoast">${pic('duck-fire')}<span><b>${i === U.me ? 'You' : esc(shortName(p.riotId))}</b> earned ${n > 1 ? `${n} fire ducks` : 'a fire duck'}${champs.length ? ` with an S+ on ${esc(champs.join(', '))}` : ''}</span></div>`;
    }).join('')}<button class="toastbtn" data-visit-volcano="${gained[0].i}">Visit the Volcano Spa</button>`;
  document.body.appendChild(t); requestAnimationFrame(()=>t.classList.add('on'));
  const close = () => { t.classList.remove('on'); setTimeout(()=>t.remove(), 400); };
  setTimeout(close, 15000);
  t.addEventListener('click', e=>{
    if(e.target.closest('.toastx')) return close();
    const v = e.target.closest('[data-visit-volcano]'); if(!v) return;
    viewing = +v.dataset.visitVolcano; store.set('utopia_view', viewing);
    renderPanels(); scene.reset(); plaza.reset(); lab.reset(); quarter.reset(); volcano.reset();
    show('volcano'); close(); $('#volcano').scrollIntoView({behavior: 'smooth', block: 'start'});
  });
}

// Penta Plaza, the Duck Infirmary, the Champion Quarter and the Volcano Spa take the place of the utopia scene,
// each with a button back
const VIEWS = {town: () => scene, plaza: () => plaza, lab: () => lab, quarter: () => quarter, volcano: () => volcano};
let view = 'town';
function show(v){
  view = v;
  Object.keys(VIEWS).forEach(k=>$('#' + k).classList.toggle('hidden', k !== v));
  $('#townPanels').classList.toggle('hidden', v !== 'town');   // Build and Defenders: the main utopia's
  VIEWS[v]().size(); tip.classList.remove('on');
  if(v !== 'town') $('#' + v + ' [data-back]').focus({preventScroll: true});
}
document.addEventListener('click', e=>{ if(e.target.closest('[data-back]')) show('town'); });

// ---- Founding Day: the first look at each utopia replays your history together ----
function founding(){
  const p = U.players[U.me];
  if(!p || !p.founding) return;
  const key = `utopia_founded_${p.riotId.toLowerCase()}_${p.founded}`;
  if(store.get(key)) return;
  store.set(key, '1');
  const f = p.founding;
  const rows = [['icon-catchup', f.boosts, 'multikills became a permanent breadcrumb boost'],
                ['duck-golden', f.golden, `pentakill${f.golden === 1 ? '' : 's'}: golden ducks for Penta Plaza`],
                ['duck-fighter', f.champs, 'champions with an S grade joined the Champion Quarter'],
                ['duck-fire', f.fire, 'S+ grades lit up the Volcano Spa']].filter(r=>r[1] > 0);
  const box = $('#founding');
  box.innerHTML = `<div class="box"><canvas></canvas><h2 id="foundTitle">Founding Day</h2>
    <p>${f.games} games together, replayed. Your Ducktopia starts from your history.</p>
    <ul>${rows.map(([img, n, text], i)=>`<li style="animation-delay:${300 + i * 450}ms">${pic(img)}<b>${n}</b><span>${text}</span></li>`).join('')}</ul>
    <p>New ducks are spawned in the Duck Infirmary and grow in its nests, then move to the pond to collect breadcrumbs.</p>
    <button data-found-close>Enter your Ducktopia</button></div>`;
  box.classList.remove('hidden');
  box.querySelector('button').focus();
  // ducks raining down behind the list
  const cv = box.querySelector('canvas'), g = cv.getContext('2d');
  cv.width = 230; cv.height = 300;
  const drops = Array.from({length: Math.min(f.golden + f.fire + f.champs, 60)}, (_, i)=>({x: Math.random() * 214, y: -20 - i * 14, v: 40 + Math.random() * 40,
    name: i < f.golden ? 'duck-golden' : i < f.golden + f.fire ? 'duck-fire' : 'duck-fighter'}));
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
document.addEventListener('keydown', e=>{
  if(e.key !== 'Escape') return;
  if(!$('#founding').classList.contains('hidden')) $('#founding').classList.add('hidden');
  else if(view !== 'town') show('town');
});

load();
