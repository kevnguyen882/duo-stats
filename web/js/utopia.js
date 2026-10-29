// Ductopia (utopia.html): the race head to head, each player's utopia as a little pixel scene, and what you can do
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
  spa: [l=>l >= 2 ? 'spa-2-hotsprings' : 'spa-1-spa', (p)=>p.levels.spa >= 2 ? 'Two pools for recovery soaks (see the Spa panel), and a big boost to your Ductopia Score'
    : p.levels.spa ? 'A pool for recovery soaks (see the Spa panel); the Hot springs add a second' : 'Recovery soaks that refresh your defenders with perks, and a big boost to your Ductopia Score'],
  fence: [()=>'tile-mud', (p)=>p.levels.fence ? `Geese bite ${Math.round(Math.min(.06 * p.levels.fence, .5) * 100)}% softer in raids` : 'Goose defences: geese bite 6% softer a level in raids'],
};
const LAB = ['nests', 'incubation'];   // the Duck Infirmary's upgrades, shown in its lab rather than under Build
const ROOMS = [...LAB, 'bakery'];      // ... and the bakery's, in the Bakery
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
  scene.reset(); plaza.reset(); lab.reset(); bakeryRoom.reset(); quarter.reset(); volcano.reset(); spaRoom.reset();
  founding(); checkFireDucks();
  // the main page's fire duck pop-up links here: #volcano=<player index> opens that player's Volcano Spa
  const link = !openedFromLink && /^#volcano(?:=(\d))?$/.exec(location.hash);
  if(link){
    openedFromLink = true;
    if(link[1] && U.players[+link[1]] && +link[1] !== viewing){ viewing = +link[1]; renderPanels(); scene.reset(); plaza.reset(); lab.reset(); bakeryRoom.reset(); quarter.reset(); volcano.reset(); spaRoom.reset(); }
    show('volcano');
  }
}
let openedFromLink = false;
setInterval(load, 20000);
// when the next duckling is due to grow, ask straight away rather than waiting for the next check
setInterval(()=>{ if(U && U.players.some(p=>p.ducklings.length && p.ducklings[0] <= nowApp() || p.soaks.some(x=>x.until <= nowApp()) || Object.values(p.bakery.bakes).some(u=>u <= nowApp()))) load(); }, 5000);

// ---- drawing the panels ----
function renderPanels(){
  renderScore(); renderWhose(); renderResources(); renderBuild(); renderLab(); renderBakery(); renderQuarter(); renderVolcano(); renderSquad(); renderRaids(); renderGrounds(); renderSpa(); renderLog();
  if(tipEl && !tipEl.isConnected) showTip({target: document.body});   // what it was over has been redrawn
}
function renderScore(){
  const ps = U.players;
  $('#scoreboard').innerHTML = ps.map((p, i)=>`<div class="usd ${p.leading ? 'lead' : ''}" style="--c:${COLORS[i]}">
      <b>${esc(shortName(p.riotId))}${i === U.me ? ' (you)' : ''}</b>
      ${p.leading ? `<span class="crown">${pic('icon-crown')}Leading</span>` : ''}
      ${p.catchUp > 1 ? `<span class="boost" title="Catch-up boost: rewards from new games are multiplied while behind">${pic('icon-catchup')}×${p.catchUp}</span>` : ''}
      <div class="n">${fmt(p.score)}</div><div class="d">Ductopia Score · ${p.raidWins} raid${p.raidWins === 1 ? '' : 's'} won</div></div>`)
    .join(ps.length > 1 ? '<div class="uvs">VS</div>' : '');
  if(ps.length < 2) $('#scoreboard').style.gridTemplateColumns = '1fr';
}
function renderWhose(){
  $('#whose').innerHTML = U.players.map((p, i)=>`<button data-view="${i}" class="${viewing === i ? 'on' : ''}" aria-pressed="${viewing === i}">${esc(shortName(p.riotId))}'s Ductopia${i === U.me ? ' (you)' : ''}</button>`).join('');
}
$('#whose').addEventListener('click', e=>{
  const b = e.target.closest('[data-view]'); if(!b) return;
  viewing = +b.dataset.view; store.set('utopia_view', viewing); picking = false;
  renderPanels(); scene.reset(); plaza.reset(); lab.reset(); bakeryRoom.reset(); quarter.reset(); volcano.reset(); spaRoom.reset();
});

function growLeft(p){ return p.ducklings.length ? clock(p.ducklings[0] - nowApp()) : ''; }
function renderResources(){
  const p = U.players[viewing];
  // the breadcrumbs again, pinned to the corner so they're always in view (whoever's Ductopia is being looked at)
  $('#crumbPill').innerHTML = `${pic('icon-breadcrumb')}<b id="crumbsPill">${fmt(crumbsNow(p))}</b><span>${viewing === U.me ? 'breadcrumbs' : `${esc(shortName(p.riotId))}'s breadcrumbs`}</span>`;
  $('#crumbPill').classList.remove('hidden');
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
  $('#build').innerHTML = Object.entries(p.buildings).filter(([b])=>!ROOMS.includes(b)).map(([b, x])=>{
    const [img, what] = BUILD_INFO[b];
    return buildRow(b, x, p, own, img(Math.max(1, x.level)), what(p), x.next && x.level ? (x.next === x.name ? `level ${x.level + 1}` : x.next) : '');
  }).join('') + (own ? '' : `<p class="unote">Only ${esc(shortName(p.riotId))} can build here.</p>`)
    + '<p class="unote">The nests and spawning ducklings are in the Duck Infirmary, and the bakery and its machines in the Bakery: click them in your Ductopia.</p>';
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
  document.querySelectorAll('[data-build], [data-spawn], [data-hatbuy], [data-soak], [data-machine], [data-speed], [data-bake]').forEach(b=>{ b.disabled = busy || have < +b.dataset.cost || !!b.dataset.full; });
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
    ? 'Your five defenders rest here between goose raids. Click one to see its stats and buy it hats (just for looks). Choose who defends in the Defenders panel in your Ductopia.'
    : 'Opens with your first S-, S or S+ together. Your defenders will rest here between goose raids.';
  if(!d){ $('#quarterDetail').innerHTML = open ? '<p class="uempty">No defenders yet: play a game together first.</p>' : ''; return; }
  const mineHats = p.hats[d.champion] || {owned: [], on: null}, have = crumbsNow(p);
  const rows = [['Class', CLASS_NAME[d.cls]], ['Level', `${d.level} (from ${plural(d.games, 'game')} together${d.rank ? `, +${d.rank} from bosses in the Training Grounds` : ''})`], ['Health', `${d.hp} HP`],
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
      <div class="t"><b>${esc(d.champion)} ${stars(d.star)}</b><span>${CLASS_NAME[d.cls]} · Lv ${d.level} · ${d.hp} HP · ${d.atk} ATK${d.training ? ` · trained ${d.training}` : ''}${d.pentas ? ' · ultimate' : ''}${d.perk ? ` · <b class="uperk">♨ ${perkText(d.perk)}</b>` : ''}</span></div>
      ${own ? `<button class="ghost" data-train="${esc(d.champion)}" ${p.feathers < 2 + d.training || d.training >= 10 ? 'disabled' : ''} title="Training: +10% health and attack">Train ${pic('icon-feather')}${2 + d.training}</button>` : ''}
    </div>`).join('');
  const chosen = new Set(p.squad.map(d=>d.champion));
  const picker = picking ? `<div class="upick" id="picker">${p.champions.slice(0, 40).map(c=>`<label class="${chosen.has(c.champion) ? 'on' : ''}">
      <input type="checkbox" value="${esc(c.champion)}" ${chosen.has(c.champion) ? 'checked' : ''}>${pic('duck-' + c.cls)}${esc(c.champion)} <span style="color:var(--muted)">${c.games}</span></label>`).join('')}</div>
      <div class="ubtns"><button data-squad-save>Save squad</button><button class="ghost" data-squad-cancel>Cancel</button></div>` : '';
  $('#squad').innerHTML = list + (own ? (picking ? picker : '<div class="ubtns"><button class="ghost" data-squad-open>Change squad</button></div>')
    : `<p class="unote">${esc(shortName(p.riotId))}'s squad. Stats come from their own games on each champion.</p>`)
    + (p.soaks.length ? `<p class="unote">In the spa: ${p.soaks.map(x=>esc(x.champion)).join(', ')}. Fill-ins defend until they're out.</p>` : '')
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
  $('#raids').innerHTML = `<p class="unote" style="margin-top:0">After every game you play together, the same wave of geese raids both Ductopias, and each squad of five fights it automatically.
      A win brings breadcrumbs and goose feathers; a loss lets the geese steal some breadcrumbs. Buildings are never damaged.</p>
    ${latest ? `<div class="uraids">${ps.map((p, i)=>report(same[i], shortName(p.riotId), i)).join('')}</div>`
      : '<p class="uempty">No raids yet: the first one comes after your next game together.</p>'}
    ${practice ? `<h3 style="margin:14px 0 8px;font-size:14px">Practice raid</h3><div class="uraids">${report(practice, shortName(U.players[U.me].riotId), U.me)}</div>` : ''}
    ${U.players[U.me] && U.players[U.me].squad.length ? '<div class="ubtns"><button class="ghost" data-practice>Practice raid (nothing won or lost)</button></div>' : ''}`;
}
$('#raids').addEventListener('click', e=>{ if(e.target.closest('[data-practice]')) act({action: 'practice'}, true); });

// ---- the Training Grounds: a win on any champion earns it a challenge; beat the boss for a level ----
function fightReport(f, i){
  return `<div class="urep ${f.win ? '' : 'lost'}" style="--c:${COLORS[i] || COLORS[0]}">
    <h3><span class="who">${esc(f.champion)} vs ${esc(f.boss.name)}</span><span class="r">${f.win ? 'Level up!' : 'Beaten'}</span></h3>
    <div class="ugeese">${pic('duck-' + f.cls)}<img class="pix ${f.win ? 'gone' : ''}" src="${artURL('goose-king')}" alt="${esc(f.boss.name)}"></div>
    <div>${f.rounds} round${f.rounds === 1 ? '' : 's'} · boss level ${f.boss.level} · ${f.boss.hp} HP · ${f.boss.atk} ATK</div>
    <div class="rw">${f.win ? `${esc(f.champion)} is now level ${f.level}.` : `${esc(f.boss.name)} had ${f.bossLeft} health left. Win another game on ${esc(f.champion)} to try again.`}</div>
    <ol>${f.log.map(l=>`<li>${esc(l)}</li>`).join('')}</ol></div>`;
}
function renderGrounds(){
  const p = U.players[viewing], own = mine(), waiting = c => p.challenges.filter(x=>x === c).length;
  const row = d=>{
    const b = d.boss, n = d.maxRank ? 0 : waiting(d.champion), can = n > 0;
    const state = d.maxRank ? 'beat every boss' : can ? `${n > 1 ? `${n} challenges` : 'challenge'} ready: ${esc(b.name)} · ${b.hp} HP · ${b.atk} ATK` : 'win a game on it to earn a challenge';
    return `<div class="udef">${pic('duck-' + d.cls, 'duck pix')}${champIcon(d.champion)}
      <div class="t"><b>${esc(d.champion)}</b><span>Lv ${d.level}${d.rank ? ` (+${d.rank} from bosses)` : ''} · ${state}</span></div>
      ${own ? `<div class="ubtns">${can ? `<button data-challenge="${esc(d.champion)}">Challenge${n > 1 ? ` (${n})` : ''}</button>` : ''}<button class="ghost" data-spar="${esc(d.champion)}" title="A practice fight against the same boss: nothing won or lost">Test fight</button></div>` : ''}</div>`;
  };
  const others = p.challengers || [];   // champions off the squad with a challenge waiting
  const rows = p.squad.map(row).join('')
    + (others.length ? `<h3 class="uspah">Not defending</h3>${others.map(row).join('')}` : '');
  const last = p.bossFights[0];
  $('#grounds').innerHTML = `<p class="unote" style="margin-top:0">Win a game together on any champion and it earns a challenge here, whether it's one of your five defenders or not. Challenges add up, so two wins on the same champion mean two fights.
      Each challenge is a one-on-one fight against a boss built for that champion's level: win and it goes up a level for good; win or lose, the challenge is used up. Champions you aren't defending with show under Not defending while they have a challenge waiting.</p>
    ${p.squad.length ? rows : '<p class="uempty">No defenders yet: play a game together first.</p>'}
    ${last ? `<h3 style="margin:14px 0 8px;font-size:14px">Latest boss fight</h3><div class="uraids">${fightReport(last, viewing)}</div>
      ${last.steps ? '<div class="ubtns"><button class="ghost" data-replay>Watch it again</button></div>' : ''}` : ''}`;
}
$('#grounds').addEventListener('click', e=>{
  const c = e.target.closest('[data-challenge]'), sp = e.target.closest('[data-spar]');
  if(c) act({action: 'challenge', champion: c.dataset.challenge});
  else if(sp) act({action: 'spar', champion: sp.dataset.spar});
  else if(e.target.closest('[data-replay]')) playFight(U.players[viewing].bossFights[0]);
});

// ---- the Spa: recovery soaks with bath salts at three temperatures; fire ducks heat the water ----
const timeLeft = ms => ms >= 3600000 ? `${Math.floor(ms / 3600000)}h ${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}m` : clock(ms);
const PERK_WHAT = {eucalyptus: 'health', chili: 'attack', golden: 'raid rewards'};
const perkText = k => `+${Math.round(k.power * 100)}% ${PERK_WHAT[k.salt]}`;
const SALT_ART = {eucalyptus: 'duck-fighter', chili: 'duck-fire', golden: 'duck-golden'};
let soakPick = {champion: null, salt: 'eucalyptus', temp: 'warm'};
function renderSpa(){
  const p = U.players[viewing], own = mine(), pools = p.levels.spa;
  $('#spaTitle').textContent = pools >= 2 ? 'Hot springs' : 'Spa';
  const heatNote = `${plural(p.caught.length, 'caught fire duck')} from the Volcano Spa heat the water: every perk ${p.heat ? `is <b>${Math.round(p.heat * 100)}%</b> stronger` : 'gets stronger with each one'} (+5% a fire duck, up to +50%). Wild ones don't, until they're caught.`;
  if(!pools){
    $('#spaDetail').innerHTML = `<p class="unote">Build the Spa (in Build, back in your Ductopia) to open recovery soaks: a defender soaks with bath salts, sits out raids while it does,
      and comes out with a perk for its next goose raid or boss fight. Hotter water costs more and does more.</p><p class="unote">${heatNote}</p>`;
    return;
  }
  const busyC = new Set([...p.soaks.map(x=>x.champion), ...Object.keys(p.perks)]);
  const refreshed = Object.entries(p.perks);
  let html = `<p class="unote">A soak takes a defender out of raids for a while; it comes out refreshed with its salt's perk, which is used up by its next goose raid or boss fight
      (golden salts: its next raid). ${pools < 2 ? 'The Hot springs add a second pool.' : ''}</p>
    ${p.soaks.length ? `<h3 class="uspah">Soaking</h3>${p.soaks.map(x=>`<div class="udef">${pic(SALT_ART[x.salt], 'duck pix')}${champIcon(x.champion)}<div class="t"><b>${esc(x.champion)}</b><span>${U.temps.find(t=>t.id === x.temp).name} · ${esc(U.salts.find(s=>s.id === x.salt).name.toLowerCase())} · ${perkText(x)} · out in <strong data-until="${x.until}">${timeLeft(x.until - nowApp())}</strong></span></div></div>`).join('')}` : ''}
    ${refreshed.length ? `<h3 class="uspah">Refreshed</h3>${refreshed.map(([c, k])=>`<div class="udef">${pic(SALT_ART[k.salt], 'duck pix')}${champIcon(c)}<div class="t"><b>${esc(c)}</b><span>${perkText(k)} · for its next ${k.salt === 'golden' ? 'raid win' : 'raid or boss fight'}</span></div></div>`).join('')}` : ''}`;
  if(own){
    const squad = p.squad.map(d=>d.champion), others = p.champions.map(c=>c.champion).filter(c=>!squad.includes(c));
    const free = [...squad, ...others].filter(c=>!busyC.has(c));
    if(!free.includes(soakPick.champion)) soakPick.champion = free[0] || null;
    const temp = U.temps.find(t=>t.id === soakPick.temp), full = p.soaks.length >= pools;
    const power = (salt, t) => Math.round(t.power * (salt === 'golden' ? 2 : 1) * (1 + p.heat) * 100);
    const next = Math.min(...p.soaks.map(x=>x.until));
    html += `<h3 class="uspah">New soak</h3>${full ? `<p class="uempty">Every pool is taken: the next one is free in <b data-until="${next}">${timeLeft(next - nowApp())}</b>.</p>` : free.length ? `
      <label class="usel">Defender <select data-soak-champ>${free.map(c=>`<option ${c === soakPick.champion ? 'selected' : ''} value="${esc(c)}">${esc(c)}${squad.includes(c) ? '' : ' (not defending)'}</option>`).join('')}</select></label>
      <div class="uchoice" role="radiogroup" aria-label="Bath salts">${U.salts.map(s=>`<button class="ghost ${s.id === soakPick.salt ? 'on' : ''}" role="radio" aria-checked="${s.id === soakPick.salt}" data-salt="${s.id}">${pic(SALT_ART[s.id])}<b>${esc(s.name)}</b><span>${esc(s.does)}</span></button>`).join('')}</div>
      <div class="uchoice temps" role="radiogroup" aria-label="Temperature">${U.temps.map(t=>`<button class="ghost ${t.id} ${t.id === soakPick.temp ? 'on' : ''}" role="radio" aria-checked="${t.id === soakPick.temp}" data-temp="${t.id}"><b>${esc(t.name)}</b><span>+${power(soakPick.salt, t)}% ${PERK_WHAT[soakPick.salt]}</span><span>${pic('icon-breadcrumb')}${fmt(t.cost)} · ${timeLeft(t.minutes * 60000)}</span></button>`).join('')}</div>
      <div class="ubtns"><button data-soak data-cost="${temp.cost}">Start soak ${pic('icon-breadcrumb')}${fmt(temp.cost)}</button></div>`
      : '<p class="uempty">Every defender is soaking or already refreshed.</p>'}`;
  }
  $('#spaDetail').innerHTML = html;
  affordable();
}
$('#spaDetail').addEventListener('click', e=>{
  const s = e.target.closest('[data-salt]'), t = e.target.closest('[data-temp]');
  if(s){ soakPick.salt = s.dataset.salt; renderSpa(); }
  else if(t){ soakPick.temp = t.dataset.temp; renderSpa(); }
  else if(e.target.closest('[data-soak]')) act({action: 'soak', ...soakPick});
});
$('#spaDetail').addEventListener('change', e=>{ if(e.target.matches('[data-soak-champ]')) soakPick.champion = e.target.value; });

// the Spa's scene: its pools, coloured by temperature, with the soaking ducks bobbing in the steam, and the caught
// fire ducks from the Volcano Spa along the back, heating the water
const MAX_SPA_FIRE = 8;   // caught fire ducks drawn in the lava pool
const SPW = 480, SPH = 200, POOL_WATER = {warm: ['#74c0fc', '#4dabf7'], hot: ['#ffc078', '#ff922b'], scalding: ['#ff8787', '#fa5252']};
const spaRoom = (()=>{
  const cv = $('#spaScene'), g = cv.getContext('2d');
  function size(){   // (also called when the spa is shown)
    const css = cv.clientWidth || SPW, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr * SPH / SPW);
  }
  function reset(){
    if(!U) return;
    const p = U.players[viewing];
    cv.setAttribute('aria-label', !p.levels.spa ? 'The Spa: not built yet'
      : `The Spa: ${p.soaks.length ? p.soaks.map(x=>`${x.champion} soaking`).join(', ') : 'empty pools'}`);
  }
  function label(text, x, y, color = '#fff'){
    g.font = 'bold 9px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.lineWidth = 3; g.strokeStyle = 'rgba(16,24,32,.9)'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
  }
  function draw(now){
    requestAnimationFrame(draw);
    if(!U || view !== 'spa') return;
    const p = U.players[viewing], k = cv.width / SPW;
    g.setTransform(k, 0, 0, k, 0, 0); g.imageSmoothingEnabled = false;
    // stone floor and a back wall
    for(let y = 0; y < SPH; y += 32) for(let x = 0; x < SPW; x += 32) g.drawImage(art('tile-plaza'), x, y, 32, 32);
    g.fillStyle = '#5c4b3f'; g.fillRect(0, 0, SPW, 34); g.fillStyle = '#3d3029'; g.fillRect(0, 34, SPW, 4);
    label(p.caught.length ? `${plural(p.caught.length, 'fire duck')} in the lava pool, heating the water · perks +${Math.round(p.heat * 100)}%` : 'No fire ducks yet: catch one at the Volcano Spa to heat the water', SPW / 2, 40, '#ffd8a8');
    g.drawImage(art('lounge-plant'), 144, 164, 28, 28); g.drawImage(art('lounge-plant'), 308, 164, 28, 28);
    // the shared lava pool in the middle, where the caught fire ducks soak
    const lx = 176, ly = 62, lw = 128, lh = 98;
    const glow = g.createRadialGradient(lx + lw / 2, ly + lh / 2, 10, lx + lw / 2, ly + lh / 2, 110);
    glow.addColorStop(0, `rgba(255,120,40,${.28 + Math.sin(now / 700) * .05})`); glow.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = glow; g.fillRect(lx - 70, ly - 50, lw + 140, lh + 100);
    g.fillStyle = '#343a40'; g.fillRect(lx - 7, ly - 7, lw + 14, lh + 14);   // a basalt rim
    g.fillStyle = '#495057'; g.fillRect(lx - 7, ly - 7, lw + 14, 3);
    const lava = g.createLinearGradient(0, ly, 0, ly + lh); lava.addColorStop(0, '#e8590c'); lava.addColorStop(.5, '#c92a2a'); lava.addColorStop(1, '#8f1d1d');
    g.fillStyle = lava; g.fillRect(lx, ly, lw, lh);
    g.fillStyle = 'rgba(255,212,59,.4)';   // bright seams drifting across the top
    for(let c = 0; c < 5; c++){ const cx = lx + ((now / 60 + c * 41) % (lw - 20)), cy = ly + 10 + c * 18; g.fillRect(Math.round(cx), cy, 20, 3); g.fillRect(Math.round(cx) + 4, cy + 3, 10, 2); }
    for(let b = 0; b < 6; b++){   // bubbles that swell and pop
      const t = (now / 1300 + b / 6) % 1, bx = lx + 10 + ((b * 47) % (lw - 20)), by = ly + 14 + ((b * 29) % (lh - 28)), r = Math.round(1 + t * 4);
      g.globalAlpha = t < .85 ? .9 : (1 - t) * 6; g.fillStyle = '#fff3bf'; g.fillRect(bx - r, by - r, r * 2, r * 2); g.fillStyle = '#ff922b'; g.fillRect(bx - r + 1, by - r + 1, r * 2 - 2, r * 2 - 2); g.globalAlpha = 1;
    }
    const fire = p.caught.slice(0, MAX_SPA_FIRE), cols = Math.min(fire.length, 4);
    fire.forEach((c, j)=>{
      const row = Math.floor(j / 4), inRow = Math.min(4, fire.length - row * 4);
      const fx = lx + (j % 4 + .5) * lw / inRow - 10 + Math.sin(now / 1500 + j) * 3, fy = ly + 18 + row * 34 + Math.sin(now / 600 + j * 2) * 1.2, face = j % 2 ? -1 : 1;
      fireBanner(g, c, fx, fy, 20, face);
      g.save(); if(face < 0){ g.translate(fx + 10, 0); g.scale(-1, 1); g.translate(-fx - 10, 0); }
      g.drawImage(art('duck-fire'), 0, 0, 32, 24, Math.round(fx), Math.round(fy), 20, 15);   // in the lava: no feet
      g.restore();
      g.fillStyle = 'rgba(255,240,180,.55)'; g.fillRect(Math.round(fx), Math.round(fy) + 14, 20, 2);
    });
    if(p.caught.length > fire.length) label(`+${p.caught.length - fire.length} more`, lx + lw / 2, ly + lh - 12, '#fff3bf');
    if(!cols) label('Waiting for fire ducks', lx + lw / 2, ly + lh / 2 - 4, '#fff3bf');
    // the defenders' two smaller pools, one each side (the second opens with the Hot springs)
    [[22, 0], [338, 1]].forEach(([x, i])=>{
      const y = 70, pw = 120, ph = 96, open = p.levels.spa > i, soak = open ? p.soaks[i] : null;
      g.fillStyle = '#868e96'; g.fillRect(x - 6, y - 6, pw + 12, ph + 12);   // the stone rim
      g.fillStyle = '#ced4da'; g.fillRect(x - 6, y - 6, pw + 12, 3);
      if(!open){   // boarded over until the Hot springs are built
        for(let r = 0; r < ph; r += 12){ g.fillStyle = r % 24 ? '#7a4f26' : '#8b5a2b'; g.fillRect(x, y + r, pw, 10); }
        if(p.levels.spa){ label('🔒', x + pw / 2, y + ph / 2 - 14); label('Opens with the', x + pw / 2, y + ph / 2 + 2, '#ffe8cc'); label('Hot springs', x + pw / 2, y + ph / 2 + 12, '#ffe8cc'); }
        return;
      }
      const [hi, lo] = soak ? POOL_WATER[soak.temp] : ['#a5d8ff', '#74c0fc'];
      const w = g.createLinearGradient(0, y, 0, y + ph); w.addColorStop(0, hi); w.addColorStop(1, lo);
      g.fillStyle = w; g.fillRect(x, y, pw, ph);
      g.fillStyle = 'rgba(255,255,255,.35)';   // ripples
      for(let r = 0; r < 3; r++){ const rx = x + ((now / 30 + r * 53 + i * 20) % (pw - 20)), ry = y + 12 + r * 28; g.fillRect(Math.round(rx), ry, 16, 2); }
      if(!soak){ label('Empty pool', x + pw / 2, y + ph / 2 - 4, '#e7f5ff'); return; }
      // steam, more of it the hotter the water
      const puffs = {warm: 3, hot: 5, scalding: 8}[soak.temp];
      for(let s = 0; s < puffs; s++){
        const t = (now / 2200 + s / puffs) % 1, sx = x + 12 + ((s * 37) % (pw - 24)) + Math.sin(now / 600 + s) * 4;
        g.globalAlpha = .55 * (1 - t); g.fillStyle = '#fff'; g.fillRect(Math.round(sx), Math.round(y + 30 - t * 50), 5, 5); g.globalAlpha = 1;
      }
      const bob = Math.sin(now / 650 + i * 2) * 2;
      duckWithHat(g, (p.squad.find(d=>d.champion === soak.champion) || {}).cls || (p.champions.find(c=>c.champion === soak.champion) || {}).cls || 'fighter',
                  hatOf(p, soak.champion), x + pw / 2 - 14, y + 14 + bob, 28);
      g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x + pw / 2 - 16, y + 39 + Math.round(bob), 32, 2);   // where the water meets the duck
      label(soak.champion, x + pw / 2, y + 50);
      label(perkText(soak), x + pw / 2, y + 61, '#fff3bf');
      label(`out in ${timeLeft(soak.until - nowApp())}`, x + pw / 2, y + 72, '#fff3bf');
    });
    if(!p.levels.spa){
      g.fillStyle = 'rgba(16,20,28,.55)'; g.fillRect(0, 0, SPW, SPH);
      label('🔒', SPW / 2, 80); label('Build the Spa to open the pools', SPW / 2, 98, '#e7f5ff');
    }
  }
  window.addEventListener('resize', size);
  size(); requestAnimationFrame(draw);
  return {reset, size};
})();

// ---- the Bakery: machines bake sweet treats, one for each class, from breadcrumbs and badges ----
let treatSel = null;   // the treat picked in the kitchen (its card is highlighted)
const badgeChip = (U_, id, text, cls = '') => `<span class="ubadge ${cls}" title="${esc(U_.badgeInfo[id].name)}">${U_.badgeInfo[id].icon} ${text}</span>`;
const wildFor = (p, cls) => (p.volcano || []).filter(d=>!d.caught && d.cls === cls).length;
function treatState(p, t){   // locked, forSale, ready or baking
  const B = p.bakery;
  return t.id in B.bakes ? 'baking' : B.machines[t.id] ? 'ready' : p.levels.bakery >= t.unlock ? 'forSale' : 'locked';
}
function renderBakery(){
  const p = U.players[viewing], own = mine(), B = p.bakery, bs = p.buildings, lvl = p.levels.bakery;
  const used = new Set(U.treats.flatMap(t=>t.badges.map(([b])=>b)));
  const nextUnlock = U.treats.find(t=>t.unlock === lvl + 1);
  const nextSpeedLevel = lvl + 1 <= 10 && (lvl + 1) % 2 === 0 ? ` and speed upgrade ${(lvl + 1) / 2}` : '';
  $('#bakeryNote').textContent = 'Bake sweet treats here, one for each class. Each machine is unlocked by your bakery level; a treat costs breadcrumbs and badges, '
    + 'and takes a while to bake. Badges spent here only leave Ductopia: they stay in your badge showcase. Treats lure wild fire ducks at the Volcano Spa: each class\'s treat, that class\'s fire ducks.';
  let html = buildRow('bakery', bs.bakery, p, own, BUILD_INFO.bakery[0](Math.max(1, lvl)),
    `${lvl ? `+${lvl * 25}% breadcrumbs` : 'Makes breadcrumbs faster'} (+25% a level), and unlocks machines and their speed upgrades`,
    bs.bakery.cost != null ? `level ${lvl + 1}${nextUnlock ? `, unlocks the ${nextUnlock.machine.toLowerCase()}` : ''}${nextSpeedLevel}` : '');
  html += `<h3 class="uspah">Badges to spend</h3><div class="ubadges">${Object.keys(U.badgeInfo).map(id=>{
    const left = B.badges[id] || 0, earned = B.earned[id] || 0;
    return badgeChip(U, id, `${esc(U.badgeInfo[id].name)} <b>${left}</b>${earned !== left ? ` of ${earned}` : ''}`, `${left ? '' : 'none'} ${used.has(id) ? 'used' : ''}`);
  }).join('')}</div><p class="unote">Every badge you've earned together, as in your badge showcase, less those baked into treats. Outlined ones go into treats.</p>`;
  html += `<h3 class="uspah">Treats</h3><div class="utreats">${U.treats.map(t=>{
    const st = treatState(p, t), m = B.machines[t.id], have = B.treats[t.id] || 0;
    const short = t.badges.filter(([b, n])=>(B.badges[b] || 0) < n);
    let body;
    if(st === 'locked') body = `<p class="uempty">🔒 The ${esc(t.machine.toLowerCase())} unlocks at bakery level ${t.unlock}.</p>`;
    else if(st === 'forSale') body = `<div class="ubld">${pic('machine-' + t.id)}<div class="t"><b>${esc(t.machine)}</b><span>Bakes ${esc(t.name.toLowerCase())} in ${fmtMin(t.minutes)}</span></div>
      <button data-machine="${t.id}" data-cost="${t.machineCost}" ${own ? '' : 'disabled'}>${pic('icon-breadcrumb')}${fmt(t.machineCost)}</button></div>`;
    else {
      const recipe = `<div class="urecipe">Each batch: <span class="ubadge">${pic('icon-breadcrumb')} ${fmt(t.crumbs)}</span>${t.badges.map(([b, n])=>
        badgeChip(U, b, `${n} ${esc(U.badgeInfo[b].name)} <span>(${B.badges[b] || 0} left)</span>`, short.some(([s])=>s === b) ? 'short' : '')).join('')}</div>`;
      const bake = st === 'baking' ? `<span class="baking">Baking: <strong data-until="${B.bakes[t.id]}">${timeLeft(B.bakes[t.id] - nowApp())}</strong> left</span>`
        : `<button data-bake="${t.id}" data-cost="${t.crumbs}" data-full="${short.length ? 1 : ''}" ${own && !short.length ? '' : 'disabled'}>Bake ${pic('icon-breadcrumb')}${fmt(t.crumbs)}</button>
           <span>${short.length ? `Needs ${short.map(([b, n])=>`${n - (B.badges[b] || 0)} more ${esc(U.badgeInfo[b].name)}`).join(', ')}` : fmtMin(m.minutes)}</span>`;
      const speed = m.speedCost == null ? '<span class="max">As fast as it gets</span>'
        : lvl < m.speedNeeds ? `<span class="max">Next: bakery level ${m.speedNeeds}</span>`
        : `<button data-speed="${t.id}" data-cost="${m.speedCost}" ${own ? '' : 'disabled'}>${pic('icon-breadcrumb')}${fmt(m.speedCost)}</button>`;
      body = recipe + `<div class="ubake">${bake}</div>
        <div class="ubld">${pic('machine-' + t.id)}<div class="t"><b>${esc(t.machine)}${m.speed ? ` · speed ${m.speed} of ${U.speeds}` : ''}</b>
          <span>A batch takes ${fmtMin(m.minutes)}${m.nextMinutes ? `. Next: ${fmtMin(m.nextMinutes)}` : ''}</span></div>${speed}</div>`;
    }
    return `<div class="utreat ${st === 'locked' ? 'locked' : ''} ${treatSel === t.id ? 'sel' : ''}" data-treat-card="${t.id}">
      <div class="utreat-head">${pic('treat-' + t.id, 'pix', t.name)}<div><b>${esc(t.name)}</b><span>${CLASS_NAME[t.id]} treat${have ? ` · ${have} in the pantry` : ''}${wildFor(p, t.id) ? ` · lures ${plural(wildFor(p, t.id), 'wild fire duck')}` : ''}</span></div></div>${body}</div>`;
  }).join('')}</div>` + (own ? '' : `<p class="unote">Only ${esc(shortName(p.riotId))} can bake here.</p>`);
  $('#bakeryDetail').innerHTML = html;
  affordable();
}
$('#bakeryDetail').addEventListener('click', e=>{
  const b = e.target.closest('[data-build]'); if(b) return act({action: 'upgrade', building: b.dataset.build});
  for(const action of ['machine', 'speed', 'bake']){
    const x = e.target.closest(`[data-${action}]`);
    if(x) return act({action, treat: x.dataset[action]});
  }
});
function pickTreat(id){
  treatSel = id; renderBakery();
  const card = document.querySelector(`[data-treat-card="${id}"]`);
  if(card) card.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

// the Bakery's kitchen: the pantry shelf along the back wall, the six machines in a row (dark until unlocked, faded until
// bought, steaming while they bake), and a baker duck in a chef's hat pottering between them
const BKW = 480, BKH = 200, MACH = {w: 64, gap: 12, y: 84};
const bakeryRoom = (()=>{
  const cv = $('#bakeryScene'), g = cv.getContext('2d');
  let hover = -1, baker = {x: 60, vx: 22};
  function size(){   // (also called when the bakery is shown)
    const css = cv.clientWidth || BKW, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr * BKH / BKW);
    hover = -1;
  }
  function reset(){
    if(!U) return;
    const p = U.players[viewing];
    cv.setAttribute('aria-label', !p.levels.bakery ? 'The Bakery: not built yet'
      : `The Bakery: ${U.treats.map(t=>`${t.machine} ${{locked: 'locked', forSale: 'not bought', ready: 'ready', baking: 'baking'}[treatState(p, t)]}`).join(', ')}`);
  }
  function label(text, x, y, color = '#fff'){
    g.font = 'bold 9px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.lineWidth = 3; g.strokeStyle = 'rgba(40,28,20,.9)'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
  }
  const x0 = () => (BKW - U.treats.length * MACH.w - (U.treats.length - 1) * MACH.gap) / 2;
  const slot = i => ({x: x0() + i * (MACH.w + MACH.gap), y: MACH.y, w: MACH.w, h: MACH.w});
  function draw(now){
    requestAnimationFrame(draw);
    if(!U || view !== 'bakery') return;
    const p = U.players[viewing], B = p.bakery, k = cv.width / BKW;
    g.setTransform(k, 0, 0, k, 0, 0); g.imageSmoothingEnabled = false;
    for(let y = 0; y < 72; y += 32) for(let x = 0; x < BKW; x += 32) g.drawImage(art('tile-kitchen-wall'), x, y, 32, 32);
    for(let y = 72; y < BKH; y += 32) for(let x = 0; x < BKW; x += 32) g.drawImage(art('tile-kitchen'), x, y, 32, 32);
    g.fillStyle = '#8a5a34'; g.fillRect(0, 70, BKW, 4);
    // the pantry: a shelf with each treat baked so far
    g.fillStyle = '#6b4423'; g.fillRect(40, 40, BKW - 80, 5); g.fillStyle = '#8a5a34'; g.fillRect(40, 40, BKW - 80, 1);
    g.fillRect(52, 45, 3, 8); g.fillRect(BKW - 55, 45, 3, 8);
    U.treats.forEach((t, i)=>{
      const n = B.treats[t.id] || 0, s = slot(i), cx = s.x + s.w / 2;
      g.globalAlpha = n ? 1 : .25; g.drawImage(art('treat-' + t.id), cx - 10, 20, 20, 20); g.globalAlpha = 1;
      if(n) label(`×${n}`, cx + 16, 26, '#fff3bf');
    });
    label('Pantry', 26, 36, '#ffe8cc');
    // the machines
    U.treats.forEach((t, i)=>{
      const s = slot(i), st = treatState(p, t), cx = s.x + s.w / 2;
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(s.x + 4, s.y + s.h - 4, s.w - 8, 5);   // its shadow
      if(st === 'locked'){ g.globalAlpha = .3; g.filter = 'brightness(0.2)'; }
      else if(st === 'forSale') g.globalAlpha = .5;
      const shake = st === 'baking' ? Math.round(Math.sin(now / 90 + i) * .6) : 0;
      g.drawImage(art('machine-' + t.id), s.x + shake, s.y, s.w, s.h);
      g.globalAlpha = 1; g.filter = 'none';
      if(st === 'baking'){
        for(let q = 0; q < 4; q++){   // steam
          const tt = (now / 1800 + q / 4) % 1;
          g.globalAlpha = .6 * (1 - tt); g.fillStyle = '#fff';
          g.fillRect(Math.round(s.x + 18 + q * 9 + Math.sin(now / 500 + q) * 3), Math.round(s.y + 8 - tt * 26), 5, 5); g.globalAlpha = 1;
        }
        const left = B.bakes[t.id] - nowApp(), total = B.machines[t.id].minutes * 60000, prog = Math.min(1, Math.max(0, 1 - left / total));
        g.fillStyle = '#343a40'; g.fillRect(s.x + 6, s.y + s.h + 4, s.w - 12, 5);
        g.fillStyle = '#fcc419'; g.fillRect(s.x + 7, s.y + s.h + 5, Math.round((s.w - 14) * prog), 3);
        label(timeLeft(left), cx, s.y + s.h + 12, '#ffe066');
      } else label(st === 'locked' ? `🔒 Bakery ${t.unlock}` : st === 'forSale' ? 'For sale' : 'Ready', cx, s.y + s.h + 6,
                   st === 'ready' ? '#b2f2bb' : '#ffe8cc');
      if(i === hover || t.id === treatSel){ g.strokeStyle = i === hover ? '#fff3bf' : '#fcc419'; g.lineWidth = 2; g.strokeRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4); }
    });
    // the baker
    if(p.levels.bakery){
      baker.x += baker.vx / 60;
      if(baker.x < 20 || baker.x > BKW - 40) baker.vx = -baker.vx;
      const bob = Math.abs(Math.sin(now / 200)) * 2;
      g.save();
      if(baker.vx < 0){ g.translate(Math.round(baker.x) + 12, 0); g.scale(-1, 1); g.translate(-Math.round(baker.x) - 12, 0); }
      duckWithHat(g, 'plain', 'chef', baker.x, 172 - bob, 24);
      g.restore();
    } else {
      g.fillStyle = 'rgba(16,20,28,.55)'; g.fillRect(0, 0, BKW, BKH);
      label('🔒', BKW / 2, 80); label('Build the bakery to open the kitchen', BKW / 2, 98, '#fff3bf');
    }
  }
  const slotAt = e => {
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * BKW / r.width, y = (e.clientY - r.top) * BKH / r.height;
    return U ? U.treats.findIndex((t, i)=>{ const s = slot(i); return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h + 20; }) : -1;
  };
  cv.addEventListener('mousemove', e=>{
    hover = slotAt(e); cv.classList.toggle('over', hover >= 0);
    if(hover < 0){ tip.classList.remove('on'); return; }
    const p = U.players[viewing], t = U.treats[hover], st = treatState(p, t);
    tip.innerHTML = `<b>${esc(t.machine)}</b><p>${{locked: `Unlocks at bakery level ${t.unlock}.`, forSale: `For sale: ${fmt(t.machineCost)} breadcrumbs.`,
      ready: `Ready to bake ${esc(t.name.toLowerCase())}.`, baking: `Baking ${esc(t.name.toLowerCase())}: done in ${timeLeft(p.bakery.bakes[t.id] - nowApp())}.`}[st]} Click to see it below.</p>`;
    tip.classList.add('on');
    const w = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(8, e.clientX - w / 2), innerWidth - w - 8) + 'px'; tip.style.top = (e.clientY + 16) + 'px';
  });
  cv.addEventListener('mouseleave', ()=>{ hover = -1; cv.classList.remove('over'); tip.classList.remove('on'); });
  cv.addEventListener('click', e=>{ const i = slotAt(e); if(i >= 0) pickTreat(U.treats[i].id); });
  window.addEventListener('resize', size);
  size(); requestAnimationFrame(draw);
  return {reset, size};
})();

// ---- a boss fight, played back round by round (from the fight's steps) ----
const MOVE_NOTE = {ult: 'Pentakill ultimate!', first: 'Strikes first from the shadows!', double: 'Double hit!'};
const MOVE_POP = {ult: 'Penta ult!', first: 'Ambush!', double: 'Double!'};   // short, to fit over the duck
let fightRun = 0;   // bumped to stop a playback (skip or close)
function playFight(f){
  if(!f || !f.steps) return;
  const run = ++fightRun, box = $('#arena'), b = f.boss, calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r=>setTimeout(r, calm ? ms / 4 : ms));
  box.innerHTML = `<div class="box uarena"><h2 id="arenaTitle">${esc(f.champion)} vs ${esc(b.name)}</h2>
    <p>${f.practice ? 'Test fight: nothing won or lost' : 'Training Grounds challenge'} · boss level ${b.level}${f.perk && f.perk.salt !== 'golden' ? ` · ♨ ${perkText(f.perk)}` : ''}</p>
    <div class="ustage">
      <div class="ufighter" data-side="me"><b>${esc(f.champion)}</b><div class="ubar"><i></i></div><span class="hp"></span>${pic('duck-' + f.cls, 'pix spr')}</div>
      <div class="uvs">VS</div>
      <div class="ufighter" data-side="boss"><b>${esc(b.name)}</b><div class="ubar boss"><i></i></div><span class="hp"></span>${pic('goose-king', 'pix spr flip')}</div>
    </div>
    <div class="uround" aria-live="polite">Get ready…</div>
    <ol class="ufeed"></ol>
    <div class="uend"></div>
    <button data-arena-skip>Skip</button></div>`;
  box.classList.remove('hidden');
  const side = s => box.querySelector(`[data-side="${s}"]`);
  const setHp = (s, hp, max) => { side(s).querySelector('.ubar i').style.width = `${Math.max(0, hp / max * 100)}%`; side(s).querySelector('.hp').textContent = `${hp} / ${max} HP`; };
  const pulse = (s, cls) => { const el = side(s); el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const pop = (s, text, kind) => { const n = document.createElement('span'); n.className = 'upop ' + kind; n.textContent = text; side(s).appendChild(n); setTimeout(()=>n.remove(), 1000); };
  setHp('me', f.hp, f.hp); setHp('boss', b.hp, b.hp);
  const feed = box.querySelector('.ufeed'), round = box.querySelector('.uround');
  const finish = () => {
    if(run !== fightRun) return;
    fightRun++;
    const last = f.steps[f.steps.length - 1];
    if(last){ setHp('me', last.hp, f.hp); setHp('boss', last.bossHp, b.hp); }
    feed.innerHTML = f.steps.map(note).join(''); feed.scrollTop = feed.scrollHeight;
    side(f.win ? 'boss' : 'me').classList.add('ko');
    round.textContent = f.win ? `${b.name} is beaten!` : f.hpLeft > 0 ? `${b.name} outlasted ${f.champion}.` : `${f.champion} was knocked out.`;
    box.querySelector('.uend').innerHTML = `<span class="${f.win ? 'won' : 'lost'}">${f.win ? (f.practice ? 'Win! (a real challenge would give a level)' : `Level up! ${esc(f.champion)} is now level ${f.level}.`)
      : f.practice ? 'Lost. Nothing lost in a test fight.' : 'Beaten. Win another game on it to try again.'}</span>`;
    const btn = box.querySelector('[data-arena-skip]'); btn.textContent = 'Close'; btn.dataset.arenaClose = ''; btn.focus();
  };
  function note(s){
    const moves = s.moves.filter(m=>MOVE_NOTE[m]).map(m=>` <em>${MOVE_NOTE[m]}</em>`).join('');
    return `<li><b>R${s.round}</b> ${esc(f.champion)} hits for ${s.hit}${s.heal ? `, heals ${s.heal}` : ''}${moves}${s.bite != null ? ` · ${esc(b.name)} ${s.moves.includes('honk') ? '<em>HONKS</em>' : 'bites'} for ${s.bite}` : ''}</li>`;
  }
  box.querySelector('[data-arena-skip]').focus();
  (async ()=>{
    await wait(500);
    for(const s of f.steps){
      if(run !== fightRun) return;
      round.textContent = `Round ${s.round}`;
      pulse('me', s.moves.includes('ult') ? 'ult' : 'lunge');
      s.moves.filter(m=>MOVE_POP[m]).forEach(m=>pop('me', MOVE_POP[m], 'call'));
      await wait(250); if(run !== fightRun) return;
      pulse('boss', 'hurt'); pop('boss', `-${s.hit}`, 'dmg'); setHp('boss', s.bossHp, b.hp);
      if(s.heal){ pop('me', `+${s.heal}`, 'heal'); setHp('me', s.bite != null ? Math.min(f.hp, s.hp + s.bite) : s.hp, f.hp); }
      if(s.bite != null){
        await wait(450); if(run !== fightRun) return;
        const honk = s.moves.includes('honk');
        pulse('boss', honk ? 'honk' : 'lunge'); if(honk) pop('boss', 'HONK!', 'call');
        await wait(250); if(run !== fightRun) return;
        pulse('me', 'hurt'); pop('me', `-${s.bite}`, 'dmg'); setHp('me', s.hp, f.hp);
      }
      feed.insertAdjacentHTML('beforeend', note(s)); feed.scrollTop = feed.scrollHeight;
      await wait(650);
    }
    finish();
  })();
  box.onclick = e => {
    if(e.target.closest('[data-arena-close]') || e.target === box){ fightRun++; box.classList.add('hidden'); box.innerHTML = ''; }
    else if(e.target.closest('[data-arena-skip]')) finish();
  };
  box.onkeydown = e => { if(e.key === 'Escape'){ fightRun++; box.classList.add('hidden'); box.innerHTML = ''; } };
}
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
    if(s.result && s.result.fight) playFight(s.result.fight);
    if(s.result && s.result.caught) playLure(s.result);
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
  const p = U.players[viewing], c = $('#crumbs'), g = $('#grow'), pill = $('#crumbsPill');
  if(c) c.textContent = fmt(crumbsNow(p));
  if(pill) pill.textContent = fmt(crumbsNow(p));
  if(g) g.textContent = growLeft(p);
  document.querySelectorAll('[data-until]').forEach(el=>{ el.textContent = timeLeft(+el.dataset.until - nowApp()); });
  affordable();
}, 250);

// ---- the scene: a little pixel picture of the utopia being viewed ----
const W = 480, H = 280;
// where each place sits on the map (its picture's top-left; all PLACE_SIZE square), round the pond in the middle: the
// Duck Infirmary and the Volcano Spa down the left, the Bakery and Spa top right, the Plaza and Quarter bottom right
const PLACE_SIZE = 44;
const PLACES = {lab: [16, 8], volcano: [16, 192], bakery: [350, 8], spa: [422, 8], plaza: [350, 192], quarter: [422, 192]};
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
    const s = PLACE_SIZE, u = s / 64;
    g.fillStyle = 'rgba(122,90,52,.55)'; g.fillRect(x + 6 * u, y + 30 * u, 52 * u, 26 * u);
    g.fillStyle = '#8b5a2b'; g.fillRect(x + 30 * u, y + 14 * u, 3, 22 * u); g.fillStyle = '#d9b77e'; g.fillRect(x + 16 * u, y + 8 * u, 31 * u, 12 * u);
    label(text, x + s / 2, y + s + 2, 'center', '#ffe8cc');
  }
  function names(x, y, first, second, color = '#ffd8a8'){   // a place's name under it, and a second line if there's more
    label(first, x + PLACE_SIZE / 2, y + PLACE_SIZE + 2);
    if(second) label(second, x + PLACE_SIZE / 2, y + PLACE_SIZE + 12, 'center', color);
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
    const S = PLACE_SIZE, at = id => PLACES[id];
    let [x, y] = at('lab');
    sprite('building-infirmary', x, y, S);
    names(x, y, 'Infirmary', `${p.ducklings.length}/${p.nestSpace} growing`);
    for(let i = 0; i < Math.min(p.ducklings.length, 8); i++){
      const hop = Math.abs(Math.sin(now / 300 + i)) * 2;
      sprite('duckling', x - 4 + (i % 4) * 13, y + S + 25 + Math.floor(i / 4) * 11 - hop, 11);
    }
    if(p.lost){
      g.fillStyle = '#a47148'; g.fillRect(x + S + 8, y + 16, 20, 16); g.fillStyle = '#6b4423'; g.fillRect(x + S + 8, y + 16, 20, 3); g.fillRect(x + S + 17, y + 16, 2, 16);
      label(`Lost & found: ${p.lost}`, x + S + 18, y + 34, 'center', '#ffd8a8');
    }
    // bakery and spa (an empty plot until built)
    [x, y] = at('bakery');
    if(p.levels.bakery){
      sprite(BUILD_INFO.bakery[0](p.levels.bakery), x, y, S);
      const baking = Object.keys(p.bakery.bakes).length;
      for(let q = 0; q < (baking ? 3 : 0); q++){   // smoke from the chimney while something bakes
        const t = (now / 1600 + q / 3) % 1; g.globalAlpha = .55 * (1 - t); g.fillStyle = '#f1f3f5';
        g.fillRect(Math.round(x + S * .75 + Math.sin(now / 400 + q) * 2), Math.round(y + 2 - t * 12), 4, 4); g.globalAlpha = 1;
      }
      names(x, y, `Bakery ${p.levels.bakery}`, baking ? `${baking} baking` : '');
    }
    else lot(x, y, 'Bakery plot');
    [x, y] = at('spa');
    if(p.levels.spa){ sprite(BUILD_INFO.spa[0](p.levels.spa), x, y, S); names(x, y, p.levels.spa >= 2 ? 'Hot springs' : 'Spa', p.soaks.length ? `${p.soaks.length} soaking` : ''); }
    else lot(x, y, 'Spa plot');
    // districts: unlocked by real achievements only
    const D = [['penta', 'plaza', 'district-penta-plaza', 'Plaza', 'a penta', `${p.golden} golden`, 'duck-golden'],
               ['champion', 'quarter', 'district-champion-quarter', 'Quarter', 'an S', `${Object.keys(p.champs).length} champs`, 'duck-fighter'],
               ['volcano', 'volcano', 'district-volcano-spa', 'Volcano', 'an S+', `${p.caught.length}/${(p.volcano || []).length} caught`, 'duck-fire']];
    D.forEach(([id, place, img, name, need, more, duck])=>{
      const [x, y] = at(place), open = p.districts.includes(id);
      g.globalAlpha = open ? 1 : .35; sprite(img, x, y, S); g.globalAlpha = 1;
      if(open){ sprite(duck, x + S * .62, y + S * .62, 14); names(x, y, name, more); }
      else { label('🔒', x + S / 2, y + S / 3); names(x, y, name, `needs ${need}`, '#dee2e6'); }
    });
  }
  // clicking the Duck Infirmary, the Bakery, the Spa or a district visits it
  const SPOTS = Object.entries(PLACES).map(([view, [x, y]])=>({view, x: x - 8, y, w: PLACE_SIZE + 16, h: PLACE_SIZE + 24}));   // (with its labels)
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
  // where each chamber goes: one row of up to 13, a second row beyond that, shrunk to fit.
  // The second row sits half a step over, so its pipes come down through the gaps in the first.
  function layout(n){
    const cols = Math.min(n, 13), rows = Math.ceil(n / cols), gap = 26, half = rows > 1 ? (40 + gap) / 2 : 0;
    const k = Math.min(1, (LW - 24) / (cols * 40 + (cols - 1) * gap + half), ((LH - 66) / rows - 14) / 112);
    const w = 40 * k, h = 112 * k, x0 = (LW - (cols * w + (cols - 1) * gap * k + half * k)) / 2;
    return Array.from({length: n}, (_, i)=>{ const row = Math.floor(i / cols);
      return {x: x0 + row * half * k + (i % cols) * (w + gap * k), y: 44 + row * (h + 14), w, h, k}; });
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
    g.fillStyle = '#5c636a';
    cs.forEach(c=>g.fillRect(Math.round(c.x + c.w / 2 - 2), 30, 4, Math.round(c.y - 30)));                  // pipes from the ceiling, behind the chambers
    cs.forEach((c, i)=>{
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

// ---- the Volcano Spa: an S+ on a champion unlocks its fire duck, which chills in the volcano's pools, wild, until it's
// lured with its class's treat and caught. Caught ones move to the Spa ----
// champion icons for drawing on canvases (banners), once loaded
const champImgs = {};
function champImg(c){
  if(!ddVer) return null;
  if(!champImgs[c]){ champImgs[c] = new Image(); champImgs[c].src = champURL(c); }
  return champImgs[c].complete && champImgs[c].naturalWidth ? champImgs[c] : null;
}
// a fire duck's banner: a pole from its back, and a flag with its champion's icon. x, y: where the duck is drawn
// (size s); face: 1 facing right, -1 left
function fireBanner(g, champion, x, y, s, face){
  const pole = Math.round(s * .95), fw = Math.round(s * .62), back = face > 0 ? x + s * .22 : x + s * .78;
  const top = Math.round(y + s * .3 - pole), px = Math.round(back);
  g.fillStyle = '#5c3d2e'; g.fillRect(px - 1, top, 2, pole);
  g.fillStyle = '#ffd43b'; g.fillRect(px - 2, top - 3, 4, 3);
  const fx = face > 0 ? px - fw - 1 : px + 1, fy = top + 1;
  g.fillStyle = '#e8590c'; g.fillRect(fx, fy, fw, fw + 2);
  g.fillStyle = '#ffd43b'; g.fillRect(fx, fy + fw, fw, 2);
  const ic = champImg(champion), is = fw - 4;
  if(ic){ g.imageSmoothingEnabled = true; g.drawImage(ic, fx + 2, fy + 2, is, is); g.imageSmoothingEnabled = false; }
  else { g.fillStyle = '#1f2937'; g.fillRect(fx + 2, fy + 2, is, is); }
}
const VW = 480, VH = 270, MAX_SPA = 60, DUCK_MAX = 24, DUCK_MIN = 12;
const POOLS = [{cx: 94, cy: 180, rx: 86, ry: 40}, {cx: 242, cy: 220, rx: 100, ry: 40}, {cx: 390, cy: 180, rx: 86, ry: 40}];
// where each of a pool's n ducks sits, in up to three rows, and how big they are: full size while they fit, smaller
// when there are too many (a duck and its banner need about 1.5 duck-widths)
function poolSpots(o, n){
  const rows = n <= 4 ? 1 : n <= 10 ? 2 : 3, cols = Math.ceil(n / rows);
  const size = Math.max(DUCK_MIN, Math.min(DUCK_MAX, o.rx * 1.45 / (cols * 1.5), o.ry * 1.6 / rows));
  return Array.from({length: n}, (_, i)=>{
    const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols), c = i % cols;
    const dy = rows === 1 ? 0 : (r / (rows - 1) - .5) * o.ry * .9;
    const half = o.rx * Math.sqrt(1 - (dy / o.ry) ** 2) * .72;   // narrower towards the top and bottom of the oval
    return {x: o.cx - half + (c + .5) / inRow * half * 2 - size / 2, y: o.cy + dy - size * .55, size, face: r % 2 ? -1 : 1};   // a row faces one way, so its banners don't clash
  });
}
const volcano = (()=>{
  const cv = $('#volcanoScene'), g = cv.getContext('2d');
  let ducks = [], key = null, hover = null;
  function size(){
    hover = null;
    const css = cv.clientWidth || VW, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr * VH / VW);
  }
  function reset(){
    if(!U) return;
    const p = U.players[viewing], all = p.volcano || [], wild = all.filter(d=>!d.caught);
    const k = viewing + ':' + wild.map(d=>d.champion).join(',');
    if(k === key) return;   // the same residents: let them keep soaking
    key = k; hover = null;
    const shown = wild.slice(-MAX_SPA);
    ducks = [];
    POOLS.forEach((pool, k)=>{   // shared out between the pools, each laid out in rows so the banners don't pile up
      const mine = shown.filter((_, i)=>i % POOLS.length === k);
      poolSpots(pool, mine.length).forEach((at, j)=>ducks.push({duck: mine[j], pool, ...at, phase: Math.random() * 6}));
    });
    cv.setAttribute('aria-label', all.length ? `Volcano Spa: ${wild.length ? `wild fire ducks chilling in the pools: ${wild.map(d=>d.champion).join(', ')}` : 'every fire duck is caught'}` : 'Volcano Spa, locked');
  }
  function label(text, x, y, color = '#fff'){
    g.font = 'bold 9px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.lineWidth = 3; g.strokeStyle = 'rgba(24,10,8,.9)'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
  }
  function draw(now){
    requestAnimationFrame(draw);
    if(!U || view !== 'volcano') return;
    const k = cv.width / VW, p = U.players[viewing], all = p.volcano || [];
    g.setTransform(k, 0, 0, k, 0, 0); g.imageSmoothingEnabled = false;
    // a smoky evening sky, and the volcano's glow
    const sky = g.createLinearGradient(0, 0, 0, 120);
    sky.addColorStop(0, '#24152b'); sky.addColorStop(1, '#7a2e1f'); g.fillStyle = sky; g.fillRect(0, 0, VW, 120);
    const glow = g.createRadialGradient(240, 34, 4, 240, 34, 150);
    glow.addColorStop(0, `rgba(255,120,40,${.38 + Math.sin(now / 700) * .06})`); glow.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = glow; g.fillRect(80, 0, 320, 140);
    g.drawImage(art('volcano-peak'), 160, -26, 160, 160);
    for(let i = 0; i < 6; i++){   // smoke rising from the crater
      const t = (now / 5200 + i / 6) % 1, x = 240 + Math.sin(t * 5 + i) * 10 + t * 30, y = 34 - t * 60, r = 4 + t * 14;
      g.fillStyle = `rgba(120,108,112,${.5 * (1 - t)})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for(let i = 0; i < 8; i++){   // sparks flying out
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
    if(!all.length){
      g.fillStyle = 'rgba(20,10,8,.5)'; g.fillRect(0, 0, VW, VH);
      label('🔒', VW / 2, 92); label('Opens with your first S+ together', VW / 2, 110, '#ffe8cc');
      return;
    }
    // the wild ones, chilling with their banners, drifting a little round their spot (the hovered one stays put)
    [...ducks].sort((a, b)=>a.y - b.y).forEach(d=>{
      const s = d.size, drift = d === hover ? 0 : Math.sin(now / 2400 + d.phase) * s * .15;
      const bob = Math.sin(now / 500 + d.phase) * s * .05, x = Math.round(d.x + drift), y = Math.round(d.y + bob);
      if(d === hover){ g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.ellipse(x + s / 2, y + s * .75, s * .6, s * .17, 0, 0, Math.PI * 2); g.fill(); }
      fireBanner(g, d.duck.champion, x, y, s, d.face);
      g.save();
      if(d.face < 0){ g.translate(x + s / 2, 0); g.scale(-1, 1); g.translate(-x - s / 2, 0); }
      g.drawImage(art('duck-fire'), 0, 0, 32, 24, x, y, s, Math.round(s * .75));   // soaking: no feet
      g.restore();
      if(Math.sin(now / 160 + d.phase * 3) > .6){ g.fillStyle = '#ffd43b'; g.fillRect(x + s / 2 + Math.round(Math.sin(d.phase) * 3), y - 3, 2, 2); }   // an ember
    });
    const extra = all.filter(d=>!d.caught).length - ducks.length;
    if(extra > 0) label(`+${extra} more`, VW - 30, VH - 14, '#ffe8cc');
    if(!ducks.length) label('Every fire duck is caught: they\'re warming the Spa', VW / 2, VH - 16, '#ffe8cc');
  }
  // hover cards for the ducks (drawn here, not by showTip, since they move)
  function hideCard(){ if(hover){ hover = null; tip.classList.remove('on'); cv.classList.remove('over'); } }
  cv.addEventListener('mousemove', e=>{
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * VW / r.width, y = (e.clientY - r.top) * VH / r.height;
    const hit = [...ducks].sort((a, b)=>b.y - a.y).find(d=>x >= d.x - d.size * .6 && x < d.x + d.size * 1.3 && y >= d.y - d.size && y < d.y + d.size * .85);
    if(!hit){ hideCard(); return; }
    if(hit !== hover){ hover = hit; tip.innerHTML = fireCard(hit.duck); tip.classList.add('on'); cv.classList.add('over'); }
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
const treatOf = cls => U.treats.find(t=>t.id === cls);
function fireCard(d){
  return `<b class="ufire">${esc(d.champion)}'s fire duck</b>
    <p>${CLASS_NAME[d.cls]} · ${d.games ? `${plural(d.games, 'S+ game')} together, the first ${fireDay(d.first)}` : 'a season-best S+ (S Rank Challenge)'}</p>
    <p>${d.caught ? `Caught: it lives in the Spa, warming the water, and collects ${U.fireRate} breadcrumbs a minute.` : `Wild: lure it with ${esc(treatOf(d.cls).name.toLowerCase())}, the ${CLASS_NAME[d.cls].toLowerCase()} treat, to catch it.`}</p>`;
}
// catching them: how many are caught, and a lure for each class with wild ducks
function renderVolcano(){
  const p = U.players[viewing], own = mine(), all = p.volcano || [], caught = all.filter(d=>d.caught).length;
  $('#volcanoNote').textContent = all.length
    ? `An S+ on a champion unlocks its fire duck, and it chills here in the volcano's pools, wild, doing nothing for you yet. Lure one with the sweet treat for its class (bake them in the Bakery) to catch it: which one comes for the treat is a surprise. Caught fire ducks move into the Spa, warming the water, and collect ${U.fireRate} breadcrumbs a minute each. Hover a duck to see whose it is.`
    : 'Opens with your first S+ together. An S+ on a champion unlocks its fire duck; catch it with a sweet treat from the Bakery.';
  if(!all.length){ $('#volcanoList').innerHTML = ''; return; }
  const lures = U.treats.map(t=>({t, wild: all.filter(d=>!d.caught && d.cls === t.id).length, have: p.bakery.treats[t.id] || 0})).filter(x=>x.wild);
  $('#volcanoList').innerHTML = `
    <div class="uvprog"><b>${caught} of ${all.length}</b> fire ducks caught<div class="ubar"><i style="width:${Math.round(caught / all.length * 100)}%"></i></div></div>
    ${lures.length ? `<h3 class="uspah">Lure a wild fire duck</h3>${lures.map(({t, wild, have})=>`<div class="ubld">${pic('treat-' + t.id)}<div class="t"><b>${esc(t.name)}</b>
        <span>${plural(wild, `wild ${CLASS_NAME[t.id].toLowerCase()} fire duck`)} · ${have ? `${have} in the pantry` : 'none in the pantry: bake some in the Bakery'}</span></div>
        <button data-lure="${t.id}" ${own && have ? '' : 'disabled'}>Lure</button></div>`).join('')}`
      : '<p class="uempty">Every fire duck is caught. The next S+ on a new champion brings another.</p>'}
    ${own ? '' : `<p class="unote">Only ${esc(shortName(p.riotId))} can lure fire ducks here.</p>`}`;
}
$('#volcanoList').addEventListener('click', e=>{ const b = e.target.closest('[data-lure]'); if(b) act({action: 'lure', treat: b.dataset.lure}); });

// ---- luring a fire duck, played out: the treat drops onto the rocks, a mystery duck creeps in and eats it, a flash as
// it's caught, then it's revealed, carrying its champion's banner ----
let lureRun = 0;
function playLure(r){
  const run = ++lureRun, box = $('#lure'), t = treatOf(r.treat), calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const p = U.players[viewing], d = (p.volcano || []).find(x=>x.champion === r.caught) || {champion: r.caught, cls: r.treat};
  box.innerHTML = `<div class="box ulure"><h2 id="lureTitle">Luring a fire duck…</h2><p>With ${esc(t.name.toLowerCase())}</p>
    <div class="ulure-stage"><canvas width="480" height="300" aria-hidden="true"></canvas></div>
    <p class="ulure-say" aria-live="polite">The treat lands on the warm rocks…</p>
    <div class="ulure-reveal hidden"><span class="uvicon">${champIcon(d.champion)}<em>S+</em></span><div><b>${esc(d.champion)}'s fire duck!</b>
      <span>A ${CLASS_NAME[d.cls].toLowerCase()} fire duck. It's moving into the Spa to warm the water, and collects ${U.fireRate} breadcrumbs a minute.</span></div></div>
    <button data-lure-close>Send it to the Spa</button></div>`;
  box.classList.remove('hidden');
  box.querySelector('button').focus();
  const cv = box.querySelector('canvas'), g = cv.getContext('2d'), say = box.querySelector('.ulure-say');
  const W2 = 240, H2 = 150, GROUND = 112, TX = 104, start = performance.now();
  const crumbs = Array.from({length: 10}, (_, i)=>({a: Math.random() * Math.PI, v: 20 + Math.random() * 30, k: i}));
  const lines = [[0, 'The treat lands on the warm rocks…'], [900, 'Something stirs on the slope…'], [2600, 'Nom nom nom…'], [3400, 'Caught!']];
  let said = 0;
  const T = calm ? 99999 : null;   // reduced motion: straight to the reveal
  (function frame(now){
    if(run !== lureRun || box.classList.contains('hidden')) return;
    const t = T || now - start;
    while(said < lines.length && t >= lines[said][0]){ say.textContent = lines[said][1]; said++; }
    g.setTransform(2, 0, 0, 2, 0, 0); g.imageSmoothingEnabled = false;
    const sky = g.createLinearGradient(0, 0, 0, GROUND); sky.addColorStop(0, '#24152b'); sky.addColorStop(1, '#7a2e1f');
    g.fillStyle = sky; g.fillRect(0, 0, W2, GROUND);
    g.drawImage(art('volcano-peak'), 150, 6, 110, 110);
    for(let y = GROUND; y < H2; y += 32) for(let x = 0; x < W2; x += 32) g.drawImage(art('tile-volcanic'), x, y, 32, 32);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, GROUND, W2, 2);
    // the treat: falls and bounces, then gets eaten a bite at a time
    const bites = t < 2600 ? 0 : Math.min(4, Math.floor((t - 2600) / 200));
    if(bites < 4){
      const fall = Math.min(1, t / 600), bounce = t > 600 && t < 900 ? Math.sin((t - 600) / 300 * Math.PI) * 6 : 0;
      const ty = (GROUND - 30) * fall * fall - bounce + 8, sz = 20 * (1 - bites * .22);
      g.drawImage(art('treat-' + r.treat), TX - sz / 2, ty + (20 - sz), sz, sz);
      if(t > 900 && t < 2600 && Math.sin(t / 150) > 0){ g.fillStyle = '#fff3bf'; g.fillRect(TX + 8, ty - 2, 2, 2); }   // it glints
    }
    if(t > 2600 && t < 3400) crumbs.forEach(c=>{   // crumbs flying from the pecking
      const u = ((t - 2600) / 400 + c.k / 10) % 1;
      g.fillStyle = '#e0a96d'; g.fillRect(Math.round(TX + Math.cos(c.a) * c.v * u), Math.round(GROUND - 6 - Math.sin(c.a) * c.v * u + 30 * u * u), 2, 2);
    });
    // the mystery duck: a shadow creeping in from the right, then pecking
    const reveal = t >= 3900;
    const walk = t < 900 ? 0 : Math.min(1, (t - 900) / 1700), dx = Math.round(W2 + 10 - walk * (W2 + 10 - TX - 8));
    const peck = t > 2600 && t < 3400 ? Math.abs(Math.sin((t - 2600) / 100)) * 4 : 0;
    const hop = walk > 0 && walk < 1 ? -Math.abs(Math.sin(t / 120)) * 2 : 0, dy = GROUND - 30 + hop + peck;
    if(t >= 900){
      if(reveal) fireBanner(g, d.champion, dx, dy, 32, -1);
      g.save(); g.translate(dx + 16, 0); g.scale(-1, 1); g.translate(-dx - 16, 0);   // facing left, towards the treat
      if(!reveal) g.filter = 'brightness(0.12)';
      g.drawImage(art('duck-fire'), dx, dy, 32, 32);
      g.restore(); g.filter = 'none';
      if(!reveal){ g.fillStyle = '#ffd43b'; g.fillRect(dx + 9, dy + 7, 2, 2); }   // a glinting eye
      if(!reveal && t < 2600){
        g.font = 'bold 14px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.fillStyle = '#ffd43b';
        g.fillText('?', dx + 16, dy - 6 + Math.sin(t / 200) * 2);
      }
    }
    // caught: a burst of light, then sparkles round the revealed duck
    if(t >= 3400 && t < 4300){
      const u = (t - 3400) / 900;
      g.fillStyle = `rgba(255,236,170,${.85 * (1 - u)})`; g.beginPath(); g.arc(dx + 16, dy + 16, 10 + u * 90, 0, Math.PI * 2); g.fill();
    }
    if(reveal) for(let i = 0; i < 8; i++){
      const a = i / 8 * Math.PI * 2 + t / 900, rr = 26 + Math.sin(t / 300 + i) * 3;
      g.fillStyle = i % 2 ? '#ffd43b' : '#ff922b'; g.fillRect(Math.round(dx + 16 + Math.cos(a) * rr), Math.round(dy + 16 + Math.sin(a) * rr * .6), 2, 2);
    }
    if(reveal && box.querySelector('.ulure-reveal').classList.contains('hidden')){
      box.querySelector('.ulure-reveal').classList.remove('hidden');
      box.querySelector('h2').textContent = 'Caught!'; say.textContent = '';
    }
    requestAnimationFrame(frame);
  })(start);
}
document.addEventListener('click', e=>{ if(e.target.closest('[data-lure-close]')) $('#lure').classList.add('hidden'); });

// ---- a pop-up when a new wild fire duck appears (either of you). The main page shows the same one; whichever page sees it
// first marks it seen in this browser, so it only pops up once.
// how many fire ducks each player had unlocked when this browser last looked. Not the old 'ducktopia_fire_seen', which
// counted S+ games: a page still open from before would keep resetting it, and the fire ducks would be announced again
// and again
const FIRE_SEEN = 'ductopia_fire_ducks_seen';
function checkFireDucks(){
  let seen; try{ seen = JSON.parse(store.get(FIRE_SEEN) || '{}') || {}; }catch(e){ seen = {}; }
  const gained = [];
  U.players.forEach((p, i)=>{
    const k = p.riotId.toLowerCase();
    const n = (p.volcano || []).length;   // fire ducks unlocked, wild or caught
    if(seen[k] != null && n > seen[k]) gained.push({p, i, n: n - seen[k]});
    seen[k] = n;
  });
  store.set(FIRE_SEEN, JSON.stringify(seen));
  if(!gained.length) return;
  const t = document.createElement('div'); t.className = 'toast firetoast'; t.setAttribute('role', 'status');
  t.innerHTML = `<button class="toastx" aria-label="Dismiss" title="Dismiss">×</button><b>🔥 A wild fire duck appeared!</b>${gained.map(({p, i, n})=>{
      const champs = (p.volcano || []).slice(-n).map(x=>x.champion);
      return `<div class="uvtoast">${pic('duck-fire')}<span><b>${i === U.me ? 'You' : esc(shortName(p.riotId))}</b> unlocked ${n > 1 ? `${n} wild fire ducks` : 'a wild fire duck'}${champs.length ? ` with an S+ on ${esc(champs.join(', '))}` : ''}. Lure ${n > 1 ? 'them' : 'it'} with a sweet treat to catch ${n > 1 ? 'them' : 'it'}.</span></div>`;
    }).join('')}<button class="toastbtn" data-visit-volcano="${gained[0].i}">Visit the Volcano Spa</button>`;
  document.body.appendChild(t); requestAnimationFrame(()=>t.classList.add('on'));
  const close = () => { t.classList.remove('on'); setTimeout(()=>t.remove(), 400); };
  setTimeout(close, 15000);
  t.addEventListener('click', e=>{
    if(e.target.closest('.toastx')) return close();
    const v = e.target.closest('[data-visit-volcano]'); if(!v) return;
    viewing = +v.dataset.visitVolcano; store.set('utopia_view', viewing);
    renderPanels(); scene.reset(); plaza.reset(); lab.reset(); bakeryRoom.reset(); quarter.reset(); volcano.reset(); spaRoom.reset();
    show('volcano'); close(); $('#volcano').scrollIntoView({behavior: 'smooth', block: 'start'});
  });
}

// Penta Plaza, the Duck Infirmary, the Bakery, the Champion Quarter, the Spa and the Volcano Spa take the place of the utopia scene,
// each with a button back
const VIEWS = {town: () => scene, plaza: () => plaza, lab: () => lab, bakery: () => bakeryRoom, quarter: () => quarter, volcano: () => volcano, spa: () => spaRoom};
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
                ['duck-fire', f.fire, 'wild fire ducks appeared at the Volcano Spa, from S+ grades']].filter(r=>r[1] > 0);
  const box = $('#founding');
  box.innerHTML = `<div class="box"><canvas></canvas><h2 id="foundTitle">Founding Day</h2>
    <p>${f.games} games together, replayed. Your Ductopia starts from your history.</p>
    <ul>${rows.map(([img, n, text], i)=>`<li style="animation-delay:${300 + i * 450}ms">${pic(img)}<b>${n}</b><span>${text}</span></li>`).join('')}</ul>
    <p>New ducks are spawned in the Duck Infirmary and grow in its nests, then move to the pond to collect breadcrumbs.</p>
    <button data-found-close>Enter your Ductopia</button></div>`;
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
  if(!$('#lure').classList.contains('hidden')) $('#lure').classList.add('hidden');
  else if(!$('#founding').classList.contains('hidden')) $('#founding').classList.add('hidden');
  else if(view !== 'town') show('town');
});

load();
