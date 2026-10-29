// Together tab: games, win rate and time played together, win and loss streaks, how much of your team's kills and
// damage the two of you account for, and your champion pairings.

// Win and loss streaks, oldest game first. Remakes are skipped (they neither keep nor break a streak).
function streaks(games){
  const g = games.filter(x=>!x.remake).sort((a,b)=>a.start-b.start);
  let run = 0, from = null, bestW = {n:0}, bestL = {n:0};
  g.forEach((x,i)=>{
    if(i && x.win === g[i-1].win) run++; else { run = 1; from = x.start; }
    const best = x.win ? bestW : bestL;
    if(run > best.n) Object.assign(best, {n:run, from, to:x.start});
  });
  return {current: g.length ? {n:run, win:g[g.length-1].win} : null, bestW, bestL};
}
function streakTiles(games){
  const s = streaks(games);
  if(!s.current) return '';
  const when = b => b.n ? (b.n > 1 ? `${fmtDate(b.from)} – ${fmtDate(b.to)}` : fmtDate(b.from)) : '';
  const tile = (n, cls, lbl, tip) => `<div title="${esc(tip)}"><div class="n ${cls}">${n}</div><div class="lbl">${lbl}</div></div>`;
  return `<h2 style="margin-top:20px">Streaks</h2><div class="big">
    ${tile(`${s.current.n}${s.current.win?'W':'L'}`, s.current.win?'w':'lo', `current ${s.current.win?'win':'loss'} streak`, '')}
    ${tile(s.bestW.n, 'w', 'longest win streak', when(s.bestW))}
    ${tile(s.bestL.n, 'lo', 'longest loss streak', when(s.bestL))}
  </div>`;
}

// Your share of your team's kills and damage (the two of you against the rest of your team), over every game together.
// The team's totals come from each row's kill participation and damage share (whichever of you has one: a player
// with no kills or assists has a kp of 0).
function duoShare(p1, p2, theirs){
  const t = {k1:0, k2:0, k:0, d1:0, d2:0, d:0};
  p1.games.filter(x=>!x.remake).forEach(x=>{ const y = theirs[x.matchId]; if(!y) return;
    const kills = [x,y].find(r=>r.kp), dmg = [x,y].find(r=>r.dmgShare);
    if(kills){ t.k1 += x.kills; t.k2 += y.kills; t.k += Math.round((kills.kills+kills.assists)/kills.kp); }
    if(dmg){ t.d1 += x.damage; t.d2 += y.damage; t.d += dmg.damage/dmg.dmgShare; }
  });
  const row = (label, a, b, total) => {
    if(!total) return '';
    const us = (a+b)/total;
    return `<div class="sharerow"><div class="m">${label}</div>
      <div class="bar share"><i class="us" style="width:${us*100}%"></i><i class="rest" style="width:${(1-us)*100}%"></i></div>
      <div class="v">${pct(us)}</div>
      <div class="split"><span class="us">You two ${pct(us)}</span> · <span>Rest of the team ${pct(1-us)}</span></div></div>`;
  };
  const rows = row('Kills', t.k1, t.k2, t.k) + row('Damage', t.d1, t.d2, t.d);
  return rows ? `<h2 style="margin-top:20px">Your share of the team</h2>${rows}
    <div class="note">The two of you against the other three on your team: kills and damage to champions, across every game together. An even split between five would be 40%.</div>` : '';
}

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
    ${streakTiles(p1.games)}
    ${duoShare(p1, p2, theirs)}
    ${top.length ? `<h2 style="margin-top:20px">Your champion pairings</h2>
    <table><tr><th style="color:var(--p1)">${esc(shortName(p1.riotId))}</th><th style="color:var(--p2)">${esc(shortName(p2.riotId))}</th>
      <th class="num">Games</th><th class="num">Win rate</th></tr>
      ${top.map(x=>`<tr><td>${icon(x.a)}${esc(x.a)}</td><td>${icon(x.b)}${esc(x.b)}</td><td class="num">${x.n}</td>
        <td class="num ${x.w/x.n>=.5?'w':'lo'}">${pct(x.w/x.n)}</td></tr>`).join('')}</table>` : ''}
  </div>`;
}
