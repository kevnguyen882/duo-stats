// The extension's popup: where Duo Stats is (and its PIN), and what the tracker is doing right now.

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function load(){
  const {appUrl = '', pin = ''} = await chrome.storage.local.get(['appUrl', 'pin']);
  $('url').value = appUrl; $('pin').value = pin;
  show();
}

async function show(){
  const {status = {}, appUrl} = await chrome.storage.local.get(['status', 'appUrl']);
  let h;
  if(!appUrl) h = '<span class="bad">Enter the Duo Stats address above and press Save.</span>';
  else if(!status.inGame) h = `Not in a game right now${status.checked ? '' : ' (checking…)'}. Start one and it begins recording by itself.
    <p style="margin:6px 0 0">In a game and still seeing this? Use the button below to allow the game's data page.</p>`;
  else h = `<b>Recording:</b> ${esc(status.champion)} · ${esc(status.riotId)}<br>
    Skill order so far: <code>${esc(status.sequence) || '–'}</code><br>
    ${status.sendError ? `<span class="bad">${esc(status.sendError)}</span>` : status.sent ? '<span class="ok">✓ Sent to Duo Stats</span>' : 'Sending…'}`;
  $('status').innerHTML = h;
}

$('save').onclick = async () => {
  let url = $('url').value.trim().replace(/\/+$/, '');
  if(url && !/^https?:\/\//.test(url)) url = 'http://' + url;
  let origin;
  try{ origin = new URL(url).origin; }catch(e){ $('status').innerHTML = '<span class="bad">That address doesn\'t look right.</span>'; return; }
  // permission to talk to that one address (the browser asks)
  const granted = await chrome.permissions.request({origins: [origin + '/*']}).catch(() => false);
  if(!granted){ $('status').innerHTML = '<span class="bad">The extension needs permission to send to Duo Stats.</span>'; return; }
  await chrome.storage.local.set({appUrl: origin, pin: $('pin').value.trim()});
  $('url').value = origin;
  chrome.runtime.sendMessage('check-now');
  $('status').innerHTML = '<span class="ok">Saved.</span>';
  setTimeout(show, 1500);
};
$('allow').onclick = () => chrome.tabs.create({url: 'https://127.0.0.1:2999/liveclientdata/activeplayername'});

chrome.storage.onChanged.addListener(show);
load();
