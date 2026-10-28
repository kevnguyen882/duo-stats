// Live tab, built around whoever this browser says is playing ("Playing as", remembered per browser):
//   champion select  this browser's player's champion only (a hovered one shows as "considering"), and the ARAM
//                    bench with both of your records on each champion and which ones would be new S Rank chances
//   in game          that player's history on the champion ("Show" turns it off)
//   champion select and in game, ARAM and ARAM Mayhem: op.gg's starting items, core builds and boots, final build items,
//                    skill order and most-picked augments
//   between games    a recap of the last game: results, grades, scores and badges

let live = null, itemData = null;
const PHASES = {ChampSelect:'Champion select', GameStart:'Game loading', InProgress:'In game', Reconnect:'Reconnecting',
  Lobby:'In lobby', Matchmaking:'In queue', ReadyCheck:'Match found', WaitingForStats:'Game over', EndOfGame:'Game over',
  PreEndOfGame:'Game over', None:'Not in a game', NoClient:'League client not open', Error:'Something went wrong'};
const LIVE_PHASES = ['ChampSelect','GameStart','InProgress','Reconnect'];

async function loadItemData(){
  if(itemData || !ddVer) return;
  try{ itemData = (await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVer}/data/en_US/item.json`)).json()).data; }catch(e){}
}
function itemIcon(id, below=''){   // below: what's shown under the picture
  const it = itemData && itemData[id], name = it ? it.name : 'Item '+id;
  const img = ddVer ? `<img src="https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/item/${id}.png" alt="" onerror="this.outerHTML='<span class=ph></span>'">` : '<span class="ph"></span>';
  return `<div class="item" title="${esc(name)}">${img}${below}</div>`;
}

// ---- who this browser is, and what to show ----
const LIVE_SHOW = [['history','History'], ['opgg','op.gg builds']];
let liveMe = store.get('duo_live_me') || '';   // riot id (lowercase) of who's playing on this browser; '' = work it out
let liveShow = (()=>{ try{ return {history:true, partner:true, opgg:true, ...JSON.parse(store.get('duo_live_show') || '{}')}; }
                       catch(e){ return {history:true, partner:true, opgg:true}; } })();
function liveMeIndex(){
  const ps = lastData ? lastData.players : [], ids = ps.map(p=>p.riotId.toLowerCase());
  if(liveMe && ids.includes(liveMe)) return ids.indexOf(liveMe);
  // not chosen yet: on the Mac running the app it's whoever is logged in to League; elsewhere, the other player
  const loggedIn = ((live && live.players) || []).find(p=>p.isMe);
  const at = loggedIn ? ids.indexOf(loggedIn.riotId.toLowerCase()) : -1;
  return viewer ? (at >= 0 ? (at ? 0 : Math.min(1, ps.length-1)) : Math.min(1, ps.length-1)) : Math.max(0, at);
}
onClick('[data-live-me]', b=>{ liveMe = b.dataset.liveMe; store.set('duo_live_me', liveMe); liveBar(); renderLive(true); });
onClick('[data-live-show]', b=>{ const k = b.dataset.liveShow; liveShow[k] = !liveShow[k];
  store.set('duo_live_show', JSON.stringify(liveShow)); liveBar(); renderLive(true); });
function liveBar(){
  const bar = document.getElementById('livebar');
  if(!bar || !lastData) return;
  const me = liveMeIndex();
  bar.innerHTML = `${lastData.players.length > 1 ? `<div class="lbgroup"><span>Playing as</span><div class="seg" role="group" aria-label="Playing as">${lastData.players.map((p,i)=>
      `<button data-live-me="${esc(p.riotId.toLowerCase())}" class="${i===me?'on':''}" aria-pressed="${i===me}">${esc(shortName(p.riotId))}</button>`).join('')}</div></div>` : ''}
    <div class="lbgroup"><span>Show</span><div class="seg" role="group" aria-label="Show while in game">${LIVE_SHOW.map(([k,l])=>
      `<button data-live-show="${k}" class="${liveShow[k]?'on':''}" aria-pressed="${!!liveShow[k]}">${l}</button>`).join('')}</div></div>`;
}

// ---- S Rank Challenge status on the champion: your best grade this season, or a chance to get one, and your partner's ----
function srankStatus(det, player, color){
  if(!sr && !srLoading) loadSrank().then(()=>renderLive(true));   // season grades come from the S Rank tab's data
  const ps = lastData.players, i = ps.indexOf(player), cid = String(det.id || '');
  if(!sr || !sr.players || !cid || i < 0) return '';
  const gradeOf = j => ((sr.players[j] || {}).champs || {})[cid];
  const badge = (g, c) => g === 'S+' ? `<span class="n flame rgflame" style="--k:${c}">${FLAME}<em>S+</em></span>` : `<span class="gchip">${esc(g)}</span>`;
  const mine = gradeOf(i), champ = esc(det.name || det.alias);
  const j = i === 0 ? 1 : 0, other = ps.length > 1 ? ps[j] : null, theirs = other ? gradeOf(j) : null;
  return `<div class="lpsr">${mine ? `<span>S Rank: best this season ${badge(mine, color)}</span>`
      : `<span class="lpsrchance">🎯 No S on ${champ} yet this season</span>`}
    ${other ? `<span class="lpsrother">${esc(shortName(other.riotId))}: ${theirs ? badge(theirs, COLORS[j]) : 'no S yet'}</span>` : ''}</div>`;
}

// ---- op.gg's builds for the champion: asked for once per champion and mode, the app keeps them for a few hours ----
const opgg = {};   // "alias|queue" -> {data} or {error}; missing while loading
function opggPanel(det, queueId){
  if(![450, 2400].includes(queueId)) return '';
  const key = det.alias+'|'+queueId, got = opgg[key];
  if(!got){
    opgg[key] = {loading: true};
    api(`/api/opgg?champ=${encodeURIComponent(det.alias)}&queue=${queueId}`)
      .then(d=>{ opgg[key] = {data: d}; }, e=>{ opgg[key] = {error: e.message}; }).then(()=>renderLive(true));
  }
  const champ = esc(det.name||det.alias), mode = esc(QUEUES[queueId]||'');
  const head = d => `<h3 class="opggh">op.gg · ${champ} in ${mode}${d && d.url ? ` <a href="${esc(d.url)}" target="_blank" rel="noopener">open op.gg ↗</a>` : ''}</h3>`;
  if(!got || got.loading) return `<div class="opgg">${head()}<p class="empty"><span class="spin"></span>Loading op.gg's builds…</p></div>`;
  if(got.error) return `<div class="opgg">${head()}<p class="empty">${esc(got.error)}</p></div>`;
  const d = got.data;
  // a set of items, repeats shown once with a count (2 Health Potions), then how often it's picked and won
  const build = b=>{ const n = {}; b.items.forEach(id=>n[id] = (n[id]||0)+1);
    return `<div class="opb"><div class="items">${Object.entries(n).map(([id,c])=>itemIcon(id, c>1 ? c+'×' : '')).join('')}</div>
      <div class="opbs"><span class="${b.win>=50?'w':'lo'}">${b.win.toFixed(1)}% WR</span><span>${b.pick.toFixed(1)}% pick</span><span>${f0(b.games)} games</span></div></div>`; };
  const builds = (label, list, cls='') => `<h3 class="${cls}">${label}</h3>${list && list.length ? list.map(build).join('') : '<div class="empty">op.gg has none yet.</div>'}`;
  // single items (boots, the items most often in finished builds), each with its win rate and the % of games it was built in
  const finalItem = b=>itemIcon(b.items[0], `<span class="${b.win>=50?'w':'lo'}">${b.win.toFixed(1)}%</span><span>${b.pick.toFixed(1)}%</span>`);
  const boots = d.boots && d.boots.length ? `<h4 class="opsub">Boots <small class="opnote">win rate · % of games built</small></h4>
    <div class="items opfinal">${d.boots.map(finalItem).join('')}</div>` : '';
  const final = `<h3 class="lpsub">Final build items <small class="opnote">win rate · % of games built</small></h3>${d.final && d.final.length
    ? `<div class="items opfinal">${d.final.map(finalItem).join('')}</div>` : '<div class="empty">op.gg has none yet.</div>'}`;
  const augChip = a=>{ const g = (augNames||{})[a.id] || {};
    return `<span class="augn" data-aug="${esc(a.id)}" tabindex="0"><img class="augic ${esc(g.rarity||'')}" src="/api/augicon/${encodeURIComponent(a.id)}" alt=""
      onerror="this.style.visibility='hidden'"><span>${esc((g.name||'').trim() || a.name || 'Augment #'+a.id)}</span><small>${a.pick.toFixed(1)}%</small></span>`; };
  // skill order: which skill to max first, then the most picked level-by-level path for it
  const spells = (d.skills && d.skills.spells) || {};
  const skill = (k, big) => { const sp = spells[k] || {};   // big: with the skill's picture; small: its letter only
    return `<span class="sk ${big?'big':''}" data-k="${esc(k)}" title="${esc(sp.name ? `${k} · ${sp.name}` : k)}">${big && sp.image && ddVer
      ? `<img src="https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/spell/${encodeURIComponent(sp.image)}" alt="" onerror="this.remove()">` : ''}<b>${esc(k)}</b></span>`; };
  const orders = (d.skills && d.skills.orders) || [];
  const skills = `<h3>Skill order <small class="opnote">max first · then level by level</small></h3>${orders.length ? orders.map(o=>`<div class="sko">
      <div class="skmax">${o.max.map(k=>skill(k, true)).join('<span class="skgt">›</span>')}
        <div class="opbs"><span class="${o.win>=50?'w':'lo'}">${o.win.toFixed(1)}% WR</span><span>${o.pick.toFixed(1)}% pick</span><span>${f0(o.games)} games</span></div></div>
      <div class="sklv">${o.order.map((k,i)=>`<span><small>${i+1}</small>${skill(k)}</span>`).join('')}</div></div>`).join('')
    : '<div class="empty">op.gg has none yet.</div>'}`;
  const augs = d.augments ? `<h3>Most-picked augments <small class="opnote">% of games picked</small></h3>${['Prismatic','Gold','Silver'].map(tier=>`<div class="augtier">
      <span class="rar ${tier}">${tier}</span><div class="augrow1">${(d.augments[tier]||[]).map(augChip).join('') || '<span class="empty">None yet.</span>'}</div></div>`).join('')}` : '';
  return `<div class="opgg">${head(d)}${d.stale ? '<p class="note">Couldn\'t reach op.gg just now, so these are from the last time it could.</p>' : ''}
    <div class="lpgrid"><div>${builds('Starting items', d.starter)}${builds('Core build', d.core, 'lpsub')}${boots}${final}</div><div>${skills}${augs ? `<div class="lpsub-gap"></div>${augs}` : ''}</div></div></div>`;
}

// ---- a player's card ----
function liveCard(det, player, color, queueId, isMe){
  const mine = player ? player.games.filter(g=>String(g.champion).toLowerCase()===det.alias.toLowerCase()) : [];
  const inMode = mine.filter(g=>g.queueId===queueId);
  const line = (label, a) => a ? `<div class="tts"><b style="color:var(--text)">${label}:</b> ${a.n} game${a.n>1?'s':''} ·
      <span class="${a.wr>=.5?'w':'lo'}">${pct(a.wr)} WR</span> · ${f2(a.kda)} KDA (${f1(a.k)}/${f1(a.d)}/${f1(a.a)}) · ${pct(a.kp)} KP</div>` : '';
  const champName = esc(det.name||det.alias);
  // hidden with Show → "History": say so on the card, with a way to bring it back
  const history = !liveShow.history ? `<div class="lphidden">Your history on ${champName} is hidden.
      <button class="ghost" data-live-show="history">Show it</button></div>` : mine.length
    ? line(QUEUES[queueId] || 'This mode', agg(inMode)) + line('All modes', agg(mine))
    : `<div class="tts">No saved games on ${champName} yet.</div>`;
  return `<div class="lp ${det.hover?'hovering':''}" style="--c:${color}">
    <div class="lphead">${icon(det.alias)}<div><div class="who">${isMe ? 'You' : esc(shortName(det.riotId))}${det.hover ? ' <span class="tag">considering…</span>' : ''}</div>
      <div class="champ">${champName}</div>${srankStatus(det, player, color)}</div></div>
    ${history}
    ${liveShow.opgg ? opggPanel(det, queueId) : ''}
  </div>`;
}

// ---- the ARAM bench in champion select: both of your records on each, and the S Rank chances ----
function benchPanel(s){
  if(!s.bench || !s.bench.length) return '';
  if(!sr && !srLoading) loadSrank();   // season grades, for the S Rank flags
  const players = lastData.players;
  const rows = s.bench.map(c=>{
    const per = players.map((p,i)=>{
      const g = p.games.filter(x=>!x.remake && x.champion.toLowerCase()===c.alias.toLowerCase() && x.queueId===s.queueId);
      const w = g.filter(x=>x.win).length, grade = sr && sr.players && sr.players[i] ? sr.players[i].champs[String(c.id)] : null;
      return {p, i, n: g.length, w, grade};
    });
    const chance = sr && sr.players && per.every(x=>!x.grade);
    return `<div class="bnr ${chance?'chance':''}">${icon(c.alias)}<div class="bnn"><b>${esc(c.name)}</b>${chance ? '<span class="tag gold">🎯 S Rank chance</span>' : ''}</div>
      ${per.map(x=>`<div class="bnp" style="--c:${COLORS[x.i]}"><b>${esc(shortName(x.p.riotId))}</b>
        <span>${x.n ? `${x.n} game${x.n>1?'s':''} together · ${pct(x.w/x.n)}` : 'no games together'}</span>${x.grade
          ? `<span class="bnbest" title="${esc(shortName(x.p.riotId))}'s best grade on ${esc(c.name)} this season, from any game">season best <span class="gchip">${esc(x.grade)}</span></span>` : ''}</div>`).join('')}</div>`;
  }).join('');
  return `<div class="bench"><h3>On the bench <small>records from your ${esc(QUEUES[s.queueId]||'')} games together · grades are each of your best this season, from any game · 🎯 means neither of you has an S on it yet</small></h3>${rows}</div>`;
}

// ---- between games: the last game's recap ----
// the game you were just in: right after it ends it isn't saved and loaded yet, so the recap waits for it rather than
// showing the game before (a solo game never shows up here, so after a couple of minutes it stops waiting)
let justPlayed = null;   // {id, ended: ms or null}
function noteGame(s){
  const playing = ['GameStart','InProgress','Reconnect'].includes(s.phase);
  if(playing && s.gameId) justPlayed = {id: String(s.gameId), ended: null};
  else if(!playing && justPlayed && !justPlayed.ended) justPlayed.ended = Date.now();
}
function recapPanel(){
  const all = lastData ? recentGames(lastData.players) : [];
  if(justPlayed && justPlayed.ended && Date.now() - justPlayed.ended < 120000 && !all.some(g=>String(g.x.matchId) === justPlayed.id))
    return '<div class="recap"><p class="empty"><span class="spin"></span>Wrapping up your game… the recap shows here once it\'s saved.</p></div>';
  const last = all[0];
  if(!last) return '';
  const x = last.x, ended = (x.start||0) + (x.duration||0)*1000;
  if(Date.now() - ended > 3*3600*1000) return '';
  const best = bestDamage(lastData.players);
  const [res, col] = resultOf(x);
  const rows = lastData.players.map((p,i)=>{ const r = last.rows[i]; if(!r) return '';
    return `<div class="rcp" style="--c:${COLORS[i]}">${icon(r.champion)}<div class="rcpm"><div><b style="color:${COLORS[i]}">${esc(shortName(p.riotId))}</b> · ${esc(r.champion)}
        ${r.grade==='S+' ? `<span class="n flame rgflame" style="--k:${COLORS[i]}">${FLAME}<em>S+</em></span>` : r.grade ? `<span class="gchip">${esc(r.grade)}</span>` : ''}</div>
      <div class="d">${r.kills}/${r.deaths}/${r.assists} · ${f0(r.damage)} damage · ${pct(r.kp)} kill part.</div>
      ${badgeChips(gameBadges(r, {best: best[p.riotId.toLowerCase()], name: shortName(p.riotId), mate: mateRow(lastData.players, i, r)}))}</div>
      <div class="score">${scoreBadge(perfScore(r))}<small>score</small></div></div>`; }).join('');
  return `<div class="recap"><div class="rch"><b>Last game</b> <span style="color:${col};font-weight:800">${res}</span>
      <span class="d">${esc(QUEUES[x.queueId]||'')} · ${Math.round(x.duration/60)}m · ${timeAgo(x.start)}</span>
      <button class="ghost" data-match="${esc(x.matchId)}">Relive the game</button></div>${rows}</div>`;
}

let liveHtml = '';
function renderLive(force){
  const box = document.getElementById('livebox');
  if(!box || !lastData) return;
  const s = live || {phase:'None', players:[]};
  noteGame(s);
  const on = LIVE_PHASES.includes(s.phase), me = liveMeIndex();
  let h = `<div class="phase"><span class="dot ${on?'on':''}"></span>${esc(PHASES[s.phase] || s.phase)}${s.queueId&&on ? ' · '+esc(QUEUES[s.queueId]||'Queue '+s.queueId) : ''}</div>`;
  // only this browser's player: on your screen your champion, on Steph's hers
  const cards = s.players.map(det=>({det, i: lastData.players.findIndex(p=>p.riotId.toLowerCase()===det.riotId.toLowerCase())}))
    .filter(c=>c.i === me);
  if(s.phase==='NoClient') h += `<p class="empty">The League client isn't open on the Mac running luggi duc. This tab updates by itself.</p>`;
  else if(s.phase==='Error') h += `<p class="err">${esc(s.message||'')}</p>`;
  else if(!on){
    h += recapPanel() || '';
    h += `<p class="empty">${esc(shortName(lastData.players[me].riotId))}'s champion shows up here in champion select.</p>`;
  }else if(!cards.length) h += `<p class="empty">Waiting for a champion…</p>`;
  else h += `<div class="live" style="margin-top:14px">${cards.map(c=>liveCard(c.det, lastData.players[c.i], COLORS[c.i] || COLORS[0], s.queueId, c.i===me)).join('')}</div>`;
  if(s.phase === 'ChampSelect') h += benchPanel(s);
  if(h !== liveHtml || force){ liveHtml = h; box.innerHTML = h; }   // unchanged: leave it, so hover cards and focus stay put
}

function liveTab(){
  return `<div class="livebar" id="livebar"></div>
    <div class="panel" id="livebox"></div>
    <p class="note">Your history on a champion comes from your own saved games. op.gg builds are op.gg's numbers for everyone
      playing the champion in ARAM or ARAM Mayhem.</p>`;
}
