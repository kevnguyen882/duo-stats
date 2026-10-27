// Duck Utopia's art: simple placeholder pixel sprites, one per asset in the design doc, at its final size.
// Drop a finished PNG into web/img/utopia/ with the same name (e.g. duck-plain.png) and it replaces the placeholder
// the next time the page opens; nothing else needs changing.
//   art(name)  -> a canvas or image to draw (the placeholder until the PNG, if any, has loaded)

const ART_DIR = '/img/utopia/';
const ART = {};   // name -> canvas or loaded image

// ---- drawing helpers ----
function canvasOf(w, h, draw){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  draw(g, (x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(x, y, ww, hh); });
  return c;
}
// a sprite from rows of characters (one per pixel; '.' is clear), scaled up by `scale`
function fromMap(rows, pal, scale = 1){
  return canvasOf(rows[0].length * scale, rows.length * scale, (g, px)=>rows.forEach((row, y)=>[...row].forEach((ch, x)=>{
    if(ch !== '.' && pal[ch]) px(x * scale, y * scale, scale, scale, pal[ch]);
  })));
}
// draws a half-size grid (each unit is 2x2 real pixels), for the chunky look on bigger sprites
function chunky(size, draw){ return canvasOf(size, size, (g, px)=>draw((x, y, w, h, col)=>px(x*2, y*2, w*2, h*2, col))); }
function overlay(rows, extra){   // a copy of a map with some pixels replaced: extra is [[x, y, ch], ...]
  const out = rows.map(r=>[...r]);
  extra.forEach(([x, y, ch])=>{ if(out[y] && x >= 0 && x < out[y].length) out[y][x] = ch; });
  return out.map(r=>r.join(''));
}
const line = (x, y, n, ch, dx = 1, dy = 0) => Array.from({length: n}, (_, i)=>[x + i*dx, y + i*dy, ch]);

// ---- ducks (16x16 maps, drawn at 32x32) ----
const DUCK = [
  '................',
  '........BBB.....',
  '.......BBBBB....',
  '.......BBKBBOO..',
  '.......BBBBBOOO.',
  '........BBBB....',
  '.B.......BB.....',
  '.BB.....BBBB....',
  '.BBBBBBBBBBBB...',
  '.BBBBBBBBBBBBB..',
  '..BSBBBBBBBBBB..',
  '..BSSBBBBBBBB...',
  '...SSSSSSSSS....',
  '.....O....O.....',
  '.....OO...OO....',
  '................',
];
const DUCK_PAL = {B: '#f4f1e8', S: '#c9c2b0', K: '#1b1b1b', O: '#f29a2e'};
const CLASS_KIT = {   // extra pixels on the plain duck for each League class
  tank:     [...line(7, 1, 5, 'M'), ...line(6, 2, 2, 'M'), ...line(1, 8, 3, 'D'), ...line(1, 9, 3, 'D'), ...line(1, 10, 3, 'D'), [2, 9, 'Y']],
  mage:     [...line(8, 0, 3, 'P'), ...line(7, 1, 5, 'P'), [9, 0, 'Y'], ...line(14, 4, 9, 'T', 0, 1), [14, 3, 'C']],
  marksman: [...line(7, 1, 5, 'G'), ...line(11, 2, 2, 'G'), [0, 6, 'T'], [0, 7, 'T'], [0, 8, 'T'], [0, 9, 'T'], [0, 10, 'T'], [1, 5, 'T'], [1, 11, 'T']],
  support:  [...line(5, 9, 4, 'G'), ...line(5, 10, 4, 'G'), [6, 9, 'W'], [7, 9, 'W'], [6, 10, 'W'], [6, 8, 'W']],
  fighter:  [...line(7, 2, 6, 'R'), [6, 3, 'R'], [5, 4, 'R'], ...line(14, 5, 6, 'M', 0, 1), [13, 9, 'T'], [15, 9, 'T']],
  assassin: [...line(7, 1, 5, 'H'), ...line(6, 2, 2, 'H'), [11, 2, 'H'], [6, 3, 'H'], [6, 4, 'H'], [13, 8, 'M'], [14, 7, 'M'], [12, 10, 'M']],
};
const KIT_PAL = {M: '#9aa3ad', D: '#3b5ba5', Y: '#f7c948', P: '#7c3aed', T: '#8b5a2b', C: '#38bdf8', G: '#2f9e44',
  W: '#ffffff', R: '#e03131', H: '#343a40', Z: '#fff3bf', F: '#fa5252', Q: '#ffd43b'};
const DUCKLING = [
  '............',
  '......YYY...',
  '.....YYKYOO.',
  '.....YYYYO..',
  '......YY....',
  '..YYYYYYY...',
  '.YYYYYYYYY..',
  '.YSYYYYYYY..',
  '..SSSSSSS...',
  '....O..O....',
  '............',
  '............',
];

// ---- geese (16x16, drawn at 32x32; they face left, towards the ducks) ----
const GOOSE = [
  '................',
  '....KK..........',
  '...KKKK.........',
  '..OOKWKK........',
  '.OOOKKKK........',
  '....KK..........',
  '....KK..........',
  '....KG..........',
  '....GGG.....G...',
  '...GGGGGGGGGG...',
  '..GGGGGGGGGGGG..',
  '..GGGGHHGGGGGG..',
  '...GGGHHHHHGG...',
  '....GGGGGGGG....',
  '......O..O......',
  '......OO.OO.....',
];
const GOOSE_PAL = {K: '#212529', W: '#f8f9fa', G: '#868e96', H: '#5c636a', O: '#f08c00', M: '#ced4da', Y: '#e9c46a', R: '#c92a2a'};

// ---- buildings (32x32 half-size grids, drawn at 64x64) ----
function nests(tier){
  return chunky(64, px=>{
    if(tier === 1){   // three straw nests with eggs
      [[2, 18], [12, 22], [20, 14]].forEach(([x, y])=>{
        px(x, y + 3, 10, 4, '#8d6e3f'); px(x + 1, y + 2, 8, 1, '#b08a52'); px(x + 1, y + 7, 8, 1, '#6b5230');
        px(x + 3, y, 2, 3, '#fffbea'); px(x + 5, y + 1, 2, 2, '#f1e7c6');
      });
    } else if(tier === 2){   // little duck houses
      [[1, 12], [16, 8], [9, 19]].forEach(([x, y])=>{
        px(x, y + 5, 12, 9, '#e9d8a6'); for(let i = 0; i < 6; i++) px(x + i, y + 5 - i, 12 - 2*i, 1, '#c0583a');
        px(x + 5, y + 9, 3, 5, '#6b4423'); px(x + 2, y + 7, 2, 2, '#9ad1f5'); px(x + 9, y + 7, 2, 2, '#9ad1f5');
      });
    } else {   // a duck skyline
      [[1, 8, 8, 22, '#5f7fa8'], [10, 2, 9, 28, '#7393bd'], [20, 11, 10, 19, '#4f6d93']].forEach(([x, y, w, h, c])=>{
        px(x, y, w, h, c);
        for(let yy = y + 2; yy < y + h - 2; yy += 3) for(let xx = x + 1; xx < x + w - 1; xx += 3) px(xx, yy, 2, 2, '#ffe08a');
      });
      px(13, 0, 3, 2, '#f4f1e8'); px(16, 1, 1, 1, '#f29a2e');   // a duck on the tallest roof
    }
  });
}
function pond(tier){
  const water = ['#6b4f2a', '#3a86c8', '#22b8cf'][tier - 1], deep = ['#58401f', '#2b6aa3', '#1098ad'][tier - 1];
  const rim = ['#7d5f35', '#8fbf6a', '#f3e2b3'][tier - 1];
  return chunky(64, px=>{
    for(let y = 0; y < 32; y++){
      const half = Math.round(15 * Math.sqrt(Math.max(0, 1 - ((y - 15.5) / 15.5) ** 2)));
      if(half <= 0) continue;
      px(16 - half, y, half * 2, 1, rim);
      if(half > 1) px(17 - half, y, half * 2 - 2, 1, y > 18 ? deep : water);
    }
    px(9, 10, 4, 1, '#ffffff55'); px(18, 20, 5, 1, '#ffffff44');
    if(tier === 3){ px(24, 6, 2, 6, '#2b8a3e'); px(22, 5, 6, 2, '#40c057'); }   // a palm
  });
}
function bakery(level){
  const roof = ['#c92a2a', '#e8590c', '#ae3ec9'][level - 1];
  return chunky(64, px=>{
    px(5, 13, 22, 16, '#f1d7a6');
    for(let i = 0; i < 8; i++) px(3 + i, 13 - i, 26 - 2*i, 1, roof);
    px(21, 2, 3, 6, '#868e96'); px(21, 0, 3, 1, '#dee2e6');
    px(13, 20, 6, 9, '#7a4a24'); px(7, 17, 4, 4, '#a5d8ff'); px(21, 17, 4, 4, '#a5d8ff');
    px(9, 25, 3, 2, '#d9a35b'); px(20, 25, 3, 2, '#d9a35b');   // loaves
    for(let i = 1; i < level; i++) px(5 + i*3, 10, 2, 2, '#ffd43b');   // a star per extra level
  });
}
function spa(level){
  return chunky(64, px=>{
    px(3, 16, 26, 12, level === 2 ? '#a0522d' : '#dee2e6');
    px(5, 18, 22, 8, level === 2 ? '#ff8787' : '#74c0fc');
    [[8, 10], [15, 7], [22, 10]].forEach(([x, y])=>{ px(x, y, 2, 2, '#f1f3f5cc'); px(x + 1, y - 3, 2, 2, '#f1f3f599'); });
    px(10, 21, 3, 2, '#f4f1e8'); px(19, 22, 3, 2, '#f4f1e8');   // ducks relaxing
  });
}

// ---- districts (48x48 half-size grids, drawn at 96x96) ----
function district(kind){
  return canvasOf(96, 96, (g, p)=>{
    const px = (x, y, w, h, c)=>p(x*2, y*2, w*2, h*2, c);
    px(2, 30, 44, 16, kind === 'volcano' ? '#495057' : '#d8c9a3');   // the plaza
    if(kind === 'penta'){
      px(19, 12, 10, 18, '#f7c948'); px(21, 8, 6, 5, '#f7c948'); px(27, 10, 3, 2, '#f08c00'); px(23, 9, 1, 1, '#212529');
      px(16, 28, 16, 3, '#adb5bd');
      [[6, 36], [36, 38], [12, 40]].forEach(([x, y])=>{ px(x, y, 5, 4, '#f7c948'); px(x + 5, y + 1, 2, 1, '#f08c00'); });
    } else if(kind === 'champion'){
      [[6, '#4ea8ff'], [18, '#ff6fa8'], [30, '#c8aa6e']].forEach(([x, c])=>{
        px(x + 5, 8, 1, 24, '#6b4423'); px(x, 8, 5, 12, c); px(x + 1, 20, 3, 2, c);
      });
      px(8, 36, 5, 4, '#f4f1e8'); px(22, 38, 5, 4, '#f4f1e8'); px(34, 35, 5, 4, '#f4f1e8');
    } else {
      for(let i = 0; i < 14; i++) px(10 + i, 30 - i*2, 28 - 2*i, 2, i < 11 ? '#6c4f3d' : '#e8590c');
      px(21, 2, 6, 3, '#ff922b'); px(19, 0, 2, 2, '#ffd43b'); px(27, 1, 2, 2, '#ffd43b');
      px(6, 36, 10, 6, '#ff6b6b'); px(30, 37, 10, 6, '#ff6b6b');   // hot pools
    }
  });
}

// ---- icons and tiles ----
const ICONS = {
  'icon-breadcrumb': [['..........', '..XXXXX...', '.XYYYYYX..', 'XYYZYYYYX.', 'XYYYYYZYX.', '.XYYYYYX..', '..XXXXX...'], {X: '#8d5524', Y: '#e0a96d', Z: '#c68642'}],
  'icon-feather': [['......WW', '.....WWG', '....WWG.', '...WWG..', '..WWG...', '.WWG....', '.G......', 'G.......'], {W: '#f1f3f5', G: '#868e96'}],
  'icon-crown': [['Y..Y..Y.', 'YY.YY.YY', 'YYYYYYYY', 'YRYYBYRY', 'YYYYYYYY'], {Y: '#fcc419', R: '#e03131', B: '#4dabf7'}],
  'icon-catchup': [['...R....', '..RR....', '..RRR...', '.RROR...', '.ROOOR..', 'RROYORR.', 'ROYYYOR.', '.RRRRR..'], {R: '#e8590c', O: '#ff922b', Y: '#ffe066'}],
  'icon-trophy': [['YYYYYYYY', 'YWYYYYYY', '.YYYYYY.', '..YYYY..', '...YY...', '...YY...', '..BBBB..', '.BBBBBB.'], {Y: '#fcc419', W: '#fff3bf', B: '#8d5524'}],
};
function tile(kind){
  const base = {grass: '#69a84f', water: '#3a86c8', mud: '#7a5a34'}[kind], dot = {grass: '#5b9443', water: '#5aa0dc', mud: '#6a4c2a'}[kind];
  return canvasOf(32, 32, (g, px)=>{
    px(0, 0, 32, 32, base);
    [[3, 5], [19, 3], [11, 14], [26, 17], [5, 24], [17, 27], [29, 29]].forEach(([x, y])=>px(x, y, 2, 2, dot));
  });
}

// ---- everything, by the design doc's file names ----
function buildArt(){
  const duckWith = (pal, extra = []) => fromMap(overlay(DUCK, extra), {...DUCK_PAL, ...KIT_PAL, ...pal}, 2);
  ART['duck-plain'] = duckWith({});
  ART['duckling'] = fromMap(DUCKLING, {Y: '#ffe066', S: '#f2c94c', K: '#1b1b1b', O: '#f29a2e'}, 2);
  ART['duck-golden'] = duckWith({B: '#f7c948', S: '#c9952a'}, [[8, 0, 'Z'], [9, 0, 'Z'], [10, 0, 'Z']]);
  ART['duck-fire'] = duckWith({B: '#ff8a4c', S: '#d9480f'}, [[8, 0, 'F'], [10, 0, 'F'], [9, 0, 'Q']]);
  Object.entries(CLASS_KIT).forEach(([cls, kit])=>{ ART['duck-' + cls] = duckWith({}, kit); });
  ART['banner'] = canvasOf(16, 24, (g, px)=>{ px(1, 0, 2, 24, '#6b4423'); px(3, 1, 12, 14, '#c8aa6e'); px(5, 3, 8, 10, '#1f2937'); px(3, 15, 5, 3, '#c8aa6e'); px(10, 15, 5, 3, '#c8aa6e'); });
  [1, 2, 3].forEach(t=>{ ART[`pond-${t}-${['pond', 'lake', 'lagoon'][t-1]}`] = pond(t); ART[`nests-${t}-${['nests', 'village', 'skyline'][t-1]}`] = nests(t); ART[`bakery-${t}`] = bakery(t); });
  ART['spa-1-spa'] = spa(1); ART['spa-2-hotsprings'] = spa(2);
  ART['district-penta-plaza'] = district('penta'); ART['district-champion-quarter'] = district('champion'); ART['district-volcano-spa'] = district('volcano');
  ART['goose'] = fromMap(GOOSE, GOOSE_PAL, 2);
  ART['goose-armoured'] = fromMap(overlay(GOOSE, [...line(3, 9, 10, 'M'), ...line(2, 10, 12, 'M'), ...line(3, 1, 4, 'M')]), GOOSE_PAL, 2);
  ART['goose-flying'] = fromMap(overlay(GOOSE, [...line(6, 8, 6, 'H', 1, -1), ...line(7, 8, 6, 'H', 1, -1), ...line(8, 8, 5, 'G', 1, -1)]), GOOSE_PAL, 2);
  ART['goose-goslings'] = canvasOf(32, 32, (g)=>{
    const baby = fromMap(['..KK....', '.OKKY...', '..YYYY..', '.YYYYYY.', '..YYYY..', '...O.O..'], GOOSE_PAL, 2);
    [[0, 0], [16, 2], [2, 16], [16, 16]].forEach(([x, y])=>g.drawImage(baby, x, y));
  });
  ART['goose-king'] = fromMap(overlay(GOOSE, [...line(3, 0, 4, 'Y'), [4, 1, 'R']]), GOOSE_PAL, 4);
  Object.entries(ICONS).forEach(([name, [rows, pal]])=>{ ART[name] = fromMap(rows, pal, 2); });
  ART['tile-grass'] = tile('grass'); ART['tile-water'] = tile('water'); ART['tile-mud'] = tile('mud');
  ART['ui-raid-board'] = canvasOf(128, 96, (g, px)=>{ px(0, 0, 128, 96, '#6b4423'); px(4, 4, 120, 88, '#a47148'); });
}
buildArt();

// finished art, where there is some, replaces the placeholders
Object.keys(ART).forEach(name=>{
  const img = new Image();
  img.onload = () => { ART[name] = img; };
  img.src = ART_DIR + name + '.png';
});
function art(name){ return ART[name] || ART['duck-plain']; }
