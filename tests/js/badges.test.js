// Badges (badges.js, badgeart.js) and scores (stats.js). Runs inside the page's scope: see run.js.

// an ordinary game that earns nothing; pass what a test needs
const game = over => ({matchId: '1', champion: 'Annie', win: true, remake: false, withDuo: true, duration: 1500,
  kills: 5, deaths: 5, assists: 5, kp: 0.5, dmgShare: 0.2, damage: 20000, gold: 12000, heal: 1000, mitigated: 10000,
  crit: 0, spree: 2, pentas: 0, quadras: 0, triples: 0, cs: 150, vision: 20, ...over});
// the badges come from the app (duostats/badges.py, which has the rule tests); the page shows what it's sent
const penta = {id: 'penta', ic: '👑', name: 'Pentakill', what: '2 pentakills in one game.', multi: 2};
const crit = {id: 'crit', ic: '💢', name: 'Big Crit', what: 'A 1,600 critical strike (1,500 or more).', multi: 0};

test('a game shows the badges the app attached', () => {
  assert.deepStrictEqual(gameBadges(game()), []);
  assert.deepStrictEqual(gameBadges(game({badges: [crit, penta]})).map(b=>b.id), ['crit', 'penta']);
  assert.deepStrictEqual(gameBadges(game({badges: [crit, penta]}), {multikills: false}).map(b=>b.id), ['crit']);
});

test('badge chips: one per badge, with how many', () => {
  const html = badgeChips([crit, crit, penta]);
  assert.ok(html.includes('Big Crit') && html.includes('<em>×2</em>'));   // earned in two games
  assert.ok(html.includes('multi m2'));                                    // a game with two pentas
  assert.strictEqual(badgeChips([]), '');
});

test('the catalogue comes from the app, in its order', () => {
  setBadges([{id: 'best', ic: '🏆', name: 'Personal Best', how: '...'}, {id: 'crit', ic: '💢', name: 'Big Crit', how: '...'}]);
  assert.strictEqual(BADGES.length, 2);
  assert.strictEqual(badgeOrder('crit'), 1);
  setBadges(undefined);   // nothing sent: kept as it was
  assert.strictEqual(BADGES.length, 2);
});


test('game score', () => {
  // KDA 2 x3 = 6, kp 0.5 x20 = 10, damage share 0.2 x30 = 6, 20000/4000 = 5, 25 min = 10 past 15, win 10
  assert.strictEqual(perfScore(game()), 47);
  const huge = perfScore(game({kills: 40, deaths: 0, assists: 40, kp: 1, dmgShare: 0.6, damage: 400000, duration: 3600, pentas: 1}));
  assert.strictEqual(huge, 30 + 20 + 18 + 50 + 15 + 10 + 15);   // KDA, damage and length are capped
});

test('averages leave out remakes', () => {
  const a = agg([game({kills: 10, win: true}), game({kills: 0, win: false}), game({remake: true, kills: 99})]);
  assert.strictEqual(a.n, 2);
  assert.strictEqual(a.wins, 1);
  assert.strictEqual(a.k, 5);
  assert.strictEqual(agg([game({remake: true})]), null);
});

test('champion scores rank a strong champion above a weak one', () => {
  const games = [
    ...Array.from({length: 6}, (_, i)=>game({matchId: 'a'+i, champion: 'Annie', win: true, kills: 10, deaths: 2})),
    ...Array.from({length: 6}, (_, i)=>game({matchId: 'b'+i, champion: 'Vi', win: false, kills: 1, deaths: 8})),
  ];
  const [first, second] = champScores(games);
  assert.strictEqual(first.champ, 'Annie');
  assert.strictEqual(second.champ, 'Vi');
  assert.ok(first.score > second.score);
});
