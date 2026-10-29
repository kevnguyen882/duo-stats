// The match details window: everyone's stats in one game, like the end-of-game screen.
// Opens from any element with data-match="<game id>" (Best games and Match history). Close with ×, Esc or a click outside.

let matchReq = 0, matchReturnFocus = null;

// intro: optional function(match) -> html shown above the match (the Badges showcase uses it for the badge's story)
async function openMatch(id, intro){
  const req = ++matchReq;
  showMatch('<p class="empty"><span class="spin"></span>Loading the game…</p>');
  try{
    const m = await api('/api/match?id='+encodeURIComponent(id));
    if(req === matchReq) showMatch((intro ? intro(m) : '') + matchHtml(m));
  }catch(e){ if(req === matchReq) showMatch(`<p class="err">${esc(e.message)}</p>`); }
}

function showMatch(html){
  let box = document.getElementById('mdlg');
  if(!box){
    box = document.createElement('div'); box.id = 'mdlg'; box.className = 'mdlg';
    box.innerHTML = `<div class="mdlg-panel" role="dialog" aria-modal="true" aria-label="Match details">
      <button class="mdlg-x" aria-label="Close" title="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg></button><div class="mdlg-body"></div></div>`;
    box.addEventListener('click', e=>{ if(e.target === box || e.target.closest('.mdlg-x')) closeMatch(); });
    document.body.appendChild(box);
  }
  box.querySelector('.mdlg-body').innerHTML = html;
  if(!box.classList.contains('on')){
    matchReturnFocus = document.activeElement;
    hideTip();
    box.classList.add('on'); document.body.classList.add('noscroll');
    box.querySelector('.mdlg-x').focus();
  }
}

function closeMatch(){
  const box = document.getElementById('mdlg');
  if(!box || !box.classList.contains('on')) return;
  matchReq++;
  box.classList.remove('on'); document.body.classList.remove('noscroll'); hideTip();
  if(matchReturnFocus && matchReturnFocus.focus) matchReturnFocus.focus();
}
document.addEventListener('keydown', e=>{ if(e.key === 'Escape') closeMatch(); });
onActivate('[data-match]', el=>openMatch(el.dataset.match));

function itemImg(id){
  const it = typeof itemData !== 'undefined' && itemData && itemData[id], name = it ? it.name : 'Item '+id;
  return ddVer ? `<img class="mit" src="https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/item/${id}.png" alt="${esc(name)}" title="${esc(name)}"
    onerror="this.style.visibility='hidden'">` : '';
}

function matchHtml(m){
  const all = m.teams.flatMap(t=>t.players.map(r=>{
    const x = {...r, duration: m.duration, remake: m.remake};
    x.score = perfScore(x);
    x.badges = gameBadges(x);   // (the app works them out)
    return x;
  }));
  const mvp = m.remake ? null : all.reduce((a,b)=>b.score > a.score ? b : a, all[0]);
  const maxDmg = Math.max(1, ...all.map(x=>x.damage));
  const mine = m.teams[0] && m.teams[0].players.some(r=>r.player != null) ? m.teams[0] : null;
  const result = m.remake ? 'Remake' : mine ? (mine.win ? 'Victory' : 'Defeat') : '';
  const resCls = m.remake ? '' : mine ? (mine.win ? 'win' : 'loss') : '';
  const mins = `${Math.floor(m.duration/60)}m ${String(m.duration%60).padStart(2,'0')}s`;
  const kills = t => t.players.reduce((a,r)=>a+r.kills, 0);
  let k = 0; const rowsOf = t => t.players.map(()=>all[k++]);

  const tracked = all.filter(x=>x.player != null).sort((a,b)=>a.player-b.player);
  const highlights = tracked.map(x=>{
    const c = COLORS[x.player];
    return `<div class="mhl" style="--c:${c}">${icon(x.champion)}
      <div class="mhl-main"><div class="t"><b style="color:${c}">${esc(x.name || shortName(x.riotId))}</b> · ${esc(x.champion)}
        ${x.grade ? `<span class="gchip">${esc(x.grade)}</span>` : ''}${x === mvp ? '<span class="tag gold">MVP</span>' : ''}</div>
        <div class="d">${x.kills}/${x.deaths}/${x.assists} · ${f1(kdaOf(x))} KDA · ${f0(x.damage)} damage · ${pct(x.kp)} kill part.</div>
        ${multikillChips(x)}${badgeChips(x.badges.filter(b=>!MULTIKILL_BADGE_IDS.has(b.id))) || (multikillChips(x) ? '' : '<div class="d">No badges this game.</div>')}</div>
      <div class="score">${x.score}<small>score</small></div></div>`;
  }).join('');

  const teamTable = (t, ti) => {
    const rows = rowsOf(t);
    const label = m.teams.length > 2 ? `Team ${ti+1}` : (t === mine ? 'Your team' : mine ? 'Enemy team' : `Team ${ti+1}`);
    return `<div class="mteam ${m.remake ? '' : t.win ? 'win' : 'loss'}">
      <div class="mteam-h"><b>${label}</b><span>${m.remake ? '' : t.win ? 'Victory' : 'Defeat'}</span>
        <span class="mteam-k">${kills(t)} kills · ${f0(t.players.reduce((a,r)=>a+r.gold,0))} gold</span></div>
      <div class="mscroll"><table class="mtable">
        <thead><tr><th>Player</th><th>KDA</th><th>Damage</th><th>Kill part.</th><th>Gold</th><th>CS</th><th>Vision</th><th>Items</th><th>Score</th></tr></thead>
        <tbody>${rows.map(x=>{
          const c = x.player != null ? COLORS[x.player] : '';
          return `<tr class="${x.player != null ? 'me' : ''}" ${c ? `style="--c:${c}"` : ''}>
            <td class="mp">${icon(x.champion)}<div><div class="mn">${esc(x.name || 'Unknown')}${x.grade ? `<span class="gchip">${esc(x.grade)}</span>` : ''}${x === mvp ? '<span class="tag gold">MVP</span>' : ''}</div>
              <div class="d">${esc(x.champion)}</div>${badgeChips(x.badges, true)}</div></td>
            <td><b>${x.kills}/${x.deaths}/${x.assists}</b><div class="d">${f1(kdaOf(x))}</div></td>
            <td class="mdmg"><b>${f0(x.damage)}</b><div class="bar"><i style="width:${(x.damage/maxDmg*100).toFixed(1)}%"></i></div><div class="d">${pct(x.dmgShare)} of team</div></td>
            <td>${pct(x.kp)}</td><td>${f0(x.gold)}</td><td>${x.cs}</td><td>${x.vision}</td>
            <td><div class="mitems">${x.items.map(itemImg).join('')}</div>${augIcons(x.augments)}</td>
            <td class="msc">${x.score}</td></tr>`;
        }).join('')}</tbody></table></div></div>`;
  };

  return `<div class="mhead"><div class="mres ${resCls}">${result || 'Match details'}</div>
      <div class="d">${esc(QUEUES[m.queueId] || 'Other')} · ${mins} · ${fmtDate(m.start)}</div>
      ${m.teams.length === 2 ? `<div class="mtally">${kills(m.teams[0])} <span>vs</span> ${kills(m.teams[1])}</div>` : ''}</div>
    ${highlights ? `<div class="mhls">${highlights}</div>` : ''}
    ${m.teams.map(teamTable).join('')}
    <p class="note">Hover a badge to see what it's for. Score uses the same formula as Best games.</p>`;
}

function multikillChips(x){
  const chips = MULTIKILL_BADGES.filter(([k])=>x[k]).map(([k,cls,label])=>
    `<span class="mkb ${cls}">${label}<i>${x[k]}</i></span>`).join('');
  return chips ? `<div class="tags">${chips}</div>` : '';
}
