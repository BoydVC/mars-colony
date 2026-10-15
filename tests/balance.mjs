// Automated balance playtest: scripted strategies x difficulties x seeds, using the real engine.
// Usage: node tests/balance.mjs [seeds=100]   -> prints a table, writes tests/balance_results.{json,md}
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = createRequire(import.meta.url)(join(HERE, "..", "web", "engine.js"));
const SEEDS = +(process.argv[2] || 100);
const MAX_SOL = 900;

function spot(s, t) { return E.findSpot(s, t); }
function tryBuild(s, t) { const p = spot(s, t); return p ? E.build(s, t, p.x, p.y).ok : false; }

const STRATEGIES = {
  idle: { label: "Idle (never touches anything)", act(s) { if (s.pending) E.choose(s, 1); } },
  rush: {
    label: "Colonist rush (habs + pads, all-colonist ships)",
    act(s) {
      if (s.pending) E.choose(s, 1);
      if (E.canBuild(s, "pad").ok && E.countType(s, "pad", true) < 4) tryBuild(s, "pad");
      while (E.canBuild(s, "hab").ok) if (!tryBuild(s, "hab")) break;
      if (s.window && !s.window.launched) { const n = E.slots(s); E.setManifest(s, { colonist: Math.min(n, 6 * E.countType(s, "pad")) }); E.launch(s); }
    },
  },
  rotation: {
    label: "Novice rotation (builds a fixed cycle, no forecasting)",
    act(s) {
      if (s.pending) E.choose(s, 0);
      for (const m of s.mods) if (m.status === "broken" && s.res.spares > 0) E.repair(s, m.id, "spares");
      const cycle = ["electrolyzer", "greenhouse", "hab", "solar", "drill", "solar", "foundry", "battery", "hab", "rec", "pad"];
      s._i = s._i || 0;
      const t = cycle[s._i % cycle.length];
      if (E.canBuild(s, t).ok && tryBuild(s, t)) s._i++;
      else if (!E.canBuild(s, t).ok && /Max|Unlocks/.test(E.canBuild(s, t).why || "")) s._i++;
      if (s.window && !s.window.launched) E.launch(s);
    },
  },
  casual: { label: "Casual (Mission Control logic, checks in every 7 sols)", act(s) { if (s.pending) E.choose(s, s.pending.ai || 0); if (s.sol % 7 === 0 || (s.window && !s.window.launched && s.window.closes - s.sol <= 1)) E.autopilot(s); } },
  expert: { label: "Mission Control autopilot (acts every sol)", act(s) { E.autopilot(s); } },
};

function play(strategy, diff, seed) {
  const s = E.newGame({ seed, difficulty: diff });
  const st = STRATEGIES[strategy];
  let minO2 = Infinity, minMorale = 100;
  while (!s.over && s.sol < MAX_SOL) {
    st.act(s);
    if (s.pending) E.choose(s, s.pending.ai || 0);
    E.tick(s);
    minO2 = Math.min(minO2, s.res.o2); minMorale = Math.min(minMorale, s.morale);
  }
  return { win: !!(s.over && s.over.win), sol: s.sol, deaths: s.stats.deaths, peak: s.stats.peak, medal: E.medal(s),
    reason: s.over ? (s.over.win ? "win" : /Morale/.test(s.over.reason) ? "morale collapse" : "crew lost") : "timeout", minMorale };
}

const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const rows = [];
const t0 = Date.now();
for (const strat of Object.keys(STRATEGIES)) {
  for (const diff of ["cadet", "commander", "hardcore"]) {
    const res = [];
    for (let seed = 1; seed <= SEEDS; seed++) res.push(play(strat, diff, seed));
    const wins = res.filter((r) => r.win);
    const losses = res.filter((r) => !r.win);
    const medals = { Gold: 0, Silver: 0, Bronze: 0 };
    wins.forEach((r) => medals[r.medal]++);
    const reasons = {};
    losses.forEach((r) => (reasons[r.reason] = (reasons[r.reason] || 0) + 1));
    rows.push({ strategy: strat, label: STRATEGIES[strat].label, diff, seeds: SEEDS, winRate: wins.length / SEEDS,
      medianWinSol: med(wins.map((r) => r.sol)), medianLossSol: med(losses.map((r) => r.sol)),
      avgDeaths: +(res.reduce((a, r) => a + r.deaths, 0) / SEEDS).toFixed(1), medals, lossReasons: reasons });
  }
}
const pct = (x) => (x * 100).toFixed(0).padStart(3) + "%";
const lines = [];
lines.push(`| Strategy | Difficulty | Win rate | Median win sol | Median loss sol | Avg crew lost | Medals (G/S/B) | Loss reasons |`);
lines.push(`|---|---|---|---|---|---|---|---|`);
for (const r of rows) {
  lines.push(`| ${r.label} | ${r.diff} | ${pct(r.winRate).trim()} | ${r.medianWinSol ?? "-"} | ${r.medianLossSol ?? "-"} | ${r.avgDeaths} | ${r.medals.Gold}/${r.medals.Silver}/${r.medals.Bronze} | ${Object.entries(r.lossReasons).map(([k, v]) => k + " " + v).join(", ") || "-"} |`);
}
const md = `Balance playtest: ${SEEDS} seeds per row, max ${MAX_SOL} sols, run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC (${((Date.now() - t0) / 1000).toFixed(1)}s)\n\n` + lines.join("\n") + "\n";
console.log(md);
writeFileSync(join(HERE, "balance_results.json"), JSON.stringify({ seeds: SEEDS, maxSol: MAX_SOL, rows }, null, 2));
writeFileSync(join(HERE, "balance_results.md"), md);
