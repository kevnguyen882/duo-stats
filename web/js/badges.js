// Badges: standout moments in a game (huge damage, a near-perfect KDA...). Hover one for what it means.
// The rules live in the app (duostats/badges.py): it attaches each game's badges to the rows it sends, with what each
// one means for that game, and sends the catalogue of every badge. This file only shows them.
// Several of the same multikill in one game get an upgraded look: a silver ring for two, a spinning gold one for three or more.

const kdaOf = x => (x.kills+x.assists)/Math.max(x.deaths,1);
const BADGES = [];   // every badge, in the usual order: {id, ic, name, how}. Filled from the app's stats (setBadges)
function setBadges(list){ if(Array.isArray(list)) BADGES.splice(0, BADGES.length, ...list); }
const badgeOrder = id => BADGES.findIndex(b=>b.id === id);
const MULTIKILL_BADGE_IDS = new Set(['penta', 'quadra', 'triple']);

// the badges a game earned, as the app worked them out: {id, ic, name, what, multi}. Each badge is listed once per
// game; multi says how many of that multikill the game had (0 when just one). Where the Penta / Quadra / Triple chips
// already show them with counts, pass {multikills: false} to leave them out.
function gameBadges(x, opts={}){
  return (x.badges || []).filter(b=>opts.multikills !== false || !MULTIKILL_BADGE_IDS.has(b.id));
}

// compact: icon only (the name is in the hover card)
function badgeChips(list, compact){
  const seen = new Map();   // a badge earned several times shows once, with ×n
  list.forEach(b=>seen.set(b.id, {...b, n: (seen.get(b.id)?.n || 0) + 1}));
  seen.forEach(b=>{ if(b.n === 1 && b.multi > 1) b.n = b.multi; });   // one game's badge: show how many it had, e.g. Pentakill ×2
  if(!seen.size) return '';
  return `<div class="bdgs">${[...seen.values()].map(b=>`<span class="bdg b-${b.id} ${compact?'mini':''} ${b.multi > 1 ? 'multi m'+Math.min(b.multi, 3) : ''}" tabindex="0"
    data-tip-title="${esc(b.ic+' '+b.name+(b.n>1?' ×'+b.n:''))}" data-tip="${esc(b.what)}">${b.ic}${compact?'':`<span>${esc(b.name)}</span>`}${b.n>1?`<em>×${b.n}</em>`:''}</span>`).join('')}</div>`;
}
