// 1280x800 gameplay screenshots of dist/mars-colony.html into screenshots/.
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = pathToFileURL(join(HERE, "..", "dist", "mars-colony.html")).href;
const OUT = join(HERE, "..", "screenshots");

async function main() {
  const c = await launch({ width: 1280, height: 800, port: 9456 });
  const settle = async (ms = 900) => { await c.ev("__MC__.resetWalkers(); __MC__.clearToasts()"); await sleep(ms); };
  try {
    await c.goto(DIST, 900);
    // 01 title with live demo colony behind
    await c.ev("__MC__.freeze(true); __MC__.setPhase(0.47)");
    await settle(1500);
    await c.shot(join(OUT, "01-title.png"));

    // 02 early game, build ghost on hover
    await c.ev("__MC__.freeze(false); __MC__.newGame({seed:11,difficulty:'commander'}); __MC__.step(3, true); __MC__.setPhase(0.5)");
    await c.ev("__MC__.selectBuild('greenhouse')");
    const sp = await c.ev("__MC__.findSpot('greenhouse')");
    const pt = await c.ev(`__MC__.tileCenterClient(${sp.x},${sp.y})`);
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
    await settle(1200);
    await c.shot(join(OUT, "02-early-colony-build.png"));
    await c.ev("__MC__.cancelBuild()");
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });

    // 03 launch window manifest
    await c.ev("__MC__.step(30, true)");
    await c.ev("__MC__.S.sol < 20 || !__MC__.S.window ? 0 : 0");
    await c.ev("__MC__.newGame({seed:11,difficulty:'commander'}); __MC__.runAutopilot(17); __MC__.autopilot(false); __MC__.step(3, true)");
    await c.ev("__MC__.S.window && __MC__.openManifest()");
    await settle(700);
    await c.shot(join(OUT, "03-launch-window.png"));
    await c.ev("__MC__.launch()");

    // 04 thriving colony with a Starship landing (daytime)
    await c.ev("__MC__.newGame({seed:4,difficulty:'commander'}); __MC__.runAutopilot(186); __MC__.autopilot(false); __MC__.closeModal(); __MC__.setPhase(0.44)");
    await c.ev("(()=>{const S=__MC__.S; S.storm=null; S.mods.filter(m=>m.status==='broken').forEach(m=>m.status='active'); S.last=__MC__.E.flows(S); const pads=S.mods.filter(m=>m.type==='pad'&&m.status==='active'); pads.forEach(p=>{ S.parked[p.id]=S.sol+20; }); const p=pads[pads.length-1]; __MC__.addFx('land',{x:p.x,y:p.y,id:p.id,dur:3400,fixedP:0.47}); })()");
    await settle(1400);
    await c.shot(join(OUT, "04-starship-landing.png"));
    await c.ev("__MC__.clearFx()");

    // 05 dust storm
    await c.ev("__MC__.S.storm={warn:0,sols:12,total:14,sun:0.15,global:true,active:true}; __MC__.setRes({power: 140}); __MC__.setPhase(0.4)");
    await settle(900);
    await c.shot(join(OUT, "05-global-dust-storm.png"));

    // 06 night
    await c.ev("__MC__.S.storm=null; __MC__.setRes({power: 380}); __MC__.setPhase(0.97)");
    await settle(900);
    await c.shot(join(OUT, "06-night-colony.png"));

    // 07 failure + inspector
    await c.ev("__MC__.setPhase(0.55); __MC__.S.res.spares=2; __MC__.forceEvent('failure')");
    await c.ev("(()=>{const m=__MC__.S.mods.find(q=>q.status==='broken'); if(m) __MC__.select(m.id);})()");
    await settle(900);
    await c.shot(join(OUT, "07-repair-inspector.png"));

    // 08 victory
    await c.ev("__MC__.newGame({seed:2,difficulty:'commander'}); __MC__.runAutopilot(900); __MC__.setPhase(0.5)");
    await sleep(1500);
    await c.shot(join(OUT, "08-victory.png"));

    // 09 defeat
    await c.ev("__MC__.newGame({seed:9,difficulty:'commander'}); __MC__.sabotage(['electrolyzer']); __MC__.setRes({o2:0,spares:0}); __MC__.step(40, true); __MC__.setPhase(0.8)");
    await sleep(1600);
    await c.shot(join(OUT, "09-defeat.png"));
    console.log("shots done; errors:", JSON.stringify(c.errors));
  } finally {
    await c.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
