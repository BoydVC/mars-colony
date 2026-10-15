// Headless Chrome playthrough of dist/mars-colony.html via CDP + window.__MC__.
// Prints one JSON line: {checks:[{ok,msg,info}], passed, failed}
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = pathToFileURL(join(HERE, "..", "dist", "mars-colony.html")).href;
const checks = [];
const check = (ok, msg, info = "") => checks.push({ ok: !!ok, msg, info: String(info) });
const J = (v) => JSON.stringify(v);

async function main() {
  const c = await launch({ width: 1280, height: 800, port: 9455 });
  const st = async () => JSON.parse(await c.ev("JSON.stringify(__MC__.getState())"));
  const realClick = async (x, y) => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await c.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    }
  };
  try {
    await c.goto(DIST, 800);
    check(await c.ev("typeof window.__MC__ === 'object'"), "__MC__ test API present");
    check((await c.ev("document.title")) === "Mars Colony Sim", "document title");
    check(await c.ev("!document.querySelector('#title').classList.contains('hidden')"), "title screen visible on load");
    const nd = await c.ev("document.querySelectorAll('#diff-cards .diff').length");
    check(nd === 3, "three difficulty cards", nd);
    const demo = await st();
    check(demo.demo && demo.crew > 6, "title backdrop runs a live demo colony", `crew ${demo.crew}`);

    // Start Commander through the real button
    await c.click('#diff-cards .diff[data-d="commander"]');
    await sleep(250);
    let s = await st();
    check(s.screen === "game" && s.sol === 1 && s.crew === 6 && s.diff === "commander", "Commander game starts at Sol 1 with 6 crew", J(s));
    await c.ev("__MC__.setSpeed(0)");

    // Build a Hab through the UI: card click, then a real mouse click on the map tile
    const before = await c.ev("__MC__.S.mods.length");
    const mat0 = await c.ev("__MC__.S.res.materials");
    await c.click('#build .card[data-type="hab"]');
    s = await st();
    check(s.buildType === "hab", "clicking the Hab card enters build mode", s.buildType);
    const spot = JSON.parse(await c.ev("JSON.stringify(__MC__.findSpot('hab'))"));
    const pt = await c.ev(`__MC__.tileCenterClient(${spot.x},${spot.y})`);
    await realClick(pt.x, pt.y);
    await sleep(150);
    const after = await c.ev("__MC__.S.mods.length");
    const mat1 = await c.ev("__MC__.S.res.materials");
    check(after === before + 1 && mat1 === mat0 - 35, "mouse click on map places a Hab and spends 35 materials", `${before}->${after}, ${mat0}->${mat1}`);
    const status0 = await c.ev(`__MC__.S.mods.find(m=>m.x===${spot.x}&&m.y===${spot.y}).status`);
    check(status0 === "building", "new module starts under construction", status0);
    check((await st()).buildType === null, "build mode ends after placing (Shift keeps it)", (await st()).buildType);

    // Invalid placement is refused (crater/rock tile)
    const bad = await c.ev("(()=>{const S=__MC__.S;for(let i=0;i<S.map.length;i++){if(S.map[i].t==='rock'||S.map[i].t==='crater')return {x:i%16,y:Math.floor(i/16)};}})()");
    const badRes = await c.ev(`__MC__.E.canBuild(__MC__.S,'solar',${bad.x},${bad.y})`);
    check(!badRes.ok, "cannot build on rocks/craters", badRes.why);

    // Advance sols
    await c.ev("__MC__.step(5, true)");
    s = await st();
    const status1 = await c.ev(`__MC__.S.mods.find(m=>m.x===${spot.x}&&m.y===${spot.y}).status`);
    check(s.sol === 6, "step(5) advances to Sol 6", s.sol);
    check(status1 === "active", "Hab finishes construction after 3 sols", status1);
    const sol6 = await c.ev("document.querySelector('#sol').textContent");
    check(sol6 === "6", "sol counter in the top bar updates", sol6);

    // Real-time loop advances sols on its own
    await c.ev("__MC__.setSpeed(3)");
    await sleep(2200);
    await c.ev("__MC__.setSpeed(0)");
    s = await st();
    check(s.sol >= 8, "real-time clock advances sols at speed 3", `sol ${s.sol}`);

    // Launch window -> manifest -> launch -> arrival
    let ev = [];
    for (let i = 0; i < 40 && !(await st()).window; i++) ev = ev.concat(await c.ev("__MC__.step(1, true)"));
    s = await st();
    check(s.window && !s.window.launched && s.sol === 20, "Starship launch window opens on Sol 20", `sol ${s.sol}`);
    check(s.modal === "manifest", "manifest dialog pops up when the window opens", s.modal);
    // use the stepper UI: remove all, add colonists via + button
    await c.ev("__MC__.setManifest({colonist:0,life:0,food:0,materials:0,spares:0})");
    for (let i = 0; i < 4; i++) await c.click('.step button[data-k="colonist"][data-d="1"]');
    await c.click('.step button[data-k="food"][data-d="1"]');
    const man = await c.ev("JSON.stringify(__MC__.S.window.manifest)");
    check(J(JSON.parse(man)) === J({ colonist: 4, life: 0, food: 1, materials: 0, spares: 0 }), "manifest steppers set 4 colonists + 1 food", man);
    const over = await c.ev("__MC__.setManifest({colonist:7,life:0,food:0,materials:0,spares:0})");
    check(!over.ok, "manifest refuses 7 colonists on 1 ship", over.why);
    await c.click("#m-launch");
    s = await st();
    check(s.ships === 1 && !s.window && s.modal === null, "Launch! sends 1 Starship", J({ ships: s.ships, modal: s.modal }));
    const crewBefore = s.crew;
    ev = await c.ev("__MC__.step(16, true)");
    s = await st();
    check(ev.includes("arrival") && s.crew === crewBefore + 4, "Starship lands 16 sols later with 4 colonists", `${crewBefore}->${s.crew}, ev ${ev.filter((e) => e !== "built").join(",")}`);
    const parked = await c.ev("Object.keys(__MC__.S.parked).length");
    check(parked >= 1, "landed Starship is parked on its pad", parked);

    // Dust storm cuts solar
    const gen0 = await c.ev("__MC__.S.last.solarGen");
    await c.ev("__MC__.S.storm=null; __MC__.forceEvent('storm')");
    s = await st();
    check(s.storm && s.storm.warn === 3 && !s.storm.active, "dust storm gives a 3-sol warning", J(s.storm));
    await c.ev("__MC__.S.pending=null; __MC__.step(3, true)");
    const gen1 = await c.ev("__MC__.S.last.solarGen");
    const act = await c.ev("!!(__MC__.S.storm && __MC__.S.storm.active)");
    check(act && gen1 < gen0 * 0.5, "active storm cuts solar output", `${gen0.toFixed(1)} -> ${gen1.toFixed(1)}`);
    await c.ev("__MC__.S.storm=null; __MC__.S.last=__MC__.E.flows(__MC__.S)");

    // Failure + repair through the inspector
    await c.ev("__MC__.S.pending && __MC__.choose(0); __MC__.closeModal(); __MC__.S.res.spares=3; __MC__.forceEvent('failure')");
    const broken = await c.ev("(__MC__.S.mods.find(m=>m.status==='broken')||{}).id");
    check(!!broken, "equipment failure breaks a module", broken);
    const bm = await c.ev(`(()=>{const m=__MC__.S.mods.find(q=>q.id===${broken});return {x:m.x,y:m.y}})()`);
    const bp = await c.ev(`__MC__.tileCenterClient(${bm.x},${bm.y})`);
    await realClick(bp.x, bp.y);
    await sleep(100);
    { const s2 = await st(); check(s2.sel === broken, "clicking the broken module opens the inspector", J({ sel: s2.sel, modal: s2.modal, build: s2.buildType })); }
    await c.click('#inspector button[data-act="rs"]');
    const bst = await c.ev(`__MC__.S.mods.find(q=>q.id===${broken}).status`);
    check(bst === "active", "Repair (1 spare) fixes it instantly", bst);

    // Choice event modal
    await c.ev("__MC__.S.pending && __MC__.choose(0); __MC__.forceEvent('signal'); __MC__.step(1)");
    s = await st();
    check(s.pending === "signal" && s.modal === "choice", "choice event pauses the game and shows options", J({ p: s.pending, m: s.modal }));
    await c.click('.choice button[data-i="1"]');
    s = await st();
    check(!s.pending && !s.modal, "picking an option resolves the event", J({ p: s.pending, m: s.modal }));

    // Save + reload + continue
    await c.ev("__MC__.save()");
    const solSaved = (await st()).sol;
    await c.goto(DIST, 600);
    const contVisible = await c.ev("!document.querySelector('#btn-continue').classList.contains('hidden')");
    check(contVisible, "Continue button appears after reload");
    await c.click("#btn-continue");
    s = await st();
    check(s.screen === "game" && s.sol === solSaved && !s.demo, "Continue restores the saved colony", `sol ${s.sol} vs ${solSaved}`);

    // Help modal
    await c.ev("__MC__.openHelp()");
    check((await c.ev("document.querySelector('#modal').textContent")).includes("How to Play"), "help dialog opens");
    await c.ev("__MC__.closeModal()");

    // LOSS path A: neglect (no player actions, default manifests) eventually fails
    await c.ev("__MC__.newGame({seed:3,difficulty:'commander'})");
    let guard = 0;
    while (!(await st()).over && guard++ < 60) { await c.ev("__MC__.step(10, true)"); }
    s = await st();
    check(s.over && !s.over.win, "doing nothing loses the colony (neglect path)", s.over ? `Sol ${s.over.sol}: ${s.over.reason}` : `still alive sol ${s.sol}`);
    check(s.modal === "end" || (await sleep(1200), (await st()).modal === "end"), "defeat dialog shown");
    const endTxt = await c.ev("document.querySelector('#modal').textContent");
    check(endTxt.includes("Mission Failed"), "defeat dialog says Mission Failed");

    // LOSS path B: life support sabotage -> crew lost quickly
    await c.ev("__MC__.newGame({seed:9,difficulty:'commander'})");
    await c.ev("__MC__.sabotage(['electrolyzer']); __MC__.setRes({o2:0, spares:0})");
    await c.ev("__MC__.step(40, true)");
    s = await st();
    check(s.over && !s.over.win && s.crew === 0, "no oxygen = crew lost = game over", J({ over: s.over, crew: s.crew }));

    // WIN path: Mission Control autopilot reaches 50 colonists (Cadet + Commander)
    for (const [diff, seed] of [["cadet", 2], ["commander", 4]]) {
      await c.ev(`__MC__.newGame({seed:${seed},difficulty:'${diff}'})`);
      s = JSON.parse(await c.ev("JSON.stringify(__MC__.runAutopilot(900))"));
      check(s.over && s.over.win && s.crew >= 50, `${diff}: autopilot reaches 50 colonists (win)`, s.over ? `Sol ${s.over.sol}, crew ${s.crew}` : `sol ${s.sol} crew ${s.crew}`);
    }
    await sleep(1300);
    const winTxt = await c.ev("document.querySelector('#modal').textContent");
    check(winTxt.includes("Mission Success") && /GOLD|SILVER|BRONZE/.test(winTxt), "victory dialog with a medal", winTxt.slice(0, 80));

    check(c.errors.length === 0, "no JS errors / console errors", c.errors.slice(0, 3).join(" | "));
    check(c.requests.length === 0, "no network requests (fully offline)", c.requests.slice(0, 3).join(" "));
  } catch (e) {
    check(false, "playthrough threw", e.stack || e.message);
  } finally {
    await c.close();
  }
  const passed = checks.filter((x) => x.ok).length;
  console.log(JSON.stringify({ checks, passed, failed: checks.length - passed }));
}
main();
