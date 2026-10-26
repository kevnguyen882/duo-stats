// Tests for the page's own logic (badges and scores), run with Node and nothing else:  node tests/js/run.js
// The page's files expect a browser, so they're loaded the way the page loads them (one shared global scope) with just
// enough of a pretend browser for them to load. Each *.test.js file here gets that scope and the `test` function.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', '..', 'web', 'js');
const PAGE_FILES = ['core.js', 'stats.js', 'badges.js', 'badgeart.js'];   // in the page's order; later files use earlier ones

function fakeElement(){
  const el = {dataset: {}, classList: {add(){}, remove(){}, toggle(){}}, style: {},
    addEventListener(){}, appendChild(){}, insertAdjacentHTML(){}, setAttribute(){}, closest(){ return null; }};
  return el;
}
function pageScope(){
  const document = {
    body: fakeElement(), documentElement: fakeElement(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => fakeElement(),
    createElement: fakeElement, addEventListener(){},
  };
  const scope = vm.createContext({
    document, console, Math, Date, JSON, Map, Set, Promise,
    localStorage: {getItem: () => null, setItem(){}},
    fetch: () => new Promise(()=>{}),   // never answers: no network in tests
    requestAnimationFrame(){}, setTimeout(){},
  });
  for(const f of PAGE_FILES) vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), scope, {filename: f});
  return scope;
}

const tests = [];
const test = (name, fn) => tests.push({name, fn});
const files = fs.readdirSync(__dirname).filter(f=>f.endsWith('.test.js')).sort();
for(const f of files){
  const scope = pageScope();
  scope.test = (name, fn) => test(`${f} › ${name}`, fn);
  scope.assert = assert;
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), scope, {filename: f});
}

let failed = 0;
for(const t of tests){
  try{ t.fn(); }
  catch(e){ failed++; console.log(`FAIL ${t.name}\n  ${String(e.message).split('\n').join('\n  ')}`); }
}
console.log(`${tests.length - failed} of ${tests.length} JS tests passed`);
process.exit(failed ? 1 : 0);
