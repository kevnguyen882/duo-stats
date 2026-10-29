// Overview tab: the played-together bar, each player's card, head to head, multikills and top champions.

function rankText(r){
  const fmt = (q,label)=>{ const e = r && r[q]; if(!e || !e.tier) return null;
    const t = e.tier[0] + e.tier.slice(1).toLowerCase();
    const div = ['MASTER','GRANDMASTER','CHALLENGER'].includes(e.tier) ? '' : ' '+e.rank;
    return `${label}: ${t}${div} · ${e.leaguePoints} LP (${e.wins}W ${e.losses}L)`; };
  return [fmt('RANKED_SOLO_5x5','Solo'), fmt('RANKED_FLEX_SR','Flex')].filter(Boolean).join('<br>') || 'Unranked this season';
}

function loadedText(p){
  const n = src => p.games.filter(g=>g.source===src).length;
  const rm = p.games.filter(g=>g.remake).length;
  const parts = [];
  if(n('client')) parts.push(`${n('client')} from the League client`);
  if(n('api')) parts.push(`${n('api')} from Riot's API`);
  return `<b>${p.games.length} games</b>${rm ? ` (${p.games.length-rm} counted, ${rm} remake${rm>1?'s':''})` : ''}`
    + (parts.length ? `: ${parts.join(' · ')}` : '');
}

// ---- the played-together bar (win rate is the same for both of you, so it's shown once) ----
function togetherBar(p1){
  const t = agg(p1.games), remakes = p1.games.filter(g=>g.remake).length;
  if(!t) return '';
  return `<div class="panel together"><span class="tlbl">Played together</span>
    <span><b>${t.n}</b> games</span><span><b class="w">${t.wins}W</b> <b class="lo">${t.losses}L</b></span>
    <span><b class="${t.wr>=.5?'w':'lo'}">${pct(t.wr)}</b> win rate</span>
    ${remakes ? `<span class="tts">${remakes} remake${remakes>1?'s':''} not counted</span>` : ''}</div>`;
}

// ---- each player's card ----
function champTip(t){
  const xp = Math.round(t.parts.experience);
  return `${t.champ}: score ${t.score}\n${t.n} game${t.n>1?'s':''} · ${t.wins}W ${t.n-t.wins}L · ${f2(t.kda)} KDA`
    + `\nExperience ${xp >= 0 ? '+' : ''}${xp} (${xp > 2 ? 'played a lot and doing well' : xp < -2 ? 'played a lot but struggling' : 'about even'})`
    + (t.pentas||t.quadras||t.triples ? `\n${t.pentas} penta · ${t.quadras} quadra · ${t.triples} triple` : '');
}
function topChampTile(p, wide){
  const top = champScores(p.games).slice(0, wide ? 12 : 3);   // the row shows as many as fit; the rest are hidden
  if(!top.length) return '<div class="stat"><small>Top champions</small><b>–</b></div>';
  return `<div class="stat topch ${wide?'wide':''}"><small>Top champions</small><div class="tcs">${top.map((t,i)=>
    `<div class="tc ${i===0?'first':''}" title="${esc(champTip(t))}">${icon(t.champ)}<span>${t.score}</span></div>`).join('')}</div></div>`;
}
function playerCard(p, color, shared){
  const a = agg(p.games);
  const cs = p.games.filter(g=>!g.remake).reduce((t,g)=>t+(g.cs||0), 0);
  const body = a ? `<div class="stats">
      ${shared ? '' : `<div class="stat"><small>Win rate</small><b>${pct(a.wr)}</b><small>${a.wins}W ${a.losses}L</small></div>`}
      <div class="stat"><small>KDA</small><b>${f2(a.kda)}</b><small>${f1(a.k)} / ${f1(a.d)} / ${f1(a.a)}</small></div>
      <div class="stat"><small>Kill part.</small><b>${pct(a.kp)}</b></div>
      <div class="stat"><small>Dmg / min</small><b>${f0(a.dpm)}</b></div>
      <div class="stat"><small>Total CS</small><b>${cs.toLocaleString()}</b><small>across ${a.n} game${a.n===1?'':'s'}</small></div>
      ${topChampTile(p, shared)}
    </div>` : '<p class="empty">No games found for this filter.</p>';
  return `<div class="card" style="--c:${color}"><div class="name">${esc(p.riotId)}</div>
    <div class="rank">${rankText(p.ranks)}</div>${body}
    <div class="note">${loadedText(p)}</div>
    ${p.games.length ? `<div class="note">Latest game ${timeAgo(p.games[0].start)} (${fmtDate(p.games[0].start)}) · oldest ${fmtDate(p.games[p.games.length-1].start)}</div>` : ''}</div>`;
}

// ---- head to head ----
function vsRows(a, b){
  const rows = [['KDA','kda',f2],['Kill part.','kp',pct],['CS / min','csm',f1],['Dmg / min','dpm',f0],
                ['Gold / min','gpm',f0],['Deaths','d',f1,true]];
  return rows.map(([label,k,fmt,lowerBetter])=>{
    const x = a[k], y = b[k]; if(x==null || y==null) return '';
    const tot = (x+y) || 1;
    const aWins = lowerBetter ? x<y : x>y, bWins = lowerBetter ? y<x : y>x;
    return `<div class="vsrow"><div class="l ${aWins?'lead':''}">${fmt(x)}</div>
      <div class="bar left"><i style="width:${x/tot*100}%;background:var(--p1)"></i></div>
      <div class="m">${label}</div>
      <div class="bar"><i style="width:${y/tot*100}%;background:var(--p2)"></i></div>
      <div class="r ${bWins?'lead':''}">${fmt(y)}</div></div>`;
  }).join('');
}
function headToHead(p1, p2){
  const a = agg(p1.games), b = agg(p2.games);
  if(!a || !b) return '';
  return `<h2>Head to head</h2><div class="panel"><div class="vshead">
    <span style="color:var(--p1)" title="${esc(p1.riotId)}">${esc(shortName(p1.riotId))}</span>
    <span style="color:var(--p2)" title="${esc(p2.riotId)}">${esc(shortName(p2.riotId))}</span></div><div class="vs">${vsRows(a,b)}</div></div>`;
}

// ---- multikills: click a tile to see which champions they came on ----
const MULTIKILLS = [['pentas','Pentakills','pentakill'],['quadras','Quadrakills','quadrakill'],['triples','Triple kills','triple kill']];
const mkSelected = {};   // which tile is selected on each player's card
function multikills(p, color, idx){
  const g = p.games.filter(x=>!x.remake);
  const sel = mkSelected[idx] || 'pentas';
  const total = k => g.reduce((a,x)=>a+(x[k]||0), 0);
  const lists = MULTIKILLS.map(([k,,one])=>{
    const by = {};
    g.filter(x=>x[k]>0).forEach(x=>{ by[x.champion] = (by[x.champion]||0) + x[k]; });
    const champs = Object.entries(by).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
    const body = champs.length ? `<div class="pk ${k}">${champs.map(([ch,n])=>`<div class="pkc" title="${esc(ch)}: ${n} ${one}${n>1?'s':''}">
        <div class="pki">${icon(ch)}<span class="pkn">${n}</span></div><div class="pkl">${esc(ch)}</div></div>`).join('')}</div>`
      : `<div class="pkempty">No ${one}s in these games yet.</div>`;
    return `<div data-mklist="${k}" class="${k===sel?'':'hidden'}">${body}</div>`;
  }).join('');
  return `<div class="panel" data-mkcard="${idx}"><div class="colhead" style="--c:${color}">${esc(p.riotId)}</div>
    <div class="mk" role="tablist">${MULTIKILLS.map(([k,label])=>`<div class="stat mkt ${k} ${k===sel?'on':''}" role="tab" tabindex="0"
      aria-selected="${k===sel}" data-mk="${k}"><small>${label}</small><b>${total(k)}</b></div>`).join('')}</div>${lists}</div>`;
}
onActivate('[data-mk]', el=>{
  const card = el.closest('[data-mkcard]'), k = el.dataset.mk;
  mkSelected[card.dataset.mkcard] = k;
  card.querySelectorAll('[data-mk]').forEach(t=>{ const on = t.dataset.mk===k; t.classList.toggle('on',on); t.setAttribute('aria-selected',on); });
  card.querySelectorAll('[data-mklist]').forEach(l=>l.classList.toggle('hidden', l.dataset.mklist!==k));
});

// ---- top champions: every champion, sortable by clicking a column header ----
const champSort = {};   // per player: {key, dir}
const SORTABLE = ['n','mins','wr','kda'];
function champTableBody(p, idx){
  const by = {}; p.games.forEach(x=>{ (by[x.champion] = by[x.champion] || []).push(x); });
  const st = champSort[idx] || {key:'n', dir:-1};
  // minutes count every game on the champion (remakes included), matching the Time played tab
  const rows = Object.entries(by).map(([c,g])=>{ const a = agg(g); if(a) a.mins = g.reduce((t,x)=>t+(x.duration||0),0)/60; return {c,a}; })
    .filter(r=>r.a).sort((x,y)=> st.dir*(x.a[st.key]-y.a[st.key]) || y.a.n-x.a.n || x.c.localeCompare(y.c));
  if(!rows.length) return '<p class="empty">No games.</p>';
  const th = (k, label) => SORTABLE.includes(k)
    ? `<th class="num sortable ${st.key===k?'on':''}" data-csort="${k}" data-cidx="${idx}" role="button" tabindex="0"
         aria-sort="${st.key===k?(st.dir<0?'descending':'ascending'):'none'}">${label}<span class="arr">${st.key===k?(st.dir<0?'▼':'▲'):'↕'}</span></th>`
    : `<th class="num">${label}</th>`;
  return `<div class="ctwrap"><table class="ctable"><thead><tr><th>Champion <span class="tts">(${rows.length})</span></th>
    ${th('n','Games')}${th('mins','Minutes')}${th('wr','WR')}${th('kda','KDA')}</tr></thead><tbody>
    ${rows.map(r=>`<tr><td>${icon(r.c)}${esc(r.c)}</td><td class="num">${r.a.n}</td><td class="num">${Math.round(r.a.mins).toLocaleString()}</td>
      <td class="num ${r.a.wr>=.5?'w':'lo'}">${pct(r.a.wr)}</td><td class="num">${f2(r.a.kda)}</td></tr>`).join('')}</tbody></table></div>`;
}
onActivate('[data-csort]', el=>{
  const idx = el.dataset.cidx, k = el.dataset.csort, st = champSort[idx] || {key:'n', dir:-1};
  champSort[idx] = st.key === k ? {key:k, dir:-st.dir} : {key:k, dir:-1};   // a new column starts highest first
  const box = document.querySelector(`[data-ctable="${idx}"]`);
  box.innerHTML = champTableBody(lastData.players[idx], idx);
  box.querySelector(`[data-csort="${k}"]`).focus({preventScroll:true});
});

function overviewTab(players){
  const [p1, p2] = players, cols = p2 ? 'grid2' : '';
  let h = p2 ? togetherBar(p1) : '';
  h += `<div class="${cols}">${players.map((p,i)=>playerCard(p, COLORS[i], !!p2)).join('')}</div>`;
  if(p2) h += headToHead(p1, p2);
  h += `<h2>Multikills</h2><div class="${cols}">${players.map((p,i)=>multikills(p, COLORS[i], i)).join('')}</div>`;
  h += `<h2>Top champions</h2><div class="${cols}">${players.map((p,i)=>`<div class="panel"><div class="colhead" style="--c:${COLORS[i]}">${esc(p.riotId)}</div>
    <div data-ctable="${i}">${champTableBody(p, i)}</div></div>`).join('')}</div>`;
  return h;
}
