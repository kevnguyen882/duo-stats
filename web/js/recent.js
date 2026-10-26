// Match history tab: the latest games, one tile per game. Player 1 is on the left, player 2 mirrored on the right,
// and the game itself (result, mode, length, when) sits in the middle. A game where both of you got S+ gets a
// flaming gold border. 10 games a page, with Older / Newer to page through. Click a game for its match details.
// Filter by champion (part of the name), played by either of you or by one of you in particular.

const RECENT_PER_PAGE = 10;
let recentPage = 0;   // 0 is the newest page
let recentChamp = '', recentWho = 'both';   // champion filter, and whose champion it applies to ('both' = either, '0' / '1')

function resultOf(x){
  return x.remake ? ['Remake', 'var(--muted)'] : x.win ? ['Win', 'var(--win)'] : ['Loss', 'var(--loss)'];
}

// one player's half of a tile; side 'b' is mirrored so the icons sit on the outer edges
function recentSide(x, i, side, doubleS){
  if(!x) return `<div class="rgs ${side} none"></div>`;
  const [res, col] = resultOf(x);
  const grade = x.grade === 'S+' ? `<span class="n flame rgflame" style="--k:${doubleS ? 'var(--both)' : COLORS[i]}" title="S+">${FLAME}<em>S+</em></span>`   // as on S Rank
    : x.grade ? `<span class="gchip">${esc(x.grade)}</span>` : '', name = esc(x.champion);
  return `<div class="rgs ${side}" style="--c:${COLORS[i]}">${icon(x.champion)}
    <div class="rgw"><div class="t">${side === 'b' ? grade + name : name + grade}</div>
      <div class="rgk"><b>${x.kills}/${x.deaths}/${x.assists}</b><span class="d sep"> · </span><span class="d">${x.cs} CS · ${f0(x.damage)} dmg</span></div>
      ${x.vsDuo ? `<div class="d" style="color:${col}">${res}</div>` : ''}${augIcons(x.augments)}</div></div>`;
}

function recentGames(players){
  // one entry per game, newest first, with each player's row (or nothing) in their slot
  const byGame = new Map();
  players.forEach((p,i)=>p.games.forEach(x=>{
    if(!byGame.has(x.matchId)) byGame.set(x.matchId, {x, rows: []});
    byGame.get(x.matchId).rows[i] = x;
  }));
  return [...byGame.values()].sort((a,b)=>(b.x.start||0)-(a.x.start||0));
}

function recentTab(players){
  if(recentWho !== 'both' && !players[+recentWho]) recentWho = 'both';
  const who = players.length > 1 ? [['both','Either of us'], ...players.map((p,i)=>[String(i), shortName(p.riotId)])] : [];
  return `<div class="srtools"><input id="recentq" type="search" placeholder="Champion" aria-label="Filter by champion" value="${esc(recentChamp)}" autocomplete="off">
      ${who.length ? `<div class="seg" role="group" aria-label="Played by">${who.map(([k,l])=>
        `<button data-recent-who="${k}" class="${recentWho===k?'on':''}" aria-pressed="${recentWho===k}">${esc(l)}</button>`).join('')}</div>` : ''}</div>
    <div id="recentbox">${recentBox(players)}</div>`;
}
// games that match the filters: the champion (any part of its name) played by the chosen player, or by either of you
function recentFiltered(players){
  const q = String(recentChamp).toLowerCase().replace(/[^a-z0-9]/g, '');
  const all = recentGames(players);
  if(!q) return all;
  return all.filter(({rows})=>rows.some((r, i)=>r && (recentWho === 'both' || String(i) === recentWho)
    && String(r.champion).toLowerCase().replace(/[^a-z0-9]/g, '').includes(q)));
}
out.addEventListener('input', e=>{
  if(e.target.id !== 'recentq') return;
  recentChamp = e.target.value; recentPage = 0;
  document.getElementById('recentbox').innerHTML = recentBox(lastData.players);
});
onClick('[data-recent-who]', b=>{
  recentWho = b.dataset.recentWho; recentPage = 0;
  document.querySelectorAll('[data-recent-who]').forEach(x=>{ const on = x===b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  document.getElementById('recentbox').innerHTML = recentBox(lastData.players);
});

function recentPager(page, pages, from, to, total){
  return `<div class="wknav rpager"><button class="ghost" data-recent-page="1" ${page >= pages-1 ? 'disabled' : ''}>◀ Older</button>
    <b>Page ${page+1} of ${pages}<small>Games ${from}–${to} of ${total}</small></b>
    <button class="ghost" data-recent-page="-1" ${page === 0 ? 'disabled' : ''}>Newer ▶</button></div>`;
}

function recentBox(players){
  const all = recentFiltered(players);
  if(!all.length) return `<p class="empty">${recentChamp.trim() ? 'No games match.' : 'No games.'}</p>`;
  const pages = Math.ceil(all.length / RECENT_PER_PAGE);
  recentPage = Math.min(recentPage, pages-1);
  const from = recentPage * RECENT_PER_PAGE, games = all.slice(from, from + RECENT_PER_PAGE);
  const pager = recentPager(recentPage, pages, from+1, from+games.length, all.length);
  const duo = players.length > 1;
  return `${pager}
    ${duo ? `<div class="rghead"><span style="color:${COLORS[0]}">${esc(shortName(players[0].riotId))}</span>
      <span style="color:${COLORS[1]}">${esc(shortName(players[1].riotId))}</span></div>` : ''}
    <div class="rgl">${games.map(({x, rows})=>{
      const vs = rows.filter(Boolean).some(r=>r.vsDuo);
      const [res, col] = vs ? ['Vs', 'var(--gold)'] : resultOf(x);
      const doubleS = duo && rows[0] && rows[1] && rows[0].grade === 'S+' && rows[1].grade === 'S+';
      return `<div class="rg ${duo ? '' : 'solo'} ${doubleS ? 'fire' : ''}" style="--r:${col}" data-match="${esc(x.matchId)}" role="button" tabindex="0" aria-label="Match details">
        ${recentSide(rows[0], 0, 'a', doubleS)}
        <div class="rgm"><b style="color:${col}">${res}</b>${doubleS ? '<span class="dbls">🔥 Double S+</span>' : ''}<span>${esc(QUEUES[x.queueId] || 'Other')}</span>
          <span>${Math.round(x.duration/60)}m · ${timeAgo(x.start)}</span></div>
        ${duo ? recentSide(rows[1], 1, 'b', doubleS) : ''}</div>`;
    }).join('')}</div>
    ${pages > 1 ? pager : ''}`;
}
onClick('[data-recent-page]', b=>{
  if(b.disabled) return;
  const atBottom = !!b.closest('.rpager:last-child');
  recentPage = Math.max(0, recentPage + +b.dataset.recentPage);
  const box = document.getElementById('recentbox');
  box.innerHTML = recentBox(lastData.players);
  if(atBottom) box.scrollIntoView({block: 'start', behavior: 'smooth'});   // paging from the bottom: back to the top of the list
  const pagers = box.querySelectorAll('.rpager'), again = pagers[atBottom ? pagers.length-1 : 0].querySelector(`[data-recent-page="${b.dataset.recentPage}"]`);
  if(again && !again.disabled) again.focus({preventScroll: true});
});
