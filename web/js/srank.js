// S Rank Challenge tab: who has an S- or better on more champions this season.

let sr = null, srLoading = false, champList = null, srFilter = 'all', srQuery = '';

// every champion in the game, from the app (which keeps the League client's list, so this works offline too)
let champListTried = false;
async function loadChampList(){
  if(champList) return;
  try{
    const list = await api('/api/champions');
    if(list.length) champList = list.map(c=>({id:String(c.id), alias:c.alias, name:c.name})).sort((a,b)=>a.name.localeCompare(b.name));
  }catch(e){}
  champListTried = true;
}

// force: reload even if already loaded (shows a pop-up for any new S grades)
async function loadSrank(force){
  if((sr && !force) || srLoading || !lastData) return;
  const before = sr && !sr.error ? sr : null;
  if(!before){ srLoading = true; renderSrank(); }
  let fresh;
  try{ fresh = await api('/api/srank', {players: lastData.players.map(p=>p.riotId), region: lastData.region}); }
  catch(e){ fresh = before || {error: e.message}; }
  srLoading = false;
  if(before && fresh.players){
    const gained = [];
    fresh.players.forEach((p,i)=>{ const old = (before.players[i]||{}).champs || {};
      Object.entries(p.champs).forEach(([cid,g])=>{ if(!old[cid] || grade_rank(g) < grade_rank(old[cid])) gained.push([p, i, cid, g]); }); });
    if(gained.length){
      await loadChampList();
      toast('New S rank!', gained.map(([p,i,cid,g])=>{ const c = (champList||[]).find(x=>x.id===cid);
        const img = c && ddVer ? `<img src="${champImage(c.alias)}" alt="" onerror="this.style.visibility='hidden'">` : '';
        return `<div class="srtoast p${i+1}"><span class="face">${img}</span>
          <span><b>${esc(shortName(p.riotId))}</b> got <em>${esc(g)}</em> on ${esc(c ? c.name : 'champion '+cid)}</span></div>`; }).join(''));
    }
  }
  sr = fresh;
  await loadChampList();
  renderSrank();
}

const FLAME = '<svg viewBox="0 0 28 34" aria-hidden="true"><path class="fo" d="M14 1.5c1.2 4.6 4.6 7.3 7.3 10.6 2.6 3.2 3.9 6.4 3.9 9.6C25.2 28.1 20.2 33 14 33S2.8 28.1 2.8 21.7c0-4.3 2.2-7.6 4.6-10 .2 2.4 1.2 4.2 2.9 5.2-.4-5.5 1.1-10.6 3.7-15.4z"/><path class="fi" d="M14 13.5c.8 2.6 2.6 4.1 4 5.9 1.3 1.6 1.9 3.3 1.9 5 0 3.5-2.6 6.2-5.9 6.2s-5.9-2.7-5.9-6.2c0-2.4 1.1-4.2 2.5-5.6.2 1.3.8 2.3 1.7 2.8-.1-3 .6-5.6 1.7-8.1z"/></svg>';
function gradeBadge(g, who){
  return g === 'S+' ? `<span class="n ${who} flame" title="S+">${FLAME}<em>S+</em></span>` : `<span class="n ${who}">${esc(g)}</span>`;
}

function scoreSide(p, mine, theirs, other, cls, total){
  const has = (M, c) => !!M[c.id];
  const done = champList.filter(c=>has(mine,c)).length, lead = done > other;
  const tally = {'S+':0, 'S':0, 'S-':0}; Object.values(mine).forEach(g=>tally[g] = (tally[g]||0)+1);
  const only = champList.filter(c=>has(mine,c) && !has(theirs,c)).length;
  const nm = esc(shortName(p.riotId));
  return `<div class="vside ${cls} ${lead?'lead':''}">
    <div class="vname"><span class="vn" title="${esc(p.riotId)}">${nm}</span>${lead?'<span class="crown">Leading</span>':''}</div>
    <div class="vnum">${done}</div>
    <div class="vpct">${(done/total*100).toFixed(1)}% of ${total} champions</div>
    <div class="vgr">${['S+','S','S-'].map(g=>`<span><b>${tally[g]}</b> ${g}</span>`).join('')}</div>
    <div class="vonly">${only} only ${nm} has</div></div>`;
}

function renderSrank(){
  const box = document.getElementById('srbox'); if(!box) return;
  if(srLoading || !sr){ box.innerHTML = '<p class="empty"><span class="spin"></span>Loading season grades…</p>'; return; }
  if(sr.error){ box.innerHTML = `<p class="err">${esc(sr.error)}</p>`; return; }
  if(!champList){
    box.innerHTML = champListTried ? '<p class="err">Couldn\'t get the champion list. Open League once so the app can save it.</p>'
                                   : '<p class="empty">Loading the champion list…</p>';
    if(!champListTried) loadChampList().then(()=>{ if(champList || champListTried) renderSrank(); });
    return;
  }
  const [a, b] = sr.players, A = a ? a.champs : {}, B = b ? b.champs : {};
  const total = champList.length;
  const doneA = champList.filter(c=>A[c.id]).length, doneB = champList.filter(c=>B[c.id]).length;
  const either = champList.filter(c=>A[c.id] || B[c.id]).length, both = champList.filter(c=>A[c.id] && B[c.id]).length;
  const nm = p => esc(shortName(p.riotId));
  const diff = Math.abs(doneA - doneB);
  const verdict = !b ? '' : diff === 0 ? 'All tied up' : `${nm(doneA > doneB ? a : b)} leads by ${diff}`;
  const filters = [['all','All'], ['p1', b ? nm(a)+' only' : 'Completed'], ...(b ? [['p2', nm(b)+' only'], ['both','Both']] : []), ['todo','Neither']];
  const list = champList.filter(c=>{
    const x = !!A[c.id], y = !!B[c.id];
    if(srFilter==='p1' && !(x && !y)) return false;
    if(srFilter==='p2' && !(y && !x)) return false;
    if(srFilter==='both' && !(x && y)) return false;
    if(srFilter==='todo' && (x || y)) return false;
    return !srQuery || c.name.toLowerCase().includes(srQuery);
  });
  const tip = c => c.name + sr.players.map((p,i)=>`\n${shortName(p.riotId)}: ${(i?B:A)[c.id] ? 'best this season '+(i?B:A)[c.id] : 'not yet'}`).join('');
  const missing = sr.players.filter(p=>!p.clientUpdated);
  box.innerHTML = `<div class="panel vsboard-wrap">
      <div class="vstitle">S Rank Challenge <span>· first to S- or better on every champion</span></div>
      ${b ? `<div class="vsboard">${scoreSide(a,A,B,doneB,'p1',total)}
        <div class="vmid"><div class="vs">VS</div><div class="verdict">${verdict}</div></div>
        ${scoreSide(b,B,A,doneA,'p2',total)}</div>`
      : `<div class="vsboard solo">${scoreSide(a,A,B,-1,'p1',total)}</div>`}
      <div class="vfoot"><span>Together <b>${either} / ${total}</b> (${(either/total*100).toFixed(1)}%)</span>${b?`<span>Both completed <b>${both}</b></span>`:''}<span>Left to claim <b>${total-either}</b></span></div>
    </div>
    ${missing.map(p=>`<div class="panel srmiss"><b>${nm(p)}'s full season grades haven't been read yet.</b>
      Have ${nm(p)} log into League on this Mac once while the app is running; their grades are saved automatically, so you can switch back afterwards.</div>`).join('')}
    <div class="srtools"><input id="srq" placeholder="Search champions" value="${esc(srQuery)}">
      <div class="seg">${filters.map(([k,l])=>`<button data-srf="${k}" class="${srFilter===k?'on':''}">${l}</button>`).join('')}</div>
      <span class="tts">${list.length} shown</span></div>
    <div class="srgrid">${list.map(c=>{
      const x = A[c.id], y = B[c.id], cls = x&&y ? 'both' : x ? 'p1' : y ? 'p2' : 'no';
      const img = ddVer ? `<img src="${champImage(c.alias)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=ph></span>'">` : '<span class="ph"></span>';
      return `<div class="src2 ${cls}" title="${esc(tip(c))}"><div class="face">${img}${x?gradeBadge(x,'a'):''}${y?gradeBadge(y,'b'):''}</div><div class="lbl">${esc(c.name)}</div></div>`;
    }).join('')}</div>
    <p class="note">Each badge is that player's best grade on the champion this season. Grades come from the League client for whoever is logged in on this Mac, and from the S grades announced in each post-game chat.
      ${sr.players.filter(p=>p.clientUpdated).map(p=>`${nm(p)}'s full grades were last read ${timeAgo(p.clientUpdated)}.`).join(' ')}</p>`;
}
document.addEventListener('input', e=>{
  if(e.target.id !== 'srq') return;
  srQuery = e.target.value.trim().toLowerCase();
  const pos = e.target.selectionStart; renderSrank();
  const q = document.getElementById('srq'); q.focus(); q.setSelectionRange(pos, pos);
});
document.addEventListener('click', e=>{ const f = e.target.closest('[data-srf]'); if(f){ srFilter = f.dataset.srf; renderSrank(); } });

function srankTab(){ return '<div id="srbox"></div>'; }
