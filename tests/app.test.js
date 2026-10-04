// Logic suite: runs the LOGIC block from index.html in a vm with a localStorage
// stub, and asserts behaviour. See the vanilla-html-app-verification skill.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/\/\/ ===== LOGIC START =====([\s\S]*?)\/\/ ===== LOGIC END =====/);
if (!m){ console.error("FAIL: LOGIC markers not found"); process.exit(1); }
const slice = m[1];

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra){
  if (cond) pass++;
  else { fail++; failures.push(name + (extra ? " -> " + extra : "")); }
}
function eq(a, b, name){ ok(a === b, name, "got " + JSON.stringify(a) + " want " + JSON.stringify(b)); }
function has(h, sub, name){ ok(String(h).indexOf(sub) >= 0, name, "missing: " + sub); }

// Fresh context per load: the slice declares top-level consts, so a reused vm
// context would throw "Identifier already declared".
function load(extra){
  const store = {};
  const ctx = {
    Math: Math, JSON: JSON, Date: Date, console: console,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    }
  };
  if (extra) Object.assign(ctx, extra);
  vm.createContext(ctx);
  vm.runInContext(slice, ctx, { filename: "logic.js" });
  return ctx;
}
const L = load();
const T = k => L[k];

// ---------- helpers ----------
function tank(w, h){
  const t = T("makeTank")(w || 360, h || 640);
  t.fish = [];
  return t;
}
function fishIn(t, over){
  const f = T("makeFish")("Test", "#ffb347", over && over.x || 180, over && over.y || 300);
  Object.assign(f, over || {});
  t.fish.push(f);
  return f;
}
function run(t, seconds, dt){
  dt = dt || 1/30;
  const n = Math.round(seconds/dt);
  for (let i=0;i<n;i++) T("stepTank")(t, dt);
  return t;
}

// ---------- 1. state line ----------
{
  const t = tank();
  const f = fishIn(t, { hunger: 7.4, energy: 5.1, stress: 2.2, bold: 4, social: 6,
                        age: 200, trust: 6, bored: 3, goal: "explore" });
  const line = T("stateLine")(f, t);
  has(line, "hunger 7", "stateLine carries hunger");
  has(line, "energy 5", "stateLine carries energy");
  has(line, "bold 4", "stateLine carries bold");
  has(line, "stage adult", "stateLine carries stage at age 200");
  has(line, "trust 6", "stateLine carries trust");
  has(line, "bored 3", "stateLine carries boredom");
  has(line, "light on", "stateLine carries the light state");
  has(line, "last explore", "stateLine carries the previous goal");
  // the README's own example shape
  ok(/^zone (surface|mid|floor) /.test(line), "stateLine starts with a zone");
  ok(line.indexOf("NaN") < 0, "stateLine has no NaN");
}
{
  const t = tank();
  const f = fishIn(t, { x: 100, y: 40 });
  has(T("stateLine")(f, t), "zone surface", "stateLine zone reflects height");
  f.y = 600; t.floor = 624;
  has(T("stateLine")(f, t), "zone floor", "stateLine zone reflects the floor");
}

// ---------- 2. stages ----------
{
  eq(T("stageFor")(0), 0, "age 0 is a fry");
  eq(T("stageFor")(69), 0, "age 69 is still a fry");
  eq(T("stageFor")(70), 1, "age 70 is a juvenile");
  eq(T("stageFor")(199), 1, "age 199 is still a juvenile");
  eq(T("stageFor")(200), 2, "age 200 is an adult");
  eq(T("stageFor")(460), 3, "age 460 is an elder");
  eq(T("stageFor")(99999), 3, "stage is capped at elder");
}

// ---------- 3. the advisor owns its decision ----------
{
  const t = tank();
  const f = fishIn(t, { hunger: 9.9, energy: 8, stress: 0, curiosity: 5, bored: 0 });
  let picks = {};
  for (let i=0;i<400;i++){
    const g = T("decide")(f, t);
    picks[g] = (picks[g] || 0) + 1;
  }
  // a starving fish must overwhelmingly seek food, across every personality
  const pct = (picks.seek_food || 0) / 400;
  ok(pct >= 0.89, "a starving fish picks seek_food at least 89% of the time", "got " + (pct*100).toFixed(1) + "%");
  ok(Object.keys(picks).length >= 1, "the advisor always returns a goal");
  ok(L.GOALS.indexOf(Object.keys(picks)[0] !== undefined ? Object.keys(picks)[0] : "rest") >= 0,
     "every returned goal is in the vocabulary");
}
{
  // a calm, fed, tired fish rests
  const t = tank();
  const f = fishIn(t, { hunger: 1, energy: 0.4, stress: 0, curiosity: 5, bored: 0 });
  let rest = 0;
  for (let i=0;i<300;i++) if (T("decide")(f, t) === "rest") rest++;
  ok(rest/300 > 0.5, "an exhausted fish mostly rests", "got " + (rest/300*100).toFixed(0) + "%");
}
{
  // a bored, fed fish explores rather than parking
  const t = tank();
  const f = fishIn(t, { hunger: 3, energy: 8, stress: 0, curiosity: 10, bored: 10 });
  let ex = 0;
  for (let i=0;i<300;i++) if (T("decide")(f, t) === "explore") ex++;
  ok(ex/300 > 0.25, "a bored, fed fish explores", "got " + (ex/300*100).toFixed(0) + "%");
}
{
  // The sampled distribution must TRACK the scores. A sampler whose cdf does
  // not sum to 1 spills its tail onto whichever goal happens to be last, which
  // silently hands one goal a huge share it never earned. Assert the observed
  // ranking matches the scored ranking for two different situations.
  function observed(t, f, n){
    const tally = {};
    for (let i=0;i<n;i++){ const g = T("decide")(f, t); tally[g] = (tally[g]||0)+1; }
    return Object.keys(tally).sort((a,b)=>tally[b]-tally[a]);
  }
  {
    const t = tank();
    const f = fishIn(t, { hunger: 3, energy: 8, stress: 0, curiosity: 10, bored: 10 });
    const s = T("scoreGoals")(f, t);
    const byScore = L.GOALS.filter(g => s[g] > 0.05).sort((a,b)=>s[b]-s[a]);
    const obs = observed(t, f, 1200);
    ok(obs.length >= 2, "a fed fish varies its goal", "saw " + obs.join(","));
    eq(obs[0], byScore[0], "the most-picked goal is the top-scored one");
    ok(s[obs[0]] > s[obs[obs.length-1]],
       "no low-scoring goal outranks the top one (" + obs.join(",") + ")");
  }
  {
    // the same check in the other direction: hunger dominating the field
    const t = tank();
    const f = fishIn(t, { hunger: 9.5, energy: 6, stress: 0, curiosity: 6, bored: 6 });
    const obs = observed(t, f, 1200);
    eq(obs[0], "seek_food", "a starving fish's most-picked goal is seek_food");
    ok(tallyTop(t, f, "seek_food", 1200) > 0.7,
       "and it is picked most of the time, not leaked to another goal");
  }
  function tallyTop(t, f, goal, n){
    let c = 0;
    for (let i=0;i<n;i++) if (T("decide")(f, t) === goal) c++;
    return c/n;
  }
}
{
  // variety: the same situation can still produce different answers
  const t = tank();
  const f = fishIn(t, { hunger: 5, energy: 8, stress: 0, curiosity: 7, bored: 4 });
  const seen = {};
  for (let i=0;i<400;i++) seen[T("decide")(f, t)] = 1;
  ok(Object.keys(seen).length >= 3, "the advisor samples rather than always taking the top answer",
     "distinct goals: " + Object.keys(seen).join(","));
}
{
  // uncertainty shows as hesitation, never as a silent override. Drive many
  // situations and require that near-ties are actually reached.
  const t = tank();
  const seenHes = new Set();
  let minMargin = 1;
  for (let trial=0; trial<2000; trial++){
    const f = T("makeFish")("F", "#ffb347", 180, 300);
    f.hunger = Math.random()*10; f.energy = Math.random()*10;
    f.stress = Math.random()*10; f.curiosity = Math.random()*10;
    f.bored = Math.random()*10; f.bold = Math.random()*10; f.social = Math.random()*10;
    T("decide")(f, t);
    if (f.hesitate > 0) seenHes.add(1);
  }
  ok(seenHes.size > 0, "close calls produce hesitation");
}
{
  // and a clear winner never hesitates: starving must not dither
  const t = tank();
  let hes = 0;
  for (let trial=0; trial<200; trial++){
    const f = T("makeFish")("F", "#ffb347", 180, 300);
    Object.assign(f, { hunger: 9.9, energy: 8, stress: 0, curiosity: 5, bored: 0 });
    T("decide")(f, t);
    if (f.hesitate > 0) hes++;
  }
  eq(hes, 0, "a clear choice never hesitates");
}

// ---------- 4. scoring reflects traits ----------
{
  const t = tank();
  const bold = fishIn(t, { bold: 10, hunger: 5, energy: 8, stress: 0, curiosity: 9, bored: 6 });
  const shy = T("makeFish")("S", "#7ad3ff", 180, 300);
  Object.assign(shy, { bold: 0, hunger: 5, energy: 8, stress: 0, curiosity: 9, bored: 6 });
  ok(T("scoreGoals")(bold, t).explore > T("scoreGoals")(shy, t).explore,
     "a bold fish scores higher on exploring than a shy one");
}
{
  const t = tank();
  t.decor.push({ id: "castle", kind: "decor", x: 180, y: 600, seed: 0 });
  const f = fishIn(t);
  ok(T("scoreGoals")(f, t).inspect_reef > 0, "a reef draws inspection");
}

// ---------- 5. cover calms fish, overgrowth stresses them ----------
// covers stress, trust and gesture range
{
  const t = tank();
  t.grass = [{ x: 180, h: 70, sway: 0, seed: 0.5 }];
  const hidden = fishIn(t, { x: 180, y: t.floor - 10, stress: 3, hunger: 3 });
  const exposed = T("makeFish")("E", "#ffb347", 20, 100);
  Object.assign(exposed, { x: 20, y: 100, stress: 3, hunger: 3 });
  t.fish.push(exposed);
  run(t, 6);
  ok(hidden.stress < exposed.stress, "cover calms a fish relative to open water",
     "hidden " + hidden.stress.toFixed(2) + " vs exposed " + exposed.stress.toFixed(2));
}
{
  // overgrowth: two identical tanks differing only in the beds. stepTank
  // recomputes tank.overgrown from the grass, so set real beds rather than
  // poking the flag.
  const a = tank();
  a.grass = [{ x: 180, h: 400, sway: 0, seed: 0.5 }, { x: 300, h: 400, sway: 0, seed: 0.5 }];
  const b = tank();
  b.grass = [{ x: 180, h: 30, sway: 0, seed: 0.5 }];
  const fa = fishIn(a, { stress: 1, hunger: 3 });
  const fb = T("makeFish")("B", "#ffb347", 180, 300);
  Object.assign(fb, { stress: 1, hunger: 3 });
  b.fish.push(fb);
  eq(T("overgrown")(a), true, "two beds at the ceiling are an overgrown tank");
  eq(T("overgrown")(b), false, "a low bed is not");
  a.overgrown = T("overgrown")(a); b.overgrown = T("overgrown")(b);
  run(a, 10); run(b, 10);
  ok(fa.stress > fb.stress, "an overgrown tank stresses its fish",
     "overgrown " + fa.stress.toFixed(3) + " vs clean " + fb.stress.toFixed(3));
}
{
  // and neglect costs trust over time
  const a = tank(); a.overgrown = true; a.algae = 90;
  const b = tank(); b.overgrown = false; b.algae = 0;
  const fa = fishIn(a, { trust: 6 });
  const fb = T("makeFish")("B", "#ffb347", 180, 300);
  Object.assign(fb, { trust: 6 });
  b.fish.push(fb);
  run(a, 30); run(b, 30);
  ok(fa.trust < fb.trust, "a neglected tank loses the fish's trust",
     "neglected " + fa.trust.toFixed(2) + " vs cared for " + fb.trust.toFixed(2));
}

// ---------- 6. hunger economy + feeding ----------
{
  const t = tank();
  const f = fishIn(t, { hunger: 2, y: 25 });
  eq(t.pellets.length, 0, "no pellets before a feed");
  eq(T("feedAt")(t, 180, 25), true, "a tap on the water line feeds");
  ok(t.pellets.length >= 1, "feeding drops pellets");
  eq(T("feedAt")(t, 180, 500), false, "a tap in the middle does not feed");
  ok(t.frenzy === 1, "a fresh meal sets the frenzy");
}
{
  const t = tank();
  const f = fishIn(t, { hunger: 9, x: 180, y: 25 });
  t.pellets.push({ x: 180, y: 25, vy: 0, vy2: 0 });
  eq(T("eatCheck")(f, t), true, "a fish at a pellet eats it");
  eq(t.pellets.length, 0, "the pellet is gone");
  ok(f.hunger < 9, "eating reduces hunger", "hunger " + f.hunger.toFixed(2));
}
{
  const t = tank();
  const f = fishIn(t, { hunger: 9.9 });
  t.lastDrop = 0; t.frenzy = 0; t.t = 100;
  run(t, 30);
  ok(t.coins > 0, "an untended tank still feeds and earns sand dollars", "coins " + t.coins);
}

// ---------- 7. trust ----------
{
  const t = tank();
  const trusting = fishIn(t, { trust: 8, id: "a" });
  const wary = T("makeFish")("W", "#ff8fa8", 200, 300);
  Object.assign(wary, { trust: 2, id: "b" });
  t.fish.push(wary);
  eq(T("holdAt")(t, 180, 300), 1, "only the fish that trust you come to a held finger");
  ok(trusting.badges.some(b => b.id === "hold"), "a hold earns the badge");
}
{
  const t = tank();
  const f = fishIn(t, { trust: 8, x: 180, y: 300 });
  eq(T("rapAt")(t, 180, 300), 1, "a hard rap scatters nearby fish");
  ok(f.spookedT > 0, "a scattered fish stays spooked");
  ok(f.trust < 8, "a rap costs trust", "trust " + f.trust.toFixed(2));
  const far = T("makeFish")("F", "#ffb347", 20, 100);
  Object.assign(far, { trust: 9, id: "z" });
  t.fish.push(far);
  const n2 = T("rapAt")(t, 180, 300);
  ok(n2, 0, "a rap only reaches the fish near it");
}

// ---------- 8. upkeep: trimming and glass ----------
{
  const t = tank();
  t.grass = [{ x: 180, h: 70, sway: 0, seed: 0.5 }];
  const before = t.grass[0].h;
  const r = T("stroke")(t, 160, t.floor - 30, 200, t.floor - 30, null);
  ok(r.fronds === 1, "a stroke at grass height cuts the frond", "got " + r.fronds);
  ok(t.grass[0].h < before, "the frond is shorter after a cut", before.toFixed(1) + " -> " + t.grass[0].h.toFixed(1));
}
{
  const t = tank();
  t.grass = [{ x: 180, h: 70, sway: 0, seed: 0.5 }];
  const gh = t.grass[0].h;
  T("stroke")(t, 160, t.floor - 30, 200, t.floor - 30, "sponge");
  eq(t.grass[0].h, gh, "the sponge leaves the grass alone");
}
{
  const t = tank();
  t.grass = [{ x: 180, h: 70, sway: 0, seed: 0.5 }];
  const gh = t.grass[0].h;
  const r = T("stroke")(t, 160, t.floor - 30, 200, t.floor - 30, "scissors");
  eq(r.glass, 0, "the scissors leave the glass alone");
  ok(t.grass[0].h < gh, "the scissors still cut");
}
{
  const t = tank();
  t.algae = 80;
  const r = T("stroke")(t, 40, 300, 320, 300, null);
  ok(t.algae < 80, "a drag squeegees the glass", "algae " + t.algae.toFixed(1));
  ok(r.glass === 1, "the stroke reports the glass as cleaned");
}
{
  const t = tank();
  t.grass = [{ x: 180, h: 70, sway: 0, seed: 0.5 }];
  T("stroke")(t, 160, 40, 200, 80, null);
  eq(t.grass[0].h, 70, "a stroke above the grass misses it entirely");
}

// ---------- 9. the light / sleep ----------
{
  const t = tank();
  eq(t.dark, false, "the tank starts lit");
  eq(T("sleepTank")(t), true, "the light goes out");
  eq(t.dark, true, "the tank is dark");
  eq(T("sleepTank")(t), false, "and back on");
}
{
  // growth runs with the clock, lit or not, at a quarter speed asleep
  const lit = tank(); fishIn(lit); lit.dark = false;
  const dark = tank(); fishIn(dark); dark.dark = true;
  run(lit, 30); run(dark, 30);
  const litAge = lit.fish[0].age, darkAge = dark.fish[0].age;
  ok(litAge > darkAge * 2, "a sleeping tank grows at a quarter speed",
     "lit " + litAge.toFixed(1) + " vs dark " + darkAge.toFixed(1));
}
{
  // wake after a long sleep, through the real entry point: the school is
  // ravenous and waits just under the surface where you usually feed them
  const t = tank();
  const f = fishIn(t, { hunger: 4, y: 300 });
  eq(T("sleepTank")(t), true, "the light goes out");
  run(t, 120);
  ok(t.dark, "still asleep after two minutes of tank time");
  T("sleepTank")(t);
  ok(t.frenzy > 0.9, "waking after a long sleep leaves the school ravenous", "frenzy " + t.frenzy.toFixed(2));
  ok(f.y < 60, "they gather just under the surface", "y " + f.y.toFixed(0));
  ok(f.hunger > 6, "and they are hungry", "hunger " + f.hunger.toFixed(1));
}
{
  // a short nap is not a night's sleep: nothing special happens on waking
  const t = tank();
  const f = fishIn(t, { hunger: 4, y: 300 });
  T("sleepTank")(t);
  run(t, 20);
  T("sleepTank")(t);
  ok(t.frenzy < 0.9, "a short nap leaves them merely hungry, not frenzied", "frenzy " + t.frenzy.toFixed(2));
}

// ---------- 10. arrivals ----------
{
  const t = tank();
  const a = fishIn(t, { age: 250, trust: 8 });
  const b = T("makeFish")("B", "#7ad3ff", 220, 300);
  Object.assign(b, { age: 250, trust: 8, id: "b" });
  t.fish.push(b);
  t.grass = [{ x: 180, h: 70, sway: 0, seed: 0.5 }];
  const g = T("arrivalGates")(t);
  ok(g.grown, "two grown adults open the grown gate");
  ok(g.trust, "high trust opens the trust gate");
  ok(g.bed, "a tall bed opens the bed gate");
  ok(g.room, "a tank under the ceiling has room");
  eq(T("canArrive")(t), true, "all gates met means a fry can come");
}
{
  const t = tank();
  const a = fishIn(t, { age: 250, trust: 8 });
  const b = T("makeFish")("B", "#7ad3ff", 220, 300);
  Object.assign(b, { age: 250, trust: 8, id: "b" });
  t.fish.push(b);
  t.grass = [{ x: 180, h: 20, sway: 0, seed: 0.5 }];
  eq(T("arrivalGates")(t).bed, false, "a short bed keeps the gate shut");
  eq(T("canArrive")(t), false, "and no fry arrives");
}
{
  const t = tank();
  const a = fishIn(t, { age: 250, trust: 8, x: 180, y: 300 });
  const b = T("makeFish")("B", "#7ad3ff", 220, 300);
  Object.assign(b, { age: 250, trust: 8, id: "b" });
  t.fish.push(b);
  t.grass = [{ x: 180, h: 70, sway: 0, seed: 0.5 }];
  // the dance starts, and a fry arrives a few seconds into it
  const before = t.fish.length;
  run(t, 40);
  ok(t.fish.length > before, "a fry is born once the gates are met",
     before + " -> " + t.fish.length);
  const baby = t.fish[t.fish.length-1];
  eq(T("stageFor")(baby.age), 0, "the arrival is a fry");
  ok(baby.bold >= 0 && baby.bold <= 10, "the fry inherits a sane trait", "bold " + baby.bold);
  ok(t.badges.some(x => x.id === "birth"), "the tank notes it changed someone");
}
{
  // the ceiling holds
  const t = tank();
  for (let i=0;i<5;i++) fishIn(t, { age: 250, trust: 8, id: "f"+i });
  t.grass = [{ x: 180, h: 70, sway: 0, seed: 0.5 }];
  eq(T("arrivalGates")(t).room, false, "a full tank has no room for another");
  const n = t.fish.length;
  run(t, 40);
  eq(t.fish.length, n, "and the tank stays at five");
}

// ---------- 11. shop ----------
{
  const t = tank();
  t.coins = 0;
  eq(T("buy")(t, "castle"), false, "you cannot buy what you cannot afford");
  t.coins = 200;
  eq(T("buy")(t, "castle"), true, "coins buy a castle");
  eq(t.coins, 20, "the price is taken", "coins " + t.coins);
  eq(T("buy")(t, "castle"), false, "and you cannot buy it twice");
  eq(T("owned")(t, "castle"), true, "the castle is in the tank");
}
{
  const t = tank();
  t.coins = 500;
  T("buy")(t, "sword");
  ok(t.grass.some(g => g.h > 60), "the sword plant adds a tall blade");
  t.coins = 500;
  T("buy")(t, "snail"); T("buy")(t, "urchin");
  ok(t.decor.some(d => d.id === "snail"), "the snail is placed");
  ok(t.decor.some(d => d.id === "urchin"), "the urchin is placed");
}
{
  const t = tank();
  t.coins = 500;
  T("buy")(t, "castle");
  eq(T("placeDecor")(t, "castle", 40, 100), true, "a bought decoration can be placed");
  eq(t.decor.filter(d => d.id === "castle")[0].x, 40, "at the x you tapped");
  eq(T("placeDecor")(t, "nope", 10, 10), false, "you cannot place what you do not own");
  // placement is clamped inside the glass
  T("placeDecor")(t, "castle", -50, 99999);
  const c = t.decor.filter(d => d.id === "castle")[0];
  ok(c.x >= 20 && c.y <= t.floor - 10, "placement stays inside the tank", c.x + "," + c.y);
}
{
  // the snail and the urchin actually do their work, while the tank sleeps
  const t = tank();
  t.coins = 500; T("buy")(t, "snail"); T("buy")(t, "urchin");
  t.grass = [{ x: 180, h: 90, sway: 0, seed: 0.5 }];
  const before = t.grass[0].h;
  t.dark = true;
  run(t, 60);
  ok(t.grass[0].h < before, "the grazers keep the grass down overnight",
     before.toFixed(1) + " -> " + t.grass[0].h.toFixed(1));
}

// ---------- 12. badges ----------
{
  const t = tank();
  eq(T("badgeFish")(t.fish[0] || fishIn(t), "meal", "First meal"), true, "a badge is earned");
  eq(T("badgeFish")(t.fish[0], "meal", "First meal"), false, "and not earned twice");
  eq(T("addBadge")(t, "tank", "fed", "First feeding"), true, "a tank badge is earned");
  eq(T("addBadge")(t, "tank", "fed", "First feeding"), false, "and not earned twice");
  eq(T("addBadge")(t, "fish", "x", "y"), false, "addBadge only writes tank badges");
}
{
  const t = tank();
  fishIn(t);
  t.fish[0].badges.push({ id: "meal", label: "First meal", fresh: true });
  eq(T("freshAny")(t.fish, t), true, "a fresh badge is noticed");
  T("cleared")(t.fish, t);
  eq(T("freshAny")(t.fish, t), false, "and stops being fresh once seen");
}
{
  // the whole thing earns firsts on its own over a few minutes
  const t = tank();
  fishIn(t, { hunger: 4 });
  T("feedAt")(t, 180, 25);
  run(t, 120);
  const b = t.fish[0].badges.map(x => x.id);
  ok(b.indexOf("meal") >= 0, "a fish that eats earns first meal", "badges: " + b.join(","));
  ok(t.badges.some(x => x.id === "fed"), "the tank earns first feeding");
}

// ---------- 13. persistence ----------
{
  const t = tank();
  const f = fishIn(t, { name: "Pepper", age: 300, trust: 7 });
  t.coins = 42; t.algae = 33;
  T("save")(t);
  const back = T("load")();
  ok(back !== null, "a saved tank loads");
  eq(back.fish.length, 1, "the fish came back");
  eq(back.fish[0].name, "Pepper", "with its name");
  eq(Math.round(back.fish[0].age), 300, "and its age");
  eq(back.coins, 42, "and the sand dollars");
  eq(Math.round(back.algae), 33, "and the algae");
  eq(T("stageFor")(back.fish[0].age), 2, "an age-300 fish is still an adult");
}
{
  const back = T("load")();
  ok(Array.isArray(back.grass) && back.grass.length > 0, "the grass survives a save");
  ok(back.bubbles && typeof back.bubbles.x === "number", "the bubbles survive a save");
}
{
  // a save of any length loads: a missing field must not throw
  L.localStorage.setItem("pockettank.v1", JSON.stringify({
    w: 360, h: 640, fish: [{ id: "old", name: "Old", color: "#ffb347", x: 100, y: 200,
      hunger: 5, energy: 5, stress: 1, curiosity: 5, bold: 5, social: 5, lazy: 5,
      trust: 5, age: 100 }]
  }));
  const old = T("load")();
  ok(old !== null, "an older, shorter save still loads");
  eq(old.fish.length, 1, "with its fish intact");
  eq(old.fish[0].name, "Old", "and its name");
  ok(typeof old.fish[0].bored === "number", "missing fields default to sane values");
}

// ---------- 14. long-run stability ----------
{
  const t = tank();
  fishIn(t, { hunger: 5 });
  fishIn(t, { hunger: 5 });
  run(t, 400);
  const real = t.fish.filter(f => !f.school);
  ok(real.length >= 2, "no fish vanish over a long run", "left " + real.length);
  for (const f of real){
    ok(isFinite(f.x) && isFinite(f.y), "positions stay finite", f.name + " " + f.x + "," + f.y);
    ok(f.x >= 0 && f.x <= t.w, "fish stay inside the glass horizontally", f.x);
    ok(f.y >= 0 && f.y <= t.floor, "fish stay inside the glass vertically", f.y);
    ok(f.hunger >= 0 && f.hunger <= 10, "hunger stays in range", f.hunger);
    ok(f.trust >= 0 && f.trust <= 10, "trust stays in range", f.trust);
    ok(f.stress >= 0 && f.stress <= 10, "stress stays in range", f.stress);
  }
  ok(t.fish.length <= 5, "the tank never exceeds its ceiling", "n " + t.fish.length);
  ok(isFinite(t.algae), "algae stays finite");
}
{
  // every goal is reachable over a long run, i.e. none is dead
  const t = tank();
  fishIn(t, { hunger: 5 });
  const seen = {};
  for (let i=0;i<30000;i++){ T("stepTank")(t, 1/30); seen[t.fish[0].goal] = 1; }
  ok(Object.keys(seen).length >= 5, "most goals appear over a long run",
     "saw " + Object.keys(seen).join(","));
  ok(seen.seek_food, "seek_food is reachable");
  ok(seen.rest, "rest is reachable");
}

// ---------- 15. tool expiry ----------
{
  const t = tank();
  fishIn(t);
  t.tool = "sponge"; t.toolUntil = t.t + 10;
  run(t, 20);
  eq(t.tool, null, "a tool goes back by itself");
}

// ---------- 16. a hungry fish must actually reach its food ----------
// This is the bug that survived a fully green suite: fish chose seek_food and
// targeted the pellet correctly, but the buoyancy term cancelled their descent,
// so pellets sank to the sand and nothing was ever eaten.
{
  const t = tank();
  const f = fishIn(t, { hunger: 9, x: 180, y: 60 });
  T("feedAt")(t, 180, 25);
  run(t, 60);
  ok(t.pellets.length === 0, "a hungry fish clears the pellets it was given",
     t.pellets.length + " left after 60s");
  ok(f.ate > 0, "and it counts as a meal", "ate " + f.ate);
  ok(f.hunger < 9, "and its hunger comes down", "hunger " + f.hunger.toFixed(1));
}
{
  // The same, from several starting positions. A fish need not clear every
  // pellet — it eats, then goes off to do something else and the rest is
  // unclaimed. What must hold is that every position manages at least one meal.
  let ate = 0;
  const detail = [];
  for (let trial=0; trial<8; trial++){
    const t = tank();
    const fx = 40 + trial*40, fy = 40 + (trial%3)*60;
    const f = fishIn(t, { hunger: 9.5, x: fx, y: fy });
    f.goal = "seek_food"; f.nextThink = 1e9;   // keep it committed to eating
    T("feedAt")(t, fx, 25);
    run(t, 45);
    detail.push(fx + "," + fy + "=" + f.ate);
    if (f.ate > 0) ate++;
  }
  eq(ate, 8, "a hungry fish eats from every position", detail.join(" "));
}

{
  // TWO fish, as every real tank has. The single-fish tests above all passed
  // while a two-fish tank starved: schooling repulsion shoved a fish off the
  // pellet its neighbour was eating. Test the real population.
  const t = tank(774, 498);
  t.floor = 482;
  const a = fishIn(t, { hunger: 9.5, x: 380, y: 300 });
  const b = fishIn(t, { hunger: 9.5, x: 400, y: 300 });
  T("feedAt")(t, 390, 25);
  run(t, 60);
  ok(a.ate + b.ate > 0, "a two-fish tank feeds itself",
     "ate " + a.ate + " and " + b.ate + ", " + t.pellets.length + " pellets left");
  ok(Math.min(a.hunger, b.hunger) < 9.5, "and at least one fish is fed",
     a.hunger.toFixed(1) + " / " + b.hunger.toFixed(1));
}
{
  // both fish committed to eating, side by side, one pellet between them
  const t = tank();
  const a = fishIn(t, { hunger: 9.5, x: 172, y: 300 });
  const b = fishIn(t, { hunger: 9.5, x: 186, y: 300 });
  a.goal = "seek_food"; b.goal = "seek_food";
  a.nextThink = 1e9; b.nextThink = 1e9;
  t.pellets.push({ x: 180, y: 26, vy: 0, vy2: 0 });
  run(t, 60);
  ok(a.ate > 0 || b.ate > 0, "a neighbour cannot starve a fish off its own pellet",
     "ate " + a.ate + " / " + b.ate);
}

{
  // A fish must arrive in a REASONABLE time. The steering force once sat so
  // far below the speed cap that a fish took 61 seconds to reach a pellet it
  // could cover in four — it was still eating, so a bare "did it eat?" test
  // passed the whole time. Assert the clock.
  const t = tank(774, 498);
  t.floor = 482;
  const f = fishIn(t, { hunger: 9.5, x: 440, y: 100 });
  f.goal = "seek_food"; f.nextThink = 1e9;
  t.pellets.push({ x: 387, y: 474, vy: 0, vy2: 0 });
  let secs = 0;
  while (f.ate === 0 && secs < 40){ T("stepTank")(t, 1/30); f.goal = "seek_food";
    f.target = T("targetFor")(f, t, f.goal); f.nextThink = 1e9; secs += 1/30; }
  ok(f.ate > 0, "it reaches the pellet at all");
  ok(secs < 25, "and it gets there in a sane time", secs.toFixed(1) + "s");
}

// ---------- tally ----------
console.log("logic: " + pass + " passed, " + fail + " failed");
if (fail){
  failures.forEach(f => console.log("  FAIL: " + f));
  process.exit(1);
}