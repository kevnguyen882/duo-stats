// Totals, averages and scores. Remakes are left out of every average.

function agg(games){
  const g = games.filter(x=>!x.remake), n = g.length;
  if(!n) return null;
  const sum = f => g.reduce((a,x)=>a+f(x), 0);
  const mins = Math.max(sum(x=>x.duration)/60, 1);
  const k = sum(x=>x.kills), d = sum(x=>x.deaths), a = sum(x=>x.assists), wins = sum(x=>x.win?1:0);
  const kpG = g.filter(x=>x.kp!=null);
  return {n, wins, losses:n-wins, wr:wins/n, k:k/n, d:d/n, a:a/n, kda:(k+a)/Math.max(d,1),
    csm:sum(x=>x.cs)/mins, dpm:sum(x=>x.damage)/mins, vision:sum(x=>x.vision)/n,
    kp: kpG.length ? kpG.reduce((s,x)=>s+x.kp,0)/kpG.length : null};
}

// Game score (Best games): a rough 0-100ish rating of one game, where big, long games count most.
//   KDA (capped at 10) x 3, kill participation x 20, share of team damage x 30,
//   1 per 4,000 damage (up to 50), 1 per minute past 15 (up to 15), +10 for a win,
//   +15 per penta, +6 per quadra, +2 per triple
function perfScore(x){
  const kda = Math.min((x.kills+x.assists)/Math.max(x.deaths,1), 10);
  const length = Math.min(Math.max(x.duration/60 - 15, 0), 15);
  return Math.round(kda*3 + (x.kp||0)*20 + (x.dmgShare||0)*30 + Math.min(x.damage/4000, 50) + length
    + (x.win?10:0) + x.pentas*15 + x.quadras*6 + x.triples*2);
}

// Score tiers: silver and gold scores on Best games get an emblem at the top right, like an exponent.
// Cut-offs from your games: gold is about the top 5%, silver the next ~20%, bronze (no emblem) everything else.
const SCORE_TIERS = [['gold', 80, 'Gold score', '80 or more: about the top 5% of your games.'],
                     ['silver', 60, 'Silver score', '60 to 79: a strong game, about the top quarter.'],
                     ['bronze', 0, 'Bronze score', 'Under 60.']];
const EMBLEMS = {
  // a winged silver shield, with a star
  silver: `<svg viewBox="0 0 24 24"><path d="M8 8.3C5.2 7.4 2.7 5.8 1.4 3.6c.2 3.1 1.5 5.8 3.4 7.4-1 .2-2 .1-2.9-.3 1.3 2 3.4 3.2 6.2 3.3zM16 8.3c2.8-.9 5.3-2.5 6.6-4.7-.2 3.1-1.5 5.8-3.4 7.4 1 .2 2 .1 2.9-.3-1.3 2-3.4 3.2-6.2 3.3z" fill="#9fb0c6"/>
    <path d="M12 3.2l5.2 2.1v5.4c0 3.7-2.3 6.6-5.2 8-2.9-1.4-5.2-4.3-5.2-8V5.3z" fill="url(#emb-silver)" stroke="#475569" stroke-width=".8"/>
    <path d="M12 7.4l.92 1.88 2.07.3-1.5 1.46.36 2.06L12 12.12l-1.85.98.36-2.06-1.5-1.46 2.07-.3z" fill="#f8fafc" stroke="#64748b" stroke-width=".4"/></svg>`,
  // a golden flame (the same shape as the S+ flame on the S Rank page; srank.js loads after this file)
  gold: '<svg viewBox="0 0 28 34"><path class="fo" d="M14 1.5c1.2 4.6 4.6 7.3 7.3 10.6 2.6 3.2 3.9 6.4 3.9 9.6C25.2 28.1 20.2 33 14 33S2.8 28.1 2.8 21.7c0-4.3 2.2-7.6 4.6-10 .2 2.4 1.2 4.2 2.9 5.2-.4-5.5 1.1-10.6 3.7-15.4z"/><path class="fi" d="M14 13.5c.8 2.6 2.6 4.1 4 5.9 1.3 1.6 1.9 3.3 1.9 5 0 3.5-2.6 6.2-5.9 6.2s-5.9-2.7-5.9-6.2c0-2.4 1.1-4.2 2.5-5.6.2 1.3.8 2.3 1.7 2.8-.1-3 .6-5.6 1.7-8.1z"/></svg>',
};
// the emblems' colour gradients, defined once for the whole page
document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="emb-silver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#d3dce8"/><stop offset="1" stop-color="#6b7c93"/></linearGradient>
  <linearGradient id="emb-gold-o" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#c2410c"/><stop offset=".5" stop-color="#f59e0b"/><stop offset="1" stop-color="#fde68a"/></linearGradient>
  <linearGradient id="emb-gold-i" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fffbe6"/><stop offset="1" stop-color="#fcd34d"/></linearGradient>
</defs></svg>`);

function scoreBadge(s){
  const [tier, , title, what] = SCORE_TIERS.find(([, min])=>s >= min);
  if(!EMBLEMS[tier]) return `<span class="scw"><span class="sc">${s}</span></span>`;
  return `<span class="scw" tabindex="0" data-tip-title="${title}" data-tip="${what}"><span class="sc">${s}</span><span class="emb t-${tier}" aria-hidden="true">${EMBLEMS[tier]}</span></span>`;
}

// Champion score (Top champions): how well you've done on a champion across all saved games.
//   win rate (pulled toward 50% when there are only a few games) x 40          -> up to ~40
//   KDA, capped at 8 and pulled toward 3 when there are only a few games, x 5  -> up to 40
//   wins: 5 x log2(1 + wins), so more wins keep adding, a bit less each time
//   multikills: 10 per penta + 4 per quadra + 1 per triple, up to 30
//   experience: 12 x log2(1 + games) x form, so playing a champion a lot pushes it up if you do well on it and down if
//     you don't. Form runs from -1 to +1: 70% win rate (50% is 0, 80% is +1, 20% is -1) and 30% KDA against your
//     overall KDA, both pulled toward average while there are only a few games
function champScores(games){
  const by = {}, played = games.filter(g=>!g.remake);
  played.forEach(g=>(by[g.champion] = by[g.champion] || []).push(g));
  const total = k => played.reduce((a,g)=>a+(g[k]||0),0);
  const myKda = Math.max((total('kills') + total('assists')) / Math.max(total('deaths'), 1), .1);   // never 0, it's divided by
  const clamp = v => Math.max(-1, Math.min(1, v));
  return Object.entries(by).map(([champ, gs])=>{
    const n = gs.length, sum = k => gs.reduce((a,g)=>a+(g[k]||0),0), wins = gs.filter(g=>g.win).length;
    const kda = (sum('kills') + sum('assists')) / Math.max(sum('deaths'), 1);
    const pentas = sum('pentas'), quadras = sum('quadras'), triples = sum('triples');
    const steadyKda = (Math.min(kda,8)*n + 3*2) / (n+2);   // one lucky game shouldn't top the list
    const steadyWr = (wins+2)/(n+4), formKda = (Math.min(kda,8)*n + myKda*2) / (n+2);
    const form = clamp((steadyWr - .5) / .3) * .7 + clamp((formKda - myKda) / myKda) * .3;
    const parts = { wr: steadyWr*40, kda: steadyKda*5, wins: 5*Math.log2(1+wins),
                    multi: Math.min(30, pentas*10 + quadras*4 + triples), experience: 12*Math.log2(1+n)*form };
    return { champ, n, wins, kda, pentas, quadras, triples, parts,
             score: Math.round(parts.wr + parts.kda + parts.wins + parts.multi + parts.experience) };
  }).sort((a,b)=>b.score-a.score || b.n-a.n);
}
