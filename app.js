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
  fb:null, crew:null, unsubs:[], failed:null, ready:{people:false,goals:false,checks:false},
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

// ---- Firebase
async function initFirebase(){
  const [{initializeApp}, auth, fs] = await Promise.all([
    import(FB+'firebase-app.js'), import(FB+'firebase-auth.js'), import(FB+'firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  let db;
  try { db = fs.initializeFirestore(app, {localCache: fs.persistentLocalCache({tabManager: fs.persistentMultipleTabManager()})}); }
  catch { db = fs.getFirestore(app); }
  const a = auth.getAuth(app);
  await auth.signInAnonymously(a);
  S.fb = {db, fs};
}
const col = name => S.fb.fs.collection(S.fb.db, 'crews', S.crew, name);
const ref = (name, id) => S.fb.fs.doc(S.fb.db, 'crews', S.crew, name, id);

function subscribe(){
  S.unsubs.forEach(u => u()); S.unsubs = [];
  S.ready = {people:false,goals:false,checks:false};
  const {onSnapshot} = S.fb.fs;
  const err = e => { console.error(e); S.failed = 'sync'; render(); };
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
}

function enterCrew(code, {creating=false}={}){
  S.crew = code; S.creating = creating;
  store.set('crew', code);
  history.replaceState(null, '', '#'+code);
  subscribe(); render();
}

function leaveCrew(){
  S.unsubs.forEach(u => u()); S.unsubs = [];
  S.crew = null; S.people = []; S.goals = []; S.checks = new Map(); S.me = null; S.sel = null;
  ['crew','me','sel'].forEach(k => store.set(k, null));
  history.replaceState(null, '', location.pathname);
  closeSheet(); render();
}

// ---- rendering
function render(){
  const t = today();
  if (S.date > t) S.date = t;
  const gear = $('#gear');
  const clear = () => { gear.hidden = true; $('#crew').innerHTML = ''; $('#whoami').innerHTML = ''; };

  if (S.failed){ clear(); renderFailure(); return; }
  if (!S.fb) return;
  if (!S.crew){ clear(); renderWelcome(); return; }
  if (!S.ready.people || !S.ready.goals || !S.ready.checks) return;
  if (!S.people.length){ clear(); renderSetup(); return; }
  gear.hidden = false;
  if (!person(S.sel)) S.sel = (person(S.me) ? S.me : S.people[0].id);

  $('#whoami').innerHTML = person(S.me) ? '' : `<div class="whoami"><p>Which one are you? This phone will check off your goals.</p><div class="actions">${
    S.people.map(p => `<button class="btn" style="--p:${p.color}" data-action="set-me" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>`;

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
}

const initial = n => (String(n).trim()[0] || '?').toUpperCase();

function renderFailure(){
  const msg = {
    config: `<h2>Almost there</h2><p class="empty">This copy of Streak Squad isn't connected to a database yet. Add your Firebase settings to <code>firebase-config.js</code> (the README walks through it), then reload.</p>`,
    auth: `<h2>Sign-in is turned off</h2><p class="empty">Turn on <strong>Anonymous</strong> sign-in in the Firebase console (Authentication → Sign-in method), then reload.</p>`,
    offline: `<h2>Can't connect</h2><p class="empty">Check your internet connection, then reload.</p><div class="actions"><button class="btn" data-action="reload">Reload</button></div>`,
    sync: `<h2>Can't load your crew</h2><p class="empty">The database refused the request. If you just set things up, check that the Firestore rules from <code>firestore.rules</code> are published. Otherwise reload and try again.</p><div class="actions"><button class="btn" data-action="reload">Reload</button></div>`,
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
  else if (a === 'join') join();
  else if (a === 'create') enterCrew(newCode(), {creating:true});
  else if (a === 'create-here'){ S.creating = true; render(); }
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
