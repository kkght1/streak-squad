import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const COLORS = ['#E4572E','#139A8E','#7357D6','#D9931A','#2F7BE5','#D9487D'];
const SUGGEST = [
  {title:'Work out', mode:'atleast', target:3},
  {title:'Alcohol', mode:'atmost', target:2},
  {title:'Read 20 min', mode:'daily', target:1},
  {title:'10k steps', mode:'daily', target:1},
  {title:'Takeout', mode:'atmost', target:1},
];
const ICON = {
  check:'<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus:'<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  flame:(off)=>`<svg class="flame ${off?'off':''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.6 2.2c.5 3.3-1.2 5.2-2.7 7C8.6 10.8 7 12.6 7 15.2A5 5 0 0 0 17 15.4c0-2.3-1.1-4-2.1-5.3-.2 1.3-.8 2.2-1.8 2.8.6-3.6.2-7.3-.5-10.7z"/></svg>`,
  left:'<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right:'<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k){ try { return localStorage.getItem('ss-'+k); } catch { return null; } },
  set(k,v){ try { v==null ? localStorage.removeItem('ss-'+k) : localStorage.setItem('ss-'+k,v); } catch {} },
};

// ---- dates (local time, weeks start Monday)
const ymd = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
const addDays = (s,n) => { const d = parse(s); d.setDate(d.getDate()+n); return ymd(d); };
const weekStart = s => { const d = parse(s); d.setDate(d.getDate()-((d.getDay()+6)%7)); return ymd(d); };
const today = () => ymd(new Date());
const fmt = (s,o) => parse(s).toLocaleDateString(undefined,o);

// ---- crew codes: 10 characters, no look-alikes (0/O, 1/I/L)
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => ALPHA[b % ALPHA.length]).join('');
const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const prettyCode = c => c.slice(0,5) + '-' + c.slice(5);
const inviteLink = c => location.origin + location.pathname + '#' + c;

// ---- state
const S = {
  fb:null, crew:null, unsubs:[], failed:null, ready:{people:false,goals:false,checks:false,squad:false}, squad:null,
  people:[], goals:[], checks:new Map(),
  sel:store.get('sel'), date:today(), me:store.get('me'),
  sheet:null, form:{mode:'daily',target:3}, armed:null, setupColors:[0,1,2], creating:false,
};

const person = id => S.people.find(p => p.id === id);
const goalsOf = pid => S.goals.filter(g => g.person === pid);
const isDone = (pid,gid,date) => !!S.checks.get(pid+'_'+date)?.done?.[gid];
const weekCount = (g,ws) => { let n=0; for(let i=0;i<7;i++) if(isDone(g.person,g.id,addDays(ws,i))) n++; return n; };

function streak(g){
  const t = today();
  if (g.mode === 'daily'){
    let d = isDone(g.person,g.id,t) ? t : addDays(t,-1), n = 0;
    while (n < 3660 && isDone(g.person,g.id,d)) { n++; d = addDays(d,-1); }
    return {n, unit: n===1 ? 'day' : 'days'};
  }
  const ok = c => g.mode === 'atleast' ? c >= g.target : c <= g.target;
  const first = weekStart(g.createdAt || t);
  let w = weekStart(t), n = 0;
  if (!ok(weekCount(g,w))) {
    if (g.mode === 'atmost') return {n:0, unit:'wks'};
    w = addDays(w,-7); // this week is still in progress
  }
  while (n < 520 && w >= first && ok(weekCount(g,w))) { n++; w = addDays(w,-7); }
  return {n, unit: n===1 ? 'wk' : 'wks'};
}

function summary(pid){
  const t = today(), gs = goalsOf(pid);
  const daily = gs.filter(g => g.mode==='daily');
  const dailyDone = daily.filter(g => isDone(pid,g.id,t)).length;
  let best = {n:0, unit:'days'};
  for (const g of gs){ const s = streak(g); if (s.n > best.n) best = s; }
  const over = gs.some(g => g.mode==='atmost' && weekCount(g,weekStart(t)) > g.target);
  return {gs, daily, dailyDone, best, over};
}


// ---- squad streak: a day counts when every person checked off every daily goal,
// nobody went over an "at most" limit that day, and (on Sundays) nobody finished
// the week short of an "at least" target. A miss resets the streak to zero.
function dayIssues(d){
  const issues = []; let anyGoal = false;
  const ws = weekStart(d), sunday = addDays(ws, 6);
  for (const p of S.people){
    for (const g of goalsOf(p.id)){
      if ((g.createdAt || '') > d) continue;
      anyGoal = true;
      if (g.mode === 'daily' && !isDone(p.id, g.id, d)) issues.push({p, g, kind:'daily'});
      if (g.mode === 'atmost' && isDone(p.id, g.id, d)){
        let c = 0; for (let x = ws; x <= d; x = addDays(x, 1)) if (isDone(p.id, g.id, x)) c++;
        if (c > g.target) issues.push({p, g, kind:'over'});
      }
      if (g.mode === 'atleast' && d === sunday && weekStart(g.createdAt || d) < ws && weekCount(g, ws) < g.target)
        issues.push({p, g, kind:'short'});
    }
  }
  return {ok: anyGoal && !issues.length, issues};
}

function squadState(){
  const sq = S.squad; if (!sq?.startedAt) return null;
  const t = today(), start = sq.startedAt, target = sq.target || 30;
  const todayInfo = dayIssues(t);
  let d = todayInfo.ok ? t : addDays(t, -1), n = 0;
  while (n < 2000 && d >= start && dayIssues(d).ok){ n++; d = addDays(d, -1); }
  const runStart = addDays(d, 1);
  const broke = d >= start && d < t ? {day:d, issues:dayIssues(d).issues} : null;
  return {sq, t, start, target, n, todayInfo, broke, won: n >= target, reachedOn: addDays(runStart, target - 1)};
}

const issueText = i => i.kind === 'daily' ? `${i.p.name} missed ${i.g.title}`
  : i.kind === 'over' ? `${i.p.name} went over the ${i.g.title} limit` : `${i.p.name} came up short on ${i.g.title}`;
const listNames = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

function renderSquad(){
  const el = $('#squad'), st = squadState();
  const grad = `linear-gradient(90deg, ${S.people.map(p => p.color).join(', ')}${S.people.length < 2 ? ', ' + (S.people[0]?.color || COLORS[0]) : ''})`;
  el.style.setProperty('--grad', grad);
  if (!st){
    el.innerHTML = `<section class="squad"><div class="sq-top"><span class="lbl">Squad streak</span></div>
      <p class="sq-status">Pick a prize and how many days in a row all of you need to finish your daily goals to win it.</p>
      <div class="actions"><button class="btn sq-btn" data-action="open-squad">Set a squad prize</button></div></section>`;
    return;
  }
  const {sq, t, target, n, todayInfo, broke, won} = st;
  let status;
  if (won) status = `You did it! ${target} days in a row. Time to collect.`;
  else if (st.start > t) status = `New round starts tomorrow. Make day 1 count.`;
  else if (todayInfo.ok) status = `Today counts. Everyone's done.`;
  else {
    const over = todayInfo.issues.filter(i => i.kind === 'over');
    const left = [...new Set(todayInfo.issues.filter(i => i.kind === 'daily').map(i => i.p.name))];
    status = over.length ? `${esc(issueText(over[0]))}, so today won't count.`
      : left.length ? `Waiting on ${esc(listNames(left))} to finish today's goals.`
      : `Add daily goals to start counting.`;
  }
  const lastReset = !won && broke && n < 3 && broke.issues.length
    ? `<p class="sq-reset">Reset ${broke.day === addDays(t,-1) ? 'yesterday' : 'on ' + fmt(broke.day,{weekday:'long'})}: ${esc(issueText(broke.issues[0]))}${broke.issues.length > 1 ? ` (+${broke.issues.length-1} more)` : ''}.</p>` : '';
  el.innerHTML = `<section class="squad ${won ? 'won' : ''}">
    <div class="sq-top"><span class="lbl">Squad streak</span><button class="chip" data-action="open-squad">${(sq.wins||[]).length ? `🏆 ${(sq.wins||[]).length} · ` : ''}Prize</button></div>
    <div class="sq-main">${ICON.flame(!n)}<b>${Math.min(n, target)}</b><span>of ${target} days</span></div>
    <div class="sq-prize">Prize: <strong>${esc(sq.prize || 'Not set')}</strong></div>
    <div class="sq-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(n,target)}"><i style="width:${Math.min(100, n / target * 100)}%"></i></div>
    <p class="sq-status">${status}</p>${lastReset}
    ${won ? `<div class="actions"><button class="btn sq-btn" data-action="claim">Claim prize and start next round</button></div>` : ''}
  </section>`;
  if (won){
    const key = 'won-' + S.crew + '-' + st.start;
    if (!store.get(key)){ store.set(key, '1'); confetti(); }
  }
}

function confetti(){
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas'); c.className = 'confetti'; document.body.appendChild(c);
  const ctx = c.getContext('2d'), dpr = devicePixelRatio || 1;
  const W = c.width = innerWidth * dpr, H = c.height = innerHeight * dpr;
  const cols = S.people.map(p => p.color).concat(['#FFC56E']);
  const bits = Array.from({length: 140}, () => ({x: Math.random()*W, y: -Math.random()*H*0.5, vx: (Math.random()-.5)*3*dpr, vy: (2+Math.random()*4)*dpr, r: Math.random()*6.3, vr: (Math.random()-.5)*.3, s: (5+Math.random()*6)*dpr, c: cols[Math.floor(Math.random()*cols.length)]}));
  const t0 = performance.now();
  (function frame(now){
    ctx.clearRect(0, 0, W, H);
    for (const b of bits){ b.x += b.vx; b.y += b.vy; b.vy += .05*dpr; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.s/2, -b.s/4, b.s, b.s/2); ctx.restore(); }
    if (now - t0 < 3500) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

async function claimPrize(btn){
  const st = squadState(); if (!st?.won) return;
  btn.disabled = true;
  try {
    await S.fb.fs.setDoc(ref('meta','squad'), {
      startedAt: addDays(st.reachedOn, 1),
      wins: S.fb.fs.arrayUnion({prize: st.sq.prize || '', target: st.target, wonAt: st.reachedOn}),
    }, {merge: true});
    toast(`Prize won: ${st.sq.prize}. New round starts tomorrow.`);
  } catch(e){ fail(e); btn.disabled = false; }
}

async function saveSquad(btn){
  const prize = $('#prize-text').value.trim();
  if (!prize){ toast('Name the prize first.'); $('#prize-text').focus(); return; }
  btn.disabled = true;
  try {
    await S.fb.fs.setDoc(ref('meta','squad'), {prize, target: S.prizeTarget, startedAt: S.squad?.startedAt || today()}, {merge: true});
    toast('Squad prize saved.'); closeSheet();
  } catch(e){ fail(e); }
  finally { btn.disabled = false; }
}

function renderTrophies(){
  const el = $('#trophies'); if (!el) return;
  const wins = [...(S.squad?.wins || [])].sort((a,b) => (b.wonAt||'').localeCompare(a.wonAt||''));
  el.innerHTML = wins.length ? `<span class="lbl">Trophy case</span><ul class="mlist">${wins.map(w => `<li><div><strong>🏆 ${esc(w.prize)}</strong><small>${w.target} days in a row · won ${fmt(w.wonAt,{month:'short',day:'numeric',year:'numeric'})}</small></div></li>`).join('')}</ul>`
    : `<p class="empty" style="padding:0">Prizes you win will show up here.</p>`;
}

function syncPrizeTarget(){
  $('#prize-target').textContent = S.prizeTarget;
  document.querySelectorAll('[data-action=prize-days]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.n === S.prizeTarget));
}

// ---- Firebase
async function initFirebase(){
  const [{initializeApp}, auth, fs] = await Promise.all([
    import(FB+'firebase-app.js'), import(FB+'firebase-auth.js'), import(FB+'firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  // In-memory cache only: iPhone browsers (especially in-app ones) often refuse Firestore's offline storage.
  const db = fs.getFirestore(app);
  const a = auth.getAuth(app);
  await auth.signInAnonymously(a);
  S.fb = {db, fs};
}
const col = name => S.fb.fs.collection(S.fb.db, 'crews', S.crew, name);
const ref = (name, id) => S.fb.fs.doc(S.fb.db, 'crews', S.crew, name, id);

function subscribe(){
  S.unsubs.forEach(u => u()); S.unsubs = [];
  S.ready = {people:false,goals:false,checks:false,squad:false};
  const {onSnapshot} = S.fb.fs;
  const err = e => { console.error(e); S.failed = 'sync'; S.failCode = e?.code || e?.message || 'unknown'; render(); };
  S.unsubs.push(onSnapshot(col('people'), {includeMetadataChanges:true}, s => {
    if (s.empty && s.metadata.fromCache) return; // wait for the server before deciding the crew is empty
    S.people = s.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => (a.order??0)-(b.order??0) || a.id.localeCompare(b.id));
    S.ready.people = true; render();
  }, err));
  S.unsubs.push(onSnapshot(col('goals'), s => {
    S.goals = s.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => (a.ts??0)-(b.ts??0));
    S.ready.goals = true; render();
  }, err));
  S.unsubs.push(onSnapshot(col('checks'), s => {
    S.checks = new Map(s.docs.map(d => [d.id, d.data()]));
    S.ready.checks = true; render();
  }, err));
  S.unsubs.push(onSnapshot(ref('meta','squad'), s => {
    S.squad = s.exists() ? s.data() : null;
    S.ready.squad = true; render();
  }, err));
}

function enterCrew(code, {creating=false}={}){
  S.crew = code; S.creating = creating;
  store.set('crew', code);
  history.replaceState(null, '', '#'+code);
  subscribe(); render();
}

function leaveCrew(){
  S.unsubs.forEach(u => u()); S.unsubs = [];
  S.crew = null; S.people = []; S.goals = []; S.checks = new Map(); S.squad = null; S.me = null; S.sel = null;
  ['crew','me','sel'].forEach(k => store.set(k, null));
  history.replaceState(null, '', location.pathname);
  closeSheet(); render();
}

// ---- rendering
function render(){
  const t = today();
  if (S.date > t) S.date = t;
  const gear = $('#gear');
  const clear = () => { gear.hidden = true; $('#crew').innerHTML = ''; $('#whoami').innerHTML = ''; $('#squad').innerHTML = ''; };

  if (S.failed){ clear(); renderFailure(); return; }
  if (!S.fb) return;
  if (!S.crew){ clear(); renderWelcome(); return; }
  if (!S.ready.people || !S.ready.goals || !S.ready.checks || !S.ready.squad) return;
  if (!S.people.length){ clear(); renderSetup(); return; }
  gear.hidden = false;
  if (!person(S.sel)) S.sel = (person(S.me) ? S.me : S.people[0].id);

  $('#whoami').innerHTML = person(S.me) ? '' : `<div class="whoami"><p>Which one are you? This phone will check off your goals.</p><div class="actions">${
    S.people.map(p => `<button class="btn" style="--p:${p.color}" data-action="set-me" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>`;

  renderSquad();

  const crew = $('#crew');
  crew.style.setProperty('--n', S.people.length);
  crew.innerHTML = S.people.map(p => {
    const s = summary(p.id);
    const sub = s.over ? '<span class="pill bad">Over a limit</span>'
      : s.daily.length && s.dailyDone === s.daily.length ? '<span class="pill good">Daily done</span>'
      : s.daily.length ? `${s.dailyDone}/${s.daily.length} daily today`
      : `${s.gs.length} goal${s.gs.length===1?'':'s'}`;
    return `<button class="card" style="--p:${p.color}" data-action="select" data-id="${p.id}" aria-current="${p.id===S.sel}">
      <span class="who"><span class="av">${esc(initial(p.name))}</span><span class="nm">${esc(p.name)}</span></span>
      <span class="big">${ICON.flame(!s.best.n)}<b>${s.best.n}</b><span>${s.best.unit}</span></span>
      <span class="sub">${sub}</span></button>`;
  }).join('');

  renderPerson();
  if (S.sheet === 'goals') renderGoalList();
  if (S.sheet === 'squad') renderTrophies();
}

const initial = n => (String(n).trim()[0] || '?').toUpperCase();

function renderFailure(){
  const msg = {
    config: `<h2>Almost there</h2><p class="empty">This copy of Streak Squad isn't connected to a database yet. Add your Firebase settings to <code>firebase-config.js</code> (the README walks through it), then reload.</p>`,
    auth: `<h2>Sign-in is turned off</h2><p class="empty">Turn on <strong>Anonymous</strong> sign-in in the Firebase console (Authentication → Sign-in method), then reload.</p>`,
    offline: `<h2>Can't connect</h2><p class="empty">Check your internet connection, then reload.</p><div class="actions"><button class="btn" data-action="reload">Reload</button></div>`,
    sync: `<h2>Can't load your crew</h2><p class="empty">The database refused the request. If you just set things up, check that the Firestore rules from <code>firestore.rules</code> are published. Otherwise reload and try again.</p><p class="empty" style="padding:0">Error: <code>${esc(S.failCode)}</code></p><div class="actions"><button class="btn" data-action="reload">Reload</button><button class="btn ghost" data-action="leave">Use a different crew code</button></div>`,
  }[S.failed] || '';
  $('#main').innerHTML = `<section class="panel" style="--p:${COLORS[0]}">${msg}</section>`;
}

function renderWelcome(){
  const joinVal = document.getElementById('join-code')?.value ?? '';
  $('#main').innerHTML = `<section class="panel" style="--p:${COLORS[0]}">
    <h2>Join your crew</h2>
    <p class="empty" style="padding:0">Enter the crew code a friend sent you. It's on their Crew screen (gear icon).</p>
    <div class="field"><label for="join-code">Crew code</label><input type="text" id="join-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE-23456" value="${esc(joinVal)}"></div>
    <div class="actions"><button class="btn" data-action="join" id="join-btn">Join crew</button></div>
    <div class="or">or</div>
    <p class="empty" style="padding:0">Setting this up for the group? Start a new crew and share the code.</p>
    <div class="actions"><button class="btn ghost" data-action="create">Start a new crew</button></div>
  </section>`;
}

function renderPerson(){
  const p = person(S.sel), t = today(), mine = S.sel === S.me;
  const ws = weekStart(S.date), curWs = weekStart(t);
  const gs = goalsOf(p.id);
  const days = Array.from({length:7}, (_,i) => addDays(ws,i));
  const pips = d => gs.filter(g => isDone(p.id,g.id,d)).slice(0,8).map(g => `<i class="${g.mode==='atmost'?'l':''}"></i>`).join('');
  const isToday = S.date === t;

  let body;
  if (!gs.length){
    body = mine
      ? `<div class="empty"><span>No goals yet. Add a few things you want the crew to hold you to.</span><div class="actions"><button class="btn" data-action="open-goals">Add goals</button></div></div>`
      : `<p class="empty">${esc(p.name)} hasn't set any goals yet.</p>`;
  } else {
    body = `<ul class="goals">${gs.map(g => goalRow(g, p, mine, ws, curWs)).join('')}</ul>`;
  }

  $('#main').innerHTML = `<section class="panel" style="--p:${p.color}" aria-label="${esc(p.name)}'s goals">
    <div class="phead"><span class="av">${esc(initial(p.name))}</span><h2>${esc(p.name)}</h2>
      ${mine ? `<span class="chip me">You</span><button class="chip" data-action="open-goals">Edit goals</button>` : `<span class="chip">View only</span>`}</div>
    <div class="weeknav">
      <button class="navbtn" data-action="week" data-d="-7" aria-label="Previous week">${ICON.left}</button>
      <span>${fmt(ws,{month:'short',day:'numeric'})} – ${fmt(addDays(ws,6),{month:'short',day:'numeric'})}</span>
      <button class="navbtn" data-action="week" data-d="7" aria-label="Next week" ${ws>=curWs?'disabled':''}>${ICON.right}</button>
    </div>
    <div class="days">${days.map(d => `<button class="day ${d===t?'today':''}" data-action="day" data-d="${d}" aria-pressed="${d===S.date}" ${d>t?'disabled':''} aria-label="${fmt(d,{weekday:'long',month:'long',day:'numeric'})}">
        <span class="dl">${fmt(d,{weekday:'narrow'})}</span><span class="dn">${parse(d).getDate()}</span><span class="pips">${pips(d)}</span></button>`).join('')}</div>
    <div class="dayttl"><h3>${isToday ? 'Today' : fmt(S.date,{weekday:'long'})}</h3><span>${fmt(S.date,{month:'long',day:'numeric'})}${!isToday && mine ? ' · catching up' : ''}</span></div>
    ${!mine && person(S.me) ? `<div class="note"><span>Only ${esc(p.name)} can check these off.</span><button class="linkbtn" data-action="select" data-id="${S.me}">Back to mine</button></div>` : ''}
    ${!mine && !person(S.me) ? `<div class="note"><span>Pick who you are above to start checking in.</span></div>` : ''}
    ${body}
  </section>`;
}

function goalRow(g, p, mine, ws, curWs){
  const done = isDone(p.id, g.id, S.date);
  const s = streak(g);
  const thisWeek = ws === curWs ? 'this week' : 'that week';
  let meta = '';
  if (g.mode === 'daily'){
    meta = `<span>Every day</span>`;
  } else {
    const c = weekCount(g, ws), slots = Math.max(g.target, c);
    const bar = `<span class="tp">${Array.from({length:slots},(_,i)=>`<i class="${i<c ? (g.mode==='atmost' && i>=g.target ? 'x' : 'f') : ''}"></i>`).join('')}</span>`;
    if (g.mode === 'atleast'){
      const st = c >= g.target ? `<span class="ok">Hit</span>` : `<span>${g.target - c} to go</span>`;
      meta = `${bar}<span>${c} of ${g.target} ${thisWeek}</span>${st}`;
    } else {
      const st = c > g.target ? `<span class="bad">Over by ${c-g.target}</span>` : c === g.target ? `<span class="warn">At limit</span>` : `<span>${g.target-c} left</span>`;
      meta = `${slots ? bar : ''}<span>${c} of max ${g.target} ${thisWeek}</span>${st}`;
    }
  }
  const verb = g.mode === 'atmost' ? (done ? `Remove ${g.title} log` : `Log ${g.title}`) : (done ? `Uncheck ${g.title}` : `Check off ${g.title}`);
  return `<li class="goal ${done?'done':''} ${g.mode==='atmost'?'limit':''}">
    <button class="tick" data-action="toggle" data-id="${g.id}" aria-pressed="${done}" aria-label="${esc(verb)}" ${mine?'':'disabled'}>${g.mode==='atmost' && !done ? ICON.plus : (done ? ICON.check : '')}</button>
    <div class="gmain"><span class="gtitle">${esc(g.title)}</span><span class="gmeta">${meta}</span></div>
    <div class="streak" title="${g.mode==='atmost' ? 'Weeks in a row within the limit' : g.mode==='atleast' ? 'Weeks in a row hitting the target' : 'Days in a row'}">
      <span class="row">${ICON.flame(!s.n)}<b>${s.n}</b></span><span>${s.unit}</span></div>
  </li>`;
}

function renderSetup(){
  if (!S.creating){
    $('#main').innerHTML = `<section class="panel" style="--p:${COLORS[0]}"><h2>No crew with that code</h2>
      <p class="empty" style="padding:0">Double-check the code <span class="code">${esc(prettyCode(S.crew))}</span> with your friend and try again.</p>
      <div class="actions"><button class="btn" data-action="leave">Enter a different code</button><button class="btn ghost" data-action="create-here">Set up a crew with this code</button></div></section>`;
    return;
  }
  const names = [0,1,2].map(i => document.getElementById('setup-name-'+i)?.value ?? '');
  $('#main').innerHTML = `<section class="panel" style="--p:${COLORS[S.setupColors[0]]}">
    <h2>Set up your crew</h2>
    <p class="empty" style="padding:0">Add the three of you. Each person gets a color so their check-ins are easy to tell apart.</p>
    ${[0,1,2].map(i => `<div class="prow"><div class="field"><label for="setup-name-${i}">Person ${i+1}</label>
      <input type="text" id="setup-name-${i}" maxlength="24" placeholder="${i===0?'Your name':'Friend’s name'}" value="${esc(names[i])}"></div>
      <div class="swatches" role="group" aria-label="Color for person ${i+1}">${COLORS.map((c,ci)=>`<button class="sw" style="--c:${c}" data-action="setup-color" data-i="${i}" data-c="${ci}" aria-pressed="${S.setupColors[i]===ci}" aria-label="Color ${ci+1}"></button>`).join('')}</div></div>`).join('')}
    <div class="actions"><button class="btn" data-action="setup-save">Start tracking</button></div>
  </section>`;
}

// ---- sheets
function openSheet(kind){
  S.sheet = kind; S.armed = null;
  const sh = $('#sheet');
  if (kind === 'goals'){
    const p = person(S.sel);
    sh.style.setProperty('--p', p.color);
    sh.innerHTML = `<div class="sheet-in">
      <div class="sheet-h"><h2>${esc(p.name)}'s goals</h2><button class="btn ghost" data-action="close-sheet">Done</button></div>
      <div class="field"><label for="goal-title">New goal</label><input type="text" id="goal-title" maxlength="40" placeholder="e.g. Work out"></div>
      <div class="sugs">${SUGGEST.map((s,i)=>`<button class="sug" data-action="suggest" data-i="${i}">${esc(s.title)} · ${s.mode==='daily'?'daily':s.mode==='atleast'?s.target+'×/wk':'max '+s.target+'×/wk'}</button>`).join('')}</div>
      <div class="field"><span class="lbl">How often</span><div class="seg" id="goal-mode" role="group">
        <button data-action="mode" data-m="daily">Every day</button><button data-action="mode" data-m="atleast">At least</button><button data-action="mode" data-m="atmost">At most</button></div></div>
      <div class="stepper" id="goal-stepper"><button class="navbtn" data-action="step" data-d="-1" aria-label="Fewer">−</button><output id="goal-target"></output><button class="navbtn" data-action="step" data-d="1" aria-label="More">+</button><span>days per week</span></div>
      <p class="empty" id="goal-help" style="padding:0"></p>
      <div class="actions"><button class="btn" data-action="add-goal" id="goal-add">Add goal</button></div>
      <div id="sheet-list"></div>
    </div>`;
    syncForm(); renderGoalList();
  } else if (kind === 'squad'){
    S.prizeTarget = S.squad?.target || 30;
    sh.style.setProperty('--p', person(S.me)?.color || COLORS[0]);
    sh.innerHTML = `<div class="sheet-in">
      <div class="sheet-h"><h2>Squad prize</h2><button class="btn ghost" data-action="close-sheet">Close</button></div>
      <p class="empty" style="padding:0">A day counts when all of you finish your daily goals. Going over an “at most” limit, or ending a week short of an “at least” target, resets the streak to zero.</p>
      <div class="field"><label for="prize-text">Prize</label><input type="text" id="prize-text" maxlength="60" placeholder="e.g. Steak dinner, loser buys" value="${esc(S.squad?.prize || '')}"></div>
      <div class="field"><span class="lbl">Days in a row to win</span>
        <div class="sugs">${[7,14,21,30,60,100].map(n => `<button class="sug" data-action="prize-days" data-n="${n}">${n} days</button>`).join('')}</div>
        <div class="stepper"><button class="navbtn" data-action="prize-step" data-d="-1" aria-label="Fewer days">−</button><output id="prize-target"></output><button class="navbtn" data-action="prize-step" data-d="1" aria-label="More days">+</button><span>days</span></div></div>
      <div class="actions"><button class="btn" data-action="save-squad">Save prize</button></div>
      <div id="trophies"></div>
    </div>`;
    syncPrizeTarget(); renderTrophies();
  } else {
    sh.style.setProperty('--p', person(S.me)?.color || COLORS[0]);
    sh.innerHTML = `<div class="sheet-in">
      <div class="sheet-h"><h2>Crew</h2><button class="btn ghost" data-action="close-sheet">Close</button></div>
      <div class="field"><span class="lbl">Invite your friends</span>
        <p class="empty" style="padding:0">Send them this link, or have them enter the code when they open the app.</p>
        <div class="actions" style="align-items:center"><span class="code">${esc(prettyCode(S.crew))}</span><button class="btn" data-action="copy-link">Copy invite link</button></div></div>
      ${S.people.map(p => `<div class="prow" data-pid="${p.id}"><div class="field"><label for="crew-name-${p.id}">Name</label><input type="text" id="crew-name-${p.id}" maxlength="24" value="${esc(p.name)}"></div>
        <div class="swatches" role="group" aria-label="Color for ${esc(p.name)}">${COLORS.map(c=>`<button class="sw" style="--c:${c}" data-action="crew-color" data-pid="${p.id}" data-c="${c}" aria-pressed="${p.color===c}" aria-label="Color ${c}"></button>`).join('')}</div></div>`).join('')}
      <div class="actions"><button class="btn ghost" data-action="crew-save">Save names and colors</button></div>
      <div class="field"><span class="lbl">This phone belongs to</span><div class="actions">${S.people.map(p=>`<button class="btn ${p.id===S.me?'':'ghost'}" style="--p:${p.color}" data-action="set-me" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>
      <div class="foot"><button class="linkbtn" data-action="leave" id="leave-btn">Switch to a different crew on this phone</button></div>
    </div>`;
  }
  $('#scrim').hidden = false; sh.hidden = false;
}
function closeSheet(){ S.sheet = null; $('#scrim').hidden = true; $('#sheet').hidden = true; }

function syncForm(){
  const f = S.form;
  document.querySelectorAll('#goal-mode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === f.mode));
  $('#goal-stepper').hidden = f.mode === 'daily';
  $('#goal-target').textContent = f.target;
  $('#goal-help').textContent = f.mode === 'daily' ? 'Check it off every day. The streak counts days in a row.'
    : f.mode === 'atleast' ? `Hit it at least ${f.target} day${f.target===1?'':'s'} a week. The streak counts weeks in a row.`
    : `Log each day you have it. Stay at ${f.target} or fewer a week to keep the streak going.`;
}

function renderGoalList(){
  const el = $('#sheet-list'); if (!el) return;
  const gs = goalsOf(S.sel);
  el.innerHTML = gs.length ? `<span class="lbl">Current goals</span><ul class="mlist">${gs.map(g=>`<li><div><strong>${esc(g.title)}</strong><small>${g.mode==='daily'?'Every day':g.mode==='atleast'?`At least ${g.target}× a week`:`At most ${g.target}× a week`}</small></div>
    <button class="del ${S.armed===g.id?'arm':''}" data-action="del" data-id="${g.id}">${S.armed===g.id?'Tap to delete':'Delete'}</button></li>`).join('')}</ul>` : '';
}

// ---- writes
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(()=>t.hidden=true, 3800); }
function fail(e){ console.error(e); toast(e?.code === 'permission-denied' ? "Couldn't save: the database rules refused it." : "Couldn't save. Check your connection and try again."); }
const queues = new Map();
function queued(key, fn){
  const p = (queues.get(key) || Promise.resolve()).then(fn).catch(fail);
  queues.set(key, p); return p;
}

function toggle(gid){
  const key = S.sel + '_' + S.date;
  const done = {...(S.checks.get(key)?.done || {})};
  if (done[gid]) delete done[gid]; else done[gid] = true;
  const body = {person:S.sel, date:S.date, done};
  S.checks.set(key, body); render();
  queued(key, () => S.fb.fs.setDoc(ref('checks', key), body));
}

async function addGoal(btn){
  const title = $('#goal-title').value.trim();
  if (!title){ toast('Give the goal a name first.'); $('#goal-title').focus(); return; }
  const f = S.form;
  const g = {person:S.sel, title, mode:f.mode, target: f.mode==='daily' ? 1 : f.target, createdAt: today(), ts: Date.now()};
  btn.disabled = true;
  try { await S.fb.fs.addDoc(col('goals'), g); $('#goal-title').value = ''; toast(`Added “${title}”.`); }
  catch(e){ fail(e); }
  finally { btn.disabled = false; }
}

async function setupSave(btn){
  const rows = [0,1,2].map(i => ({name: $('#setup-name-'+i).value.trim(), color: COLORS[S.setupColors[i]], order:i})).filter(r => r.name);
  if (!rows.length){ toast('Add at least one name.'); return; }
  btn.disabled = true;
  try {
    const refs = [];
    for (const r of rows) refs.push(await S.fb.fs.addDoc(col('people'), r));
    S.me = refs[0].id; S.sel = S.me; store.set('me', S.me); store.set('sel', S.me);
    S.creating = false; render();
    toast('Crew ready. Share the invite link from the gear icon.');
  } catch(e){ fail(e); btn.disabled = false; }
}

async function crewSave(btn){
  btn.disabled = true;
  try {
    for (const p of S.people){
      const row = document.querySelector(`.prow[data-pid="${p.id}"]`);
      const name = $('#crew-name-'+p.id).value.trim() || p.name;
      const color = row.querySelector('.sw[aria-pressed="true"]')?.dataset.c || p.color;
      if (name !== p.name || color !== p.color) await S.fb.fs.setDoc(ref('people', p.id), {name, color, order:p.order ?? 0});
    }
    toast('Crew saved.'); closeSheet();
  } catch(e){ fail(e); }
  finally { btn.disabled = false; }
}

async function copyLink(){
  const link = inviteLink(S.crew);
  try {
    if (navigator.share) { await navigator.share({title:'Streak Squad', text:`Join our Streak Squad crew (code ${prettyCode(S.crew)})`, url:link}); return; }
    await navigator.clipboard.writeText(link); toast('Invite link copied.');
  } catch (e) {
    if (e?.name !== 'AbortError') toast(`Copy this link: ${link}`);
  }
}

// ---- events
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]'); if (!b) return;
  const a = b.dataset.action, id = b.dataset.id;
  if (a === 'select'){ S.sel = id; store.set('sel', id); render(); }
  else if (a === 'set-me'){ S.me = id; S.sel = id; store.set('me', id); store.set('sel', id); if (S.sheet==='crew') openSheet('crew'); render(); toast(`This phone checks in as ${person(id).name}.`); }
  else if (a === 'day'){ S.date = b.dataset.d; render(); }
  else if (a === 'week'){ S.date = addDays(S.date, +b.dataset.d); render(); }
  else if (a === 'toggle'){ if (S.sel === S.me) toggle(id); }
  else if (a === 'open-goals') openSheet('goals');
  else if (a === 'open-settings') openSheet('crew');
  else if (a === 'close-sheet') closeSheet();
  else if (a === 'mode'){ S.form.mode = b.dataset.m; if (S.form.mode==='atmost' && S.form.target===3) S.form.target = 2; syncForm(); }
  else if (a === 'step'){ S.form.target = Math.min(7, Math.max(S.form.mode==='atmost'?0:1, S.form.target + +b.dataset.d)); syncForm(); }
  else if (a === 'suggest'){ const s = SUGGEST[+b.dataset.i]; $('#goal-title').value = s.title; S.form.mode = s.mode; S.form.target = s.mode==='daily'?3:s.target; syncForm(); }
  else if (a === 'add-goal') addGoal(b);
  else if (a === 'del'){
    if (S.armed !== id){ S.armed = id; renderGoalList(); return; }
    S.armed = null; S.goals = S.goals.filter(g => g.id !== id); render();
    S.fb.fs.deleteDoc(ref('goals', id)).then(()=>toast('Goal deleted.'), fail);
  }
  else if (a === 'setup-color'){ S.setupColors[+b.dataset.i] = +b.dataset.c; renderSetup(); }
  else if (a === 'setup-save') setupSave(b);
  else if (a === 'crew-color'){ b.parentElement.querySelectorAll('.sw').forEach(x => x.setAttribute('aria-pressed', x===b)); }
  else if (a === 'crew-save') crewSave(b);
  else if (a === 'copy-link') copyLink();
  else if (a === 'open-squad') openSheet('squad');
  else if (a === 'prize-days'){ S.prizeTarget = +b.dataset.n; syncPrizeTarget(); }
  else if (a === 'prize-step'){ S.prizeTarget = Math.min(365, Math.max(2, S.prizeTarget + +b.dataset.d)); syncPrizeTarget(); }
  else if (a === 'save-squad') saveSquad(b);
  else if (a === 'claim') claimPrize(b);
  else if (a === 'join') join();
  else if (a === 'create') enterCrew(newCode(), {creating:true});
  else if (a === 'create-here'){ S.creating = true; render(); }
  else if (a === 'leave' && S.failed){ S.failed = null; leaveCrew(); }
  else if (a === 'leave'){
    if (b.id === 'leave-btn' && b.dataset.armed !== '1'){ b.dataset.armed = '1'; b.textContent = 'Tap again to leave this crew on this phone'; return; }
    leaveCrew();
  }
  else if (a === 'reload') location.reload();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheet) closeSheet();
  if (e.key === 'Enter' && e.target.id === 'goal-title') addGoal($('#goal-add'));
  if (e.key === 'Enter' && e.target.id === 'join-code') join();
});

function join(){
  const code = cleanCode($('#join-code').value);
  if (code.length !== 10){ toast('Crew codes are 10 letters and numbers, like ABCDE-23456.'); return; }
  enterCrew(code);
}

// ---- boot
(async () => {
  if (!firebaseConfig){ S.failed = 'config'; render(); return; }
  try { await initFirebase(); }
  catch (e) {
    console.error(e);
    const c = e?.code || '';
    S.failed = /operation-not-allowed|admin-restricted/.test(c) ? 'auth' : /network/.test(c) || !navigator.onLine ? 'offline' : 'config';
    render(); return;
  }
  const fromLink = cleanCode(location.hash.slice(1));
  const code = fromLink.length === 10 ? fromLink : cleanCode(store.get('crew'));
  if (code.length === 10){
    if (code !== store.get('crew')) { S.me = null; S.sel = null; store.set('me', null); store.set('sel', null); }
    enterCrew(code);
  } else render();
})();

// roll over to the new day at midnight, and when the app comes back to the foreground
let lastDay = today();
const rollover = () => { const t = today(); if (t !== lastDay){ if (S.date === lastDay) S.date = t; lastDay = t; render(); } };
setInterval(rollover, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) rollover(); });
