// Time played tab: time played per day (a bar chart), then time and stats per champion, overall and week by week.

let weekStart = null;   // Monday 00:00 (local time) of the week being shown
function mondayOf(ts){ const d = new Date(ts); d.setHours(0,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d.getTime(); }
function addWeeks(ms, n){ const d = new Date(ms); d.setDate(d.getDate()+7*n); return d.getTime(); }

function champLine(a){
  if(!a) return '<div class="tts">Remakes only</div>';
  return `<div class="tts"><span class="${a.kda>=3?'w':''}">${f2(a.kda)} KDA</span> (${f1(a.k)}/${f1(a.d)}/${f1(a.a)})
    · <span class="${a.wr>=.5?'w':'lo'}">${pct(a.wr)} WR</span> (${a.wins}W ${a.losses}L)
    · ${pct(a.kp)} KP · ${f0(a.dpm)} dmg/min · ${f1(a.csm)} CS/min</div>`;
}
function timeTable(games, scroll){
  const by = {};
  games.forEach(g=>{ const v = by[g.champion] || (by[g.champion] = {t:0, n:0, g:[]}); v.t += g.duration; v.n++; v.g.push(g); });
  const rows = Object.entries(by).sort((a,b)=>b[1].t-a[1].t);
  if(!rows.length) return '<p class="empty">No games this week.</p>';
  const max = rows[0][1].t || 1;
  return `<div class="tt ${scroll?'scroll':''}">${rows.map(([c,v])=>`<div class="ttr">${icon(c)}<div>
    <div class="ttn"><span>${esc(c)}</span><span>${fmtTime(v.t)} · ${v.n} game${v.n>1?'s':''}</span></div>
    <div class="bar"><i style="width:${v.t/max*100}%;background:var(--c)"></i></div>${champLine(agg(v.g))}</div></div>`).join('')}</div>`;
}
function weekBox(players){
  const all = players.flatMap(p=>p.games).filter(g=>g.start);
  if(!all.length) return '';
  const newest = mondayOf(Math.max(...all.map(g=>g.start))), oldest = mondayOf(Math.min(...all.map(g=>g.start)));
  if(weekStart===null || weekStart>newest) weekStart = newest;
  if(weekStart<oldest) weekStart = oldest;
  const end = addWeeks(weekStart, 1), day = {month:'short', day:'numeric'};
  const label = `${new Date(weekStart).toLocaleDateString(undefined,day)} – ${new Date(end-1).toLocaleDateString(undefined,day)}`;
  const ago = Math.round((newest-weekStart)/(7*86400000));
  return `<div class="wknav"><button class="ghost" data-week="-1" ${weekStart<=oldest?'disabled':''}>◀ Older</button>
      <b>${label}<small>${ago===0 ? 'Most recent week' : ago+' week'+(ago>1?'s':'')+' earlier'}</small></b>
      <button class="ghost" data-week="1" ${weekStart>=newest?'disabled':''}>Newer ▶</button></div>
    <div class="${players.length>1?'grid2':''}">${players.map((p,i)=>{
      const wk = p.games.filter(g=>g.start>=weekStart && g.start<end);
      return `<div style="--c:${COLORS[i]}"><div class="colhead">${esc(p.riotId)}</div>
        <div class="wktot">${fmtTime(wk.reduce((a,g)=>a+g.duration,0))} played · ${wk.length} game${wk.length===1?'':'s'}</div>${timeTable(wk)}</div>`;
    }).join('')}</div>`;
}
// ---- time played per day ----
const DAY_RANGES = [[14,'2 weeks'], [30,'30 days'], [90,'90 days']];
let dayRange = +store.get('duo_day_range') || 30;
if(!DAY_RANGES.some(([n])=>n===dayRange)) dayRange = 30;
function dayOf(ts){ const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
function addDays(ms, n){ const d = new Date(ms); d.setDate(d.getDate()+n); return d.getTime(); }   // safe across clock changes
const fmtDay = (ms, o) => new Date(ms).toLocaleDateString(undefined, o);
function fmtAxis(sec){ const h = Math.floor(sec/3600), m = Math.round(sec%3600/60); return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; }

// one entry per day in the range, oldest first. Each game counts once (when you play together, both of you have it).
function dailyTime(players){
  const games = new Map();
  players.forEach(p=>p.games.forEach(g=>{ if(g.start && !games.has(g.matchId)) games.set(g.matchId, g); }));
  const today = dayOf(Date.now()), days = [];
  for(let d = addDays(today, 1-dayRange); d <= today; d = addDays(d, 1)) days.push({d, t:0, n:0, w:0, l:0});
  const at = new Map(days.map(x=>[x.d, x]));
  games.forEach(g=>{ const x = at.get(dayOf(g.start)); if(!x) return;
    x.t += g.duration; x.n++; if(!g.remake){ if(g.win) x.w++; else x.l++; } });
  return days;
}

function dayChart(players){
  const days = dailyTime(players), played = days.filter(x=>x.n), n = days.length;
  const total = played.reduce((a,x)=>a+x.t, 0), longest = played.reduce((a,x)=>x.t > a.t ? x : a, {t:0});
  const step = [900, 1800, 3600, 7200, 10800, 14400].find(s=>Math.ceil(Math.max(longest.t,1)/s) <= 4) || 21600;
  const top = Math.max(1, Math.ceil(Math.max(longest.t,1)/step)) * step;
  const ticks = []; for(let v = step; v <= top; v += step) ticks.push(v);
  const label = (x, i) => dayRange === 14 ? (n-1-i) % 2 === 0
    : dayRange === 30 ? new Date(x.d).getDay() === 1 : new Date(x.d).getDate() === 1;
  const tile = (v, k, sub) => `<div class="dtile"><b>${v}</b><span>${k}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const tipOf = x => x.n ? `${fmtTime(x.t)} · ${x.n} game${x.n>1?'s':''} · ${x.w}W ${x.l}L` : 'No games';
  return `<div class="dtiles">
      ${tile(fmtTime(total), `played${players.length>1 ? ' together' : ''}`)}
      ${tile(`${played.length}<small> / ${n}</small>`, 'days played')}
      ${tile(played.length ? fmtTime(total/played.length) : '–', 'average per day played')}
      ${tile(longest.t ? fmtTime(longest.t) : '–', 'longest day', longest.t ? fmtDay(longest.d, {weekday:'short', month:'short', day:'numeric'}) : '')}
    </div>
    <div class="dchart r${dayRange}" role="img" aria-label="Time played per day for the last ${n} days. Longest day ${longest.t ? fmtTime(longest.t) : 'none'}; the table below lists every day played.">
      <div class="dplot">
        ${ticks.map(v=>`<div class="dgrid" style="bottom:${v/top*100}%"><span>${fmtAxis(v)}</span></div>`).join('')}
        <div class="dbars">${days.map(x=>`<div class="dcol ${x.n?'':'none'}" tabindex="${x.n?0:-1}"
          data-tip-title="${esc(fmtDay(x.d, {weekday:'long', month:'short', day:'numeric'}))}" data-tip="${esc(tipOf(x))}">
          <i style="height:${x.t ? Math.max(x.t/top*100, 1.5) : 0}%"></i></div>`).join('')}</div>
      </div>
      <div class="dx">${days.map((x,i)=>label(x,i) ? `<span style="left:${(i+.5)/n*100}%">${esc(fmtDay(x.d, dayRange===90 ? {month:'short'} : {month:'short', day:'numeric'}))}</span>` : '').join('')}</div>
    </div>
    ${played.length ? `<details class="dtable"><summary>Show as a table</summary><table>
      <thead><tr><th>Day</th><th>Time</th><th>Games</th><th>W–L</th></tr></thead>
      <tbody>${[...played].reverse().map(x=>`<tr><td>${esc(fmtDay(x.d, {weekday:'short', month:'short', day:'numeric'}))}</td>
        <td>${fmtTime(x.t)}</td><td>${x.n}</td><td>${x.w}–${x.l}</td></tr>`).join('')}</tbody></table></details>`
      : `<p class="empty">No games in the last ${n} days.</p>`}`;
}
onClick('[data-day-range]', b=>{
  dayRange = +b.dataset.dayRange; store.set('duo_day_range', dayRange);
  document.querySelectorAll('[data-day-range]').forEach(x=>{ const on = x===b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  document.getElementById('daybox').innerHTML = dayChart(lastData.players);
});

onClick('[data-week]', b=>{
  if(b.disabled || !lastData) return;
  weekStart = addWeeks(weekStart, +b.dataset.week);
  document.getElementById('weekbox').innerHTML = weekBox(lastData.players);
});

function timeTab(players){
  if(!players.some(p=>p.games.length)) return '<p class="empty">No games.</p>';
  return `<h2 class="first">Time played per day</h2>
    <div class="srtools"><div class="seg" role="group" aria-label="Days shown">${DAY_RANGES.map(([n,l])=>
      `<button data-day-range="${n}" class="${dayRange===n?'on':''}" aria-pressed="${dayRange===n}">${l}</button>`).join('')}</div></div>
    <div class="panel" id="daybox">${dayChart(players)}</div>
    <h2>Time played by champion</h2>
    <div class="${players.length>1?'grid2':''}">${players.map((p,i)=>`<div class="panel" style="--c:${COLORS[i]}">
      <div class="colhead">${esc(p.riotId)}</div>
      <div class="wktot">${fmtTime(p.games.reduce((a,g)=>a+g.duration,0))} across all games</div>${timeTable(p.games, true)}</div>`).join('')}</div>
    <h2>Time played by week</h2><div class="panel" id="weekbox">${weekBox(players)}</div>`;
}
