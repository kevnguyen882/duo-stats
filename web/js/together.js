// Together tab: games, win rate and time played together, and your champion pairings.

function togetherTab(p1, p2){
  const d = agg(p1.games);
  if(!d) return '<div class="panel empty">No games together yet. Play a game with League open, or try a different queue filter.</div>';
  const theirs = Object.fromEntries(p2.games.map(x=>[x.matchId, x]));
  const pairs = {};
  p1.games.filter(x=>!x.remake).forEach(x=>{ const y = theirs[x.matchId]; if(!y) return;
    const k = x.champion+'|'+y.champion;
    (pairs[k] = pairs[k] || {a:x.champion, b:y.champion, n:0, w:0}); pairs[k].n++; if(x.win) pairs[k].w++; });
  const top = Object.values(pairs).sort((a,b)=>b.n-a.n || b.w/b.n-a.w/a.n).slice(0,8);
  return `<div class="panel">
    <div class="big">
      <div><div class="n">${d.n}</div><div class="lbl">games together</div></div>
      <div><div class="n ${d.wr>=.5?'w':'lo'}">${pct(d.wr)}</div><div class="lbl">win rate (${d.wins}W ${d.losses}L)</div></div>
      <div><div class="n">${fmtTime(p1.games.reduce((t,g)=>t+(g.duration||0),0))}</div><div class="lbl">played together</div></div>
    </div>
    ${top.length ? `<h2 style="margin-top:20px">Your champion pairings</h2>
    <table><tr><th style="color:var(--p1)">${esc(shortName(p1.riotId))}</th><th style="color:var(--p2)">${esc(shortName(p2.riotId))}</th>
      <th class="num">Games</th><th class="num">Win rate</th></tr>
      ${top.map(x=>`<tr><td>${icon(x.a)}${esc(x.a)}</td><td>${icon(x.b)}${esc(x.b)}</td><td class="num">${x.n}</td>
        <td class="num ${x.w/x.n>=.5?'w':'lo'}">${pct(x.w/x.n)}</td></tr>`).join('')}</table>` : ''}
  </div>`;
}
