// Badges (badges.js, badgeart.js) and scores (stats.js). Runs inside the page's scope: see run.js.

// an ordinary game that earns nothing; pass what a test needs
const game = over => ({matchId: '1', champion: 'Annie', win: true, remake: false, withDuo: true, duration: 1500,
  kills: 5, deaths: 5, assists: 5, kp: 0.5, dmgShare: 0.2, damage: 20000, gold: 12000, heal: 1000, mitigated: 10000,
  crit: 0, spree: 2, pentas: 0, quadras: 0, triples: 0, cs: 150, vision: 20, ...over});
const ids = (x, opts) => gameBadges(x, opts).map(b=>b.id);

test('an ordinary game earns no badges', () => {
  assert.deepStrictEqual(ids(game()), []);
});

test('each badge at its threshold, and just under it', () => {
  const cases = [
    ['sixfig', {damage: 100000}, {damage: 99999}],
    ['untouch', {kills: 6, assists: 10, deaths: 2}, {kills: 6, assists: 9, deaths: 2}],   // KDA 8 vs 7.5
    ['spree', {kills: 30}, {kills: 29}],
    ['playmaker', {assists: 50}, {assists: 49}],
    ['marathon', {duration: 1800}, {duration: 1799}],
    ['lifeline', {heal: 25000}, {heal: 24999}],
    ['wall', {mitigated: 120000}, {mitigated: 119999}],
    ['crit', {crit: 1500}, {crit: 1499}],
    ['unstoppable', {spree: 8}, {spree: 7}],
    ['midas', {gold: 25000}, {gold: 24999}],
  ];
  for(const [id, earns, misses] of cases){
    assert.ok(ids(game(earns)).includes(id), `${id} should be earned`);
    assert.ok(!ids(game(misses)).includes(id), `${id} should not be earned`);
  }
});

test('percentages count as the page rounds them', () => {
  assert.ok(ids(game({kp: 0.895})).includes('everywhere'));    // shown as 90%
  assert.ok(!ids(game({kp: 0.894})).includes('everywhere'));   // shown as 89%
  assert.ok(ids(game({dmgShare: 0.395})).includes('carry'));
  assert.ok(!ids(game({dmgShare: 0.394})).includes('carry'));
});

test('KDA with no deaths counts deaths as one', () => {
  assert.ok(ids(game({kills: 4, assists: 4, deaths: 0})).includes('untouch'));
});

test('a remake earns nothing', () => {
  assert.deepStrictEqual(ids(game({remake: true, damage: 200000, pentas: 1})), []);
});

test('personal best needs that player\'s best damage', () => {
  assert.ok(ids(game({damage: 50000}), {best: 50000}).includes('best'));
  assert.ok(!ids(game({damage: 49000}), {best: 50000}).includes('best'));
  assert.ok(!ids(game({damage: 50000})).includes('best'));   // best not known
});

test('duo badges need both of you on the team', () => {
  const big = game({damage: 70000, kills: 20});
  assert.deepStrictEqual(ids(big, {mate: game({damage: 70000, kills: 20})}).filter(i=>['twins','killers'].includes(i)), ['twins','killers']);
  assert.deepStrictEqual(ids(big, {mate: game({damage: 69999, kills: 19})}).filter(i=>['twins','killers'].includes(i)), []);
  assert.ok(!ids(big).includes('twins'));   // no partner in that game
});

test('multikills: one badge per kind, with how many', () => {
  const b = gameBadges(game({pentas: 2, quadras: 1}));
  const penta = b.find(x=>x.id === 'penta'), quadra = b.find(x=>x.id === 'quadra');
  assert.strictEqual(penta.multi, 2);
  assert.strictEqual(quadra.multi, 0);   // just one
  assert.ok(penta.what.includes('2 pentakills'));
  assert.deepStrictEqual(ids(game({pentas: 1}), {multikills: false}), []);
});

test('every badge has a border drawn for it', () => {
  for(const [id] of BADGES) assert.ok(id in BADGE_BORDERS, `no border for ${id}`);
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
