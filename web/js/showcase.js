// Badges tab, Showcase view: every badge earned, one medallion each, to play with.
//   The drawer is a felt board: drop a medallion anywhere on it, overlap them however you like (the last one moved sits on top).
//   Badges not on the board live in the bag beside it (underneath on narrow screens; new badges land there too).
//   Drag from the bag to the board and back. In the bag, badges stack by badge type or by champion (a toggle; each stack
//   has a count, and dragging a stack takes its newest badge). Click a stack to open it: every badge in it, one by one,
//   to pick exactly which to put out. The bag's search narrows it down by champion or badge name.
//   Keyboard: arrow keys nudge a medallion on the board (Shift for bigger steps), Delete puts it back in the bag,
//   and Shift + an arrow key on a bagged badge places it in the middle of the board.
//   Hover for half a second to see the champion and the stat that earned it; click to relive the game.
// Each of you has one showcase of your own badges, saved in the app so the other can look at it (read only).
// The Mac running the app arranges Player 1's showcase; another computer on the network arranges Player 2's.

const SHOWCASE_LOCAL = 'duo_showcase_board';   // where layouts were kept in the browser before; moved over to the app once
let showcases = null;   // from the app: {player (lowercase Riot ID): {board: {badge key: {x, y, z}}, updated}}; x, y are 0..1
let showcaseWho = store.get('duo_showcase_who');   // whose showcase this browser is looking at (player index); null = your own
let showcaseItems = new Map();   // key -> item, for what's showing right now
let bagOpen = store.get('duo_bag_open') !== 'closed';
let bagChamp = '', bagStack = '';  // the bag's search (part of a champion's or badge's name), and the stack that's open ('' = none)
let bagGroup = store.get('duo_bag_group') === 'champion' ? 'champion' : 'badge';   // what the bag stacks by
const stackOf = it => bagGroup === 'champion' ? it.x.champion : it.b.id;          // which stack a badge goes in
let currentBag = [];               // what's in the bag right now (all of it, before the filters)

// every badge earned, newest first: {key, b (badge), x (game row), i (player index), p (player)}
function showcaseAll(players){
  const out = [];
  players.forEach((p,i)=>p.games.forEach(x=>gameBadges(x)
    .forEach(b=>out.push({key: `${x.matchId}|${p.riotId.toLowerCase()}|${b.id}`, b, x, i, p}))));
  return out.sort((a,b)=>(b.x.start||0)-(a.x.start||0) || a.i-b.i);
}
// whose showcase is whose: this Mac's browsers are Player 1, other computers Player 2
function myShowcase(){ return viewer && lastData.players.length > 1 ? 1 : 0; }
function viewedShowcase(){ const v = showcaseWho === null ? myShowcase() : +showcaseWho; return v >= 0 && v < lastData.players.length ? v : myShowcase(); }
const canArrange = () => viewedShowcase() === myShowcase();
const showcaseKey = i => lastData.players[i].riotId.toLowerCase();
function board(){ const s = showcases && showcases[showcaseKey(viewedShowcase())]; return s && s.board && typeof s.board === 'object' ? s.board : {}; }
let saveTimer = null;
function saveBoard(placed){   // your own showcase only (the app refuses anything else too)
  const i = myShowcase();
  showcases[showcaseKey(i)] = {board: placed, updated: Date.now()};
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>api('/api/showcase', {owner: lastData.players[i].riotId, board: placed})
    .catch(e=>msg(`Couldn't save your showcase: ${esc(e.message)}`, 'err')), 250);
}
async function loadShowcases(){
  try{ showcases = await api('/api/showcase'); }catch(e){ showcases = showcases || {}; return; }
  // a layout made before showcases were saved in the app: move your own badges' spots over, once
  if(!showcases[showcaseKey(myShowcase())] && store.get('duo_showcase_moved') !== '1'){
    let old = {}; try{ old = JSON.parse(store.get(SHOWCASE_LOCAL) || '{}') || {}; }catch(e){}
    const mine = old[String(myShowcase())] || old.both || {}, tag = `|${showcaseKey(myShowcase())}|`;
    const moved = Object.fromEntries(Object.entries(mine).filter(([k, v])=>k.includes(tag) && onBoard(v)));
    if(Object.keys(moved).length) saveBoard(moved);
    store.set('duo_showcase_moved', '1');
  }
}
// someone else's showcase can change while you look at it: check every few seconds
setInterval(async ()=>{
  if(!lastData || activeTab !== 'badges' || badgeView !== 'showcase' || canArrange() || document.hidden || scDrag) return;
  const before = JSON.stringify(board());
  await loadShowcases();
  if(JSON.stringify(board()) !== before) redrawBadges();
}, 5000);
const onBoard = v => v && Number.isFinite(v.x) && Number.isFinite(v.y);
const clamp01 = v => Math.min(.97, Math.max(.03, v));

function showcaseBox(players){
  if(showcases === null){ loadShowcases().then(redrawBadges); return '<p class="empty"><span class="spin"></span>Opening the showcase…</p>'; }
  const all = showcaseAll(players), vi = viewedShowcase(), mine = canArrange(), owner = esc(shortName(players[vi].riotId));
  const items = all.filter(it=>it.i === vi);
  showcaseItems = new Map(items.map(it=>[it.key, it]));
  if(!items.length) return `<p class="empty">${mine ? 'No badges yet. Go earn some!' : `${owner} hasn't earned any badges yet.`}</p>`;
  const placed = board();
  const shown = items.filter(it=>onBoard(placed[it.key])).sort((a,b)=>(placed[a.key].z||0) - (placed[b.key].z||0));
  const bag = currentBag = items.filter(it=>!onBoard(placed[it.key]));
  const head = mine
    ? `<span>Your showcase · ${shown.length} on display · ${bag.length} in the bag · drag anywhere, pile them up · hover for the story · click to relive the game</span>`
    : `<span class="scro">👀 ${owner}'s showcase · look only · ${shown.length} on display, ${bag.length} still in their bag · hover for the story · click to relive the game</span>`;
  return `<div class="schead"><b>${items.length}</b> badge${items.length>1?'s':''}${head}</div>
    <div class="scplay ${mine ? '' : 'readonly'}"><div class="drawer"><div class="felt ${mine ? '' : 'ro'}" id="felt" ${feltH ? `style="height:${feltH}px;aspect-ratio:auto"` : ''} aria-label="${mine ? 'Your badge display board' : owner+"'s badge display board, look only"}">${shown.map(it=>{ const v = placed[it.key];
        return scItem(it, `left:${clamp01(v.x)*100}%;top:${clamp01(v.y)*100}%;z-index:${(v.z||0)+1}`); }).join('')}
      ${shown.length ? '' : `<div class="feltempty">${mine ? 'Drag badges here from the bag' : `${owner} hasn't put any badges out yet`}</div>`}</div>
      <div class="pull" data-felt-resize role="separator" aria-orientation="horizontal" aria-label="Board height: drag, or use the up and down arrows"
        tabindex="0" title="Drag to make the board taller or shorter · double-click to reset"></div></div>
    ${mine ? `<div class="bag ${bagOpen ? 'open' : ''}" id="bag">
      <button class="baghead" data-bag-toggle aria-expanded="${bagOpen}"><span class="bagic" aria-hidden="true">🎒</span>
        <b>Bag</b><span class="bagn">${bag.length} badge${bag.length===1?'':'s'}</span><span class="chev" aria-hidden="true">▾</span></button>
      <div class="bagbody">
        ${bag.length ? `<div class="bagfilter"><input id="bagq" type="search" placeholder="Champion or badge" aria-label="Filter the bag by champion or badge name" value="${esc(bagChamp)}" autocomplete="off">
          <div class="seg bagseg" role="group" aria-label="Stack the bag by">${[['badge','By badge'], ['champion','By champion']].map(([k,l])=>
            `<button data-bag-group="${k}" class="${bagGroup===k?'on':''}" aria-pressed="${bagGroup===k}">${l}</button>`).join('')}</div></div>` : ''}
        <div class="bagtools" id="bagtools">${bagTools(shown.length)}</div>
        <div class="bagin" id="bagin">${bagContents()}</div>
      </div></div>` : ''}</div>`;
}

// stack: for a stack in the bag, how many badges it holds (this one, the newest, is the one that moves);
// clicking a stack opens it instead of the game
function scItem(it, style, stack = 0){
  const count = stack || 1;
  const {b, x, p, i} = it;
  const when = new Date(x.start).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
  const tipHtml = `<div class="sctip">${icon(x.champion)}<div><b>${b.ic} ${esc(b.name)}${count > 1 ? ` ×${count}` : ''}</b><div class="d">${esc(x.champion)} · ${esc(shortName(p.riotId))}</div></div></div>
    <p>${esc(b.what)}</p><div class="src">${stack ? `${count > 1 ? `The newest of ${count} in the bag · ` : ''}drag to put it out · click to see ${count > 1 ? `all ${count}` : 'it'}`
      : `${esc(when)} · click to relive the game`}</div>`;
  const multi = b.multi > 1 ? `multi m${Math.min(b.multi, 3)}` : '';   // several of this multikill in one game
  return `<div class="sci b-${b.id} ${count > 1 ? 'stack' : ''} ${multi}" ${stack ? 'data-stack="1"' : ''} style="--c:${COLORS[i]};${style}" role="button" tabindex="0" data-sc="${esc(it.key)}" data-tip-delay="500" data-tip-html="${esc(tipHtml)}"
    aria-label="${esc(`${b.name}${count > 1 ? `, ${count} in the bag, newest:` : ','} ${shortName(p.riotId)} on ${x.champion}, ${when}`)}"><span class="med">${badgeArt(b.id, x.champion, b.ic)}</span><span class="who"></span>${count > 1 ? `<i class="stackn">${count}</i>` : ''}${multi ? `<i class="mkx">×${b.multi}</i>` : ''}</div>`;
}

// ---- the bag's stacks and filters ----
const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');   // "Kai'Sa" and "kaisa" match
// the search box matches a champion or a badge's name ("drav", "unstoppable")
function bagByChampion(){ const q = squash(bagChamp); return q ? currentBag.filter(it=>squash(it.x.champion).includes(q) || squash(it.b.name).includes(q)) : currentBag; }
function bagFiltered(){ return bagByChampion().filter(it=>!bagStack || stackOf(it) === bagStack); }
const bagFiltering = () => !!(squash(bagChamp) || bagStack);
function bagContents(){
  if(!currentBag.length) return '<span class="bagempty">Empty: every badge is on display.</span>';
  if(bagStack){   // an open stack: every badge in it, newest first
    const list = bagFiltered();
    return list.length ? list.map(it=>scItem(it, '')).join('') : '<span class="bagempty">None of these left in the bag.</span>';
  }
  const stacks = new Map();   // badge id or champion -> its badges, newest first
  bagFiltered().forEach(it=>{ const k = stackOf(it); if(!stacks.has(k)) stacks.set(k, []); stacks.get(k).push(it); });
  if(!stacks.size) return '<span class="bagempty">No badges in the bag match.</span>';
  // champions: the most badges earned first, counting the board too, so a stack keeps its place as badges come and go;
  // badge types: the usual badge order
  const earned = new Map();
  if(bagGroup === 'champion') showcaseItems.forEach(it=>earned.set(it.x.champion, (earned.get(it.x.champion) || 0) + 1));
  const order = bagGroup === 'champion'
    ? (a,b)=>earned.get(b[0].x.champion) - earned.get(a[0].x.champion) || a[0].x.champion.localeCompare(b[0].x.champion)
    : (a,b)=>badgeOrder(a[0].b.id) - badgeOrder(b[0].b.id);
  return [...stacks.values()].sort(order).map(st=>scItem(st[0], '', st.length)).join('');
}
function bagTools(onDisplay){
  const n = bagFiltered().length, badge = bagGroup === 'badge' && bagStack && BADGES.find(b=>b.id === bagStack);
  const open = !bagStack ? '' : badge ? `${badge.ic} ${esc(badge.name)}` : esc(bagStack);
  return `${open ? `<button class="bagback" data-bag-back>← All badges<span>${open} · ${n}</span></button>` : ''}
    ${n ? `<button class="ghost" data-bag-tip>${bagFiltering() ? `Tip these ${n} out` : 'Tip it all out'}</button>` : ''}
    ${onDisplay ? '<button class="ghost" data-bag-sweep>Put everything back</button>' : ''}`;
}
function redrawBag(){   // just the bag's contents, so the search box keeps its place
  const inBag = document.getElementById('bagin'); if(!inBag) return;
  inBag.innerHTML = bagContents();
  document.getElementById('bagtools').innerHTML = bagTools(document.querySelectorAll('#felt .sci').length);
}
out.addEventListener('input', e=>{ if(e.target.id === 'bagq'){ bagChamp = e.target.value; redrawBag(); } });
onClick('[data-bag-back]', ()=>{ bagStack = ''; redrawBag(); });
onClick('[data-bag-group]', b=>{
  bagGroup = b.dataset.bagGroup; store.set('duo_bag_group', bagGroup); bagStack = '';
  document.querySelectorAll('[data-bag-group]').forEach(x=>{ const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  redrawBag();
});

function topZ(placed){ return Math.max(0, ...Object.values(placed).filter(onBoard).map(v=>v.z||0)); }
function placeBadge(key, x, y){ const placed = board(); placed[key] = {x: clamp01(x), y: clamp01(y), z: topZ(placed) + 1}; saveBoard(placed); }
function bagBadge(key){ const placed = board(); delete placed[key]; saveBoard(placed); }
function redrawShowcase(focusKey){
  redrawBadges();
  const el = focusKey && [...document.querySelectorAll('#badgebox .sci')].find(e=>e.dataset.sc === focusKey);
  if(el) el.focus({preventScroll: true});
}

onClick('[data-bag-toggle]', ()=>{
  bagOpen = !bagOpen; store.set('duo_bag_open', bagOpen ? 'open' : 'closed');
  const bag = document.getElementById('bag'); bag.classList.toggle('open', bagOpen);
  bag.querySelector('[data-bag-toggle]').setAttribute('aria-expanded', bagOpen);
});
// tip the bag out: scatter everything in it over the board, loosely, as if poured
onClick('[data-bag-tip]', ()=>{
  const placed = board(); let z = topZ(placed);
  bagFiltered().map(it=>it.key).filter(k=>!onBoard(placed[k])).forEach(k=>{
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * .42;
    placed[k] = {x: clamp01(.5 + Math.cos(a) * r), y: clamp01(.5 + Math.sin(a) * r * 1.05), z: ++z};
  });
  saveBoard(placed); redrawShowcase();
});
onClick('[data-bag-sweep]', ()=>{ const placed = board(); showcaseItems.forEach((_, k)=>delete placed[k]); saveBoard(placed); redrawShowcase(); });

// ---- the board's height: drag the brass handle at the bottom (kept in this browser; double-click goes back to the default).
// Badges keep their spots as fractions of the board, so they spread out or close up with it.
let feltH = +store.get('duo_felt_h') || 0, feltResize = null;
const FELT_MIN = 220, FELT_MAX = 1600;
function setFeltH(h){
  const felt = document.getElementById('felt'); if(!felt) return;
  feltH = h ? Math.round(Math.min(FELT_MAX, Math.max(FELT_MIN, h))) : 0;
  felt.style.height = feltH ? feltH + 'px' : ''; felt.style.aspectRatio = feltH ? 'auto' : '';
  store.set('duo_felt_h', feltH ? String(feltH) : '');
}
document.addEventListener('pointerdown', e=>{
  const grip = e.target.closest('[data-felt-resize]'); if(!grip || e.button !== 0) return;
  e.preventDefault(); grip.setPointerCapture(e.pointerId);
  feltResize = {y: e.clientY, h: document.getElementById('felt').offsetHeight, id: e.pointerId};
  document.body.classList.add('feltresizing');
});
document.addEventListener('pointermove', e=>{ if(feltResize && e.pointerId === feltResize.id) setFeltH(feltResize.h + e.clientY - feltResize.y); });
const endFeltResize = e=>{ if(feltResize && e.pointerId === feltResize.id){ feltResize = null; document.body.classList.remove('feltresizing'); } };
document.addEventListener('pointerup', endFeltResize);
document.addEventListener('pointercancel', endFeltResize);
out.addEventListener('dblclick', e=>{ if(e.target.closest('[data-felt-resize]')) setFeltH(0); });
out.addEventListener('keydown', e=>{
  if(!e.target.closest || !e.target.closest('[data-felt-resize]')) return;
  const step = {ArrowUp: -40, ArrowDown: 40}[e.key]; if(!step) return;
  e.preventDefault(); setFeltH(document.getElementById('felt').offsetHeight + step);
});

// ---- dragging (mouse, pen or touch): onto the board anywhere, or back into the bag ----
let scDrag = null, scJustDragged = false;
document.addEventListener('pointerdown', e=>{
  const el = e.target.closest('#badgebox .sci');
  if(!el || e.button !== 0 || !canArrange()) return;
  const r = el.getBoundingClientRect();
  // remember where on the medallion it was grabbed, so it doesn't jump under the pointer
  scDrag = {el, x: e.clientX, y: e.clientY, id: e.pointerId, ghost: null, dx: e.clientX - (r.left + r.width/2), dy: e.clientY - (r.top + r.height/2)};
});
document.addEventListener('pointermove', e=>{
  if(!scDrag || e.pointerId !== scDrag.id) return;
  if(!scDrag.ghost){
    if(Math.hypot(e.clientX - scDrag.x, e.clientY - scDrag.y) < 5) return;
    hideTip();
    scDrag.ghost = scDrag.el.cloneNode(true);
    scDrag.ghost.removeAttribute('style'); scDrag.ghost.style.setProperty('--c', scDrag.el.style.getPropertyValue('--c'));
    scDrag.ghost.className += ' scghost'; scDrag.ghost.removeAttribute('data-tip-html');
    document.body.appendChild(scDrag.ghost);
    scDrag.el.classList.add('placeholder');
    document.body.classList.add('scdragging');
  }
  e.preventDefault();
  scDrag.ghost.style.left = (e.clientX - scDrag.dx) + 'px'; scDrag.ghost.style.top = (e.clientY - scDrag.dy) + 'px';
  const at = document.elementFromPoint(e.clientX, e.clientY);
  document.getElementById('felt').classList.toggle('dropto', !!(at && at.closest('#felt')));
  document.getElementById('bag').classList.toggle('dropto', !!(at && at.closest('#bag')));
});
function endScDrag(e){
  if(!scDrag) return;
  const d = scDrag; scDrag = null;
  if(!d.ghost) return;
  d.ghost.remove(); d.el.classList.remove('placeholder'); document.body.classList.remove('scdragging');
  ['felt','bag'].forEach(id=>{ const el = document.getElementById(id); if(el) el.classList.remove('dropto'); });
  scJustDragged = true; setTimeout(()=>scJustDragged = false, 0);
  if(e.type === 'pointercancel') return;
  const at = document.elementFromPoint(e.clientX, e.clientY), key = d.el.dataset.sc;
  if(at && at.closest('#felt')){
    const r = document.getElementById('felt').getBoundingClientRect();
    placeBadge(key, (e.clientX - d.dx - r.left) / r.width, (e.clientY - d.dy - r.top) / r.height);
    redrawShowcase();
  }else if(at && at.closest('#bag') && d.el.closest('#felt')){
    bagBadge(key); redrawShowcase();
  }
}
document.addEventListener('pointerup', endScDrag);
document.addEventListener('pointercancel', endScDrag);

// keyboard: arrows nudge a medallion on the board (Shift: bigger steps), Delete / Backspace puts it back in the bag,
// Shift + arrow on a bagged badge puts it in the middle of the board
out.addEventListener('keydown', e=>{
  const el = e.target.closest && e.target.closest('#badgebox .sci');
  if(!el || !canArrange()) return;
  const key = el.dataset.sc, inBag = !el.closest('#felt');
  const step = {ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1]}[e.key];
  if(!inBag && (e.key === 'Delete' || e.key === 'Backspace')){ e.preventDefault(); bagBadge(key); redrawShowcase(); return; }
  if(!step) return;
  if(inBag && !e.shiftKey) return;
  e.preventDefault();
  const v = board()[key], size = e.shiftKey ? .04 : .01;
  if(inBag) placeBadge(key, .5, .5);
  else placeBadge(key, v.x + step[0] * size, v.y + step[1] * size * 1.6);
  redrawShowcase(key);
});

// ---- click: relive the game ----
onActivate('.sci', el=>{
  if(scJustDragged) return;
  const it = showcaseItems.get(el.dataset.sc);
  if(it && el.dataset.stack){   // a stack in the bag: open it
    hideTip(); bagStack = stackOf(it); redrawBag();
    const first = document.querySelector('#bagin .sci'); if(first) first.focus({preventScroll: true});
    return;
  }
  if(it) openMatch(it.x.matchId, m=>badgeStory(it, m));
});

const ordinal = n => { const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v-20) % 10] || s[v] || s[0]); };
function partOfDay(h){ return h < 5 ? '🌙 Late night' : h < 12 ? '🌅 Morning' : h < 17 ? '☀️ Afternoon' : h < 21 ? '🌆 Evening' : '🌃 Night'; }

// the story of one badge: when, who, what you did, who was with you
function badgeStory(it, m){
  const {b, i, p} = it;
  const rows = m.teams.flatMap(t=>t.players.map(r=>({...r, duration: m.duration, remake: m.remake})));
  const me = rows.find(r=>r.player === i) || it.x, mate = rows.find(r=>r.player != null && r.player !== i);
  const myTeam = m.teams.find(t=>t.players.some(r=>r.player === i));
  const d = new Date(m.start), h = d.getHours();
  // which game of the day this was, among the games you saved
  const day = dayOf(m.start), ofDay = recentGames(lastData.players).map(g=>g.x).filter(g=>dayOf(g.start) === day).sort((a,b)=>a.start-b.start);
  const nth = ofDay.findIndex(g=>String(g.matchId) === String(m.matchId)) + 1;
  const allBadges = rows.filter(r=>r.player != null).map(r=>({r, list: gameBadges(r)}));
  const mk = MULTIKILL_BADGES.filter(([k])=>me[k]).map(([k,cls,label])=>`<span class="mkb ${cls}">${label}<i>${me[k]}</i></span>`).join('');
  const stat = (v, k, sub) => `<div class="bsstat"><b>${v}</b><span>${k}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const won = myTeam ? myTeam.win : me.win;
  return `<div class="bstory b-${b.id}" style="--c:${COLORS[i]}">
    <div class="bshead"><span class="med big" aria-hidden="true">${badgeArt(b.id, me.champion, b.ic)}</span>
      <div><div class="bsname">${esc(b.name)}</div>
        <div class="bswho">Earned by <b style="color:${COLORS[i]}">${esc(shortName(p.riotId))}</b> on <b>${esc(me.champion)}</b></div>
        <div class="bswhat">${esc(b.what)}</div></div></div>
    <div class="bswhen"><div class="bsdate">${esc(d.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric', year:'numeric'}))}</div>
      <div class="bstime">${esc(d.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'}))} · ${timeAgo(m.start)}
        <span class="tag">${partOfDay(h)}</span>${nth ? `<span class="tag">${ordinal(nth)} game of the day</span>` : ''}</div></div>
    <div class="bsstats">
      ${stat(m.remake ? 'Remake' : won ? '<span class="ok">Victory</span>' : '<span class="err">Defeat</span>', esc(QUEUES[m.queueId] || 'Game'),
             `${Math.floor(m.duration/60)}m ${String(m.duration%60).padStart(2,'0')}s`)}
      ${stat(`${me.kills}/${me.deaths}/${me.assists}`, 'K / D / A', `${f1(kdaOf(me))} KDA`)}
      ${stat(f0(me.damage), 'damage', `${pct(me.dmgShare)} of the team`)}
      ${stat(pct(me.kp), 'kill participation', `${me.cs} CS · ${f0(me.gold)} gold`)}
      ${stat(scoreBadge(perfScore(me)), 'score', me.grade ? `grade ${esc(me.grade)}` : '')}
    </div>
    ${mk ? `<div class="tags bsmk">${mk}</div>` : ''}
    ${mate ? `<div class="bsmate" style="--c:${COLORS[mate.player]}">${icon(mate.champion)}<div>With <b>${esc(mate.name || 'your duo')}</b> on ${esc(mate.champion)}
      · ${mate.kills}/${mate.deaths}/${mate.assists}${mate.grade ? ` · grade ${esc(mate.grade)}` : ''}</div></div>` : ''}
    ${allBadges.some(x=>x.list.length) ? `<div class="bsall"><span>Badges earned this game</span>${allBadges.map(({r, list})=>list.length
      ? `<div class="bsrow"><b style="color:${COLORS[r.player]}">${esc(r.name)}</b>${badgeChips(list)}</div>` : '').join('')}</div>` : ''}
  </div>
  <h2 class="bsfull">Full match</h2>`;
}
