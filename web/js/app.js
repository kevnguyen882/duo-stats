// Loading stats, drawing the tabs, and staying up to date while you play.

let activeTab = store.get('duo_tab') || 'overview';
let dataVersion = null;   // the app's "something new was saved" counter
let liveTimer = null;

function render(data){
  data.players.forEach(p=>p.games.sort((a,b)=>(b.start||0)-(a.start||0)));
  const players = data.players, [p1, p2] = players;
  const tabs = [
    ['overview', 'Overview', overviewTab(players)],
    ['live', 'Live', liveTab()],
    ...(p2 ? [['duo', 'Together', togetherTab(p1, p2)]] : []),
    ['time', 'Time played', timeTab(players)],
    ['best', 'Best games', bestTab(players)],
    ['badges', 'Badges', badgesTab(players)],
    ['srank', 'S Rank Challenge', srankTab()],
    ['recent', 'Match history', recentTab(players)],
  ];
  if(!tabs.some(t=>t[0]===activeTab)) activeTab = 'overview';
  out.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([id,label])=>
      `<button class="tab ${id===activeTab?'on':''}" role="tab" aria-selected="${id===activeTab}" data-tab="${id}">${label}</button>`).join('')}</div>`
    + tabs.map(([id,,html])=>`<section class="tabpane ${id===activeTab?'':'hidden'}" data-pane="${id}">${html}</section>`).join('');
  liveBar();
  renderLive(true);
  renderSrank();
  if(activeTab === 'srank') loadSrank();
  loadAugNames();
  loadItemData().then(renderLive);
}
onClick('[data-tab]', t=>{
  activeTab = t.dataset.tab; store.set('duo_tab', activeTab);
  if(activeTab === 'srank') loadSrank();
  document.querySelectorAll('.tab').forEach(b=>{ const on = b.dataset.tab===activeTab; b.classList.toggle('on',on); b.setAttribute('aria-selected',on); });
  document.querySelectorAll('.tabpane').forEach(p=>p.classList.toggle('hidden', p.dataset.pane!==activeTab));
});

// quiet: a background refresh (no "Loading…" message, no options popping open)
let loading = false;
async function loadStats(quiet){
  if(loading) return;
  const s = formSettings();
  if(!s.players[0]){ showSettings(true); if(!quiet) msg('Enter at least one Riot ID.', 'err'); return; }
  loading = true; $('#go').disabled = true;
  if(!quiet) msg('<span class="spin"></span>Loading… The first time, games from Riot\'s servers take a moment each; games saved on this Mac load instantly.');
  try{
    const data = await api('/api/stats', s);
    const firstLoad = !lastData;
    lastData = data;
    setBadges(data.badges);
    if(firstLoad) weekStart = null;
    render(data);
    const together = data.players.length > 1 ? ' together' : '';
    const warnings = (data.warnings||[]).map(x=>`<div class="err">${esc(x)}</div>`).join('');
    msg(`${data.players[0].games.length} games${together}.`
      + (data.clientOpen ? '' : ' League isn\'t open, so this is everything saved so far.') + warnings, 'ok');
    if(!liveTimer){ liveTimer = true; poll().then(nextPoll); }
  }catch(e){ if(!quiet) msg(esc(e.message), 'err'); }
  finally{ loading = false; $('#go').disabled = false; }
}
$('#go').onclick = async ()=>{
  await api('/api/settings', formSettings()).catch(()=>{});
  loadStats(false);
};

// every few seconds (every second in champion select, so picks and swaps show straight away): the Live tab,
// and whether the app has saved anything new (a finished game, a new grade)
let polls = 0;
function nextPoll(){ setTimeout(()=>poll().finally(nextPoll), live && live.phase === 'ChampSelect' ? 1000 : 3000); }
async function poll(){
  if(!lastData) return;
  try{ live = await api('/api/live?' + lastData.players.map(p=>'id='+encodeURIComponent(p.riotId)).join('&')); }
  catch(e){ live = {phase:'Error', message:e.message, players:[]}; }
  liveBar();
  renderLive();
  gameStartNotice(live);
  if(dataVersion === null) dataVersion = live.version;
  else if(live.version !== dataVersion){
    dataVersion = live.version;
    loadStats(true);
    if(sr) loadSrank(true);
  }
  if(++polls % 5 === 0) checkKey();   // refresh the client status line now and then
}

// starting up: fill in the options, then load straight away if there's a Riot ID to load
(async ()=>{
  const s = await loadSettings();
  const st = await checkKey();
  if(st && st.viewer) enterViewerMode();
  if((s.players||[]).some(Boolean)) loadStats(false);
  else if(viewer) msg('luggi duc isn\'t set up yet on the Mac running it. Add the Riot IDs there first.');
  else { showSettings(true); msg('Enter your Riot IDs in Options to get started.'); }
})();

// ---- a game starting: a notification with a button to the Live tab ----
// Shown when champion select begins, or when a game starts loading without one. Not on the first check after the page
// opens (so a refresh mid-game doesn't announce it), and not when you're already looking at the Live tab.
let lastPhase;   // undefined until the first check
const PLAYING = ['ChampSelect', 'GameStart', 'InProgress', 'Reconnect'];
function gameStartNotice(s){
  const was = lastPhase; lastPhase = s.phase;
  if(was === undefined || was === s.phase) return;
  const starting = s.phase === 'ChampSelect' || (['GameStart', 'InProgress'].includes(s.phase) && !PLAYING.includes(was));
  if(!starting) return;
  if(!document.hidden && activeTab === 'live') return;
  const what = `${s.phase === 'ChampSelect' ? 'Champion select' : 'Game loading'}${s.queueId ? ' · ' + esc(QUEUES[s.queueId] || 'Queue ' + s.queueId) : ''}`;
  document.querySelectorAll('.toast.gamestart').forEach(closeToast);
  toast('🎮 Your game is starting', `${what}<button class="toastbtn" data-open-live>Open Live</button>`, 30000, 'gamestart');
  if(document.hidden){   // in another tab: say so in the tab's title until you come back
    const title = document.title;
    document.title = '🎮 Game starting · ' + title;
    document.addEventListener('visibilitychange', function back(){
      if(!document.hidden){ document.title = title; document.removeEventListener('visibilitychange', back); } });
  }
}
// ---- a new wild fire duck in Ductopia (an S+ on a new champion): a notification with a button to the Volcano Spa ----
// Ductopia's page shows the same one; whichever page sees it first marks it seen in this browser (utopia.js).
async function fireDuckNotice(){
  if(document.hidden) return;
  let u; try{ u = await api('/api/utopia'); }catch(e){ return; }
  let seen; try{ seen = JSON.parse(store.get('ductopia_fire_ducks_seen') || '{}') || {}; }catch(e){ seen = {}; }   // (as utopia.js's FIRE_SEEN)
  const gained = [];
  (u.players || []).forEach((p, i)=>{
    const k = p.riotId.toLowerCase();
    const n = (p.volcano || []).length;   // fire ducks unlocked, wild or caught
    if(seen[k] != null && n > seen[k]) gained.push({p, i, n: n - seen[k]});
    seen[k] = n;
  });
  store.set('ductopia_fire_ducks_seen', JSON.stringify(seen));
  if(!gained.length) return;
  toast('🔥 A wild fire duck appeared!', gained.map(({p, i, n})=>{
    const games = (p.volcano || []).slice(-n), last = games[games.length - 1];
    const img = last && ddVer ? `<img src="${champImage(last.champion)}" alt="" onerror="this.style.visibility='hidden'">` : '';
    return `<div class="srtoast p${i+1}"><span class="face">${img}</span><span><b>${i === u.me ? 'You' : esc(shortName(p.riotId))}</b> unlocked
      ${n > 1 ? `${n} wild fire ducks` : 'a wild fire duck'}${games.length ? ` with an S+ on ${esc(games.map(x=>x.champion).join(', '))}` : ''}. Lure ${n > 1 ? 'them' : 'it'} with a sweet treat to catch ${n > 1 ? 'them' : 'it'}.</span></div>`;
  }).join('') + `<button class="toastbtn" data-open-volcano="${gained[0].i}">Visit the Volcano Spa</button>`, 20000, 'firetoast');
}
setTimeout(fireDuckNotice, 4000);
setInterval(fireDuckNotice, 30000);
document.addEventListener('click', e=>{ const b = e.target.closest('[data-open-volcano]'); if(b) location.href = '/ductopia#volcano=' + b.dataset.openVolcano; });

document.addEventListener('click', e=>{
  const b = e.target.closest('[data-open-live]'); if(!b) return;
  const tab = document.querySelector('[data-tab="live"]'); if(tab){ tab.click(); window.scrollTo({top: 0, behavior: 'smooth'}); }
  closeToast(b.closest('.toast'));
});
