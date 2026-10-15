/* Mars Colony Sim — game engine.
 * Pure + deterministic (seeded RNG stored in state), no DOM. Shared by the browser UI
 * and the Node balance playtest (tests/balance.mjs). All numbers are game numbers. */
(function (root) {
  'use strict';

  const W = 16, H = 11, HUB = { x: 7, y: 5 };
  const GOAL = 50;
  const WINDOW_EVERY = 52;   // "every ~26 months", compressed to 52 sols
  const FIRST_WINDOW = 20;
  const WINDOW_LEN = 6;      // sols the launch window stays open
  const TRANSIT = 16;        // sols from launch to landing (compressed)
  const BASE_STORAGE = 20;
  const BASE_TANKS = 150;    // O2 / water / food storage before Hab tanks
  const LIFE = { hub: 1, hab: 1, electrolyzer: 1, drill: 1, greenhouse: 1, med: 1 }; // power priority tier

  const DIFFS = {
    cadet: {
      label: 'Cadet', blurb: 'Gentler events and roomier Starships. A great first colony.',
      start: { o2: 100, water: 120, food: 120, power: 40, materials: 120, spares: 4 },
      eventRate: 0.6, consume: 0.85, shipCap: 120, landRisk: 0, stormLen: 0.7, crew: 6,
    },
    commander: {
      label: 'Commander', blurb: 'The intended challenge. Plan ahead for dust storms.',
      start: { o2: 70, water: 90, food: 90, power: 30, materials: 80, spares: 3 },
      eventRate: 1.5, consume: 1, shipCap: 100, landRisk: 0.04, stormLen: 1, crew: 6,
    },
    hardcore: {
      label: 'Hardcore', blurb: 'Lean supplies, rough landings, long storms. Good luck.',
      start: { o2: 50, water: 60, food: 60, power: 20, materials: 60, spares: 2 },
      eventRate: 1.8, consume: 1.15, shipCap: 80, landRisk: 0.1, stormLen: 1.3, crew: 6,
    },
  };

  // power: draw per sol (kWh-ish game units). solar/gen: generation per sol.
  const MODULES = {
    hub: { name: 'Command Hub', cost: {}, sols: 0, power: 1, housing: 2, storage: BASE_STORAGE, rec: 4, hidden: true,
      desc: 'Mission control, galley and the first beds. Cannot be moved.' },
    hab: { name: 'Hab Module', key: 'H', cost: { materials: 35 }, sols: 3, power: 1, housing: 4, tanks: 30,
      desc: 'Pressurized quarters: beds for 4, +30 O\u2082/water/food tank space.' },
    solar: { name: 'Solar Array', key: 'S', cost: { materials: 15 }, sols: 2, solar: 8,
      desc: 'Makes 8 power/sol in clear skies. Dust storms cut it hard.' },
    battery: { name: 'Battery Bank', key: 'B', cost: { materials: 20 }, sols: 2, storage: 40,
      desc: 'Stores 40 power. Carries you through storms.' },
    electrolyzer: { name: 'O\u2082 Electrolyzer', key: 'O', cost: { materials: 25 }, sols: 3, power: 3, workers: 1,
      input: { water: 3 }, output: { o2: 6 }, desc: 'Splits water into breathable oxygen: 3 water \u2192 6 O\u2082/sol.' },
    drill: { name: 'Ice Drill', key: 'W', cost: { materials: 25 }, sols: 3, power: 4, workers: 1,
      output: { water: 10 }, desc: 'Mines subsurface ice: 10 water/sol, +50% on an ice deposit.' },
    greenhouse: { name: 'Greenhouse', key: 'G', cost: { materials: 30 }, sols: 4, power: 3, workers: 1,
      input: { water: 2 }, output: { food: 5 }, desc: 'Grows potatoes and greens: 2 water \u2192 5 food/sol.' },
    foundry: { name: 'Regolith Foundry', key: 'F', cost: { materials: 35 }, sols: 4, power: 4, workers: 1,
      output: { materials: 3 }, desc: 'Sinters Martian dirt into 3 building materials/sol.' },
    rec: { name: 'Rec Dome', key: 'R', cost: { materials: 30 }, sols: 3, power: 1, rec: 10,
      desc: 'Gym, movie night, and a view. Keeps 10 colonists happy.' },
    med: { name: 'Med Bay', key: 'D', cost: { materials: 40, spares: 1 }, sols: 4, power: 2, workers: 1, med: true,
      desc: 'Saves lives in a crisis, cures sickness faster, +morale.' },
    pad: { name: 'Landing Pad', key: 'L', cost: { materials: 90, spares: 1 }, sols: 5, pads: 1, max: 4,
      desc: 'Each pad lands one more Starship per launch window.' },
    reactor: { name: 'Fission Reactor', key: 'K', cost: { materials: 100, spares: 1 }, sols: 6, gen: 20, unlock: 12,
      desc: 'Steady 20 power/sol, storm or not. Unlocks at 12 colonists.' },
  };
  const BUILD_ORDER = ['hab', 'solar', 'battery', 'electrolyzer', 'drill', 'greenhouse', 'foundry', 'rec', 'med', 'pad', 'reactor'];

  const CARGO = {
    colonist: { name: 'Colonist', desc: '+1 crew (needs a bed). Max 6 per ship', give: { crew: 1 }, perShip: 6 },
    life: { name: 'Life Support Crate', desc: '+40 O\u2082, +40 water', give: { o2: 40, water: 40 } },
    food: { name: 'Food Pallet', desc: '+50 food', give: { food: 50 } },
    materials: { name: 'Building Materials', desc: '+30 materials', give: { materials: 30 } },
    spares: { name: 'Spare Parts', desc: '+2 spares (instant repairs)', give: { spares: 2 } },
  };
  const CARGO_ORDER = ['colonist', 'life', 'food', 'materials', 'spares'];
  const SLOT_T = 10; // every cargo slot is 10 t

  // ---------- RNG ----------
  function mulberry(a) {
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rnd(s) {
    s.rng = (s.rng + 0x6D2B79F5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const pick = (s, arr) => arr[Math.floor(rnd(s) * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Map ----------
  function genMap(seed) {
    const r = mulberry((seed * 2654435761) >>> 0);
    const tiles = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tiles.push({ t: 'ground', v: r() });
    const T = (x, y) => tiles[y * W + x];
    const nearHub = (x, y) => Math.abs(x - HUB.x) <= 2 && Math.abs(y - HUB.y) <= 2;
    // big crater (2x2) + small craters
    const craters = [];
    for (let i = 0; i < 40 && craters.length < 1; i++) {
      const x = Math.floor(r() * (W - 1)), y = Math.floor(r() * (H - 1));
      if ([[0, 0], [1, 0], [0, 1], [1, 1]].some(([dx, dy]) => nearHub(x + dx, y + dy))) continue;
      craters.push({ x, y, big: true });
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) T(x + dx, y + dy).t = 'crater';
      T(x, y).big = true;
    }
    let small = 0;
    for (let i = 0; i < 200 && small < 4; i++) {
      const x = Math.floor(r() * W), y = Math.floor(r() * H);
      if (nearHub(x, y) || T(x, y).t !== 'ground') continue;
      T(x, y).t = 'crater'; small++;
    }
    let rocks = 0;
    for (let i = 0; i < 300 && rocks < 10; i++) {
      const x = Math.floor(r() * W), y = Math.floor(r() * H);
      if (nearHub(x, y) || T(x, y).t !== 'ground') continue;
      T(x, y).t = 'rock'; rocks++;
    }
    // ice: one deposit touching the hub area + two clusters elsewhere
    const seedIce = [[HUB.x + 2, HUB.y + 1]];
    for (let i = 0; i < 2; i++) seedIce.push([2 + Math.floor(r() * (W - 4)), 1 + Math.floor(r() * (H - 2))]);
    for (const [cx, cy] of seedIce) {
      const cells = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]];
      let n = 0;
      for (const [dx, dy] of cells) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (T(x, y).t !== 'ground' || (x === HUB.x && y === HUB.y)) continue;
        if (n > 0 && r() < 0.35) continue;
        T(x, y).t = 'ice'; n++;
      }
    }
    return tiles;
  }

  // ---------- Setup ----------
  function newGame(opts) {
    opts = opts || {};
    const seed = (opts.seed == null ? Math.floor(Math.random() * 1e9) : opts.seed) >>> 0;
    const diff = DIFFS[opts.difficulty] ? opts.difficulty : 'commander';
    const d = DIFFS[diff];
    const s = {
      v: 1, seed, diff, sol: 1, rng: (seed ^ 0x9E3779B9) >>> 0,
      map: genMap(seed), mods: [], nextId: 1,
      res: Object.assign({}, d.start), crew: d.crew, sick: 0, sickSols: 0, morale: 72,
      storm: null, fx: { blight: 0, devil: 0, flare: 0 },
      short: { o2: 0, water: 0, food: 0 }, lowMorale: 0,
      ships: [], nextWindow: FIRST_WINDOW, window: null, parked: {},
      log: [], pending: null, over: null, autopilotUsed: false,
      stats: { peak: d.crew, deaths: 0, landed: 0, ships: 0, storms: 0, built: 0, events: 0, arrivals: 0, hardLandings: 0 },
      last: null,
    };
    addMod(s, 'hub', HUB.x, HUB.y, true);
    const starters = ['hab', 'solar', 'solar', 'solar', 'battery', 'electrolyzer', 'drill', 'greenhouse', 'foundry', 'pad'];
    for (const t of starters) {
      const spot = findSpot(s, t);
      if (spot) addMod(s, t, spot.x, spot.y, true);
    }
    s.last = flows(s);
    log(s, 'good', 'Touchdown! Six colonists step onto Mars. Keep them breathing, fed and happy.');
    log(s, 'info', 'First Starship launch window opens on Sol ' + FIRST_WINDOW + '.');
    return s;
  }

  function addMod(s, type, x, y, done) {
    const M = MODULES[type];
    const m = { id: s.nextId++, type, x, y, status: done ? 'active' : 'building', prog: 0, need: M.sols, repairing: false };
    s.mods.push(m);
    return m;
  }

  function log(s, kind, msg) {
    s.log.push({ sol: s.sol, kind, msg });
    if (s.log.length > 120) s.log.splice(0, s.log.length - 120);
  }

  // ---------- Queries ----------
  const tileAt = (s, x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? null : s.map[y * W + x];
  const modAt = (s, x, y) => s.mods.find((m) => m.x === x && m.y === y) || null;
  const countType = (s, t, any) => s.mods.filter((m) => m.type === t && (any || m.status === 'active')).length;
  const inTransitCrew = (s) => s.ships.reduce((n, sh) => n + (sh.cargo.colonist || 0), 0);
  const padsActive = (s) => countType(s, 'pad');
  const unlocked = (s, t) => !MODULES[t].unlock || s.stats.peak >= MODULES[t].unlock;

  function canAfford(s, cost) {
    for (const k in cost) if ((s.res[k] || 0) < cost[k]) return false;
    return true;
  }

  function canBuild(s, type, x, y) {
    const M = MODULES[type];
    if (!M || M.hidden) return { ok: false, why: 'Unknown module' };
    if (s.over) return { ok: false, why: 'Game over' };
    if (!unlocked(s, type)) return { ok: false, why: 'Unlocks at ' + M.unlock + ' colonists' };
    if (M.max && countType(s, type, true) >= M.max) return { ok: false, why: 'Max ' + M.max + ' ' + M.name + 's' };
    if (!canAfford(s, M.cost)) return { ok: false, why: 'Not enough ' + Object.keys(M.cost).filter((k) => s.res[k] < M.cost[k]).join(' & ') };
    if (x == null) return { ok: true };
    const t = tileAt(s, x, y);
    if (!t) return { ok: false, why: 'Off the map' };
    if (t.t === 'rock') return { ok: false, why: 'Boulder field \u2014 can\u2019t build here' };
    if (t.t === 'crater') return { ok: false, why: 'Crater \u2014 can\u2019t build here' };
    if (modAt(s, x, y)) return { ok: false, why: 'Tile occupied' };
    return { ok: true };
  }

  function build(s, type, x, y) {
    const c = canBuild(s, type, x, y);
    if (!c.ok) return c;
    const M = MODULES[type];
    for (const k in M.cost) s.res[k] -= M.cost[k];
    const m = addMod(s, type, x, y, false);
    log(s, 'info', 'Construction started: ' + M.name + ' (' + M.sols + ' sols).');
    return { ok: true, id: m.id };
  }

  function demolish(s, id) {
    const i = s.mods.findIndex((m) => m.id === id);
    if (i < 0) return { ok: false, why: 'No such module' };
    const m = s.mods[i];
    if (m.type === 'hub') return { ok: false, why: 'The Command Hub stays.' };
    const refund = Math.floor((MODULES[m.type].cost.materials || 0) * 0.5);
    s.res.materials += refund;
    s.mods.splice(i, 1);
    log(s, 'info', 'Recycled ' + MODULES[m.type].name + ' (+' + refund + ' materials).');
    return { ok: true, refund };
  }

  function repair(s, id, mode) {
    const m = s.mods.find((q) => q.id === id);
    if (!m || m.status !== 'broken') return { ok: false, why: 'Nothing to repair' };
    if (mode === 'spares') {
      if (s.res.spares < 1) return { ok: false, why: 'No spare parts' };
      s.res.spares -= 1; m.status = 'active';
      log(s, 'good', MODULES[m.type].name + ' repaired with spare parts.');
      return { ok: true };
    }
    if (s.res.materials < 15) return { ok: false, why: 'Need 15 materials' };
    s.res.materials -= 15; m.status = 'building'; m.repairing = true; m.prog = 0; m.need = 3;
    log(s, 'info', 'Crew patching the ' + MODULES[m.type].name + ' (3 sols).');
    return { ok: true };
  }

  function moraleFactor(m) { return m < 25 ? 0.75 : m < 50 ? 0.9 : m > 80 ? 1.1 : 1; }

  // Production/consumption model for the coming sol (no mutation).
  function flows(s) {
    const d = DIFFS[s.diff];
    let sun = s.storm && s.storm.active ? s.storm.sun : 1;
    if (s.fx.devil > 0) sun *= 1.25;
    const o = { sun, gen: 0, solarGen: 0, demand: 0, lifeDemand: 0, storage: 0, housing: 0, rec: 0, pads: 0, jobs: 0, med: 0,
      tanks: BASE_TANKS, n: {}, broken: 0, building: 0 };
    let drillOut = 0;
    for (const m of s.mods) {
      if (m.status === 'broken') o.broken++;
      if (m.status === 'building') o.building++;
      if (m.status !== 'active') continue;
      const M = MODULES[m.type];
      o.n[m.type] = (o.n[m.type] || 0) + 1;
      if (M.solar) { o.gen += M.solar * sun; o.solarGen += M.solar * sun; }
      if (M.gen) o.gen += M.gen;
      if (M.power) { o.demand += M.power; if (LIFE[m.type]) o.lifeDemand += M.power; }
      o.tanks += M.tanks || 0;
      o.storage += M.storage || 0;
      o.housing += M.housing || 0;
      o.rec += M.rec || 0;
      o.pads += M.pads || 0;
      o.jobs += M.workers || 0;
      if (M.med) o.med++;
      if (m.type === 'drill') { const t = tileAt(s, m.x, m.y); drillOut += MODULES.drill.output.water * (t && t.t === 'ice' ? 1.5 : 1); }
    }
    const avail = Math.max(0, s.crew - s.sick);
    o.staff = o.jobs ? Math.min(1, avail / o.jobs) : 1;
    // Power priority: life support (habs, O2, water, food, med) first, then industry.
    const avP = s.res.power + o.gen;
    o.effLife = o.lifeDemand <= 0 ? 1 : Math.min(1, avP / o.lifeDemand);
    const otherDemand = o.demand - o.lifeDemand;
    o.effOther = otherDemand <= 0 ? 1 : clamp((avP - o.lifeDemand) / otherDemand, 0, 1);
    o.eff = o.demand <= 0 ? 1 : Math.min(1, avP / o.demand);
    o.used = o.lifeDemand * o.effLife + otherDemand * o.effOther;
    o.mf = moraleFactor(s.morale);
    const work = o.staff * o.mf * (s.fx.flare ? 0 : 1);
    const base = o.effLife * work;
    o.base = base;
    const ne = o.n.electrolyzer || 0, ng = o.n.greenhouse || 0, nf = o.n.foundry || 0;
    const Mo = MODULES;
    o.prod = { water: drillOut * base, o2: Mo.electrolyzer.output.o2 * ne * base,
      food: Mo.greenhouse.output.food * ng * base * (s.fx.blight > 0 ? 0.5 : 1), materials: Mo.foundry.output.materials * nf * o.effOther * work };
    o.want = { water: (Mo.electrolyzer.input.water * ne + Mo.greenhouse.input.water * ng) * base };
    const c = d.consume;
    o.cons = { o2: s.crew * c, water: s.crew * c, food: s.crew * c };
    o.net = {
      o2: o.prod.o2 - o.cons.o2,
      water: o.prod.water - o.want.water - o.cons.water,
      food: o.prod.food - o.cons.food,
      materials: o.prod.materials,
      power: o.gen - o.demand,
    };
    return o;
  }

  function forecast(s) {
    const f = s.last || flows(s);
    const out = {};
    for (const k of ['o2', 'water', 'food']) {
      const net = f.net[k];
      out[k] = { net, sols: net < -0.01 ? Math.floor(s.res[k] / -net) : Infinity };
    }
    out.power = { net: f.net.power, sols: f.net.power < -0.01 ? Math.floor(s.res.power / -f.net.power) : Infinity };
    return out;
  }

  // ---------- Crew loss ----------
  function loseCrew(s, n, cause, ev) {
    n = Math.min(n, s.crew);
    if (n <= 0) return 0;
    let saved = 0;
    if (countType(s, 'med') > 0) for (let i = 0; i < n; i++) if (rnd(s) < 0.35) saved++;
    const lost = n - saved;
    if (saved) log(s, 'good', 'Med Bay saved ' + saved + ' colonist' + (saved > 1 ? 's' : '') + ' from ' + cause + '.');
    if (lost <= 0) return 0;
    s.crew -= lost; s.stats.deaths += lost;
    s.sick = Math.min(s.sick, s.crew);
    s.morale = clamp(s.morale - Math.min(25, 6 * lost), 0, 100);
    log(s, 'bad', lost + ' colonist' + (lost > 1 ? 's were' : ' was') + ' lost to ' + cause + '.');
    ev.push({ type: 'death', n: lost, cause });
    return lost;
  }

  // ---------- Events ----------
  function breakRandom(s, filter) {
    const pool = s.mods.filter((m) => m.status === 'active' && m.type !== 'hub' && (!filter || filter(m)));
    if (!pool.length) return null;
    const m = pick(s, pool);
    m.status = 'broken';
    return m;
  }

  const EVENTS = [
    { id: 'storm', w: 3, ok: (s) => !s.storm && s.sol >= 12, run(s, ev) {
      const d = DIFFS[s.diff];
      const global = s.sol > 90 && rnd(s) < 0.22;
      const dur = Math.max(3, Math.round((global ? 16 + rnd(s) * 12 : 5 + rnd(s) * 10) * d.stormLen));
      s.storm = { warn: 3, sols: dur, total: dur, sun: global ? 0.15 : 0.3, global, active: false };
      log(s, 'warn', (global ? 'GLOBAL dust storm' : 'Regional dust storm') + ' spotted by the weather orbiter \u2014 arrives in 3 sols, about ' + dur + ' sols long. Charge batteries!');
      ev.push({ type: 'storm-warn', global, dur });
    } },
    { id: 'meteor', w: 0.9, ok: (s) => s.sol > 15, run(s, ev) {
      const m = breakRandom(s);
      if (!m) return;
      log(s, 'bad', 'Meteorite strike! The ' + MODULES[m.type].name + ' is damaged and offline.');
      ev.push({ type: 'meteor', x: m.x, y: m.y, id: m.id });
    } },
    { id: 'failure', w: 2.2, ok: (s) => s.sol > 8, run(s, ev) {
      const m = breakRandom(s, (q) => MODULES[q.type].workers || q.type === 'solar' || q.type === 'battery' || q.type === 'hab');
      if (!m) return;
      const why = pick(s, ['a seized pump', 'a fried controller board', 'a cracked seal', 'dust in the bearings', 'a software glitch']);
      log(s, 'bad', 'Equipment failure: ' + why + ' took the ' + MODULES[m.type].name + ' offline.');
      ev.push({ type: 'failure', x: m.x, y: m.y, id: m.id });
    } },
    { id: 'flare', w: 0.7, ok: (s) => s.sol > 10, run(s, ev) {
      s.fx.flare = 1; s.morale = clamp(s.morale - 4, 0, 100);
      log(s, 'warn', 'Solar flare! Crew shelters in the Hub \u2014 no work next sol.');
      ev.push({ type: 'flare' });
    } },
    { id: 'ice', w: 1, ok: () => true, run(s, ev) {
      const n = Math.round(30 + rnd(s) * 30); s.res.water += n;
      log(s, 'good', 'Rover crew found a shallow ice lens: +' + n + ' water.'); ev.push({ type: 'good' });
    } },
    { id: 'find', w: 1, ok: () => true, run(s, ev) {
      const n = Math.round(20 + rnd(s) * 25); s.res.materials += n;
      log(s, 'good', 'Salvaged an old supply drop crate: +' + n + ' materials.'); ev.push({ type: 'good' });
    } },
    { id: 'mail', w: 1.1, ok: () => true, run(s, ev) {
      s.morale = clamp(s.morale + 8, 0, 100);
      log(s, 'good', 'Video messages from home arrive. Morale up!'); ev.push({ type: 'good' });
    } },
    { id: 'party', w: 0.8, ok: () => true, run(s, ev) {
      s.morale = clamp(s.morale + 6, 0, 100);
      log(s, 'good', pick(s, ['Karaoke night in the Command Hub.', 'Someone baked Mars-potato pizza.', 'Low-gravity basketball tournament!', 'Movie marathon under the dome.']) + ' Morale up.');
      ev.push({ type: 'good' });
    } },
    { id: 'devil', w: 0.9, ok: (s) => countType(s, 'solar') > 0 && !(s.storm && s.storm.active), run(s, ev) {
      s.fx.devil = 6;
      log(s, 'good', 'A dust devil swept the solar panels clean: +25% solar for 6 sols.'); ev.push({ type: 'good' });
    } },
    { id: 'leak', w: 0.7, ok: (s) => s.sol > 12, run(s, ev) {
      const n = Math.round(s.res.o2 * 0.25); s.res.o2 -= n;
      log(s, 'bad', 'Pressure leak in a hab seal vented ' + n + ' O\u2082 before it was patched.'); ev.push({ type: 'leak' });
    } },
    { id: 'sick', w: 0.6, ok: (s) => s.crew >= 4 && !s.sick, run(s, ev) {
      const med = countType(s, 'med') > 0;
      s.sick = Math.min(s.crew - 1, 1 + Math.floor(rnd(s) * 3)); s.sickSols = med ? 2 : 6;
      s.morale = clamp(s.morale - 5, 0, 100);
      log(s, 'warn', s.sick + ' colonist' + (s.sick > 1 ? 's' : '') + ' down with Hab Flu for ' + s.sickSols + ' sols' + (med ? ' (Med Bay on it).' : '. A Med Bay would speed recovery.'));
      ev.push({ type: 'sick' });
    } },
    { id: 'blight', w: 0.7, ok: (s) => countType(s, 'greenhouse') > 0 && !s.fx.blight, run(s, ev) {
      s.pending = { id: 'blight', title: 'Greenhouse Blight', text: 'A fungus is spreading through the potato trays.',
        options: [{ label: 'Purge the crop', hint: '\u221225 food now, greenhouses stay healthy' },
                  { label: 'Ride it out', hint: 'Greenhouses at half output for 10 sols' }], ai: s.res.food > 60 ? 0 : 1 };
      ev.push({ type: 'choice' });
    } },
    { id: 'signal', w: 0.6, ok: (s) => s.sol > 20, run(s, ev) {
      s.pending = { id: 'signal', title: 'Strange Glint on the Plain', text: 'The survey drone spotted something shiny 12 km out. Probably old landing debris \u2014 maybe useful.',
        options: [{ label: 'Send a rover', hint: '\u221215 power. Likely +45 materials, small risk' },
                  { label: 'Stay home', hint: 'Nothing happens' }], ai: s.res.power > 25 ? 0 : 1 };
      ev.push({ type: 'choice' });
    } },
  ];

  function choose(s, idx) {
    const p = s.pending;
    if (!p) return { ok: false };
    const ev = [];
    if (p.id === 'blight') {
      if (idx === 0) { s.res.food = Math.max(0, s.res.food - 25); log(s, 'info', 'Crop purged. The greenhouses are clean.'); }
      else { s.fx.blight = 10; log(s, 'warn', 'Blight spreads: greenhouses at half output for 10 sols.'); }
    } else if (p.id === 'signal') {
      if (idx === 0) {
        s.res.power = Math.max(0, s.res.power - 15);
        if (rnd(s) < 0.7) { s.res.materials += 45; s.morale = clamp(s.morale + 6, 0, 100); log(s, 'good', 'Rover hauled back a cargo fairing full of aluminum: +45 materials!'); }
        else if (s.res.spares > 0) { s.res.spares -= 1; log(s, 'bad', 'Rover got stuck in sand and burned a spare part getting home.'); }
        else { s.morale = clamp(s.morale - 4, 0, 100); log(s, 'bad', 'Rover came home empty-handed and very dusty.'); }
      } else log(s, 'info', 'The glint stays a mystery.');
    }
    s.pending = null;
    return { ok: true, ev };
  }

  function rollEvent(s, ev) {
    const d = DIFFS[s.diff];
    if (s.sol < 6) return;
    if (rnd(s) > 0.13 * d.eventRate) return;
    const pool = EVENTS.filter((e) => e.ok(s));
    const tot = pool.reduce((a, e) => a + e.w, 0);
    let r = rnd(s) * tot;
    for (const e of pool) { r -= e.w; if (r <= 0) { s.stats.events++; e.run(s, ev); return; } }
  }

  function forceEvent(s, id) {
    const e = EVENTS.find((q) => q.id === id);
    if (!e) return [];
    const ev = []; e.run(s, ev); s.last = flows(s); return ev;
  }

  // ---------- Starship ----------
  function slots(s) { return Math.floor(padsActive(s) * DIFFS[s.diff].shipCap / SLOT_T); }

  function autoManifest(s) {
    const n = slots(s);
    const m = { colonist: 0, life: 0, food: 0, materials: 0, spares: 0 };
    if (!n) return m;
    let left = n;
    const add = (k, q) => { q = Math.min(q, left); m[k] += q; left -= q; };
    const f = s.last || flows(s);
    if (s.res.spares < 2) add('spares', 2); else if (s.res.spares < 4) add('spares', 1);
    if (f.net.food < 0 && s.res.food < 120) add('food', 1);
    if ((f.net.o2 < 0 && s.res.o2 < 80) || (f.net.water < 0 && s.res.water < 80)) add('life', 1);
    add('materials', s.res.materials < 80 ? 3 : 2);
    add('colonist', Math.min(left, 6 * padsActive(s)));
    if (left > 0) add('materials', left);
    return m;
  }

  function manifestSize(m) { return CARGO_ORDER.reduce((a, k) => a + (m[k] || 0), 0); }

  function setManifest(s, m) {
    if (!s.window || s.window.launched) return { ok: false, why: 'No open launch window' };
    const clean = {};
    for (const k of CARGO_ORDER) clean[k] = Math.max(0, Math.floor(m[k] || 0));
    if (manifestSize(clean) > slots(s)) return { ok: false, why: 'Over capacity' };
    if (clean.colonist > 6 * padsActive(s)) return { ok: false, why: 'Max 6 colonists per ship' };
    s.window.manifest = clean;
    return { ok: true };
  }

  function launch(s) {
    const w = s.window;
    if (!w || w.launched) return { ok: false, why: 'No open launch window' };
    const ships = padsActive(s);
    w.launched = true;
    if (!ships) { log(s, 'bad', 'No working landing pad \u2014 the launch window closed without a ship.'); s.window = null; return { ok: false, why: 'No working landing pad' }; }
    const cargo = Object.assign({}, w.manifest);
    cargo.colonist = Math.min(cargo.colonist || 0, 6 * ships);
    while (manifestSize(cargo) > slots(s)) { const k = CARGO_ORDER.slice().reverse().find((q) => cargo[q] > 0); cargo[k]--; }
    s.ships.push({ id: s.sol * 10 + ships, launch: s.sol, arrive: s.sol + TRANSIT, n: ships, cargo });
    s.stats.ships += ships;
    log(s, 'good', ships + ' Starship' + (ships > 1 ? 's' : '') + ' launched from Earth carrying ' + (cargo.colonist || 0) + ' colonists. ETA Sol ' + (s.sol + TRANSIT) + '.');
    s.window = null;
    return { ok: true };
  }

  function stepShips(s, ev) {
    const d = DIFFS[s.diff];
    for (const sh of s.ships.slice()) {
      if (s.sol < sh.arrive) continue;
      s.ships.splice(s.ships.indexOf(sh), 1);
      let hard = 0;
      for (let i = 0; i < sh.n; i++) if (rnd(s) < d.landRisk) hard++;
      const keep = 1 - 0.5 * hard / sh.n;
      const c = sh.cargo;
      const got = [];
      s.crew += c.colonist || 0;
      s.stats.arrivals += c.colonist || 0;
      for (const k of ['life', 'food', 'materials', 'spares']) {
        const q = c[k] || 0; if (!q) continue;
        for (const r in CARGO[k].give) { const v = Math.floor(CARGO[k].give[r] * q * keep); s.res[r] += v; got.push('+' + v + ' ' + r); }
      }
      s.stats.landed += sh.n;
      const free = s.mods.filter((m) => m.type === 'pad' && m.status === 'active' && !(s.parked[m.id] > s.sol));
      for (let i = 0; i < sh.n && i < free.length; i++) s.parked[free[i].id] = s.sol + 30;
      s.morale = clamp(s.morale + 10, 0, 100);
      log(s, 'good', 'Starship touchdown! ' + (c.colonist || 0) + ' new colonists' + (got.length ? ', ' + got.join(', ') : '') + '.');
      if (hard) {
        s.stats.hardLandings += hard;
        const p = breakRandom(s, (m) => m.type === 'pad');
        log(s, 'bad', 'Hard landing! Some cargo was crushed' + (p ? ' and a landing pad is damaged' : '') + '. All crew are safe.');
      }
      ev.push({ type: 'arrival', n: sh.n, colonists: c.colonist || 0, hard });
    }
    if (s.window && !s.window.launched && s.sol >= s.window.closes) {
      log(s, 'info', 'Launch window closing \u2014 Mission Control launched the current manifest.');
      launch(s);
    }
    if (!s.window && s.sol >= s.nextWindow) {
      s.window = { opens: s.sol, closes: s.sol + WINDOW_LEN, launched: false, manifest: autoManifest(s) };
      s.nextWindow = s.sol + WINDOW_EVERY;
      log(s, 'warn', 'Starship launch window is OPEN (' + slots(s) + ' cargo slots). Pack the manifest!');
      ev.push({ type: 'window', slots: slots(s) });
    }
  }

  // ---------- Tick (one sol) ----------
  function tick(s) {
    if (s.over || s.pending) return [];
    const d = DIFFS[s.diff];
    const ev = [];
    // construction & repairs
    for (const m of s.mods) {
      if (m.status !== 'building') continue;
      m.prog++;
      if (m.prog >= m.need) {
        const wasRepair = m.repairing;
        m.status = 'active'; m.repairing = false; m.prog = 0;
        if (!wasRepair) s.stats.built++;
        log(s, 'good', MODULES[m.type].name + (wasRepair ? ' back online.' : ' complete!'));
        ev.push({ type: 'built', id: m.id, x: m.x, y: m.y, repair: wasRepair });
      }
    }
    // production
    const f = flows(s);
    s.res.power = clamp(s.res.power + f.gen - f.used, 0, f.storage);
    s.res.water += f.prod.water;
    const want = f.want.water;
    const scale = want > 0 ? Math.min(1, s.res.water / want) : 1;
    s.res.water -= want * scale;
    s.res.o2 += f.prod.o2 * scale;
    s.res.food += f.prod.food * scale;
    s.res.materials += f.prod.materials;
    // crew needs
    const frac = {};
    for (const k of ['o2', 'water', 'food']) {
      const need = s.crew * d.consume;
      if (s.res[k] >= need) { s.res[k] -= need; s.short[k] = 0; frac[k] = 0; }
      else { frac[k] = need ? (need - s.res[k]) / need : 0; s.res[k] = 0; s.short[k]++; }
    }
    for (const k of ['o2', 'water', 'food']) s.res[k] = Math.min(s.res[k], f.tanks);
    // Expected losses scale with how short you are; the fractional part is a dice roll.
    const toll = (x) => Math.floor(x) + (rnd(s) < x - Math.floor(x) ? 1 : 0);
    if (s.short.o2 >= 1) loseCrew(s, toll(0.25 + s.crew * frac.o2 * 0.3), 'oxygen shortage', ev);
    if (s.short.water >= 3 && s.crew) loseCrew(s, toll(0.15 + s.crew * frac.water * 0.2), 'dehydration', ev);
    if (s.short.food >= 5 && s.crew) loseCrew(s, toll(0.1 + s.crew * frac.food * 0.15), 'starvation', ev);
    // morale
    if (s.crew > 0) {
      const housing = f.housing;
      let t = 62;
      const recRatio = Math.min(1, f.rec / s.crew);
      t += recRatio * 22 - (1 - recRatio) * 10;
      const over = s.crew - housing;
      if (over > 0) t -= Math.min(45, over * 5);
      if (s.short.o2) t -= 30;
      if (s.short.water) t -= 18;
      if (s.short.food) t -= 15;
      if (s.storm && s.storm.active) t -= 6;
      if (f.med) t += 5;
      t -= Math.min(10, f.broken * 2);
      s.morale = clamp(s.morale + (t - s.morale) * 0.15, 0, 100);
      s.lowMorale = s.morale <= 8 ? s.lowMorale + 1 : 0;
    }
    // timers
    if (s.fx.devil > 0) s.fx.devil--;
    if (s.fx.blight > 0) s.fx.blight--;
    s.fx.flare = 0;
    if (s.sick && --s.sickSols <= 0) { s.sick = 0; log(s, 'good', 'Everyone has recovered from the flu.'); }
    if (s.storm) {
      if (!s.storm.active) {
        if (--s.storm.warn <= 0) { s.storm.active = true; log(s, 'warn', 'The dust storm has arrived. Solar output down to ' + Math.round(s.storm.sun * 100) + '%.'); ev.push({ type: 'storm-start', global: s.storm.global }); }
      } else if (--s.storm.sols <= 0) {
        s.stats.storms++; s.storm = null;
        log(s, 'good', 'The storm has cleared. Blue sunset tonight.'); ev.push({ type: 'storm-end' });
      }
    }
    rollEvent(s, ev);
    s.sol++;
    stepShips(s, ev);
    s.stats.peak = Math.max(s.stats.peak, s.crew);
    for (const k in s.parked) if (s.parked[k] <= s.sol || !s.mods.some((m) => m.id === +k)) delete s.parked[k];
    // end conditions
    if (s.crew >= GOAL) {
      s.over = { win: true, sol: s.sol, reason: 'The colony reached ' + GOAL + ' colonists. Mars has a town!' };
      log(s, 'good', 'MISSION SUCCESS \u2014 ' + GOAL + ' colonists on Mars by Sol ' + s.sol + '!');
      ev.push({ type: 'win' });
    } else if (s.crew <= 0) {
      s.crew = 0;
      s.over = { win: false, sol: s.sol, reason: 'The last of the crew was lost. The colony is silent.' };
      ev.push({ type: 'lose' });
    } else if (s.lowMorale >= 8) {
      s.over = { win: false, sol: s.sol, reason: 'Morale collapsed. The crew voted to mothball the base and wait for the next ship home.' };
      ev.push({ type: 'lose' });
    }
    s.last = flows(s);
    return ev;
  }

  function score(s) {
    return Math.max(0, Math.round(s.stats.peak * 100 + s.stats.landed * 50 + s.stats.storms * 40 - s.stats.deaths * 120 + (s.over && s.over.win ? Math.max(0, 900 - s.sol) * 10 : s.sol)));
  }
  function medal(s) {
    if (!s.over || !s.over.win) return null;
    return s.sol <= 200 ? 'Gold' : s.sol <= 260 ? 'Silver' : 'Bronze';
  }

  // ---------- Placement helper ----------
  function findSpot(s, type) {
    const cands = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tileAt(s, x, y);
      if (t.t === 'rock' || t.t === 'crater' || modAt(s, x, y)) continue;
      const dist = Math.abs(x - HUB.x) + Math.abs(y - HUB.y) * 1.2;
      let score = dist;
      if (type === 'drill') score += t.t === 'ice' ? -20 : 0;
      else if (t.t === 'ice') score += 12;
      if (type === 'pad') score += dist < 3 ? 20 : -dist * 0.3;
      if (type === 'solar' || type === 'battery') score = Math.abs(dist - 2.6) + (t.t === 'ice' ? 12 : 0);
      cands.push({ x, y, score: score + t.v * 0.01 });
    }
    cands.sort((a, b) => a.score - b.score);
    return cands[0] || null;
  }

  // ---------- Autopilot (Mission Control AI) ----------
  // A planner that keeps life support ahead of the crew it is expecting, then grows.
  function autopilot(s, opts) {
    opts = opts || {};
    if (s.over) return;
    if (s.pending) choose(s, s.pending.ai || 0);
    const d = DIFFS[s.diff];
    // repairs
    const pri = ['electrolyzer', 'drill', 'greenhouse', 'solar', 'pad', 'battery', 'hab', 'foundry', 'reactor', 'med', 'rec'];
    for (const m of s.mods.filter((q) => q.status === 'broken').sort((a, b) => pri.indexOf(a.type) - pri.indexOf(b.type))) {
      if (s.res.spares >= 1) repair(s, m.id, 'spares'); else if (s.res.materials >= 15) repair(s, m.id, 'materials');
    }
    const all = (t) => countType(s, t, true);
    const target = s.crew + inTransitCrew(s) + (s.window && !s.window.launched ? (s.window.manifest.colonist || 0) : 0);
    const c = d.consume;
    let drillCap = 0;
    for (const m of s.mods) if (m.type === 'drill' && m.status !== 'broken') { const t = tileAt(s, m.x, m.y); drillCap += MODULES.drill.output.water * (t.t === 'ice' ? 1.5 : 1); }
    const need = {
      electrolyzer: () => all('electrolyzer') * MODULES.electrolyzer.output.o2 * 0.92 < target * c + 1,
      drill: () => drillCap * 0.92 < target * c + all('electrolyzer') * MODULES.electrolyzer.input.water + all('greenhouse') * MODULES.greenhouse.input.water + 1,
      greenhouse: () => all('greenhouse') * MODULES.greenhouse.output.food * 0.92 < target * c + 0.5,
      solar: () => {
        let demand = 0, firm = 0, sol = 0;
        for (const m of s.mods) { const M = MODULES[m.type]; demand += M.power || 0; firm += M.gen || 0; sol += M.solar || 0; }
        return firm + sol * 0.8 < demand * 1.15 + 2;
      },
      battery: () => {
        let demand = 0, store = 0;
        for (const m of s.mods) { const M = MODULES[m.type]; demand += M.power || 0; store += M.storage || 0; }
        return store < demand * 4;
      },
      hab: () => s.mods.reduce((a, m) => a + (MODULES[m.type].housing || 0), 0) < target + 2,
      foundry: () => all('foundry') < 2 + Math.floor(target / 12),
      rec: () => s.mods.reduce((a, m) => a + (MODULES[m.type].rec || 0), 0) < target,
      med: () => target >= 10 && all('med') < 1,
      pad: () => (target >= 9 && all('pad') < 2) || (target >= 16 && all('pad') < 3) || (target >= 24 && all('pad') < 4),
      reactor: () => {
        if (!unlocked(s, 'reactor') || s.res.spares < 2) return false;
        let demand = 0, firm = 0;
        for (const m of s.mods) { const M = MODULES[m.type]; demand += M.power || 0; firm += M.gen || 0; }
        return firm < demand * 0.45;
      },
    };
    const order = ['electrolyzer', 'drill', 'greenhouse', 'solar', 'foundry', 'hab', 'battery', 'reactor', 'med', 'rec', 'pad'];
    let built = 0;
    for (let pass = 0; pass < 6 && built < (opts.maxBuilds || 4); pass++) {
      let any = false;
      for (const t of order) {
        if (built >= (opts.maxBuilds || 4)) break;
        if (t === 'solar' && need.reactor() && s.res.materials >= MODULES.reactor.cost.materials) continue;
        if (t === 'battery' && need.reactor()) continue;
        if (!need[t]()) continue;
        const spot = findSpot(s, t);
        if (!spot) continue;
        if (build(s, t, spot.x, spot.y).ok) { built++; any = true; }
      }
      if (!any) break;
    }
    if (s.window && !s.window.launched) {
      setManifest(s, autoManifest(s));
      launch(s);
    }
  }

  const API = {
    W, H, HUB, GOAL, WINDOW_EVERY, FIRST_WINDOW, WINDOW_LEN, TRANSIT, SLOT_T,
    DIFFS, MODULES, BUILD_ORDER, CARGO, CARGO_ORDER,
    newGame, tick, flows, forecast, canBuild, build, demolish, repair, choose, forceEvent,
    setManifest, launch, autoManifest, manifestSize, slots, autopilot, findSpot,
    tileAt, modAt, countType, inTransitCrew, unlocked, score, medal, rnd,
  };
  root.MarsEngine = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
