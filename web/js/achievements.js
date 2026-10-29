// Badges tab, two views (filter either to both of you or one player):
//   Collection: a tile per badge (see badges.js) with the champions each of you has earned it on. Each champion icon has a
//     count bubble (as in the Overview's multikills); hover for the best time it happened, click to open that game.
//   Showcase: each player's badges, one medallion each, laid out on a felt board or kept in a bag (showcase.js).
//     There the player buttons pick whose showcase to look at; only your own can be rearranged.

let badgeWho = store.get('duo_badge_who') || 'both';   // 'both', or a player's index ('0' / '1')
let badgeView = store.get('duo_badge_view') === 'showcase' ? 'showcase' : 'collection';
const BADGE_VIEWS = [['collection','Collection'], ['showcase','Showcase']];

function badgesTab(players){
  return `<div class="srtools" id="badgetools">${badgeTools(players)}</div><div id="badgebox">${badgeContent(players)}</div>`;
}
function badgeTools(players){
  if(!players[+badgeWho]) badgeWho = 'both';
  const views = `<div class="seg" role="group" aria-label="View">${BADGE_VIEWS.map(([k,l])=>
      `<button data-badge-view="${k}" class="${badgeView===k?'on':''}" aria-pressed="${badgeView===k}">${l}</button>`).join('')}</div>`;
  if(players.length < 2) return views;
  if(badgeView === 'showcase'){   // whose showcase to look at
    const vi = viewedShowcase(), mine = myShowcase();
    return views + `<div class="seg" role="group" aria-label="Whose showcase">${players.map((p,i)=>
      `<button data-showcase-who="${i}" class="${vi===i?'on':''}" aria-pressed="${vi===i}">${esc(shortName(p.riotId))}${i===mine?' (you)':''}</button>`).join('')}</div>`;
  }
  const who = [['both','Both'], ...players.map((p,i)=>[String(i), shortName(p.riotId)])];
  return views + `<div class="seg" role="group" aria-label="Whose badges">${who.map(([k,l])=>
      `<button data-badge-who="${k}" class="${badgeWho===k?'on':''}" aria-pressed="${badgeWho===k}">${esc(l)}</button>`).join('')}</div>`;
}
onClick('[data-showcase-who]', b=>{
  showcaseWho = b.dataset.showcaseWho; store.set('duo_showcase_who', showcaseWho);
  document.getElementById('badgetools').innerHTML = badgeTools(lastData.players);
  redrawBadges();
});
function badgeContent(players){ return badgeView === 'showcase' ? showcaseBox(players) : badgeBox(players); }
function redrawBadges(){ document.getElementById('badgebox').innerHTML = badgeContent(lastData.players); }
onClick('[data-badge-view]', b=>{
  badgeView = b.dataset.badgeView; store.set('duo_badge_view', badgeView);
  document.getElementById('badgetools').innerHTML = badgeTools(lastData.players);
  redrawBadges();
});
onClick('[data-badge-who]', b=>{
  badgeWho = b.dataset.badgeWho; store.set('duo_badge_who', badgeWho);
  document.querySelectorAll('[data-badge-who]').forEach(x=>{ const on = x===b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  redrawBadges();
});

function badgeBox(players){
  // badge id -> one Map per player: champion -> {n: times earned, game: the highest-scoring game it was earned in}
  const won = Object.fromEntries(BADGES.map(({id})=>[id, players.map(()=>new Map())]));
  players.forEach((p,i)=>p.games.forEach(x=>{
    const s = perfScore(x);
    gameBadges(x).forEach(b=>{
      const m = won[b.id][i], cur = m.get(x.champion) || {n: 0, s: -1};
      cur.n++;
      if(s > cur.s) Object.assign(cur, {s, game: x, what: b.what});
      m.set(x.champion, cur);
    });
  }));
  const shown = players.map((p,i)=>badgeWho === 'both' || String(i) === badgeWho);
  const tiles = BADGES.map(({id, ic, name, how: rule})=>{
    const per = won[id], total = per.reduce((a,m,i)=>a + (shown[i] ? [...m.values()].reduce((s,v)=>s+v.n, 0) : 0), 0);
    return {id, ic, name, rule, per, total};
  });
  tiles.sort((a,b)=>(b.total > 0) - (a.total > 0));   // unlocked first, otherwise in the usual badge order
  const unlocked = tiles.filter(t=>t.total).length;
  return `<div class="achsum"><b>${unlocked}</b> of ${BADGES.length} badges unlocked
      <span>Every badge you've earned, and the champions you earned it on. Click a champion to open the game.</span></div>
    <div class="achs">${tiles.map(t=>achTile(t, players, shown)).join('')}</div>`;
}

function achTile(t, players, shown){
  const rows = players.map((p,i)=>{
    if(!shown[i]) return '';
    const champs = [...t.per[i].entries()].sort((a,b)=>b[1].n - a[1].n || b[1].s - a[1].s);
    const games = champs.reduce((a,[,v])=>a+v.n, 0);
    return `<div class="achp" style="--c:${COLORS[i]}">
      <div class="achn"><b>${esc(shortName(p.riotId))}</b><span>${games
        ? `${games}× · ${champs.length} champion${champs.length>1?'s':''}` : 'Not yet'}</span></div>
      ${champs.length ? `<div class="achc">${champs.map(([c,v])=>`<div class="pkc achi" role="button" tabindex="0" data-match="${esc(v.game.matchId)}"
        data-tip-title="${esc(c)} · ${v.n} time${v.n>1?'s':''}" data-tip="${esc(v.what)}${v.n>1?' (the best of them)':''} Click to open that game.">
        <div class="pki">${icon(c)}<span class="pkn">${v.n}</span></div><div class="pkl">${esc(c)}</div></div>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  // the tile's badge shows the champion it was earned on most (by whoever is shown); a locked one is an empty border
  let top = null;
  players.forEach((p,i)=>{ if(shown[i]) t.per[i].forEach((v, c)=>{ if(!top || v.n > top.n) top = {c, n: v.n}; }); });
  return `<div class="ach b-${t.id} ${t.total ? '' : 'locked'}">
    <div class="achh"><span class="achic" aria-hidden="true">${badgeArt(t.id, top && top.c, '')}</span>
      <div><b>${esc(t.name)}</b><div class="d">${esc(t.rule)}</div></div>
      <span class="acht">${t.total ? `${t.total}×` : 'Locked'}</span></div>
    ${rows}</div>`;
}
