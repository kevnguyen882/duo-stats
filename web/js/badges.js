// Badges: standout moments in a game (huge damage, a near-perfect KDA...). Hover one for what it means.
// Multikills are badges too, one per game per kind: 2 pentas and a quadra in a game earn one Pentakill badge (×2)
// and one Quadra Kill.
// Where the Penta / Quadra / Triple chips already show them with counts, pass {multikills: false} to leave them out.
// Several of the same multikill in one game get an upgraded look: a silver ring for two, a spinning gold one for three or more.
// Percentages are compared as the page shows them (rounded), so 89.8% kill participation shown as 90% counts.
// Duo badges (Twin Carries, Killing Machines) need both of you on the same team, and go to each of you.

const kdaOf = x => (x.kills+x.assists)/Math.max(x.deaths,1);
const BADGES = [
  // id, icon, name, earned?, what it means (for this game), how to earn it (for the Badges tab), how many that game had
  // earned? and what it means get (game row, opts); opts.mate is your duo partner's row in the same game, if on your team
  ['best', '🏆', 'Personal Best', (x,o)=>o.best && x.damage >= o.best && x.damage > 0,
    x=>`${f0(x.damage)} damage: ${o_who(x)} highest damage to champions in any saved game.`,
    'Your highest damage to champions in any saved game.'],
  ['sixfig', '💥', 'Six Figures', x=>x.damage >= 100000, x=>`Dealt ${f0(x.damage)} damage to champions (100,000 or more).`,
    'Deal 100,000 or more damage to champions.'],
  ['untouch', '🛡️', 'Untouchable', x=>Math.round(kdaOf(x)*10) >= 80, x=>`A KDA of ${f1(kdaOf(x))} (8 or better).`,
    'Finish with a KDA of 8 or better.'],
  ['everywhere', '🌐', 'Everywhere', x=>Math.round(x.kp*100) >= 90, x=>`In on ${pct(x.kp)} of the team's kills (90% or more).`,
    "Take part in 90% or more of your team's kills."],
  ['carry', '🔥', 'Hard Carry', x=>Math.round(x.dmgShare*100) >= 40, x=>`Dealt ${pct(x.dmgShare)} of the team's damage (40% or more).`,
    "Deal 40% or more of your team's damage."],
  ['spree', '☠️', 'Killing Spree', x=>x.kills >= 30, x=>`${x.kills} kills in one game (30 or more).`,
    'Get 30 or more kills.'],
  ['playmaker', '🤝', 'Playmaker', x=>x.assists >= 50, x=>`${x.assists} assists in one game (50 or more).`,
    'Get 50 or more assists.'],
  ['marathon', '⏳', 'Marathon', x=>x.duration >= 1800, x=>`A ${Math.floor(x.duration/60)}-minute game (30 minutes or more).`,
    'Play a game that lasts 30 minutes or more.'],
  ['lifeline', '🩹', 'Lifeline', x=>x.heal >= 25000, x=>`Healed ${f0(x.heal)} (25,000 or more).`, 'Heal 25,000 or more in a game.'],
  ['wall', '🧱', 'Brick Wall', x=>x.mitigated >= 120000, x=>`Blocked or reduced ${f0(x.mitigated)} damage (120,000 or more).`,
    'Block or reduce 120,000 or more damage with armor, magic resist and shields.'],
  ['crit', '💢', 'Big Crit', x=>x.crit >= 1500, x=>`A ${f0(x.crit)} critical strike (1,500 or more).`, 'Land a single critical strike of 1,500 or more.'],
  ['unstoppable', '🌪️', 'Unstoppable', x=>x.spree >= 8, x=>`${x.spree} kills in a row without dying (8 or more).`, 'Get 8 or more kills in a row without dying.'],
  ['midas', '💰', 'Gold Digger', x=>x.gold >= 25000, x=>`Earned ${f0(x.gold)} gold (25,000 or more).`, 'Earn 25,000 or more gold in a game.'],
  ['twins', '👯', 'Twin Carries', (x,o)=>o.mate && x.damage >= 70000 && o.mate.damage >= 70000,
    (x,o)=>`Both of you dealt 70,000+ damage: ${f0(x.damage)} and ${f0(o.mate.damage)}.`, 'Both of you deal 70,000 or more damage in the same game.'],
  ['killers', '🔪', 'Killing Machines', (x,o)=>o.mate && x.kills >= 20 && o.mate.kills >= 20,
    (x,o)=>`Both of you got 20+ kills: ${x.kills} and ${o.mate.kills}.`, 'Both of you get 20 or more kills in the same game.'],
  ['penta', '👑', 'Pentakill', x=>x.pentas > 0, x=>`${x.pentas} pentakill${x.pentas>1?'s':''} in one game.`, 'Get a pentakill.', x=>x.pentas],
  ['quadra', '⚔️', 'Quadra Kill', x=>x.quadras > 0, x=>`${x.quadras} quadra kill${x.quadras>1?'s':''} in one game.`, 'Get a quadra kill.', x=>x.quadras],
  ['triple', '🗡️', 'Triple Kill', x=>x.triples > 0, x=>`${x.triples} triple kill${x.triples>1?'s':''} in one game.`, 'Get a triple kill.', x=>x.triples],
];
const MULTIKILL_BADGE_IDS = new Set(['penta', 'quadra', 'triple']);
const o_who = x => x.name ? `${x.name}'s` : 'their';

// your duo partner's row in the same game, when you were on the same team (for the duo badges)
let mateMaps = null, mateFrom = null;
function mateRow(players, i, x){
  if(players.length < 2 || !x || !x.withDuo) return null;
  if(mateFrom !== players){ mateFrom = players; mateMaps = players.map(p=>new Map(p.games.map(g=>[String(g.matchId), g]))); }
  return mateMaps[i === 0 ? 1 : 0].get(String(x.matchId)) || null;
}

// each tracked player's best damage in a non-remake game, for Personal Best
function bestDamage(players){
  const out = {};
  players.forEach(p=>{ out[p.riotId.toLowerCase()] = Math.max(0, ...p.games.filter(g=>!g.remake).map(g=>g.damage)); });
  return out;
}

// the badges a game earned. x: a game row; opts.best: that player's best damage (if known); opts.name: whose game;
// opts.multikills: false to leave out the multikill badges. Each badge is listed once per game; multi says how many of
// that multikill the game had (0 when just one).
function gameBadges(x, opts={}){
  if(x.remake) return [];
  const row = {...x, name: opts.name || x.name};
  return BADGES.filter(([id, , , earned])=>(opts.multikills !== false || !MULTIKILL_BADGE_IDS.has(id)) && earned(row, opts))
    .map(([id, ic, name, , what, , count])=>{
      const n = count ? count(row) : 1;   // multi: how many of this multikill the game had (2+ gets an upgraded look)
      return {id, ic, name, what: what(row, opts), multi: n > 1 ? n : 0};
    });
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
