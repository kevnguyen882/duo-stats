// Duo Stats Skill Tracker: while a League game is running on this computer, checks your ability levels every two
// seconds (from the game's own data at https://127.0.0.1:2999, which only this computer can see) and sends the order
// you levelled them to the Duo Stats app. Nothing else is read or sent.

const GAME = 'https://127.0.0.1:2999/liveclientdata/';
const EVERY_MS = 2000;
const SLOTS = ['Q', 'W', 'E', 'R'];

let running = false;

async function settings(){
  const s = await chrome.storage.local.get(['appUrl', 'pin']);
  return {appUrl: (s.appUrl || '').replace(/\/+$/, ''), pin: s.pin || ''};
}
async function setStatus(fields){
  const {status = {}} = await chrome.storage.local.get('status');
  await chrome.storage.local.set({status: {...status, ...fields, checked: Date.now()}});   // also keeps this worker awake
}
async function game(path){
  const r = await fetch(GAME + path, {cache: 'no-store'});
  if(!r.ok) throw new Error('game data ' + r.status);
  return r.json();
}

// one look at the game: who's playing, on what, at what point, and the ability levels now
async function snapshot(){
  const [riotId, abilities, stats, players] = await Promise.all([
    game('activeplayername'), game('activeplayerabilities'), game('gamestats'), game('playerlist')]);
  const me = (players || []).find(p => (p.riotId || `${p.riotIdGameName}#${p.riotIdTagLine}`).toLowerCase() === String(riotId).toLowerCase()) || {};
  const raw = String(me.rawChampionName || '');
  const champion = raw.startsWith('game_character_displayname_') ? raw.slice('game_character_displayname_'.length) : (me.championName || '');
  const levels = Object.fromEntries(SLOTS.map(k => [k, (abilities[k] && abilities[k].abilityLevel) || 0]));
  return {riotId: String(riotId), champion, mode: String(stats.gameMode || ''), gameTime: stats.gameTime || 0, levels};
}

async function tick(){
  const {track} = await chrome.storage.local.get('track');
  let snap;
  try{ snap = await snapshot(); }
  catch(e){ await setStatus({inGame: false}); return false; }   // no game running (or the game's certificate isn't allowed yet)

  // a new game: different player, champion or mode, or the clock went backwards
  let t = track;
  const start = Date.now() - Math.round(snap.gameTime * 1000);
  if(!t || t.riotId !== snap.riotId || t.champion !== snap.champion || t.mode !== snap.mode || snap.gameTime + 5 < t.gameTime)
    t = {riotId: snap.riotId, champion: snap.champion, mode: snap.mode, start, levels: {Q:0, W:0, E:0, R:0}, sequence: '', sent: ''};
  // each ability that went up since last time adds its letter (two at once are rare at this speed; they go in Q-W-E-R order)
  SLOTS.forEach(k => { for(let n = t.levels[k]; n < snap.levels[k]; n++) t.sequence += k; });
  t.levels = snap.levels; t.gameTime = snap.gameTime;

  let sendError = '';
  if(t.sequence && t.sequence !== t.sent){
    const {appUrl, pin} = await settings();
    if(!appUrl) sendError = 'Set the Duo Stats address in the extension first.';
    else try{
      const r = await fetch(appUrl + '/api/skills', {method: 'POST', headers: {'Content-Type': 'application/json', ...(pin ? {'X-Duo-Pin': pin} : {})},
        body: JSON.stringify({riotId: t.riotId, champion: t.champion, mode: t.mode, start: t.start, sequence: t.sequence.slice(0, 18)})});
      if(r.ok) t.sent = t.sequence;
      else sendError = ((await r.json().catch(() => ({}))).error) || `Duo Stats answered ${r.status}.`;
    }catch(e){ sendError = "Couldn't reach Duo Stats. Is it running, and is the address right?"; }
  }
  await chrome.storage.local.set({track: t});
  await setStatus({inGame: true, riotId: t.riotId, champion: t.champion, sequence: t.sequence, sent: t.sent === t.sequence, sendError});
  return true;
}

// keep checking every couple of seconds while a game is on; the alarm restarts the loop if the browser paused it
async function loop(){
  if(running) return;
  running = true;
  try{
    while(await tick()) await new Promise(r => setTimeout(r, EVERY_MS));
  }finally{ running = false; }
}
chrome.alarms.create('check', {periodInMinutes: 0.5});
chrome.alarms.onAlarm.addListener(loop);
chrome.runtime.onStartup.addListener(loop);
chrome.runtime.onInstalled.addListener(loop);
chrome.runtime.onMessage.addListener((msg, _, reply) => { if(msg === 'check-now'){ loop(); reply(true); } });
