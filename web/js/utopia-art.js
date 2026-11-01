// Ductopia's art: simple placeholder pixel sprites, one per asset in the design doc, at its final size.
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
// the Mystic Marsh's birds: the duck recoloured, smallest first after the plain duck (see BIRDS in duostats/utopia.py)
const recolour = fn => DUCK.map((row, y)=>[...row].map((ch, x)=>fn(ch, x, y) || ch).join(''));
const HEAD = (ch, x, y) => y >= 1 && y <= 4 && ch === 'B' ? 'N' : null;
const SWAN = [   // the duck's body, with a long curved neck and the head held high
  '................',
  '.........BBB....',
  '........BBKBOOO.',
  '........BBB.....',
  '.......BB.......',
  '.......BB.......',
  '........BB......',
  '.B......BB......',
  '.BB....BBBB.....',
  '.BBBBBBBBBBBB...',
  '.BBBBBBBBBBBBB..',
  '..BSBBBBBBBBBB..',
  '..BSSBBBBBBBB...',
  '...SSSSSSSSS....',
  '.....O....O.....',
  '.....OO...OO....',
];
const MARSH_BIRDS = {
  mallard: [recolour((ch, x, y)=>HEAD(ch, x, y) || (y === 5 && ch === 'B' ? 'W' : null)), {N: '#2b8a3e', W: '#ffffff', B: '#b9a894', S: '#6f5a45'}],
  wood: [recolour((ch, x, y)=>(y === 2 && ch === 'B' && x > 8 ? 'W' : HEAD(ch, x, y))), {N: '#5f3dc4', W: '#ffffff', B: '#c4874f', S: '#7f4f24', O: '#e03131'}],
  swan: [SWAN, {B: '#ffffff', S: '#b9c6d3', O: '#f08c00'}],
  black: [SWAN, {B: '#2f3237', S: '#17181b', K: '#f8f9fa', O: '#e03131'}],
  royal: [overlay(SWAN, [[9, 0, 'Y'], [11, 0, 'Y'], ...line(9, 1, 3, 'Y')]), {B: '#ffffff', S: '#f2d27a', Y: '#fcc419', O: '#f08c00'}],   // crowned
};
// the Mystic: the Mystic Marsh's wizard toad, in a starry hat with its wand raised
const MYSTIC = [
  '.......P........', '......PPP.......', '.....PPSPP......', '....PPPPPPP...Q.', '..PPPPPPPPPPP.T.', '...GGGGGGGGG..T.',
  '..GWKGGGGGWKG.T.', '..GGGGGGGGGGGGT.', '..GDDDDDDDDDGGT.', '.GGGYYYYYYYGGGT.', '.GGYYYYYYYYYGG..', '.GGYYYYYYYYYGG..',
  '..GGYYYYYYYGG...', '.GGGG.....GGGG..', '................', '................'];
const MYSTIC_PAL = {P: '#5f3dc4', S: '#ffd43b', Q: '#fff3bf', T: '#8b5a2b', G: '#5c940d', D: '#2b5d0a', Y: '#d8f5a2', W: '#ffffff', K: '#1b1b1b'};
const KIT_PAL = {M: '#9aa3ad', D: '#3b5ba5', Y: '#f7c948', P: '#7c3aed', T: '#8b5a2b', C: '#38bdf8', G: '#2f9e44',
  W: '#ffffff', R: '#e03131', H: '#343a40', Z: '#fff3bf', F: '#fa5252', Q: '#ffd43b'};
const CHAMP_DUCK = [   // a game with more than one pentakill: crowned, caped, sashed and flexing (20x20, drawn at 40x40)
  '....................',
  '..........Q.Q.Q.....',
  '..........QQQQQ.....',
  '..........QCQRQ.....',
  '.........BBBBBBB....',
  '.........BBBBBKBOO..',
  '.........BBBBBBBOOO.',
  '..........BBBBBB....',
  '.FF.SS.....BBBB.....',
  '.FFSBBS...BBBBBB....',
  '.FFSBMBS.BBBBBBBB...',
  'FFFSBBBBSBBBBBRBBB..',
  'FFFFSBBBBBBBBRBBBBB.',
  'FFFFBSBBBBBBRBBBBBB.',
  'FFFFBBBBBBBRBBBBBBB.',
  'FFF.BBBBBBRBBBBBBBS.',
  'FF...SBBBRBBBBBBBS..',
  '......SSSSSSSSSSS...',
  '........OO....OO....',
  '.......OOO...OOO....',
];
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
    } else if(kind === 'marsh'){   // a murky pool with cattails, and the Mystic's hat poking up from a lily pad
      px(2, 30, 44, 16, '#5c6b34');
      for(let y = 0; y < 12; y++){ const half = Math.round(19 * Math.sqrt(1 - ((y - 5.5) / 6) ** 2)); px(24 - half, 32 + y, half * 2, 1, y > 5 ? '#24474f' : '#2f5f5c'); }
      [[6, 18], [9, 22], [39, 20]].forEach(([x, h])=>{ px(x, 44 - h, 1, h - 10, '#4a6b2a'); px(x - 1, 44 - h - 3, 2, 4, '#6b4423'); });
      px(28, 37, 10, 3, '#74b816'); px(30, 26, 6, 11, '#5c940d'); px(31, 29, 1, 1, '#1b1b1b'); px(34, 29, 1, 1, '#1b1b1b');
      for(let i = 0; i < 5; i++) px(33 - i, 18 + i * 2, 1 + i * 2, 2, '#5f3dc4');
      px(32, 21, 1, 1, '#ffd43b'); px(38, 20, 1, 9, '#8b5a2b'); px(37, 18, 3, 2, '#fff3bf');
      px(14, 36, 4, 2, '#ffffff'); px(17, 35, 1, 1, '#f29a2e'); px(20, 39, 4, 2, '#b9a894'); px(20, 38, 2, 1, '#2b8a3e');   // a duck and a mallard
    } else {
      for(let i = 0; i < 14; i++) px(10 + i, 30 - i*2, 28 - 2*i, 2, i < 11 ? '#6c4f3d' : '#e8590c');
      px(21, 2, 6, 3, '#ff922b'); px(19, 0, 2, 2, '#ffd43b'); px(27, 1, 2, 2, '#ffd43b');
      px(6, 36, 10, 6, '#ff6b6b'); px(30, 37, 10, 6, '#ff6b6b');   // hot pools
    }
  });
}

// hats for the Champion Quarter's defenders: 10x6 maps whose bottom row sits on the duck's head (see wearHat in utopia.js)
const HAT_ART = {
  cap: [['..........', '..........', '..........', '..RRRR....', '.RRRRRR...', '.RRRRRRRR.'], {R: '#e03131'}],
  beanie: [['...W......', '..BBB.....', '.BBBBB....', '.BBBBB....', 'BBBBBBB...', 'WWWWWWW...'], {B: '#1c7ed6', W: '#e7f5ff'}],
  party: [['...Y......', '...P......', '..PYP.....', '..YPY.....', '.PYPYP....', '.YPYPY....'], {P: '#f06595', Y: '#ffe066'}],
  flowers: [['..........', '..........', '..........', '..........', '.RGYGPG...', '.GGGGGG...'], {R: '#ff6b6b', G: '#40c057', Y: '#ffd43b', P: '#cc5de8'}],
  cowboy: [['..........', '..........', '..TTTT....', '..TBBT....', '..TTTT....', 'TTTTTTTT..'], {T: '#a0522d', B: '#5c3317'}],
  tophat: [['..KKKK....', '..KKKK....', '..KKKK....', '..RRRR....', '..KKKK....', 'KKKKKKKK..'], {K: '#212529', R: '#c92a2a'}],
  chef: [['.WWWWW....', 'WWWWWWW...', 'WWWWWWW...', '.WWWWW....', '.WWWWW....', '.SSSSS....'], {W: '#ffffff', S: '#ced4da'}],
  viking: [['W......W..', 'W.MMMM.W..', '.WMMMMMW..', '..MMMMM...', '.MMMMMMM..', '.YYYYYYY..'], {W: '#f8f0e3', M: '#adb5bd', Y: '#e8a33d'}],
  wizard: [['....P.....', '...PP.....', '...PYP....', '..PPPP....', '.PPPPPP...', 'PPPPPPPPP.'], {P: '#5f3dc4', Y: '#ffe066'}],
  crown: [['..........', '..........', '.Y.Y.Y....', '.YYYYY....', '.YRYCY....', '.YYYYY....'], {Y: '#fcc419', R: '#e03131', C: '#38bdf8'}],
};

// ---- the Bakery's sweet treats, one for each class (10x10 maps, drawn at 20x20) ----
const TREAT_ART = {
  marksman: [['..DDDDDD..', '.DPPRPPPD.', 'DPPPPPBPPD', 'DPYP..PPPD', 'DPP....RPD', 'DPPP..PPPD', 'DBPPPPPYPD', '.DPPRPPPD.', '..DDDDDD..', '..........'],
    {D: '#d9a066', P: '#f783ac', R: '#e03131', Y: '#ffe066', B: '#4dabf7'}],   // bullseye donuts
  fighter: [['..LLLLLL..', '.LCCCCCCL.', 'LCLLLLLLCL', 'LCLCCCWLCL', 'LCLCLLCLCL', 'LCLWCCCLCL', 'LCLLLLLLCL', '.LCCWCCCL.', '..LLLLLL..', '..........'],
    {L: '#e8c08a', C: '#a0522d', W: '#fff8e1'}],                                  // cinnamon rolls
  support: [['....R.....', '...RR.....', '.WWWWWWWW.', 'HHHHHHHHHH', 'YHYYHYYYHY', 'YYYYYYYYYY', 'WWWWWWWWWW', 'YYYYYYYYYY', 'YYYYYYYYYY', 'SSSSSSSSSS'],
    {R: '#e03131', W: '#fff8e1', H: '#f59f00', Y: '#ffd43b', S: '#ced4da'}],      // honey cakes
  mage: [['..PPPPPP..', '.PPPPPPPP.', '.CCCCCCCC.', '.PPPPPPPP.', '..TTTTTT..', '.TTTTTTTT.', '.CCCCCCCC.', '.TTTTTTTT.', '..Y...Y...', '.....Y....'],
    {P: '#b197fc', C: '#fff8e1', T: '#63e6be', Y: '#ffe066'}],                    // macarons
  tank: [['..........', '.WWWWWWWW.', '.WBWWWWBW.', 'BBBBBBBBBB', 'BRBBGBBRBB', 'BBBGBBRBBB', 'BBRBBBBBGB', 'BBBBBRBBBB', 'DDDDDDDDDD', '..........'],
    {W: '#fff8e1', B: '#8b5a2b', R: '#e03131', G: '#40c057', D: '#5c3317'}],      // fruitcake
  assassin: [['..........', '.KKK..KKK.', 'KSKKKKSKKK', 'KKKKKKKKKK', 'KKKGKKKKGK', '.KKK..KKK.', '...KKKK...', '..KSKKKK..', '..KKKGKK..', '...KKKK...'],
    {K: '#3b2314', S: '#8b5a2b', G: '#fcc419'}],                                  // chocolate truffles
};

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
  ART['duck-golden-champion'] = fromMap(CHAMP_DUCK, {B: '#f7c948', S: '#c9952a', M: '#fff3bf', K: '#1b1b1b', O: '#f29a2e', Q: '#e67700', C: '#38bdf8', R: '#e03131', F: '#c92a2a'}, 2);
  ART['duck-fire'] = duckWith({B: '#ff8a4c', S: '#d9480f'}, [[8, 0, 'F'], [10, 0, 'F'], [9, 0, 'Q']]);
  Object.entries(CLASS_KIT).forEach(([cls, kit])=>{ ART['duck-' + cls] = duckWith({}, kit); });
  ART['banner'] = canvasOf(16, 24, (g, px)=>{ px(1, 0, 2, 24, '#6b4423'); px(3, 1, 12, 14, '#c8aa6e'); px(5, 3, 8, 10, '#1f2937'); px(3, 15, 5, 3, '#c8aa6e'); px(10, 15, 5, 3, '#c8aa6e'); });
  [1, 2, 3].forEach(t=>{ ART[`pond-${t}-${['pond', 'lake', 'lagoon'][t-1]}`] = pond(t); ART[`nests-${t}-${['nests', 'village', 'skyline'][t-1]}`] = nests(t); ART[`bakery-${t}`] = bakery(t); });
  ART['spa-1-spa'] = spa(1); ART['spa-2-hotsprings'] = spa(2);
  ART['district-mystic-marsh'] = district('marsh');
  Object.entries(MARSH_BIRDS).forEach(([id, [map, pal]])=>{ ART['bird-' + id] = fromMap(map, {...DUCK_PAL, ...pal}, 2); });
  ART['mystic-toad'] = fromMap(MYSTIC, MYSTIC_PAL, 2);
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
  // the Duck Infirmary: the building in the utopia, and its lab inside
  ART['building-infirmary'] = chunky(48, px=>{
    px(3, 8, 18, 14, '#f1f3f5'); px(2, 6, 20, 3, '#adb5bd'); px(3, 21, 18, 2, '#868e96');
    px(10, 10, 4, 10, '#e03131'); px(7, 13, 10, 4, '#e03131');                // a red cross
    px(9, 18, 6, 4, '#495057'); px(4, 10, 3, 3, '#74c0fc'); px(17, 10, 3, 3, '#74c0fc');
    px(18, 1, 3, 6, '#ced4da'); px(19, 2, 1, 4, '#63e6be');                    // a bubbling tube on the roof
  });
  ART['lab-tile'] = canvasOf(32, 32, (g, px)=>{
    px(0, 0, 32, 32, '#1d3b45'); px(0, 0, 32, 1, '#2b5563'); px(0, 0, 1, 32, '#2b5563'); px(16, 0, 1, 32, '#24485a'); px(0, 16, 32, 1, '#24485a');
  });
  ART['lab-chamber'] = canvasOf(40, 112, (g, px)=>{   // the glass is left clear: the fluid is drawn behind it
    px(2, 0, 36, 10, '#868e96'); px(2, 0, 36, 2, '#ced4da'); px(16, 2, 8, 3, '#495057');
    px(0, 96, 40, 16, '#5c636a'); px(0, 96, 40, 2, '#adb5bd'); px(4, 102, 32, 6, '#343a40');
    px(3, 10, 2, 86, 'rgba(220,240,255,.55)'); px(35, 10, 2, 86, 'rgba(220,240,255,.55)'); px(8, 14, 2, 70, 'rgba(255,255,255,.35)');
  });
  ART['egg'] = fromMap(['..WWW...', '.WWWWW..', 'WWWSWWW.', 'WWWWWWW.', 'WWWWWSW.', 'WSWWWWW.', '.WWWWW..', '..WWW...'], {W: '#fff8e1', S: '#e9d8a6'}, 2);
  Object.entries(HAT_ART).forEach(([name, [rows, pal]])=>{ ART['hat-' + name] = fromMap(rows, pal, 2); });
  // the Champion Quarter: a lounge for the defenders
  ART['tile-wood'] = canvasOf(32, 32, (g, px)=>{
    px(0, 0, 32, 32, '#8a5a34');
    [0, 8, 16, 24].forEach((y, i)=>{ px(0, y, 32, 1, '#6b4423'); px((i * 11) % 32, y, 1, 8, '#6b4423'); px(((i * 11) + 4) % 32, y + 3, 6, 1, '#9c6a3f'); });
  });
  ART['tile-wallpaper'] = canvasOf(32, 32, (g, px)=>{
    px(0, 0, 32, 32, '#7b3f4f');
    [4, 20].forEach(x=>px(x, 0, 2, 32, '#8f4e5f')); [[10, 8], [26, 24]].forEach(([x, y])=>{ px(x, y, 3, 3, '#c8aa6e'); px(x + 1, y - 1, 1, 5, '#c8aa6e'); px(x - 1, y + 1, 5, 1, '#c8aa6e'); });
  });
  ART['lounge-sofa'] = chunky(96, px=>{ px(2, 6, 44, 12, '#2f6f8f'); px(0, 10, 6, 16, '#255a75'); px(42, 10, 6, 16, '#255a75');
    px(6, 18, 18, 7, '#3d8bb0'); px(24, 18, 18, 7, '#3d8bb0'); px(23, 18, 2, 7, '#2f6f8f'); px(4, 25, 40, 4, '#255a75'); px(5, 29, 3, 3, '#3b2a1a'); px(40, 29, 3, 3, '#3b2a1a'); });
  ART['lounge-armchair'] = chunky(64, px=>{ px(4, 4, 24, 14, '#a8462f'); px(1, 10, 6, 14, '#8a3624'); px(25, 10, 6, 14, '#8a3624');
    px(7, 17, 18, 7, '#c4573c'); px(4, 24, 24, 4, '#8a3624'); px(5, 28, 3, 3, '#3b2a1a'); px(24, 28, 3, 3, '#3b2a1a'); });
  ART['lounge-fireplace'] = chunky(96, px=>{ px(4, 4, 40, 4, '#5c4a42'); px(6, 8, 36, 36, '#9a8478'); px(6, 8, 36, 2, '#b8a397');
    px(14, 20, 20, 24, '#2b1d18'); px(12, 18, 24, 2, '#5c4a42'); px(16, 40, 16, 3, '#6b4423'); });
  ART['lounge-beanbag'] = chunky(48, px=>{ px(4, 10, 16, 12, '#e8a33d'); px(2, 14, 20, 8, '#d18b26'); px(6, 8, 10, 4, '#f2bb5c'); });
  ART['lounge-table'] = chunky(64, px=>{ px(2, 12, 28, 4, '#6b4423'); px(2, 12, 28, 1, '#8a5a34'); px(4, 16, 2, 10, '#5c3317'); px(26, 16, 2, 10, '#5c3317');
    px(8, 9, 4, 3, '#f8f9fa'); px(12, 10, 1, 1, '#f8f9fa'); px(18, 9, 6, 3, '#e8590c'); });
  ART['lounge-plant'] = chunky(48, px=>{ px(8, 16, 8, 8, '#a0522d'); px(7, 15, 10, 2, '#8b4513');
    [[11, 2, 2, 14], [6, 6, 5, 3], [13, 4, 5, 3], [4, 10, 7, 3], [13, 9, 7, 3]].forEach(([x, y, w, h])=>px(x, y, w, h, '#2f9e44')); });
  ART['lounge-window'] = chunky(64, px=>{ px(2, 2, 28, 24, '#c8aa6e'); px(4, 4, 24, 20, '#1e2a4a'); px(15, 4, 2, 20, '#c8aa6e'); px(4, 13, 24, 2, '#c8aa6e');
    px(20, 6, 4, 4, '#fff3bf'); [[7, 7], [11, 17], [24, 18], [8, 20]].forEach(([x, y])=>px(x, y, 1, 1, '#ffffff')); });
  ART['tile-plaza'] = canvasOf(32, 32, (g, px)=>{   // pale paving stones, so the golden ducks stand out
    px(0, 0, 32, 32, '#a39a8c');
    [[0, 0, 15, 7], [16, 0, 16, 7], [0, 8, 9, 7], [10, 8, 13, 7], [24, 8, 8, 7], [0, 16, 15, 7], [16, 16, 16, 7], [0, 24, 6, 8], [7, 24, 14, 8], [22, 24, 10, 8]]
      .forEach(([x, y, w, h], i)=>{ px(x, y, w, h, i % 3 ? '#ddd5c6' : '#e8e1d3'); px(x, y, w, 1, '#f4efe6'); });
  });
  ART['plaza-fountain'] = chunky(64, px=>{   // a golden duck on a fountain
    px(2, 20, 28, 9, '#8d6e2f'); px(3, 21, 26, 7, '#3a86c8'); px(5, 22, 6, 1, '#a5d8ff'); px(19, 25, 7, 1, '#a5d8ff');
    px(13, 10, 6, 12, '#d4a73a'); px(12, 9, 8, 2, '#f2d27f');
    px(12, 4, 7, 5, '#f7c948'); px(16, 2, 3, 3, '#f7c948'); px(19, 3, 2, 1, '#f29a2e'); px(17, 3, 1, 1, '#1b1b1b');
    [[9, 6], [22, 5], [8, 13], [23, 12]].forEach(([x, y])=>px(x, y, 1, 3, '#a5d8ff'));
  });
  ART['tile-volcanic'] = canvasOf(32, 32, (g, px)=>{   // dark basalt with glowing cracks, for the Volcano Spa
    px(0, 0, 32, 32, '#3b3236');
    [[2, 3, 9, 6], [14, 1, 12, 7], [4, 13, 11, 7], [19, 12, 10, 8], [1, 23, 8, 7], [12, 23, 14, 7]].forEach(([x, y, w, h], i)=>{
      px(x, y, w, h, i % 2 ? '#4a3f43' : '#433a3e'); px(x, y, w, 1, '#5a4e52'); });
    [[11, 9, 1, 4], [12, 12, 4, 1], [27, 20, 1, 3], [9, 21, 3, 1]].forEach(([x, y, w, h])=>px(x, y, w, h, '#e8590c'));
  });
  ART['volcano-peak'] = chunky(160, px=>{   // the volcano behind the springs (80x80 half-size grid)
    for(let i = 0; i < 46; i++){ const w = 20 + i * 1.32; px(Math.round(40 - w / 2), 34 + i, Math.round(w), 1, i < 3 ? '#5c3d2e' : i % 7 ? '#5a4740' : '#4d3c36'); }
    px(29, 30, 22, 5, '#3a2a25'); px(31, 31, 18, 3, '#ff6b1a'); px(34, 31, 12, 1, '#ffd43b');   // the crater, glowing
    [[33, 35, 2, 14], [35, 48, 2, 10], [45, 35, 2, 9], [43, 43, 2, 12], [41, 54, 2, 8]].forEach(([x, y, w, h])=>px(x, y, w, h, '#e8590c'));   // lava runs
    [[34, 36], [44, 38], [36, 52], [42, 50]].forEach(([x, y])=>px(x, y, 1, 2, '#ffd43b'));
  });
  // the Bakery: its kitchen, its machines (one for each treat) and the treats
  ART['tile-kitchen'] = canvasOf(32, 32, (g, px)=>{ px(0, 0, 32, 32, '#e9e2d4'); px(0, 0, 16, 16, '#b9ad98'); px(16, 16, 16, 16, '#b9ad98'); });
  ART['tile-kitchen-wall'] = canvasOf(32, 32, (g, px)=>{   // cream subway tiles
    px(0, 0, 32, 32, '#f3ead8');
    [0, 8, 16, 24].forEach((y, i)=>{ px(0, y, 32, 1, '#d8ccb4'); [0, 16].forEach(x=>px((x + (i % 2) * 8) % 32, y, 1, 8, '#d8ccb4')); });
  });
  ART['machine-marksman'] = chunky(64, px=>{   // a donut fryer
    px(4, 12, 24, 14, '#adb5bd'); px(4, 12, 24, 2, '#dee2e6'); px(6, 14, 20, 4, '#f59f00'); px(6, 14, 20, 1, '#ffd43b');
    px(9, 13, 6, 3, '#f783ac'); px(11, 14, 2, 1, '#f59f00'); px(18, 13, 6, 3, '#f783ac'); px(20, 14, 2, 1, '#f59f00');
    px(14, 20, 4, 3, '#e03131'); px(6, 26, 2, 4, '#495057'); px(24, 26, 2, 4, '#495057'); px(27, 8, 2, 10, '#868e96'); px(25, 8, 4, 2, '#868e96');
  });
  ART['machine-fighter'] = chunky(64, px=>{   // a dough mixer
    px(6, 26, 22, 4, '#c92a2a'); px(21, 8, 6, 18, '#e03131'); px(8, 5, 19, 6, '#e03131'); px(8, 5, 19, 1, '#ff8787');
    px(14, 11, 2, 5, '#868e96'); px(8, 16, 13, 10, '#ced4da'); px(8, 16, 13, 1, '#f1f3f5'); px(10, 15, 9, 2, '#f1e3c6'); px(24, 14, 2, 2, '#f1f3f5');
  });
  ART['machine-support'] = chunky(64, px=>{   // a honey oven
    px(4, 6, 24, 22, '#f8f0e3'); px(4, 4, 24, 3, '#f59f00'); px(8, 7, 2, 3, '#f59f00'); px(19, 7, 2, 5, '#f59f00'); px(24, 7, 1, 2, '#f59f00');
    px(7, 13, 18, 11, '#495057'); px(8, 14, 16, 9, '#343a40'); px(10, 17, 12, 5, '#ff922b'); px(12, 16, 8, 2, '#ffd43b');
    px(8, 9, 2, 2, '#495057'); px(12, 9, 2, 2, '#495057'); px(5, 28, 3, 2, '#495057'); px(24, 28, 3, 2, '#495057');
  });
  ART['machine-mage'] = chunky(64, px=>{   // an enchanted piping bench
    px(2, 19, 28, 3, '#6b4423'); px(2, 19, 28, 1, '#8a5a34'); px(4, 22, 2, 8, '#5c3317'); px(26, 22, 2, 8, '#5c3317');
    px(9, 5, 8, 9, '#7c3aed'); px(10, 4, 6, 2, '#9775fa'); px(11, 14, 4, 2, '#5f3dc4'); px(12, 16, 2, 2, '#c0eb75');
    px(19, 16, 4, 3, '#cc5de8'); px(19, 17, 4, 1, '#fff8e1'); px(24, 16, 4, 3, '#63e6be'); px(24, 17, 4, 1, '#fff8e1');
    [[5, 4], [20, 6], [24, 10], [6, 13], [18, 2]].forEach(([x, y])=>px(x, y, 1, 1, '#ffe066'));
  });
  ART['machine-tank'] = chunky(64, px=>{   // a stone oven
    px(2, 26, 28, 4, '#5c636a'); px(20, 2, 4, 8, '#5c636a');
    for(let i = 0; i < 18; i++){ const w = Math.round(14 + Math.sqrt(i) * 3.4); px(16 - Math.round(w / 2), 8 + i, w, 1, i % 4 ? '#868e96' : '#6c757d'); }
    px(11, 17, 10, 9, '#2b1d18'); px(12, 16, 8, 1, '#2b1d18'); px(13, 21, 6, 5, '#ff922b'); px(14, 23, 4, 3, '#ffd43b');
  });
  ART['machine-assassin'] = chunky(64, px=>{   // a chocolate tempering machine
    px(6, 6, 20, 18, '#5c636a'); px(6, 6, 20, 2, '#343a40'); px(9, 10, 14, 9, '#212529'); px(10, 11, 12, 7, '#5c3317');
    px(11, 13, 6, 2, '#8b5a2b'); px(15, 15, 5, 1, '#8b5a2b'); px(14, 24, 4, 3, '#495057'); px(15, 27, 2, 2, '#5c3317');
    px(7, 29, 18, 2, '#adb5bd'); px(22, 8, 2, 1, '#e03131'); px(5, 24, 3, 6, '#495057'); px(24, 24, 3, 6, '#495057');
  });
  Object.entries(TREAT_ART).forEach(([cls, [rows, pal]])=>{ ART['treat-' + cls] = fromMap(rows, pal, 2); });
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
