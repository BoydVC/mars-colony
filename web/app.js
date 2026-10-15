/* Mars Colony Sim — UI glue: game loop, panels, modals, input, sound, save, test API. */
(function () {
  'use strict';
  const E = window.MarsEngine, R = window.MarsRender;
  const $ = (q) => document.querySelector(q);
  const SAVE_KEY = 'marsColonySim.save.v1';
  const MS_PER_SOL = [0, 2600, 1200, 450];
  const RES_META = {
    o2: { name: 'Oxygen', short: 'O\u2082', col: '#4fd1c5' },
    water: { name: 'Water', short: 'H\u2082O', col: '#5aa9ff' },
    food: { name: 'Food', short: 'FD', col: '#8bd450' },
    power: { name: 'Battery', short: 'kW', col: '#ffd23f' },
    materials: { name: 'Materials', short: 'MT', col: '#d8b8a4' },
    spares: { name: 'Spare Parts', short: 'SP', col: '#c79bff' },
  };
  const CARGO_COL = { colonist: '#e8b67a', life: '#4fd1c5', food: '#8bd450', materials: '#d8b8a4', spares: '#c79bff' };
  const ICON = {
    pause: '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>',
    p1: '<svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6z"/></svg>',
    p2: '<svg viewBox="0 0 16 16"><path d="M1 2l7 6-7 6zM8 2l7 6-7 6z"/></svg>',
    p3: '<svg viewBox="0 0 16 16"><path d="M0 3l5 5-5 5zM5.5 3l5 5-5 5zM11 3l5 5-5 5z"/></svg>',
    snd: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2z"/><path d="M11 5.5c1 1.2 1 3.8 0 5M12.8 4c1.8 2.2 1.8 5.8 0 8" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
    mute: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2z"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.5"/></svg>',
  };

  let S = null;            // live game state
  const V = {              // view state
    screen: 'title', speed: 1, acc: 0, phase: 0.42, buildType: null, hover: null, mouse: null, sel: null,
    fx: [], walkers: [], rovers: [], autopilot: false, muted: false, modal: null, demo: true,
    lastFrame: 0, L: null, dpr: 1, frames: 0, lastUiSol: -1, logLen: -1,
  };

  // ---------- Sound (tiny WebAudio synth) ----------
  let AC = null;
  function beep(freq, dur, type, vol, slide) {
    if (V.muted || V.demo) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, AC.currentTime + dur);
      g.gain.value = vol || 0.05; g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
      o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
    } catch (e) { /* audio optional */ }
  }
  const SFX = {
    click: () => beep(660, 0.06, 'square', 0.03),
    build: () => { beep(440, 0.08, 'triangle', 0.05); setTimeout(() => beep(660, 0.1, 'triangle', 0.05), 70); },
    done: () => { beep(523, 0.09, 'sine', 0.05); setTimeout(() => beep(784, 0.14, 'sine', 0.05), 90); },
    bad: () => beep(220, 0.3, 'sawtooth', 0.04, 110),
    warn: () => { beep(880, 0.08, 'square', 0.03); setTimeout(() => beep(880, 0.08, 'square', 0.03), 160); },
    land: () => beep(90, 1.2, 'sawtooth', 0.05, 40),
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'triangle', 0.06), i * 160)),
    no: () => beep(160, 0.12, 'square', 0.03),
  };

  // ---------- Helpers ----------
  const fmt = (v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.floor(v + 1e-6).toString());
  const fmtRate = (v) => (v > 0.05 ? '+' : v < -0.05 ? '\u2212' : '\u00b1') + Math.abs(v).toFixed(1);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function costText(cost) { return Object.keys(cost).map((k) => cost[k] + (k === 'materials' ? ' mat' : k === 'spares' ? ' sp' : ' ' + k)).join(' + ') || 'free'; }

  function toast(msg, kind) {
    if (V.demo) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 450); }, 4200);
  }

  // ---------- Game lifecycle ----------
  function startGame(opts) {
    S = E.newGame(opts || {});
    V.demo = false; V.screen = 'game'; V.sel = null; V.buildType = null; V.fx = []; V.walkers = []; V.rovers = [];
    V.acc = 0; V.phase = 0.42; V.autopilot = false; V.speed = 1; V.logLen = -1;
    $('#title').classList.add('hidden');
    closeModal();
    buildCards();
    renderUI(true);
    save();
    toast('Welcome to Mars, Commander. Keep an eye on the red warnings on the left!', 'good');
  }

  function startDemo() {
    S = E.newGame({ seed: 4242, difficulty: 'cadet' });
    for (let i = 0; i < 150 && !S.over; i++) { E.autopilot(S); E.tick(S); }
    V.demo = true; V.screen = 'title'; V.speed = 2; V.autopilot = true; V.phase = 0.4;
    buildCards(); renderUI(true);
  }

  function save() { if (V.demo || !S) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
  function loadSave() { try { const j = localStorage.getItem(SAVE_KEY); return j ? JSON.parse(j) : null; } catch (e) { return null; } }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  function continueGame() {
    const st = loadSave();
    if (!st || st.over) return false;
    S = st; V.demo = false; V.screen = 'game'; V.autopilot = false; V.speed = 0; V.fx = []; V.walkers = []; V.logLen = -1;
    $('#title').classList.add('hidden');
    buildCards(); renderUI(true);
    if (S.pending) openChoice(); else if (S.window && !S.window.launched) openManifest();
    return true;
  }

  function showTitle() {
    closeModal();
    $('#title').classList.remove('hidden');
    const st = loadSave();
    $('#btn-continue').classList.toggle('hidden', !(st && !st.over));
    if (st && !st.over) $('#btn-continue').textContent = 'Continue colony (Sol ' + st.sol + ', ' + st.crew + ' crew)';
    startDemo();
  }

  // One sol. Returns events.
  function doTick() {
    if (!S || S.over) return [];
    if (V.autopilot) { E.autopilot(S); S.autopilotUsed = S.autopilotUsed || !V.demo; }
    if (S.pending) { if (!V.demo) openChoice(); return []; }
    const ev = E.tick(S);
    handleEvents(ev);
    if (V.demo && S.over) startDemo();
    save();
    renderUI();
    return ev;
  }

  function handleEvents(ev) {
    for (const e of ev) {
      switch (e.type) {
        case 'built': if (!V.demo) SFX.done(); addFx('spark', { x: e.x, y: e.y, dur: 900 }); break;
        case 'meteor': addFx('meteor', { x: e.x, y: e.y, dur: 1400 }); SFX.bad(); toast('Meteorite strike! A module is offline \u2014 click it to repair.', 'bad'); break;
        case 'failure': addFx('zap', { x: e.x, y: e.y, dur: 900 }); SFX.bad(); toast('Equipment failure! Click the smoking module to repair it.', 'bad'); break;
        case 'storm-warn': SFX.warn(); toast((e.global ? 'GLOBAL dust storm' : 'Dust storm') + ' in 3 sols (~' + e.dur + ' sols). Solar will drop \u2014 charge batteries!', 'warn'); break;
        case 'storm-start': toast('The dust storm is here. Solar output is way down.', 'warn'); break;
        case 'storm-end': toast('Storm cleared! Panels are back to full power.', 'good'); break;
        case 'flare': SFX.warn(); toast('Solar flare! Everyone shelters for a sol.', 'warn'); break;
        case 'leak': SFX.bad(); toast('A hab seal leaked some oxygen.', 'bad'); break;
        case 'sick': toast('Hab Flu is going around \u2014 fewer workers for a few sols.', 'warn'); break;
        case 'good': if (!V.demo) SFX.click(); break;
        case 'death': SFX.bad(); toast(e.n + ' colonist' + (e.n > 1 ? 's' : '') + ' lost to ' + e.cause + '.', 'bad'); break;
        case 'arrival': {
          const pads = S.mods.filter((m) => m.type === 'pad' && S.parked[m.id] > S.sol);
          pads.slice(0, e.n).forEach((p, i) => addFx('land', { x: p.x, y: p.y, id: p.id, dur: 3200, delay: i * 500 }));
          if (!V.demo) { SFX.land(); toast('Starship touchdown! ' + e.colonists + ' new colonists have arrived.' + (e.hard ? ' (hard landing!)' : ''), e.hard ? 'warn' : 'good'); }
          break;
        }
        case 'window': if (!V.demo && !V.autopilot) { SFX.warn(); openManifest(); } break;
        case 'choice': if (!V.demo && !V.autopilot) openChoice(); break;
        case 'win': if (!V.demo) { SFX.win(); setTimeout(openEnd, 900); } break;
        case 'lose': if (!V.demo) { SFX.bad(); setTimeout(openEnd, 900); } break;
      }
    }
  }

  function addFx(type, o) { V.fx.push(Object.assign({ type, t0: performance.now() + (o.delay || 0) }, o)); }

  // ---------- Panels ----------
  function buildCards() {
    const box = $('#build');
    box.innerHTML = '';
    for (const t of E.BUILD_ORDER) {
      const M = E.MODULES[t];
      const b = document.createElement('button');
      b.className = 'card'; b.dataset.type = t;
      b.innerHTML = '<canvas width="76" height="76"></canvas><div><div class="nm">' + esc(M.name) + '</div><div class="cost">' + costText(M.cost) + '</div></div><span class="key">' + M.key + '</span><span class="cnt"></span>';
      b.title = M.name + ' \u2014 ' + M.desc + ' (' + M.sols + ' sols to build)';
      R.drawIcon(b.querySelector('canvas'), t);
      b.addEventListener('click', () => selectBuild(t));
      box.appendChild(b);
    }
  }

  function selectBuild(t) {
    if (!S || V.demo) return;
    if (V.buildType === t) { cancelBuild(); return; }
    const c = E.canBuild(S, t);
    if (!c.ok) { SFX.no(); toast(E.MODULES[t].name + ': ' + c.why, 'warn'); return; }
    SFX.click();
    V.buildType = t; V.sel = null;
    renderUI(true);
  }
  function cancelBuild() { V.buildType = null; renderUI(true); }

  function resRow(k, val, cap, rate, fc) {
    const m = RES_META[k];
    const pct = cap ? Math.min(100, (val / cap) * 100) : 0;
    const rc = rate > 0.05 ? 'pos' : rate < -0.05 ? 'neg' : 'zero';
    return '<div class="res' + (fc && fc < 8 ? ' alert' : '') + '" data-res="' + k + '"><div class="ico" style="background:' + m.col + '">' + m.short + '</div>' +
      '<div class="name">' + m.name + '</div><div class="val">' + fmt(val) + (cap ? '<span class="dim" style="font-size:11px">/' + fmt(cap) + '</span>' : '') + '</div>' +
      '<div class="meter"><i style="width:' + pct.toFixed(1) + '%;background:' + m.col + '"></i></div><div class="rate ' + rc + '">' + (rate == null ? '' : fmtRate(rate) + '/sol') + '</div>' +
      (fc != null && fc < 30 ? '<div class="fc">' + (fc <= 0 ? (k === 'power' ? 'POWER SHORTFALL \u2014 build Solar!' : 'EMPTY \u2014 crew in danger!') : (k === 'power' ? 'Drained in ' : 'Runs out in ') + fc + ' sol' + (fc === 1 ? '' : 's')) + '</div>' : '') + '</div>';
  }

  function moodName(m) { return m >= 80 ? 'Thrilled' : m >= 60 ? 'Content' : m >= 40 ? 'Restless' : m >= 20 ? 'Grumpy' : 'Mutinous'; }

  function tips() {
    const f = S.last, fc = E.forecast(S), out = [];
    const tip = (kind, txt) => out.push({ kind, txt });
    if (S.over) return [{ kind: S.over.win ? 'good' : 'bad', txt: S.over.reason }];
    if (S.sol < 8) tip('good', 'Click a module card on the right, then a free tile to build. Food is slipping: a 2nd Greenhouse is a great first build.');
    const sh = (k, mod) => { if (fc[k].sols < 15) tip(fc[k].sols < 6 ? 'bad' : 'warn', RES_META[k].name + ' runs out in ' + fc[k].sols + ' sols \u2014 build a ' + E.MODULES[mod].name + '.'); };
    sh('o2', 'electrolyzer'); sh('water', 'drill'); sh('food', 'greenhouse');
    if (f.eff < 0.999) tip('bad', 'Power shortfall! Life support gets power first; build Solar Arrays or Batteries.');
    else if (fc.power.sols < 12) tip('warn', 'Batteries draining (' + fc.power.sols + ' sols left). More Solar or a Battery Bank will help.');
    if (S.storm && !S.storm.active) tip('warn', 'Dust storm arrives in ' + S.storm.warn + ' sol' + (S.storm.warn > 1 ? 's' : '') + '. Fill the batteries now.');
    if (S.crew > f.housing) tip('bad', 'Overcrowded: ' + S.crew + ' crew, ' + f.housing + ' beds. Build a Hab Module.');
    const incoming = E.inTransitCrew(S);
    if (incoming && S.crew + incoming > f.housing + (S.mods.filter((m) => m.type === 'hab' && m.status === 'building').length * 4)) tip('warn', incoming + ' colonists inbound \u2014 build Habs before they land.');
    if (f.staff < 0.999) tip('warn', 'Not enough workers (' + (S.crew - S.sick) + ' for ' + f.jobs + ' jobs). Production at ' + Math.round(f.staff * 100) + '%.');
    if (f.broken) tip('bad', f.broken + ' module' + (f.broken > 1 ? 's are' : ' is') + ' broken. Click to repair.');
    if (f.rec < S.crew) tip('info', 'Crew wants fun: a Rec Dome boosts morale.');
    if (S.window && !S.window.launched) tip('good', 'Launch window open! Click the orange chip up top to pack the Starship.');
    if (!(f.n.foundry > 1) && S.sol > 8 && S.res.materials < 60) tip('info', 'Low on materials: another Regolith Foundry pays for itself.');
    if (S.morale < 30) tip('bad', 'Morale is low. Rec Domes, beds and full bellies cheer people up.');
    if (!out.length) tip('good', 'All systems nominal. Plan for the next Starship: more Habs, more Landing Pads.');
    return out.slice(0, 4);
  }

  function renderUI(force) {
    if (!S) return;
    const f = S.last || E.flows(S), fc = E.forecast(S);
    if (V.modal === 'manifest' && (!S.window || S.window.launched)) closeModal();
    if (V.modal === 'choice' && !S.pending) closeModal();
    $('#sol').textContent = S.sol;
    $('#goal-crew').textContent = S.crew;
    $('#goal-fill').style.width = Math.min(100, (S.crew / E.GOAL) * 100) + '%';
    $('#diff-label').textContent = E.DIFFS[S.diff].label + (V.autopilot ? ' \u00b7 autopilot' : '');
    const chip = $('#window-chip');
    if (S.window && !S.window.launched) { chip.className = 'chip open'; chip.textContent = 'LAUNCH WINDOW OPEN \u2014 pack Starship (closes Sol ' + S.window.closes + ')'; }
    else {
      chip.className = 'chip';
      const ship = S.ships[0];
      chip.textContent = ship ? 'Starship inbound \u2014 lands Sol ' + ship.arrive + ' (' + (ship.arrive - S.sol) + ' sols)' : 'Next launch window: Sol ' + S.nextWindow + ' (in ' + (S.nextWindow - S.sol) + ')';
    }
    // speed buttons
    document.querySelectorAll('.speed button[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === V.speed));
    $('#btn-auto').classList.toggle('on', V.autopilot);
    $('#btn-mute').innerHTML = V.muted ? ICON.mute : ICON.snd;
    // resources
    $('#res').innerHTML =
      resRow('o2', S.res.o2, f.tanks, f.net.o2, fc.o2.sols) +
      resRow('water', S.res.water, f.tanks, f.net.water, fc.water.sols) +
      resRow('food', S.res.food, f.tanks, f.net.food, fc.food.sols) +
      resRow('power', S.res.power, f.storage, f.gen - f.demand, f.eff < 0.999 ? 0 : fc.power.sols < 30 ? fc.power.sols : null) +
      resRow('materials', S.res.materials, 0, f.net.materials, null) +
      resRow('spares', S.res.spares, 0, null, null);
    // crew
    const sun = Math.round(f.sun * 100);
    $('#crew').innerHTML = '<div class="crewbox">' +
      '<div class="row"><span>Colonists</span><b>' + S.crew + (S.sick ? ' <span class="dim">(' + S.sick + ' sick)</span>' : '') + '</b></div>' +
      '<div class="row"><span>Beds</span><b class="' + (S.crew > f.housing ? 'bad' : '') + '">' + f.housing + '</b></div>' +
      '<div class="row"><span>Jobs filled</span><b class="' + (f.staff < 1 ? 'bad' : '') + '">' + Math.min(f.jobs, S.crew - S.sick) + ' / ' + f.jobs + '</b></div>' +
      '<div class="row"><span>Power</span><b>' + f.gen.toFixed(0) + ' gen / ' + f.demand + ' use</b></div>' +
      '<div class="row"><span>Sunlight</span><b class="' + (sun < 60 ? 'bad' : '') + '">' + sun + '%' + (S.storm && S.storm.active ? ' storm' : '') + '</b></div>' +
      '<div class="morale"><div class="row"><span>Morale</span><span class="mood" style="color:' + (S.morale < 30 ? 'var(--bad)' : S.morale < 55 ? 'var(--warn)' : 'var(--good)') + '">' + moodName(S.morale) + ' ' + Math.round(S.morale) + '</span></div>' +
      '<div class="bar"><i style="width:' + S.morale.toFixed(0) + '%"></i></div></div></div>';
    $('#tips').innerHTML = tips().map((t) => '<li class="' + t.kind + '">' + esc(t.txt) + '</li>').join('');
    // build cards
    document.querySelectorAll('#build .card').forEach((c) => {
      const t = c.dataset.type, M = E.MODULES[t];
      const ok = E.canBuild(S, t).ok;
      c.classList.toggle('no', !ok);
      c.classList.toggle('sel', V.buildType === t);
      const lockedTxt = !E.unlocked(S, t) ? 'unlocks @' + M.unlock + ' crew' : costText(M.cost);
      c.querySelector('.cost').textContent = lockedTxt;
      const n = E.countType(S, t, true);
      c.querySelector('.cnt').textContent = n ? '\u00d7' + n : '';
    });
    $('#map').classList.toggle('building', !!V.buildType);
    $('#buildbar').classList.toggle('hidden', !V.buildType);
    if (V.buildType) $('#buildbar-text').innerHTML = 'Placing <b>' + esc(E.MODULES[V.buildType].name) + '</b> \u2014 click a free tile' + (V.buildType === 'drill' ? ' (ice = +50%)' : '') + ' \u00b7 Shift-click to place several';
    renderInspector();
    // log
    if (force || S.log.length !== V.logLen || V.lastUiSol !== S.sol) {
      V.logLen = S.log.length; V.lastUiSol = S.sol;
      $('#log').innerHTML = S.log.slice(-40).reverse().map((l) => '<li class="' + l.kind + '"><span class="s">' + l.sol + '</span><span>' + esc(l.msg) + '</span></li>').join('');
    }
  }

  function renderInspector() {
    const box = $('#inspector');
    const m = V.sel && S.mods.find((q) => q.id === V.sel);
    if (!m) { box.classList.add('hidden'); return; }
    const M = E.MODULES[m.type];
    box.classList.remove('hidden');
    const st = m.status === 'building' ? (m.repairing ? 'repairing' : 'building') : m.status;
    let extra = '';
    if (m.status === 'building') extra = '<p>' + (m.repairing ? 'Repair' : 'Construction') + ': ' + m.prog + ' / ' + m.need + ' sols</p>';
    const t = E.tileAt(S, m.x, m.y);
    if (m.type === 'drill' && t.t === 'ice') extra += '<p style="color:var(--water)">On an ice deposit: +50% water.</p>';
    if (m.type === 'pad' && S.parked[m.id] > S.sol) extra += '<p>A Starship is parked here.</p>';
    const btns = [];
    if (m.status === 'broken') {
      btns.push('<button class="primary" data-act="rs"' + (S.res.spares < 1 ? ' disabled' : '') + '>Repair now (1 spare)</button>');
      btns.push('<button data-act="rm"' + (S.res.materials < 15 ? ' disabled' : '') + '>Patch (15 mat, 3 sols)</button>');
    }
    if (m.type !== 'hub') btns.push('<button data-act="del">Recycle (+' + Math.floor((M.cost.materials || 0) / 2) + ' mat)</button>');
    btns.push('<button data-act="close">Close</button>');
    const key = m.id + st + m.prog + S.res.spares + S.res.materials;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = '<div class="hd"><canvas width="88" height="88"></canvas><div><b>' + esc(M.name) + '</b><div class="st ' + m.status + '">' + st + '</div></div></div><p>' + esc(M.desc) + '</p>' + extra + '<div class="btns">' + btns.join('') + '</div>';
    R.drawIcon(box.querySelector('canvas'), m.type);
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'rs' || a === 'rm') { const r = E.repair(S, m.id, a === 'rs' ? 'spares' : 'materials'); if (r.ok) { SFX.build(); S.last = E.flows(S); } else { SFX.no(); toast(r.why, 'warn'); } }
      if (a === 'del') { E.demolish(S, m.id); V.sel = null; S.last = E.flows(S); SFX.click(); }
      if (a === 'close') V.sel = null;
      box.dataset.key = ''; save(); renderUI(true);
    }));
  }

  // ---------- Modals ----------
  function openModal(kind, html) {
    V.modal = kind;
    $('#modal').innerHTML = html;
    $('#overlay').classList.remove('hidden');
  }
  function closeModal() { V.modal = null; $('#overlay').classList.add('hidden'); }

  function openManifest() {
    if (!S.window || S.window.launched) return;
    const w = S.window, slots = E.slots(S), pads = E.countType(S, 'pad');
    const m = w.manifest;
    const used = E.manifestSize(m);
    let bar = '';
    for (const k of E.CARGO_ORDER) for (let i = 0; i < (m[k] || 0); i++) bar += '<i class="' + k + '"></i>';
    for (let i = used; i < slots; i++) bar += '<i></i>';
    const rows = E.CARGO_ORDER.map((k) => '<div class="cargo"><span class="dot" style="background:' + CARGO_COL[k] + '"></span><div><div class="nm">' + E.CARGO[k].name + '</div><div class="ds">' + E.CARGO[k].desc + '</div></div>' +
      '<div class="step"><button data-k="' + k + '" data-d="-1">\u2212</button><span id="q-' + k + '">' + (m[k] || 0) + '</span><button data-k="' + k + '" data-d="1">+</button></div></div>').join('');
    const f = S.last;
    openModal('manifest', '<h2>Starship Launch Window</h2><p class="sub">Earth and Mars line up every ~26 months (here: every ' + E.WINDOW_EVERY + ' sols). ' +
      pads + ' landing pad' + (pads === 1 ? '' : 's') + ' = ' + pads + ' Starship' + (pads === 1 ? '' : 's') + '. Ships land on Sol ' + (S.sol + E.TRANSIT) + '. Beds now: ' + f.housing + ', crew: ' + S.crew + '.</p>' +
      '<div class="ships" id="ship-row"></div>' +
      '<div class="cap"><span>Cargo slots (10 t each)</span><span><b class="mono">' + used + '</b> / ' + slots + '</span></div><div class="capbar">' + bar + '</div>' + rows +
      '<div class="row-btns"><button class="btn ghost" id="m-auto">Auto-pack</button><button class="btn ghost" id="m-later">Decide later (closes Sol ' + w.closes + ')</button><button class="btn" id="m-launch">Launch!</button></div>');
    const row = $('#ship-row');
    for (let i = 0; i < Math.max(1, pads); i++) {
      const c = document.createElement('canvas'); c.width = 72; c.height = 160; row.appendChild(c);
      const g = c.getContext('2d'); if (pads) R.drawStarship(g, 36, 152, 140, {}); else { g.fillStyle = '#5a3a3a'; g.font = '12px sans-serif'; g.fillText('no pad', 14, 80); }
    }
    $('#modal').querySelectorAll('.step button').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k, d = +b.dataset.d;
      const nm = Object.assign({}, S.window.manifest);
      nm[k] = Math.max(0, (nm[k] || 0) + d);
      const r = E.setManifest(S, nm);
      if (!r.ok) { SFX.no(); toast(r.why, 'warn'); return; }
      SFX.click(); openManifest();
    }));
    $('#m-auto').onclick = () => { E.setManifest(S, E.autoManifest(S)); SFX.click(); openManifest(); };
    $('#m-later').onclick = () => { closeModal(); renderUI(true); };
    $('#m-launch').onclick = () => { E.launch(S); SFX.land(); closeModal(); toast('Starship away! Arrives Sol ' + (S.sol + E.TRANSIT) + '.', 'good'); save(); renderUI(true); };
  }

  function openChoice() {
    const p = S.pending; if (!p) return;
    if (V.modal === 'choice') return;
    openModal('choice', '<h2>' + esc(p.title) + '</h2><p class="sub">' + esc(p.text) + '</p><div class="choice">' +
      p.options.map((o, i) => '<button data-i="' + i + '"><b>' + esc(o.label) + '</b><span>' + esc(o.hint) + '</span></button>').join('') + '</div>');
    $('#modal').querySelectorAll('.choice button').forEach((b) => b.addEventListener('click', () => { E.choose(S, +b.dataset.i); S.last = E.flows(S); SFX.click(); closeModal(); save(); renderUI(true); }));
  }

  function openHelp() {
    openModal('help', '<h2>How to Play</h2><div class="help">' +
      '<p>You run a tiny base on Mars. Grow it to <b>' + E.GOAL + ' colonists</b> using Starship resupply runs. If everyone is lost, or morale collapses for good, the mission ends.</p>' +
      '<h4>Keep people alive</h4><ul><li><b>O\u2082 Electrolyzers</b> turn water into air. <b>Ice Drills</b> mine water (+50% on pale ice tiles). <b>Greenhouses</b> grow food.</li>' +
      '<li>Each colonist uses 1 O\u2082, 1 water and 1 food per sol. Watch the green/red <b>+/\u2212 per sol</b> numbers on the left.</li>' +
      '<li>Run out of air and people are lost fast. Water and food give a few sols of warning.</li></ul>' +
      '<h4>Power</h4><ul><li><b>Solar Arrays</b> charge your <b>Batteries</b>. Dust storms cut sunlight to 30% (global storms: 15%), so build extra batteries. Life support always gets power first.</li>' +
      '<li>At 12 colonists you unlock the <b>Fission Reactor</b>: steady power, storm or not.</li></ul>' +
      '<h4>Grow</h4><ul><li>Every ' + E.WINDOW_EVERY + ' sols a <b>launch window</b> opens. Pack each Starship with colonists and supplies (max 6 colonists per ship). More <b>Landing Pads</b> = more ships.</li>' +
      '<li>New colonists need <b>beds</b> (Hab Modules), jobs, air and food. Build ahead of arrivals.</li><li><b>Rec Domes</b> and a <b>Med Bay</b> keep morale up. Unhappy crews work slower.</li>' +
      '<li>Things break. Click a smoking module: repair instantly with a spare part, or patch it with materials.</li></ul>' +
      '<h4>Controls</h4><ul><li>Click a module card, then a tile. Hold <kbd>Shift</kbd> to place several. Right-click or <kbd>Esc</kbd> cancels.</li>' +
      '<li><kbd>Space</kbd> pause, <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> speed, <kbd>N</kbd> next sol, <kbd>A</kbd> autopilot, <kbd>?</kbd> help, <kbd>M</kbd> mute.</li>' +
      '<li>Build hotkeys: ' + E.BUILD_ORDER.map((t) => '<kbd>' + E.MODULES[t].key + '</kbd> ' + E.MODULES[t].name).join(', ') + '.</li></ul>' +
      '<h4>Medals</h4><p>Reach ' + E.GOAL + ' colonists by Sol 200 for Gold, Sol 260 for Silver, any time for Bronze. Autopilot wins are marked as assisted.</p>' +
      '</div><div class="row-btns"><button class="btn" id="h-close">Got it</button></div>');
    $('#h-close').onclick = () => { closeModal(); };
  }

  function openMenu() {
    openModal('menu', '<h2>Paused</h2><p class="sub">Sol ' + S.sol + ' \u00b7 ' + S.crew + ' colonists \u00b7 ' + E.DIFFS[S.diff].label + '. Your colony autosaves every sol.</p>' +
      '<div class="row-btns" style="justify-content:flex-start"><button class="btn" id="mn-resume">Resume</button><button class="btn ghost" id="mn-help">How to play</button><button class="btn ghost" id="mn-title">Title screen</button><button class="btn ghost" id="mn-new">Abandon &amp; restart</button></div>');
    $('#mn-resume').onclick = closeModal;
    $('#mn-help').onclick = openHelp;
    $('#mn-title').onclick = () => { save(); showTitle(); };
    $('#mn-new').onclick = () => { const d = S.diff; clearSave(); startGame({ difficulty: d }); };
  }

  function openEnd() {
    if (!S.over) return;
    const win = S.over.win, md = E.medal(S);
    const st = S.stats;
    openModal('end', '<div class="end-hero"><div class="medal ' + (win ? md : 'lost') + '">' + (win ? md.toUpperCase() : 'LOST') + '</div>' +
      '<h2>' + (win ? 'Mission Success!' : 'Mission Failed') + '</h2><p class="sub">' + esc(S.over.reason) + (win && S.autopilotUsed ? ' (autopilot assisted)' : '') + '</p></div>' +
      '<div class="stats"><div><b>' + S.sol + '</b><span>Sols</span></div><div><b>' + st.peak + '</b><span>Peak crew</span></div><div><b>' + st.landed + '</b><span>Starships landed</span></div>' +
      '<div><b>' + st.built + '</b><span>Modules built</span></div><div><b>' + st.storms + '</b><span>Storms survived</span></div><div><b>' + st.deaths + '</b><span>Crew lost</span></div></div>' +
      '<p class="sub" style="text-align:center;margin-top:12px">Score <b class="mono" style="color:var(--sand)">' + E.score(S).toLocaleString() + '</b> \u00b7 ' + E.DIFFS[S.diff].label + '</p>' +
      '<div class="row-btns" style="justify-content:center"><button class="btn ghost" id="e-title">Title screen</button><button class="btn" id="e-again">New colony</button></div>');
    clearSave();
    $('#e-again').onclick = () => startGame({ difficulty: S.diff });
    $('#e-title').onclick = showTitle;
  }

  // ---------- Canvas drawing ----------
  function resize() {
    const cv = $('#map'), r = cv.getBoundingClientRect();
    V.dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * V.dpr); cv.height = Math.round(r.height * V.dpr);
    V.L = R.layout(Math.round(r.width), Math.round(r.height));
    const tl = $('#tl'), tr = tl.getBoundingClientRect();
    tl.width = Math.round(tr.width * V.dpr); tl.height = Math.round(tr.height * V.dpr);
  }

  function modulePoints() { return S.mods.filter((m) => m.status === 'active').map((m) => R.center(V.L, m.x, m.y)); }

  function updateWalkers(dt) {
    const L = V.L, want = Math.min(S.crew, 16);
    const pts = modulePoints();
    if (!pts.length) return;
    while (V.walkers.length < want) {
      const a = pts[Math.floor(Math.random() * pts.length)];
      V.walkers.push({ x: a.cx, y: a.cy + L.t * 0.3, tx: a.cx, ty: a.cy, wait: Math.random() * 2000, ph: Math.random() * 6 });
    }
    V.walkers.length = Math.min(V.walkers.length, want);
    const sp = L.t * 0.0009 * (V.speed >= 2 ? 1.6 : 1);
    for (const w of V.walkers) {
      if (w.wait > 0) { w.wait -= dt; continue; }
      const dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy);
      if (d < 2) { const b = pts[Math.floor(Math.random() * pts.length)]; w.tx = b.cx + (Math.random() - 0.5) * L.t * 0.4; w.ty = b.cy + L.t * (0.3 + Math.random() * 0.15); w.wait = 500 + Math.random() * 2500; continue; }
      w.x += dx / d * sp * dt; w.y += dy / d * sp * dt; w.ph += dt * 0.012;
    }
    const wantR = 1 + Math.floor(S.crew / 18);
    while (V.rovers.length < wantR) V.rovers.push({ x: L.ox + Math.random() * L.gw, y: L.oy + Math.random() * L.gh, tx: 0, ty: 0, t: 0 });
    V.rovers.length = wantR;
    for (const r of V.rovers) {
      if (r.t <= 0 || Math.hypot(r.tx - r.x, r.ty - r.y) < 3) { r.tx = L.ox + Math.random() * L.gw; r.ty = L.oy + (0.3 + Math.random() * 0.7) * L.gh; r.t = 9000; }
      const dx = r.tx - r.x, dy = r.ty - r.y, d = Math.hypot(dx, dy) || 1;
      r.x += dx / d * sp * 1.6 * dt; r.y += dy / d * sp * 1.6 * dt; r.t -= dt; r.dir = dx >= 0 ? 1 : -1;
    }
  }

  function draw(now) {
    const cv = $('#map'), g = cv.getContext('2d'), L = V.L;
    if (!L || !S) return;
    g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    const phase = V.speed >= 3 && !V.demo ? 0.5 : V.phase;
    const dl = R.daylight(phase), night = 1 - dl;
    const stormK = S.storm && S.storm.active ? (S.storm.global ? 1 : 0.7) : 0;
    R.drawSky(g, S, L, phase, now, stormK);
    g.drawImage(R.terrain(S, L), 0, L.sky, L.w, L.h - L.sky);
    if (night > 0.02) { g.fillStyle = 'rgba(14,10,38,' + (night * 0.42).toFixed(3) + ')'; g.fillRect(0, L.sky, L.w, L.h - L.sky); }
    // build-mode overlay
    if (V.buildType) {
      for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) {
        const ok = E.canBuild(S, V.buildType, x, y).ok;
        if (!ok) continue;
        const tl = E.tileAt(S, x, y);
        g.fillStyle = V.buildType === 'drill' && tl.t === 'ice' ? 'rgba(120,200,255,0.22)' : 'rgba(123,224,138,0.10)';
        g.fillRect(L.ox + x * L.t + 2, L.oy + y * L.t + 2, L.t - 4, L.t - 4);
      }
    }
    // foundations + walkways
    g.fillStyle = 'rgba(235,180,130,0.16)';
    const occ = new Set(S.mods.map((m) => m.x + ',' + m.y));
    for (const m of S.mods) {
      const X = L.ox + m.x * L.t, Y = L.oy + m.y * L.t, k = L.t * 0.08;
      g.beginPath(); g.roundRect ? g.roundRect(X + k, Y + k, L.t - 2 * k, L.t - 2 * k, L.t * 0.18) : g.rect(X + k, Y + k, L.t - 2 * k, L.t - 2 * k); g.fill();
      if (occ.has((m.x + 1) + ',' + m.y)) g.fillRect(X + L.t - k, Y + L.t * 0.4, 2 * k, L.t * 0.2);
      if (occ.has(m.x + ',' + (m.y + 1))) g.fillRect(X + L.t * 0.4, Y + L.t - k, L.t * 0.2, 2 * k);
    }
    // draw list sorted by y
    const list = [];
    const flick = (m) => m.status === 'broken';
    for (const m of S.mods) list.push({ y: m.y + 0.01, m });
    for (const w of V.walkers) list.push({ y: (w.y - L.oy) / L.t - 0.45, w });
    for (const r of V.rovers) list.push({ y: (r.y - L.oy) / L.t - 0.45, r });
    list.sort((a, b) => a.y - b.y);
    const charge = S.last ? S.res.power / Math.max(1, S.last.storage) : 0.5;
    for (const it of list) {
      if (it.w) { if (night < 0.85) R.drawAstronaut(g, it.w.x, it.w.y, L.t, it.w.ph); continue; }
      if (it.r) { R.drawRover(g, it.r.x, it.r.y, L.t, it.r.dir || 1); continue; }
      const m = it.m, c = R.center(L, m.x, m.y);
      const o = { time: now, night, day: dl, active: m.status === 'active', charge, dust: stormK, blight: S.fx.blight > 0 };
      if (m.status === 'building') {
        g.save(); g.globalAlpha = m.repairing ? 0.8 : 0.4; R.drawModule(g, m.type, c.cx, c.cy, L.t * 1.1, o); g.restore();
        g.strokeStyle = 'rgba(255,200,80,0.8)'; g.lineWidth = 1.5;
        const x0 = c.cx - L.t * 0.4, y0 = c.cy - L.t * 0.4, s = L.t * 0.8;
        g.setLineDash([4, 3]); g.strokeRect(x0, y0, s, s); g.setLineDash([]);
        g.beginPath(); g.moveTo(x0, y0 + s); g.lineTo(x0 + s, y0); g.moveTo(x0, y0); g.lineTo(x0 + s, y0 + s); g.strokeStyle = 'rgba(255,200,80,0.25)'; g.stroke();
        const p = (m.prog + V.phase) / m.need;
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x0, y0 + s + 2, s, 4); g.fillStyle = '#ffd23f'; g.fillRect(x0, y0 + s + 2, s * Math.min(1, p), 4);
      } else {
        R.drawModule(g, m.type, c.cx, c.cy, L.t * 1.1, o);
        if (m.type === 'pad' && S.parked[m.id] > S.sol && !V.fx.some((f) => f.type === 'land' && f.id === m.id)) R.drawStarship(g, c.cx, c.cy + L.t * 0.1, L.t * 1.55, { night: night > 0.5 });
        if (flick(m)) {
          g.fillStyle = 'rgba(30,10,10,0.35)'; g.beginPath(); g.ellipse(c.cx, c.cy, L.t * 0.45, L.t * 0.4, 0, 0, Math.PI * 2); g.fill();
          for (let i = 0; i < 4; i++) { const p = ((now * 0.0005 + i / 4) % 1); g.fillStyle = 'rgba(55,48,48,' + (0.75 * (1 - p)).toFixed(2) + ')'; g.beginPath(); g.arc(c.cx + Math.sin(p * 5 + i) * 6, c.cy - L.t * 0.2 - p * L.t * 0.8, L.t * (0.06 + p * 0.14), 0, Math.PI * 2); g.fill(); }
          if (Math.sin(now * 0.008) > -0.3) { const x = c.cx + L.t * 0.3, y = c.cy - L.t * 0.36, k = L.t * 0.2; g.fillStyle = '#ff4d3d'; g.beginPath(); g.moveTo(x, y - k); g.lineTo(x + k, y + k * 0.8); g.lineTo(x - k, y + k * 0.8); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.fillRect(x - 1, y - k * 0.35, 2, k * 0.6); g.fillRect(x - 1, y + k * 0.4, 2, 2); }
        }
      }
    }
    // effects
    V.fx = V.fx.filter((f) => f.fixedP != null || now < f.t0 + f.dur + 50);
    for (const f of V.fx) {
      const p = f.fixedP != null ? f.fixedP : (now - f.t0) / f.dur; if (p < 0) continue;
      const c = R.center(L, f.x, f.y);
      if (f.type === 'land') {
        const by = c.cy + L.t * 0.1, h = L.t * 1.55;
        const ease = 1 - Math.pow(1 - Math.min(1, p / 0.85), 3);
        const y = lerp(-h * 0.2, by, ease);
        const alt = by - y, k = Math.max(0, Math.min(1, 1 - alt / (h * 1.6))) * (p > 0.92 ? Math.max(0, 1 - (p - 0.92) / 0.08) : 1);
        if (k > 0.02) {
          for (let i = 0; i < 14; i++) {
            const a = i / 14 * Math.PI * 2 + now * 0.0004, rr = L.t * (0.35 + 0.5 * k) * (0.8 + 0.4 * R.h2(i, 1, 9));
            g.fillStyle = 'rgba(215,150,105,' + (0.5 * k).toFixed(2) + ')';
            g.beginPath(); g.arc(c.cx + Math.cos(a) * rr, by + Math.sin(a) * rr * 0.32, L.t * (0.12 + 0.2 * k), 0, Math.PI * 2); g.fill();
          }
        }
        R.drawStarship(g, c.cx, y, h, { flame: p < 0.9 ? 1 : 0, night: night > 0.5 });
      } else if (f.type === 'meteor') {
        if (p < 0.45) { const q = p / 0.45, sx = c.cx + L.t * 6, sy = -20, x = lerp(sx, c.cx, q), y = lerp(sy, c.cy, q); const gr = g.createLinearGradient(x, y, x + L.t * 1.6, y - L.t * 1.2); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); g.strokeStyle = gr; g.lineWidth = 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + L.t * 1.6, y - L.t * 1.2); g.stroke(); }
        else { const q = (p - 0.45) / 0.55; R.glow(g, c.cx, c.cy, L.t * (0.5 + q * 1.2), 'rgba(255,170,80,A)', 0.9 * (1 - q)); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.fillStyle = 'rgba(120,60,30,' + (1 - q).toFixed(2) + ')'; g.fillRect(c.cx + Math.cos(a) * L.t * q, c.cy + Math.sin(a) * L.t * q * 0.7 - L.t * 0.4 * Math.sin(q * Math.PI), 3, 3); } }
      } else if (f.type === 'spark') {
        g.strokeStyle = 'rgba(123,224,138,' + (1 - p).toFixed(2) + ')'; g.lineWidth = 2; g.beginPath(); g.ellipse(c.cx, c.cy + L.t * 0.2, L.t * (0.3 + p * 0.4), L.t * (0.12 + p * 0.15), 0, 0, Math.PI * 2); g.stroke();
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + p; g.fillStyle = 'rgba(255,240,150,' + (1 - p).toFixed(2) + ')'; g.fillRect(c.cx + Math.cos(a) * L.t * 0.5 * p, c.cy - L.t * 0.2 - p * L.t * 0.4 + Math.sin(a) * 4, 3, 3); }
      } else if (f.type === 'zap') {
        R.glow(g, c.cx, c.cy - L.t * 0.2, L.t * 0.6, 'rgba(255,90,60,A)', 0.8 * (1 - p));
      }
    }
    // storm haze
    if (stormK > 0) {
      const hz = g.createLinearGradient(0, 0, 0, L.h);
      hz.addColorStop(0, 'rgba(150,70,30,' + (0.62 * stormK).toFixed(3) + ')'); hz.addColorStop(0.35, 'rgba(170,85,40,' + (0.42 * stormK).toFixed(3) + ')'); hz.addColorStop(1, 'rgba(170,85,40,' + (0.3 * stormK).toFixed(3) + ')');
      g.fillStyle = hz; g.fillRect(0, 0, L.w, L.h);
      for (let i = 0; i < 6; i++) { const x = ((R.h2(i, 5, 2) * L.w + now * 0.05 * (1 + i % 3)) % (L.w + 400)) - 200, y = L.sky + R.h2(i, 6, 2) * (L.h - L.sky); R.glow(g, x, y, L.t * 3, 'rgba(190,105,55,A)', 0.35 * stormK); }
      g.strokeStyle = 'rgba(240,175,125,' + (0.35 * stormK).toFixed(3) + ')'; g.lineWidth = 1.2;
      for (let i = 0; i < 110; i++) {
        const x = ((R.h2(i, 1, 2) * L.w + now * (0.25 + R.h2(i, 2, 2) * 0.35)) % (L.w + 60)) - 30, y = R.h2(i, 3, 2) * L.h;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 18 + R.h2(i, 4, 2) * 30, y + 2); g.stroke();
      }
    } else if (S.storm && !S.storm.active) {
      const gr = g.createLinearGradient(L.w * 0.6, 0, L.w, 0); gr.addColorStop(0, 'rgba(170,85,40,0)'); gr.addColorStop(1, 'rgba(170,85,40,0.35)');
      g.fillStyle = gr; g.fillRect(0, 0, L.w, L.sky);
    }
    // night lights pass
    if (night > 0.05) {
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const m of S.mods) {
        if (m.status !== 'active') continue;
        const c = R.center(L, m.x, m.y);
        const col = { hab: 'rgba(255,200,120,A)', hub: 'rgba(255,200,120,A)', greenhouse: 'rgba(255,110,210,A)', foundry: 'rgba(255,130,40,A)', rec: 'rgba(170,120,255,A)', med: 'rgba(60,220,190,A)', reactor: 'rgba(80,220,210,A)', pad: 'rgba(255,90,60,A)' }[m.type];
        if (col) R.glow(g, c.cx, c.cy, L.t * 0.55, col, night * 0.28);
      }
      g.restore();
    }
    // hover + selection
    if (V.hover && !V.modal && V.screen === 'game') {
      const { x, y } = V.hover, X = L.ox + x * L.t, Y = L.oy + y * L.t;
      if (V.buildType) {
        const ok = E.canBuild(S, V.buildType, x, y).ok;
        g.save(); g.globalAlpha = 0.6; const c = R.center(L, x, y);
        R.drawModule(g, V.buildType, c.cx, c.cy, L.t, { time: now, night: 0, day: 1, active: true, charge: 1, dust: 0 }); g.restore();
        g.strokeStyle = ok ? '#7be08a' : '#ff5d5d'; g.lineWidth = 2; g.strokeRect(X + 1, Y + 1, L.t - 2, L.t - 2);
      } else { g.strokeStyle = 'rgba(255,230,200,0.5)'; g.lineWidth = 1.5; g.strokeRect(X + 1, Y + 1, L.t - 2, L.t - 2); }
    }
    if (V.sel) {
      const m = S.mods.find((q) => q.id === V.sel);
      if (m) { const c = R.center(L, m.x, m.y), k = 0.5 + 0.5 * Math.sin(now * 0.006); g.strokeStyle = 'rgba(255,122,61,' + (0.6 + 0.4 * k).toFixed(2) + ')'; g.lineWidth = 2.5; g.beginPath(); g.ellipse(c.cx, c.cy + L.t * 0.28, L.t * 0.5, L.t * 0.17, 0, 0, Math.PI * 2); g.stroke(); }
    }
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  function drawTimeline() {
    const cv = $('#tl'), g = cv.getContext('2d');
    const w = cv.width / V.dpr, h = cv.height / V.dpr;
    g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!S) return;
    const span = 130, x0 = 16, x1 = w - 16, start = S.sol - 4;
    const X = (sol) => x0 + (sol - start) / span * (x1 - x0);
    const ty = h * 0.56;
    g.fillStyle = '#2a1b20'; g.fillRect(x0, ty - 3, x1 - x0, 6);
    g.font = '10px ' + getComputedStyle(document.body).fontFamily; g.textAlign = 'center';
    for (let s = Math.ceil(start / 10) * 10; s < start + span; s += 10) { const x = X(s); g.fillStyle = '#4a3436'; g.fillRect(x, ty - 6, 1, 12); g.fillStyle = '#7d6660'; g.fillText(s, x, h - 3); }
    // windows
    const wins = [];
    if (S.window && !S.window.launched) wins.push([S.window.opens, S.window.closes, true]);
    for (let s = S.nextWindow; s < start + span; s += E.WINDOW_EVERY) wins.push([s, s + E.WINDOW_LEN, false]);
    for (const [a, b, open] of wins) { const xa = Math.max(x0, X(a)), xb = Math.min(x1, X(b)); if (xb <= x0) continue; g.fillStyle = open ? '#ff7a3d' : 'rgba(255,122,61,0.55)'; g.fillRect(xa, ty - 5, Math.max(3, xb - xa), 10); g.fillStyle = '#ffb48a'; g.textAlign = 'left'; g.fillText(open ? 'WINDOW OPEN' : 'launch window', xa + 2, ty - 10); g.textAlign = 'center'; }
    // storm
    if (S.storm) { const a = S.sol + (S.storm.active ? 0 : S.storm.warn), b = a + S.storm.sols; g.fillStyle = 'rgba(200,110,60,0.75)'; g.fillRect(X(a), ty + 5, Math.max(3, X(b) - X(a)), 6); g.fillStyle = '#e0a070'; g.textAlign = 'left'; g.fillText((S.storm.global ? 'GLOBAL ' : '') + 'dust storm', X(b) + 4, ty + 12); g.textAlign = 'center'; }
    // ships in transit
    for (const sh of S.ships) {
      const xa = X(sh.launch), xb = X(sh.arrive);
      g.strokeStyle = 'rgba(232,182,122,0.6)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(Math.max(x0, xa), ty); g.lineTo(xb, ty); g.stroke(); g.setLineDash([]);
      const px = X(S.sol + V.phase);
      const cx = Math.min(px, xb);
      g.save(); g.translate(cx, ty); g.rotate(Math.PI / 2); R.drawStarship(g, 0, 9, 22, {}); g.restore();
      g.fillStyle = '#e8b67a'; g.fillText('lands ' + sh.arrive + ' \u00b7 ' + (sh.cargo.colonist || 0) + ' crew', xb, ty - 10);
      g.fillStyle = '#e8b67a'; g.beginPath(); g.arc(xb, ty, 4, 0, Math.PI * 2); g.fill();
    }
    // now marker
    const nx = X(S.sol + V.phase);
    g.fillStyle = '#f6e7dc'; g.fillRect(nx - 1, ty - 14, 2, 28);
    g.textAlign = 'left'; g.fillStyle = '#b39a8c'; g.fillText('TIMELINE', 6, 12);
  }

  // ---------- Main loop ----------
  function frame(now) {
    const dt = Math.min(100, now - (V.lastFrame || now));
    V.lastFrame = now;
    V.frames++;
    if (S) {
      const running = !V.freeze && ((V.screen === 'game' && !V.modal && !S.over && V.speed > 0) || (V.demo && V.screen === 'title'));
      if (running) {
        const ms = MS_PER_SOL[V.demo ? 2 : V.speed];
        V.acc += dt;
        if (V.acc >= ms) { V.acc -= ms; if (V.acc > ms) V.acc = 0; doTick(); }
        V.phase = (0.42 + V.acc / ms) % 1;
        if (V.phase < 0.42) V.phase += 0; // keep continuous
      }
      updateWalkers(dt);
      draw(now);
      drawTimeline();
      $('#dayfill').style.width = (V.acc / (MS_PER_SOL[V.speed] || 1) * 100).toFixed(1) + '%';
    }
    requestAnimationFrame(frame);
  }

  // ---------- Input ----------
  function onMove(e) {
    if (!V.L || !S) return;
    const r = $('#map').getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    V.hover = R.tileFromPx(V.L, px, py);
    const tip = $('#hover-tip');
    if (!V.hover || V.screen !== 'game') { tip.classList.add('hidden'); return; }
    const { x, y } = V.hover;
    const m = E.modAt(S, x, y), tl = E.tileAt(S, x, y);
    let html = '';
    if (V.buildType) {
      const c = E.canBuild(S, V.buildType, x, y);
      html = '<b>' + esc(E.MODULES[V.buildType].name) + '</b><br>' + (c.ok ? '<span class="ok">Click to build</span>' + (V.buildType === 'drill' && tl.t === 'ice' ? ' \u00b7 ice bonus +50%' : '') : '<span class="no">' + esc(c.why) + '</span>');
    } else if (m) {
      const M = E.MODULES[m.type];
      html = '<b>' + esc(M.name) + '</b> \u00b7 ' + (m.status === 'building' ? (m.repairing ? 'repairing' : 'building') + ' ' + m.prog + '/' + m.need : m.status) + '<br>' + esc(M.desc) + (m.status === 'broken' ? '<br><span class="no">Broken \u2014 click to repair</span>' : '');
    } else {
      html = { ground: 'Open regolith \u2014 buildable', rock: 'Boulder field \u2014 not buildable', crater: 'Crater \u2014 not buildable', ice: '<b style="color:#9fd3ff">Ice deposit</b> \u2014 Ice Drills get +50% here' }[tl.t];
    }
    tip.innerHTML = html; tip.classList.remove('hidden');
    tip.style.left = Math.min(px + 16, r.width - 250) + 'px'; tip.style.top = Math.min(py + 16, r.height - 70) + 'px';
  }

  function clickTile(x, y, keep) {
    if (!S || V.screen !== 'game' || V.modal) return { ok: false, why: 'not in game' };
    if (V.buildType) {
      const r = E.build(S, V.buildType, x, y);
      if (r.ok) {
        SFX.build(); S.last = E.flows(S);
        if (!keep || !E.canBuild(S, V.buildType).ok) V.buildType = null;
        save(); renderUI(true);
      } else { SFX.no(); toast(r.why, 'warn'); }
      return r;
    }
    const m = E.modAt(S, x, y);
    V.sel = m ? m.id : null;
    if (m) SFX.click();
    $('#inspector').dataset.key = '';
    renderUI(true);
    return { ok: !!m };
  }

  function setSpeed(n) { V.speed = n; renderUI(true); }

  function bind() {
    const cv = $('#map');
    cv.addEventListener('mousemove', onMove);
    cv.addEventListener('mouseleave', () => { V.hover = null; $('#hover-tip').classList.add('hidden'); });
    cv.addEventListener('click', (e) => { onMove(e); if (V.hover) clickTile(V.hover.x, V.hover.y, e.shiftKey); });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); if (V.buildType) cancelBuild(); else { V.sel = null; renderUI(true); } });
    const sp = document.querySelectorAll('.speed button[data-speed]');
    sp[0].innerHTML = ICON.pause; sp[1].innerHTML = ICON.p1; sp[2].innerHTML = ICON.p2; sp[3].innerHTML = ICON.p3;
    sp.forEach((b) => b.addEventListener('click', () => { SFX.click(); setSpeed(+b.dataset.speed); }));
    $('#btn-step').onclick = () => { if (V.screen === 'game' && !V.modal) { V.speed = 0; doTick(); renderUI(true); } };
    $('#btn-auto').onclick = () => { V.autopilot = !V.autopilot; if (V.autopilot) toast('Autopilot on: Mission Control will build, repair and pack Starships. (Your win will be marked assisted.)', 'good'); renderUI(true); };
    $('#btn-help').onclick = openHelp;
    $('#btn-mute').onclick = () => { V.muted = !V.muted; renderUI(true); };
    $('#btn-menu').onclick = () => { if (V.screen === 'game') openMenu(); };
    $('#window-chip').onclick = () => { if (S && S.window && !S.window.launched && !V.demo) openManifest(); };
    $('#buildbar-cancel').onclick = cancelBuild;
    $('#btn-howto').onclick = openHelp;
    $('#btn-continue').onclick = continueGame;
    const dc = $('#diff-cards');
    dc.innerHTML = Object.keys(E.DIFFS).map((k) => '<button class="diff' + (k === 'commander' ? ' rec' : '') + '" data-d="' + k + '"><b>' + E.DIFFS[k].label + '</b><span>' + E.DIFFS[k].blurb + '</span><i>' + (k === 'cadet' ? 'GREAT FOR VIC & CHAR' : k === 'commander' ? 'RECOMMENDED' : 'FOR VETERANS') + ' \u2192</i></button>').join('');
    dc.querySelectorAll('.diff').forEach((b) => b.addEventListener('click', () => { clearSave(); startGame({ difficulty: b.dataset.d }); }));
    window.addEventListener('resize', () => { resize(); });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key;
      if (k === 'Escape') { if (V.modal && V.modal !== 'end' && V.modal !== 'choice') { if (V.modal === 'manifest') closeModal(); else closeModal(); } else if (V.buildType) cancelBuild(); else if (V.sel) { V.sel = null; renderUI(true); } return; }
      if (V.screen !== 'game' || V.modal) return;
      if (k === ' ') { e.preventDefault(); setSpeed(V.speed === 0 ? (V.lastSpeed || 1) : (V.lastSpeed = V.speed, 0)); return; }
      if (k === '1' || k === '2' || k === '3') { setSpeed(+k); return; }
      if (k === 'n' || k === 'N') { V.speed = 0; doTick(); renderUI(true); return; }
      if (k === 'a' || k === 'A') { $('#btn-auto').click(); return; }
      if (k === '?' || k === '/') { openHelp(); return; }
      if (k === 'm' || k === 'M') { V.muted = !V.muted; renderUI(true); return; }
      const t = E.BUILD_ORDER.find((q) => E.MODULES[q].key === k.toUpperCase());
      if (t) selectBuild(t);
    });
  }

  // ---------- Boot ----------
  function boot() {
    R.drawIcon($('#logo'), 'hub');
    const tlc = $('#title-logo'), g = tlc.getContext('2d');
    const gr = g.createRadialGradient(46, 44, 8, 60, 60, 58); gr.addColorStop(0, '#f0a066'); gr.addColorStop(0.6, '#c4572a'); gr.addColorStop(1, '#6e2412');
    g.fillStyle = gr; g.beginPath(); g.arc(60, 60, 54, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(90,30,15,0.5)'; [[40, 46, 9], [74, 72, 12], [66, 36, 5], [44, 80, 6]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); });
    g.fillStyle = 'rgba(255,255,255,0.65)'; g.beginPath(); g.ellipse(60, 12, 16, 5, 0, 0, Math.PI * 2); g.fill();
    R.drawStarship(g, 92, 104, 64, {});
    bind();
    resize();
    showTitle();
    requestAnimationFrame(frame);
  }

  // ---------- Test API ----------
  window.__MC__ = {
    E, R,
    get S() { return S; },
    getState() {
      return { screen: V.screen, modal: V.modal, demo: V.demo, sol: S && S.sol, crew: S && S.crew, over: S && S.over, diff: S && S.diff,
        res: S && Object.assign({}, S.res), window: S && S.window, ships: S && S.ships.length, morale: S && S.morale,
        storm: S && S.storm, mods: S && S.mods.length, pending: S && S.pending && S.pending.id, speed: V.speed, autopilot: V.autopilot, buildType: V.buildType, sel: V.sel };
    },
    newGame(opts) { startGame(opts); V.speed = 0; renderUI(true); return this.getState(); },
    step(n, autoChoose) {
      const all = [];
      for (let i = 0; i < (n || 1); i++) {
        if (S.pending) { if (!autoChoose) break; E.choose(S, S.pending.ai || 0); closeModal(); }
        all.push(...doTick()); if (S.over) break;
      }
      renderUI(true); return all.map((e) => e.type);
    },
    setSpeed, selectBuild, cancelBuild, clickTile,
    tileCenterClient(x, y) { const r = $('#map').getBoundingClientRect(); const c = R.center(V.L, x, y); return { x: r.left + c.cx, y: r.top + c.cy }; },
    findSpot(t) { return E.findSpot(S, t); },
    openManifest, launch() { const r = E.launch(S); closeModal(); renderUI(true); return r; },
    setManifest(m) { const r = E.setManifest(S, m); if (V.modal === 'manifest') openManifest(); return r; },
    choose(i) { const r = E.choose(S, i); closeModal(); renderUI(true); return r; },
    autopilot(on) { V.autopilot = !!on; renderUI(true); },
    runAutopilot(maxSols) { V.autopilot = true; for (let i = 0; i < (maxSols || 1000) && !S.over; i++) { E.autopilot(S); E.tick(S); } S.autopilotUsed = true; S.last = E.flows(S); renderUI(true); if (S.over) { handleEvents([{ type: S.over.win ? 'win' : 'lose' }]); } return this.getState(); },
    forceEvent(id) { const ev = E.forceEvent(S, id); handleEvents(ev); renderUI(true); return ev.map((e) => e.type); },
    setRes(o) { Object.assign(S.res, o); S.last = E.flows(S); renderUI(true); },
    sabotage(types) { for (const m of S.mods) if (types.includes(m.type)) m.status = 'broken'; S.last = E.flows(S); renderUI(true); },
    select(id) { V.sel = id; renderUI(true); },
    openHelp, openEnd, closeModal, showTitle, continueGame, save, loadSave,
    setPhase(p) { V.phase = p; },
    freeze(on) { V.freeze = !!on; },
    resetWalkers() { V.walkers = []; V.rovers = []; },
    addFx(type, o) { addFx(type, o); },
    clearFx() { V.fx = []; },
    clearToasts() { $('#toasts').innerHTML = ''; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
