// Best games tab: your top games by score, with the other player's result in the same game underneath.
// Filter by when the game was played (a day, week or month, stepping back with Older / Newer, or all time), and by
// player: both of you together (each game once), or ranked by one player's score with the other underneath.
// Click a game for its match details.

const MULTIKILL_BADGES = [['pentas','penta','Pentakill'],['quadras','quadra','Quadra'],['triples','triple','Triple']];

function bestGameRow(entry, rank, second){
  const x = entry.x, tags = [];
  MULTIKILL_BADGES.forEach(([k,cls,label])=>{
    if(x[k]) tags.push(`<span class="mkb ${cls}" title="${x[k]} ${label.toLowerCase()}${x[k]>1?'s':''}">${label}<i>${x[k]}</i></span>`); });
  tags.push(`<span class="tag">${x.win?'Win':'Loss'}</span>`);
  if(x.grade) tags.push(`<span class="gchip">${esc(x.grade)}</span>`);
  if(x.kp!=null) tags.push(`<span class="tag">${pct(x.kp)} kill part.</span>`);
  if(x.dmgShare!=null) tags.push(`<span class="tag">${pct(x.dmgShare)} of team dmg</span>`);
  if(!second) tags.push(`<span class="tag">${esc(QUEUES[x.queueId]||'Other')} · ${timeAgo(x.start)}</span>`);
  return `<div class="hlc ${second?'second':''}" style="--c:${entry.c}"><div class="rk">${second ? '↳' : rank}</div>${icon(x.champion)}
    <div><div class="t"><b style="color:${entry.c}">${esc(shortName(entry.p.riotId))}</b> · ${esc(x.champion)} · ${x.kills}/${x.deaths}/${x.assists}</div>
      <div class="tags">${tags.join('')}</div>
      ${badgeChips(gameBadges(x, {multikills: false}))}</div>
    <div class="score">${scoreBadge(entry.s)}<small>score</small></div></div>`;
}

const BEST_RANGES = [['today','Day'], ['week','Week'], ['month','Month'], ['all','All time']];
let bestRange = store.get('duo_best_range') || 'all';
if(!BEST_RANGES.some(([k])=>k===bestRange)) bestRange = 'all';
let bestBack = 0;   // how many days / weeks / months back from the current one
let bestWho = store.get('duo_best_who') || 'both';   // 'both', or a player's index ('0' / '1')
const BEST_SHOWN = 10;

// the period being shown: [from, to) in ms, its name, and the dates it covers
function bestPeriod(range, back){
  const fmt = (ms, o) => new Date(ms).toLocaleDateString(undefined, o), md = {month:'short', day:'numeric'};
  if(range === 'today'){
    const from = addDays(dayOf(Date.now()), -back), to = addDays(from, 1);
    return {from, to, name: back === 0 ? 'Today' : back === 1 ? 'Yesterday' : fmt(from, {weekday:'long'}),
            dates: fmt(from, {weekday:'short', ...md})};
  }
  if(range === 'week'){
    const from = addWeeks(mondayOf(Date.now()), -back), to = addWeeks(from, 1);
    return {from, to, name: back === 0 ? 'This week' : back === 1 ? 'Last week' : `${back} weeks ago`,
            dates: `${fmt(from, md)} – ${fmt(to-1, md)}`};
  }
  if(range === 'month'){
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(1); d.setMonth(d.getMonth()-back);
    const from = d.getTime(); d.setMonth(d.getMonth()+1);
    return {from, to: d.getTime(), name: back === 0 ? 'This month' : back === 1 ? 'Last month' : fmt(from, {month:'long'}),
            dates: fmt(from, {month:'long', year:'numeric'})};
  }
  return {from: 0, to: Infinity};
}

function bestTab(players){
  if(!players[+bestWho]) bestWho = 'both';
  const who = players.length > 1 ? [['both','Both'], ...players.map((p,i)=>[String(i), shortName(p.riotId)])] : [];
  return `<div class="srtools"><div class="seg" role="group" aria-label="Best games from">${BEST_RANGES.map(([k,l])=>
      `<button data-best-range="${k}" class="${bestRange===k?'on':''}" aria-pressed="${bestRange===k}">${l}</button>`).join('')}</div>
    ${who.length ? `<div class="seg" role="group" aria-label="Whose games">${who.map(([k,l])=>
      `<button data-best-who="${k}" class="${bestWho===k?'on':''}" aria-pressed="${bestWho===k}">${esc(l)}</button>`).join('')}</div>` : ''}</div>
    <div id="bestbox">${bestBox(players)}</div>`;
}
function bestBox(players){
  if(bestRange === 'all') return bestList(players, bestPeriod('all'));
  const per = bestPeriod(bestRange, bestBack);
  const oldest = Math.min(...players.flatMap(p=>p.games.map(g=>g.start||Infinity)));
  return `<div class="wknav"><button class="ghost" data-best-back="1" ${per.from <= oldest ? 'disabled' : ''}>◀ Older</button>
      <b>${esc(per.name)}<small>${esc(per.dates)}</small></b>
      <button class="ghost" data-best-back="-1" ${bestBack === 0 ? 'disabled' : ''}>Newer ▶</button></div>
    ${bestList(players, per)}`;
}
onClick('[data-best-range]', b=>{
  bestRange = b.dataset.bestRange; bestBack = 0; store.set('duo_best_range', bestRange);
  document.querySelectorAll('[data-best-range]').forEach(x=>{ const on = x===b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  document.getElementById('bestbox').innerHTML = bestBox(lastData.players);
});
onClick('[data-best-who]', b=>{
  bestWho = b.dataset.bestWho; store.set('duo_best_who', bestWho);
  document.querySelectorAll('[data-best-who]').forEach(x=>{ const on = x===b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  document.getElementById('bestbox').innerHTML = bestBox(lastData.players);
});
onClick('[data-best-back]', b=>{
  if(b.disabled) return;
  bestBack = Math.max(0, bestBack + +b.dataset.bestBack);
  document.getElementById('bestbox').innerHTML = bestBox(lastData.players);
  const again = document.querySelector(`[data-best-back="${b.dataset.bestBack}"]`);   // keep focus on the same button
  if(again && !again.disabled) again.focus();
});

function bestList(players, per){
  // one entry per game, with the other player underneath. Both: the higher score leads. One player: they always lead,
  // and only their score decides the ranking.
  const byGame = {};
  players.forEach((p,i)=>p.games.filter(x=>!x.remake && (x.start||0) >= per.from && (x.start||0) < per.to).forEach(x=>{
    (byGame[x.matchId] = byGame[x.matchId] || []).push({x, p, i, c:COLORS[i], s:perfScore(x)}); }));
  const lead = bestWho === 'both' ? (a,b)=>b.s-a.s : (a,b)=>(String(b.i)===bestWho) - (String(a.i)===bestWho);
  const top = Object.values(byGame).filter(r=>bestWho === 'both' || r.some(e=>String(e.i)===bestWho))
    .map(r=>r.sort(lead)).sort((a,b)=>b[0].s-a[0].s).slice(0, BEST_SHOWN);
  if(!top.length) return `<p class="empty">${bestRange === 'all' ? 'No games yet.' : `No games ${bestBack ? 'in this period' : 'yet'}.`}</p>`;
  return `<div class="hl">${top.map((g,n)=>`<div class="hlg" data-match="${esc(g[0].x.matchId)}" role="button" tabindex="0" aria-label="Match details">${bestGameRow(g[0], n+1, false)}${g.slice(1).map(e=>bestGameRow(e, '', true)).join('')}</div>`).join('')}</div>
    <p class="note">Score blends damage, game length, KDA, kill participation, share of team damage, the win and any multikills; long, high-damage games score highest. Hover a badge to see what it's for, and click a game for its full details.</p>`;
}
