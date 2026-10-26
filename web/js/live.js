// Live tab, built around whoever this browser says is playing ("Playing as", remembered per browser):
//   champion select  this browser's player's champion only (a hovered one shows as "considering"), and the ARAM
//                    bench with both of your records on each champion and which ones would be new S Rank chances
//   in game          that player's history on the champion ("Show" turns it off)
//   between games    a recap of the last game: results, grades, scores and badges
// The gold u.gg button at the top opens the build page for the champion this browser's player has locked in.

let live = null, itemData = null;
const PHASES = {ChampSelect:'Champion select', GameStart:'Game loading', InProgress:'In game', Reconnect:'Reconnecting',
  Lobby:'In lobby', Matchmaking:'In queue', ReadyCheck:'Match found', WaitingForStats:'Game over', EndOfGame:'Game over',
  PreEndOfGame:'Game over', None:'Not in a game', NoClient:'League client not open', Error:'Something went wrong'};
const LIVE_PHASES = ['ChampSelect','GameStart','InProgress','Reconnect'];

function uggUrl(alias, queueId){
  const slug = ({MonkeyKing:'wukong'}[alias] || alias).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(queueId===2400) return `https://u.gg/lol/champions/aram-mayhem/${slug}-aram-mayhem`;
  if(queueId===450) return `https://u.gg/lol/champions/aram/${slug}-aram`;
  return `https://u.gg/lol/champions/${slug}/build`;
}
// on this Mac the app opens u.gg (in your default browser); on another computer it opens right here
onClick('[data-ugg]', el=>viewer ? window.open(el.dataset.ugg, '_blank', 'noopener') : api('/api/open', {url: el.dataset.ugg}).catch(()=>{}));

async function loadItemData(){
  if(itemData || !ddVer) return;
  try{ itemData = (await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVer}/data/en_US/item.json`)).json()).data; }catch(e){}
}
function finishedItem(id){
  const it = itemData && itemData[id];
  if(!it) return true;   // unknown (e.g. a Mayhem-only item): keep it
  const tags = it.tags || [];
  if(tags.includes('Consumable') || tags.includes('Trinket') || it.consumed) return false;
  return !(it.into && it.into.length) && ((it.gold||{}).total||0) >= 900;
}
function itemIcon(id, n){
  const it = itemData && itemData[id], name = it ? it.name : 'Item '+id;
  const img = ddVer ? `<img src="https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/item/${id}.png" alt="" onerror="this.outerHTML='<span class=ph></span>'">` : '<span class="ph"></span>';
  return `<div class="item" title="${esc(name)}">${img}${n}×</div>`;
}

// ---- who this browser is, and what to show ----
const LIVE_SHOW = [['history','History & items']];
let liveMe = store.get('duo_live_me') || '';   // riot id (lowercase) of who's playing on this browser; '' = work it out
let liveShow = (()=>{ try{ return {history:true, partner:true, ...JSON.parse(store.get('duo_live_show') || '{}')}; }
                       catch(e){ return {history:true, partner:true}; } })();
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

// ---- a player's card ----
const AUG_TIERS = ['Silver', 'Gold', 'Prismatic'];
function liveCard(det, player, color, queueId, isMe){
  const mine = player ? player.games.filter(g=>String(g.champion).toLowerCase()===det.alias.toLowerCase()) : [];
  const inMode = mine.filter(g=>g.queueId===queueId);
  const wins = (inMode.length ? inMode : mine).filter(g=>g.win && !g.remake);
  const count = (list, key, keep) => { const c = {};
    list.forEach(g=>(g[key]||[]).filter(keep||(()=>true)).forEach(v=>c[v] = (c[v]||0)+1));
    return Object.entries(c).sort((a,b)=>b[1]-a[1]); };
  const items = count(wins, 'items', finishedItem).slice(0,6);
  // augments by tier (Silver, then Gold, then Prismatic), the most-picked 4 of each
  const augTiers = AUG_TIERS.map(tier=>[tier, count(wins, 'augments').filter(([id])=>((augNames||{})[id]||{}).rarity === tier).slice(0,4)])
    .filter(([, list])=>list.length);
  const line = (label, a) => a ? `<div class="tts"><b style="color:var(--text)">${label}:</b> ${a.n} game${a.n>1?'s':''} ·
      <span class="${a.wr>=.5?'w':'lo'}">${pct(a.wr)} WR</span> · ${f2(a.kda)} KDA (${f1(a.k)}/${f1(a.d)}/${f1(a.a)}) · ${pct(a.kp)} KP</div>` : '';
  const whose = isMe ? 'your' : 'their';
  // an augment: icon, name and how many wins it was in; hover for its description
  const augChip = ([id,n])=>{ const a = (augNames||{})[id] || {};
    return `<span class="augn" data-aug="${esc(id)}" tabindex="0"><img class="augic ${esc(a.rarity||'')}" src="/api/augicon/${encodeURIComponent(id)}" alt=""
      onerror="this.style.visibility='hidden'"><span>${esc(a.name||'Augment #'+id)}</span><small>${n}×</small></span>`; };
  // the other player's wins on the same champion, for their items
  const other = lastData && lastData.players.length > 1 ? lastData.players.find(p=>p !== player) : null;
  const theirs = other ? other.games.filter(g=>String(g.champion).toLowerCase()===det.alias.toLowerCase()) : [];
  const theirInMode = theirs.filter(g=>g.queueId===queueId);
  const theirWins = (theirInMode.length ? theirInMode : theirs).filter(g=>g.win && !g.remake);
  const theirItems = count(theirWins, 'items', finishedItem).slice(0,6);
  const champName = esc(det.name||det.alias), otherName = other ? esc(shortName(other.riotId)) : '';
  const theirBlock = !other ? '' : `<h3 class="lpsub">Items in ${otherName}'s wins${theirs.length && !theirInMode.length ? ' (all modes)' : ''}</h3>
    ${theirItems.length ? `<div class="items">${theirItems.map(([id,n])=>itemIcon(id,n)).join('')}</div>`
      : `<div class="empty">${!theirs.length ? `${otherName} hasn't played ${champName} yet.` : theirWins.length ? 'No items recorded for these wins.' : `${otherName} hasn't won on ${champName} yet.`}</div>`}`;
  // hidden with Show → "History & items": say so on the card, with a way to bring it back
  const history = !liveShow.history ? `<div class="lphidden">Your history, items and augments on ${esc(det.name||det.alias)} are hidden.
      <button class="ghost" data-live-show="history">Show them</button></div>` : `${mine.length ? line(QUEUES[queueId] || 'This mode', agg(inMode)) + line('All modes', agg(mine))
      : `<div class="tts">No saved games on ${champName} yet.</div>`}
    ${mine.length || theirs.length ? `<div class="lpgrid">
      <div><h3>Items in ${whose} wins${inMode.length || !mine.length ? '' : ' (all modes)'}</h3>${items.length ? `<div class="items">${items.map(([id,n])=>itemIcon(id,n)).join('')}</div>`
        : `<div class="empty">${!mine.length ? `No games on ${champName} yet.` : wins.length ? 'No items recorded for these wins.' : 'No wins on this champion yet.'}</div>`}
        ${theirBlock}</div>
      <div><h3>Augments in ${whose} wins</h3>${augTiers.length ? augTiers.map(([tier, list])=>`<div class="augtier">
          <span class="rar ${tier}">${tier}</span><div class="augrow1">${list.map(augChip).join('')}</div></div>`).join('')
        : '<div class="empty">No augments recorded for these wins.</div>'}</div></div>` : ''}`;
  return `<div class="lp ${det.hover?'hovering':''}" style="--c:${color}">
    <div class="lphead">${icon(det.alias)}<div><div class="who">${isMe ? 'You' : esc(shortName(det.riotId))}${det.hover ? ' <span class="tag">considering…</span>' : ''}</div>
      <div class="champ">${esc(det.name||det.alias)}</div>${srankStatus(det, player, color)}</div>
      ${det.hover ? '' : `<button class="ghost" data-ugg="${esc(uggUrl(det.alias, queueId))}">u.gg build</button>`}</div>
    ${history}
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
  const mine = on && s.players.find(p=>lastData.players.findIndex(x=>x.riotId.toLowerCase()===p.riotId.toLowerCase()) === me);
  const uggBtn = mine && !mine.hover
    ? `<button class="uggmain" data-ugg="${esc(uggUrl(mine.alias, s.queueId))}">Open u.gg · ${esc(mine.name || mine.alias)}</button>`
    : mine ? '<span class="d">Lock in to open u.gg</span>' : '';
  let h = `<div class="phase"><span class="dot ${on?'on':''}"></span>${esc(PHASES[s.phase] || s.phase)}${s.queueId&&on ? ' · '+esc(QUEUES[s.queueId]||'Queue '+s.queueId) : ''}${uggBtn}</div>`;
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
    <p class="note">Your history on a champion comes from your own saved games. "Open u.gg build" opens the champion's page on u.gg.</p>`;
}
