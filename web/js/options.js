// The Options panel: Riot IDs, region, queue, the optional Riot API key, and the League client's status.
// On another computer on the network (a viewer) it only offers the theme: everything else can only be changed on the host Mac.

function showSettings(open){
  $('#settings').classList.toggle('hidden', !open);
  $('#gear').setAttribute('aria-expanded', open);
}
$('#gear').onclick = () => showSettings($('#settings').classList.contains('hidden'));
$('#closeSettings').onclick = () => showSettings(false);
// once the tab bar is pinned to the top, line the options icon up with it
addEventListener('scroll', ()=>{ const t = document.querySelector('.tabs');
  $('#gear').classList.toggle('docked', !!t && t.getBoundingClientRect().top <= 0.5); }, {passive:true});
// a failed load opens the options so it can be fixed
new MutationObserver(()=>{ if($('#msg').classList.contains('err') && !viewer) showSettings(true); })
  .observe($('#msg'), {attributes:true, attributeFilter:['class']});

$('#region').innerHTML = REGIONS.map(r=>`<option>${r}</option>`).join('');

function formSettings(){
  return {players: [$('#p1').value.trim(), $('#p2').value.trim()], region: $('#region').value,
          queue: $('#queue').value, count: +$('#count').value};
}
function fillForm(s){
  const players = s.players || [];
  $('#p1').value = players[0] || ''; $('#p2').value = players[1] || '';
  if(s.region) $('#region').value = s.region;
  $('#queue').value = s.queue || '';
  if(s.count) $('#count').value = String(s.count);
  if(!$('#count').value) $('#count').value = '40';   // a saved choice that's no longer listed
}

// Settings live in the app now (so the background listener knows who to track). Older versions kept them
// in the browser, so those are moved over the first time.
async function loadSettings(){
  let s = {};
  try{ s = await api('/api/settings'); }catch(e){}
  if(!(s.players||[]).some(Boolean) && store.get('duo_p1')){
    s = {players: [store.get('duo_p1')||'', store.get('duo_p2')||''], region: store.get('duo_region') || 'NA',
         queue: store.get('duo_queue') || '', count: +(store.get('duo_count') || 40)};
    api('/api/settings', s).catch(()=>{});
  }
  fillForm(s);
  return s;
}

// ---- the League client's status ----
function showClientStatus(c){
  if(!c) return;
  const text = !c.connected ? 'League client not open. Games you play while it\'s closed are picked up next time it opens.'
    : `Connected to League${c.me ? ' as '+esc(c.me) : ''} · ${c.listening ? 'listening for games' : 'checking every few seconds'}`
      + (c.lastSaved ? ` · last game saved ${timeAgo(c.lastSaved)}` : '');
  $('#clientStatus').innerHTML = `<span class="dot ${c.connected?'on':''}"></span>${text}`;
}

// ---- the Riot API key ----
async function checkKey(){
  try{
    const s = await api('/api/status');
    $('#forgetKey').classList.toggle('hidden', !s.saved);
    if(s.hasKey) $('#keynote').innerHTML = s.saved
      ? '<span class="ok">✓ Using your saved API key.</span> Games are also loaded from Riot\'s servers.'
      : '<span class="ok">✓ API key set for this session.</span> Games are also loaded from Riot\'s servers.';
    showClientStatus(s.client);
    return s;
  }catch(e){ return null; }
}
$('#forgetKey').onclick = async ()=>{
  try{ await api('/api/forget', {}); msg('Saved key removed from this Mac.', 'ok'); checkKey(); }
  catch(e){ msg(esc(e.message), 'err'); }
};
$('#saveKey').onclick = async ()=>{
  msg('<span class="spin"></span>Checking key with Riot…');
  try{
    const r = await api('/api/key', {key: $('#key').value, remember: $('#remember').checked}); $('#key').value = '';
    msg(r.saved ? 'Key works and is saved in your Keychain.' : ($('#remember').checked
      ? "Key works, but it couldn't be saved to the Keychain, so it's set for this session only." : 'Key works and is set for this session.'), 'ok');
    checkKey();
  }catch(e){ msg(esc(e.message), 'err'); }
};

// another computer on the network: say so, and keep only what a viewer can use
function enterViewerMode(){
  viewer = true;
  document.body.classList.add('viewer');
  $('#gear').title = 'Theme'; $('#gear').setAttribute('aria-label', 'Theme');
  $('.sub').insertAdjacentHTML('afterend', '<p class="viewing">👀 Viewing luggi duc from another computer. You can look around; settings are changed on the Mac running it.</p>');
}
