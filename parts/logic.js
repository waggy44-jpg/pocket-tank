// ===== LOGIC START =====
var GOALS = ["seek_food","follow_friend","inspect_reef","visit_bubbles","explore","rest","dart_play"];
var STAGES = ["fry","juvenile","adult","elder"];
var STAGE_AT = [0, 70, 200, 460];
var TANK_MAX_FISH = 5;
var COLORS = ["#ffb347","#7ad3ff","#ff8fa8","#a6e07a","#c9a6ff","#ffe9a3"];

function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function lerp(a,b,t){ return a+(b-a)*t; }
function rnd(a,b){ return a+Math.random()*(b-a); }
function ri(n){ return Math.floor(Math.random()*n); }
function dist(ax,ay,bx,by){ var dx=ax-bx,dy=ay-by; return Math.sqrt(dx*dx+dy*dy); }
function clamp01(v){ return clamp(v,0,1); }

function stageFor(age){
  var s=0;
  for (var i=0;i<STAGE_AT.length;i++) if (age>=STAGE_AT[i]) s=i;
  return s;
}
function stageName(i){ return STAGES[clamp(i,0,3)]; }

function makeFish(nm, col, x, y){
  return {
    id: Math.random().toString(36).slice(2,9),
    name: nm, color: col, x:x, y:y, vx:0, vy:0, dir:1, tail:Math.random()*6.28,
    hunger: rnd(4,7), energy: rnd(7,9), stress: 1, curiosity: rnd(5,9), bored: 0,
    bold: ri(11), social: ri(11), lazy: ri(11),
    trust: 3, age: 0, grown: false, school: false,
    goal: "explore", urgency: 0, hesitate: 0, goalAge: 0, target: null,
    friend: null, friendT: 0, spookAng: rnd(0,6.28), spookedT: 0, savedY: null,
    seed: Math.random(), nextThink: 0, ate: 0,
    badges: [], seen: {needs:false,traits:false,trust:false}, held:false
  };
}

function temperament(f){
  return { bold:f.bold, shy:10-f.bold, social:f.social, solo:10-f.social,
           lazy:f.lazy, busy:10-f.lazy };
}

/* How much seagrass shelters a point: 0 open water, 1 tucked in the grass.
   Only beds the fish is actually beside count, so open floor stays open. */
function coverAt(tank,x,y){
  var c = 0;
  for (var i=0;i<tank.grass.length;i++){
    var b = tank.grass[i];
    if (Math.abs(x-b.x) > 26) continue;
    var top = tank.floor - b.h;
    if (y > top) c += clamp01((y-top)/(b.h+1)) * 0.8;
  }
  return clamp01(c);
}

function nearest(list,x,y){
  var b=null,bd=1e9;
  for (var i=0;i<list.length;i++){ var d=dist(x,y,list[i].x,list[i].y); if(d<bd){bd=d;b=list[i];} }
  return b;
}
function reefOf(tank){
  for (var i=0;i<tank.decor.length;i++) if (tank.decor[i].id==="castle") return tank.decor[i];
  return null;
}
function bedAt(tank,x){
  var b=null,bd=1e9;
  for (var i=0;i<tank.grass.length;i++){ var d=Math.abs(tank.grass[i].x-x); if(d<bd){bd=d;b=tank.grass[i];} }
  return b;
}

/* The state line — exactly the shape the 14.3M model is asked to complete. */
function stateLine(f, tank){
  var best=null,bd=1e9,i,g,d;
  for (i=0;i<tank.fish.length;i++){
    g = tank.fish[i];
    if (g.id===f.id || g.school) continue;
    d = dist(f.x,f.y,g.x,g.y);
    if (d<bd){ bd=d; best=g; }
  }
  var reef = reefOf(tank);
  var zone = f.y < tank.h*0.3 ? "surface" : (f.y > tank.floor-50 ? "floor" : "mid");
  return "zone "+zone
    +" hunger "+Math.round(f.hunger)
    +" energy "+Math.round(f.energy)
    +" stress "+Math.round(f.stress)
    +" curiosity "+Math.round(f.curiosity)
    +" bold "+f.bold
    +" social "+f.social
    +" stage "+stageName(stageFor(f.age))
    +" trust "+Math.round(f.trust)
    +" bored "+Math.round(f.bored)
    +" food "+(tank.pellets.length ? (nearest(tank.pellets,f.x,f.y) && dist(f.x,f.y,nearest(tank.pellets,f.x,f.y).x,nearest(tank.pellets,f.x,f.y).y)<120 ? "near":"far") : "none")
    +" friend "+(best ? (bd<45?"mid":(bd<120?"near":"far")) : "none")
    +" bubble "+(tank.bubbles ? (dist(f.x,f.y,tank.bubbles.x,tank.bubbles.y)<70?"near":"far") : "none")
    +" reef "+(reef ? (dist(f.x,f.y,reef.x,reef.y)<90?"near":"far") : "none")
    +" cover "+(coverAt(tank,f.x,f.y)>0.4?"yes":"no")
    +" light "+(tank.dark?"off":"on")
    +" last "+f.goal;
}

/* The advisor. On the board a 14.3M transformer reads the line and completes it
   with a goal and an urgency, sampled from its own distribution. This is the
   same interface over a weighted model of drives and traits: no rule ever
   overrides the pick, and a close call shows as hesitation. */
function scoreGoals(f, tank){
  var T = temperament(f);
  var h=f.hunger/10, e=f.energy/10, st=f.stress/10, cu=f.curiosity/10, bo=f.bored/10;
  var cover = coverAt(tank,f.x,f.y);
  var buddies = 0;
  for (var i=0;i<tank.fish.length;i++){
    var g=tank.fish[i];
    if (g.id!==f.id && !g.school && dist(f.x,f.y,g.x,g.y)<120) buddies++;
  }
  // Hunger is quartic and dominates: a starving fish must pick seek_food across
  // every personality. Everything discretionary is gated by (1-h) and by energy,
  // so a full belly and a tired fish both narrow the field honestly.
  var fed = (1 - h*0.96), lively = e;
  var s = {};
  s.seek_food     = h*h*h*h*60 + T.lazy*0.05;
  s.rest          = (1-e)*(1-e)*12 + T.lazy*0.10 + (tank.dark?2.2:0) + st*0.8;
  s.follow_friend = (buddies*(0.42+T.social*0.12) + T.shy*0.05) * (0.4+lively*0.6) + h*0.4;
  s.inspect_reef  = cu*(0.55+T.bold*0.07) * fed * (0.4+lively*0.6) + (reefOf(tank)?0.5:0)*fed;
  s.visit_bubbles = (0.42+T.curiosity*0.03)*(1-h)*(0.4+lively*0.6)*(tank.bubbles?1:0.15) + T.busy*0.05;
  // boredom is what keeps the tank moving: a bored, fed fish goes and looks at
  // a part of the tank it has not seen for a while
  s.dart_play     = (cu*0.6+bo*2.4+T.bold*0.13+T.busy*0.09)*(tank.dark?0.15:1)*fed*lively;
  s.explore       = (bo*4.2+cu*0.7+T.bold*0.08)*fed*lively*(1-cover*0.35);
  if (f.spookedT > 0){ s.dart_play = 0; s.explore *= 0.3; }
  return s;
}

function decide(f, tank){
  var s = scoreGoals(f,tank);
  var keys = GOALS.filter(function(g){ return s[g] > 0.05; });
  if (!keys.length) keys = ["rest"];
  var sum=0,i;
    for (i=0;i<keys.length;i++) sum += s[keys[i]];
    // Temper the distribution, then RENORMALISE. Raising to 1/temp changes the
    // total, and an un-normalised cdf silently dumps every sample past its end
    // onto the last key — which then gets picked far more than it deserves.
    var temp = 0.55 + f.stress*0.035 + f.bored*0.02;
    var w = [], total = 0;
    for (i=0;i<keys.length;i++){
      var p = Math.pow(s[keys[i]]/sum, 1/temp);
      w.push(p); total += p;
    }
    var r=Math.random(), acc=0, pick=keys[keys.length-1];
    for (i=0;i<keys.length;i++){
      acc += w[i]/total;
      if (r <= acc){ pick = keys[i]; break; }
    }
  var sorted = keys.slice().sort(function(a,b){ return s[b]-s[a]; });
  var top = s[sorted[0]], second = s[sorted[1]]||0;
  var margin = top>0 ? (top-second)/top : 1;
  // hesitation only on a genuine near-tie between the two front runners
  f.hesitate = (keys.length>1 && margin > 0 && margin < 0.30) ? rnd(0.7,1.6) : 0;
  f.urgency = clamp(Math.round(5 + f.hunger*0.4), 1, 9);
  if (f.goal !== pick){ f.goal = pick; f.goalAge = 0; }
  if (pick !== "follow_friend"){ f.friend = null; f.friendT = 0; }
  return pick;
}

/* The reflex layer only performs the chosen goal. */
function targetFor(f, tank, goal){
  var reef = reefOf(tank), p, best, bd, i, g, d, gc;
  switch(goal){
    case "seek_food":
      p = nearest(tank.pellets, f.x, f.y);
      return p ? {x:p.x, y:p.y} : null;
    case "follow_friend":
      if (f.friend && f.friendT>0 && f.friend.x!=null) return {x:f.friend.x, y:f.friend.y};
      best=null; bd=1e9;
      for (i=0;i<tank.fish.length;i++){
        g=tank.fish[i]; if (g.id===f.id||g.school) continue;
        d=dist(f.x,f.y,g.x,g.y); if(d<bd){bd=d;best=g;}
      }
      if (!best) return null;
      f.friend=best; f.friendT=6;
      return {x:best.x, y:best.y};
    case "inspect_reef":
      return reef ? {x:reef.x+rnd(-30,30), y:tank.floor-28} : null;
    case "visit_bubbles":
      return tank.bubbles ? {x:tank.bubbles.x+rnd(-16,16), y:tank.bubbles.y+52} : null;
    case "explore":
      return {x:rnd(26,tank.w-26), y:rnd(tank.h*0.24,tank.floor-28)};
    case "rest":
      gc=null;
      for (i=0;i<tank.grass.length;i++) if (!gc || tank.grass[i].h>gc.h) gc=tank.grass[i];
      return gc ? {x:gc.x+rnd(-14,14), y:tank.floor-14} : {x:rnd(30,tank.w-30), y:tank.floor-18};
    case "dart_play":
      return {x:rnd(26,tank.w-26), y:rnd(tank.h*0.18,tank.floor-32)};
  }
  return null;
}

function stepDrives(f, tank, dt){
  var rate = tank.dark ? 0.25 : 1;
  f.hunger = clamp(f.hunger + dt*0.055*rate, 0, 10);
  f.energy = clamp(f.energy - dt*0.030*rate + (f.goal==="rest" ? dt*0.30 : 0), 0, 10);
  var moving = (f.goal==="dart_play" || f.goal==="explore");
  f.bored  = clamp(f.bored + dt*(moving ? -1.6 : 0.16)*rate, 0, 10);
  if (f.hunger < 3) f.bored = clamp(f.bored + dt*0.05, 0, 10);
  f.curiosity = clamp(f.curiosity + dt*((f.goal==="rest"||f.goal==="seek_food") ? -0.02 : 0.03), 1, 10);
  var calm = tank.dark ? 1.7 : 1;
  var dStress = (tank.overgrown?0.075:0) + (f.hunger>8?0.02:0) + (tank.dark?0.012:0)
              - coverAt(tank,f.x,f.y)*0.10 - 0.055*calm;
  f.stress = clamp(f.stress + dt*dStress, 0, 10);
  if (f.spookedT > 0) f.spookedT = Math.max(0, f.spookedT - dt);
  f.goalAge += dt;
  if (f.friendT > 0) f.friendT -= dt;
  var care = (tank.overgrown ? -0.010 : 0.006) + (tank.algae>55 ? -0.006 : 0.002);
  f.trust = clamp(f.trust + dt*care*(1 - clamp01(f.age/2400)), 0, 10);
}

function swim(f, tank, dt){
  var sp = (44 + f.energy*4.2) * (f.goal==="dart_play" ? 1.75 : 1) * (tank.dark?0.55:1);
  if (f.hesitate > 0){ sp *= 0.18; f.hesitate -= dt; }
  if (f.spookedT > 0) sp *= 1.5;
  var ax=0, ay=0, i, g, ddx, ddy, dd;
  if (f.target){
    ddx = f.target.x - f.x; ddy = f.target.y - f.y;
    dd = Math.sqrt(ddx*ddx+ddy*ddy) || 1;
    // Steering must actually reach the speed cap, or a fish spends a minute
    // drifting toward a pellet it could cover in four seconds. Urgency scales
    // how eagerly it commits.
    var steer = 14 + f.urgency*3.2;
    ax += ddx/dd*steer;
    ay += ddy/dd*steer;
  }
  // Schooling: neighbours pull together, but a fish that has committed to a
  // meal must not be shoved off it by a neighbour jostling for the same pellet.
  // Separation only applies to fish that are NOT eating.
  for (i=0;i<tank.fish.length;i++){
    g = tank.fish[i]; if (g.id===f.id) continue;
    ddx = f.x-g.x; ddy = f.y-g.y; dd = Math.sqrt(ddx*ddx+ddy*ddy)||1;
    if (dd < 70 && f.goal !== "seek_food"){ ax += ddx/dd*(70-dd)/70*1.5; ay += ddy/dd*(70-dd)/70*1.5; }
    else if (dd > 165 && f.goal==="follow_friend"){ ax -= ddx/dd*0.5; ay -= ddy/dd*0.5; }
  }
  // A fish holds a level: buoyancy cancels the goal's vertical pull when it is
  // calm and unhurried. But a fish that has chosen to EAT must be able to go
  // down to the food — pellets sink to the sand, and cancelling vertical
  // movement here left a hungry fish drifting away from every meal it wanted.
  if (f.goal !== "rest" && f.goal !== "seek_food") ay -= f.vy*0.9;
  else if (f.goal === "seek_food") ay -= f.vy*0.12;
  if (f.spookedT > 0){ ax += Math.cos(f.spookAng)*9; ay += Math.sin(f.spookAng)*9; }
  f.vx += ax*dt*6; f.vy += ay*dt*6;
  var drag = Math.pow(0.90, dt*60);
  f.vx *= drag; f.vy *= drag;
  var v = Math.sqrt(f.vx*f.vx+f.vy*f.vy), maxv = sp;
  if (v > maxv){ f.vx = f.vx/v*maxv; f.vy = f.vy/v*maxv; }
  f.x += f.vx*dt; f.y += f.vy*dt;
  f.tail += dt*(2.2+v*0.11);
  var m = 13 + stageFor(f.age)*4 + (f.grown?4:0);
  f.x = clamp(f.x, m, tank.w-m);
  f.y = clamp(f.y, 16, tank.floor-9);
  if (Math.abs(f.vx) > 3) f.dir = f.vx > 0 ? 1 : -1;
  return v;
}

function eatCheck(f, tank){
  for (var i=0;i<tank.pellets.length;i++){
    var p = tank.pellets[i];
    if (dist(f.x,f.y,p.x,p.y) < 13 + stageFor(f.age)*3){
      tank.pellets.splice(i,1);
      f.hunger = clamp(f.hunger - rnd(3.4,5.2), 0, 10);
      return true;
    }
  }
  return false;
}

/* ---------- tank ---------- */
function makeTank(w,h){
  var t = {
    w:w, h:h, floor:h-16,
    fish:[], pellets:[], decor:[], bubbles:{x:w-34, y:70},
    grass:[], dark:false, algae:0, overgrown:false,
    coins:0, t:0, asleep:false, tool:null, toolUntil:0,
    pop:0, frenzy:0, log:[]
  };
  for (var i=0;i<7;i++) t.grass.push(mkGrass(w, h, i));
  t.overgrown = overgrown(t);
  return t;
}
function mkGrass(w,h,i){
  return { x: 26 + (w-52)*(i/6) + rnd(-6,6), h: rnd(34,62), sway: Math.random()*6.28, seed: Math.random() };
}
function newTank(w,h){
  var t = makeTank(w,h);
  var a = makeFish("Fry one", COLORS[0], w*0.38, h*0.5);
  var b = makeFish("Fry two", COLORS[1], w*0.62, h*0.5);
  t.fish.push(a,b);
  return t;
}

/* ---------- growth, arrivals, trust, upkeep ---------- */
function growth(f, tank, dt){
  var rate = tank.dark || tank.asleep ? 0.25 : 1;
  f.age += dt*rate;
  var st = stageFor(f.age);
  if (!f.grown && st >= 1){ f.grown = true; }
  return st;
}

/* A birth needs: two grown adults, tank trust up, a bed tall enough to hide
   in, and no fish already at the ceiling. */
function arrivalGates(tank){
  var adults = tank.fish.filter(function(f){ return stageFor(f.age) >= 2; });
  var trust = 0;
  tank.fish.forEach(function(f){ trust += f.trust; });
  trust = tank.fish.length ? trust/tank.fish.length : 0;
  var bed = 0;
  tank.grass.forEach(function(g){ if (g.h > bed) bed = g.h; });
  return {
    grown: adults.length >= 2,
    trust: trust >= 5.5,
    bed: bed >= 48,
    room: tank.fish.length < TANK_MAX_FISH
  };
}
function canArrive(tank){
  var g = arrivalGates(tank);
  return g.grown && g.trust && g.bed && g.room;
}
/* The dance: two trusting adults circle low in the grass for a while, then a
   fry appears between them. */
function courtTick(tank, dt){
  var adults = tank.fish.filter(function(f){ return stageFor(f.age) >= 2 && !f.school; });
  if (adults.length < 2) { tank.court = null; return; }
  if (!canArrive(tank)){ tank.court = null; return; }
  if (!tank.court){
    tank.court = { t:0, a:adults[0].id, b:adults[1].id, bed:bedAt(tank, adults[0].x) };
    return;
  }
  var a = null, b = null, i;
  for (i=0;i<adults.length;i++){
    if (adults[i].id === tank.court.a) a = adults[i];
    if (adults[i].id === tank.court.b) b = adults[i];
  }
  if (!a || !b){ tank.court = null; return; }
  tank.court.t += dt;
  var bed = tank.court.bed;
  if (bed){
    var ang = tank.court.t*1.15;
    a.x = lerp(a.x, bed.x + Math.cos(ang)*30, 0.045);
    a.y = lerp(a.y, tank.floor - 16, 0.045);
    a.dir = Math.cos(ang) >= 0 ? 1 : -1;
    b.x = lerp(b.x, bed.x + Math.cos(ang+0.5)*30, 0.045);
    b.y = lerp(b.y, tank.floor - 14, 0.045);
    b.dir = Math.cos(ang+0.5) >= 0 ? 1 : -1;
    a.held = b.held = false;
    if (tank.court.t > 26){
      var baby = makeFish("Fry", COLORS[ri(COLORS.length)], bed.x, tank.floor-20);
      baby.bold = clamp(Math.round((a.bold+b.bold)/2 + rnd(-1,1)),0,10);
      baby.social = clamp(Math.round((a.social+b.social)/2 + rnd(-1,1)),0,10);
      baby.trust = Math.max(a.trust,b.trust) - 1;
      tank.fish.push(baby);
      tank.court = null;
      tank.pop = 2.2;
      tank.news = { t: 0, b: "A fry arrived", s: "the tank changed someone" };
      addBadge(tank, "tank", "birth", "The tank changed someone");
    }
  }
}

function earn(tank, n){ tank.coins += n; }
function addBadge(tank, who, id, label){
  if (who === "tank"){
    if (!tank.badges) tank.badges = [];
    if (tank.badges.some(function(b){ return b.id===id; })) return false;
    tank.badges.push({id:id, label:label, fresh:true});
    return true;
  }
  return false;
}
function badgeFish(f, id, label){
  if (f.badges.some(function(b){ return b.id===id; })) return false;
  f.badges.push({id:id, label:label, fresh:true});
  return true;
}
function freshAny(fish, tank){
  for (var i=0;i<fish.length;i++) if (fish[i].badges.some(function(b){ return b.fresh; })) return true;
  return (tank.badges||[]).some(function(b){ return b.fresh; });
}
function cleared(fish, tank){
  fish.forEach(function(f){ f.badges.forEach(function(b){ b.fresh=false; }); });
  (tank.badges||[]).forEach(function(b){ b.fresh=false; });
}

/* Only a tank truly smothered by two beds at the ceiling is overgrown. */
function overgrown(tank){
  var tall = 0, i;
  for (i=0;i<tank.grass.length;i++) if (tank.grass[i].h > tank.h*0.42) tall++;
  return tall >= 2;
}
function stepTank(tank, dt){
  tank.t += dt;
  if (tank.tool && tank.t > tank.toolUntil){ tank.tool = null; tank.toolUntil = 0; }
  if (tank.pop > 0) tank.pop -= dt;

  // hunger economy: a meal lasts ~5 min awake. The tank holds off feeding
    // itself while anyone is begging, so the first meal is yours.
    var hungry = 0;
    for (var i=0;i<tank.fish.length;i++){
      if (!tank.fish[i].school && tank.fish[i].hunger > 8.6) hungry++;
    }
    tank.frenzy = clamp01(tank.frenzy + dt*(hungry>0 ? 0.12 : -0.10));
    if (hungry > 0 && tank.frenzy > 0.55 && tank.pellets.length < 5 && tank.t - (tank.lastDrop||0) > 4){
    var yy = rnd(18, 34);
    tank.pellets.push({x:rnd(20,tank.w-20), y:yy, vy:0, vy2:0});
    tank.lastDrop = tank.t;
    earn(tank, 1);
  }

  // seagrass grows, algae films the glass
  for (var j=0;j<tank.grass.length;j++){
    var g = tank.grass[j];
    g.sway += dt*0.7;
    g.h = Math.min(tank.h*0.55, g.h + dt*0.16*(tank.dark?0.4:1));
    // the urchin and the snail do their work at night
    var grazer = owned(tank, "urchin");
    var snail = owned(tank, "snail");
    if (tank.dark) g.h = Math.max(16, g.h - dt*(snail?0.30:0)*(grazer?1.7:1));
    else if (grazer && g.h > 40) g.h = Math.max(18, g.h - dt*0.08);
  }
  tank.algae = clamp(tank.algae + dt*(tank.dark?0.02:0.055), 0, 100);
  tank.overgrown = overgrown(tank);

  for (var f=0; f<tank.fish.length; f++){
    var fs = tank.fish[f];
    if (fs.school) continue;
    growth(fs, tank, dt);
    stepDrives(fs, tank, dt);
    if (tank.t > fs.nextThink || fs.goalAge > 6){
      fs.nextThink = tank.t + rnd(2.5,4.5);
      decide(fs, tank);
    }
    fs.target = targetFor(fs, tank, fs.goal);
    var v = swim(fs, tank, dt);
    if (eatCheck(fs, tank)){
      fs.ate++;
      badgeFish(fs, "meal", "First meal from you");
      earn(tank, 3);
      addBadge(tank, "tank", "fed", "First feeding");
    }
    if (fs.goal === "rest" && v < 12) badgeFish(fs, "rest", "First rest");
    if (fs.goal === "inspect_reef" && reefOf(tank) && fs.target &&
        dist(fs.x,fs.y,fs.target.x,fs.target.y) < 40) badgeFish(fs,"reef","First reef");
    if (fs.goal === "visit_bubbles" && tank.bubbles && fs.target &&
        dist(fs.x,fs.y,fs.target.x,fs.target.y) < 44) badgeFish(fs,"bubbles","First bubbles");
    if (fs.goal === "follow_friend" && fs.target &&
        dist(fs.x,fs.y,fs.target.x,fs.target.y) < 40) badgeFish(fs,"follow","First follow");
    if (fs.goal === "dart_play" && v > 70) badgeFish(fs,"dart","First dart");
  }
  courtTick(tank, dt);

  // shrimp school: eats what falls and multiplies
  for (var s=tank.fish.length-1; s>=0; s--){
    var sh = tank.fish[s];
    if (!sh.school) continue;
    for (var p2=0;p2<tank.pellets.length;p2++){
      if (sh.y < tank.floor-12 && dist(sh.x,sh.y,tank.pellets[p2].x,tank.pellets[p2].y) < 26){
        tank.pellets.splice(p2,1); sh.energy -= 1; earn(tank, 1); break;
      }
    }
    sh.x = clamp(sh.x + Math.sin(tank.t*1.7 + sh.seed*6)*10*dt, 10, tank.w-10);
    sh.y = clamp(sh.y + (sh.energy>3 ? 26 : -20)*dt, tank.h*0.35, tank.floor-8);
    if (sh.energy <= 0){ tank.fish.splice(s,1); }
  }

  // pellets sink
  for (var q=0;q<tank.pellets.length;q++){
    var pl = tank.pellets[q];
    pl.vy = Math.min(pl.vy + 26*dt, 22);
    pl.y += pl.vy*dt;
    if (pl.y > tank.floor-8){ pl.y = tank.floor-8; pl.vy = 0; }
  }
  // sleep: the tank keeps running, at a quarter speed
  tank.asleep = tank.dark;
  return tank;
}

/* Gestures: a feed tap on the surface line, a hold to befriend, three hard
   raps to scatter, a drag to clean, a two-tap for the light. */
function feedAt(tank, x, y){
  if (y > tank.h*0.34) return false;
  var n = tank.dark ? 1 : 3;
  for (var i=0;i<n;i++){
    tank.pellets.push({x:clamp(x+rnd(-16,16),18,tank.w-18), y:rnd(16,30), vy:0, vy2:0});
  }
  tank.frenzy = 1;
  earn(tank, 2);
  return true;
}
function holdAt(tank, x, y){
  var trusted = [];
  for (var i=0;i<tank.fish.length;i++){
    var f = tank.fish[i];
    if (f.school) continue;
    f.held = true;
    if (f.trust >= 4.5) trusted.push(f);
  }
  trusted.sort(function(a,b){ return b.trust-a.trust; });
  trusted.forEach(function(f){ badgeFish(f,"hold","First hold-approach"); });
  addBadge(tank,"tank","hold","First hold-approach");
  return trusted.length;
}
function rapAt(tank, x, y){
  var n = 0;
  for (var i=0;i<tank.fish.length;i++){
    var f = tank.fish[i];
    if (f.school) continue;
    var d = dist(f.x,f.y,x,y);
    if (d < 150){
      f.spookedT = 4.5; f.spookAng = Math.atan2(f.y-y, f.x-x);
      f.trust = clamp(f.trust - 0.9, 0, 10);
      f.vx += Math.cos(f.spookAng)*130; f.vy += Math.sin(f.spookAng)*130;
      n++;
    }
  }
  return n;
}
/* A stroke. The sponge only wipes glass, the scissors only trim; a bare
   finger does both. A stroke cuts exactly the fronds it crosses, at the
   height of the finger. */
function segHitsY(x0,y0, x1,y1, gx, top, bot){
  // does the segment (x0,y0)-(x1,y1) pass through the vertical band
  // at gx, between top and bot? (sampled, which is exact enough at this scale)
  var steps = 24;
  for (var i=0;i<=steps;i++){
    var u = i/steps;
    var x = lerp(x0,x1,u), y = lerp(y0,y1,u);
    if (Math.abs(x-gx) < 13 && y >= top && y <= bot) return u;
  }
  return -1;
}
function stroke(tank, x0,y0, x1,y1, tool){
  var cut = (tool !== "sponge"), wipe = (tool !== "scissors");
  var fronds = 0, glass = 0;
  for (var i=0;i<tank.grass.length;i++){
    var g = tank.grass[i];
    if (!cut) continue;
    // a stroke cuts at the height of your finger, and the bed keeps what was
    // below it: stroke low on the glass and the blade is cut to a nub, stroke
    // near the tip and only the top is taken. `tip` is the blade's top (smaller
    // y), `base` its foot in the sand, so tip < base.
    var tip = tank.floor - 6 - g.h*0.9, base = tank.floor - 10;
    var u = segHitsY(x0,y0, x1,y1, g.x, tip, base);
    if (u < 0) continue;
    // segHitsY returns the first sample inside the band, walking the blade
    // from its tip downward, so u falls as the stroke gets lower.
    var nh = Math.max(10, 6 + (1-u)*(g.h - 6));
    if (nh < g.h - 1){ g.h = nh; fronds++; }
  }
  if (wipe){
    var amount = clamp01(1 - Math.abs((x0+x1)/2/tank.w - 0.5)*0.4);
    tank.algae = clamp(tank.algae - 9*amount, 0, 100);
    glass = 1;
  }
  if (fronds) { earn(tank,1); addBadge(tank,"tank","trim","First trimming"); }
  if (glass) { earn(tank,1); addBadge(tank,"tank","glass","First glass cleaning"); }
  return { fronds:fronds, glass:glass };
}

function sleepTank(tank){
  tank.dark = !tank.dark;
  if (tank.dark){
    for (var i=0;i<tank.fish.length;i++) tank.fish[i].savedY = tank.fish[i].y;
    tank.asleepFrom = tank.t;
    addBadge(tank,"tank","night","First full night's sleep");
  } else {
    for (var j=0;j<tank.fish.length;j++) if (tank.fish[j].savedY!=null) tank.fish[j].y = tank.fish[j].savedY;
    // woken after a real stretch of sleep: the school is ravenous, and waits
    // just under the surface where you usually feed them
    if (tank.t - (tank.asleepFrom||0) > 60){
      tank.frenzy = 1;
      for (var k=0;k<tank.fish.length;k++){
        var f = tank.fish[k];
        if (f.school) continue;
        f.hunger = clamp(f.hunger + 2.5, 0, 10);
        f.y = rnd(20,40);
        f.energy = clamp(f.energy + 1.5, 0, 10);
      }
    }
    tank.asleepFrom = 0;
  }
  return tank.dark;
}

/* ---------- shop ---------- */
var SHOP = [
  { id:"sword", kind:"plant", name:"Sword plant", price:60, blurb:"A tall blade of grass. A fry needs cover to hide in." },
  { id:"snail", kind:"critter", name:"Algae snail", price:80, blurb:"Grazes the glass and trims the grass while the tank sleeps." },
  { id:"urchin", kind:"critter", name:"Sea urchin", price:120, blurb:"Keeps the grass down in daylight, so two beds never smother the tank." },
  { id:"castle", kind:"decor", name:"Castle", price:180, blurb:"A swim-through. Fish come to inspect it." },
  { id:"coral", kind:"decor", name:"Coral", price:150, blurb:"Slow colour on the back wall. Purely for looking at." }
];
function owned(tank,id){ return tank.decor.some(function(d){ return d.id===id; }); }
function buy(tank,id){
  var it = SHOP.filter(function(s){ return s.id===id; })[0];
  if (!it || owned(tank,id) || tank.coins < it.price) return false;
  tank.coins -= it.price;
  tank.decor.push({ id:it.id, kind:it.kind === "critter" ? it.id : "decor",
                    name:it.name, x:tank.w/2, y:tank.floor-14, seed:Math.random()*6.28 });
  if (it.id === "sword"){
    var g = mkGrass(tank.w, tank.h, ri(7));
    g.h = 74; g.x = clamp(tank.w/2 + rnd(-60,60), 24, tank.w-24);
    tank.grass.push(g);
  }
  return true;
}
function placeDecor(tank,id,x,y){
  for (var i=0;i<tank.decor.length;i++){
    if (tank.decor[i].id===id){
      tank.decor[i].x = clamp(x, 20, tank.w-20);
      tank.decor[i].y = clamp(y, tank.h*0.45, tank.floor-10);
      return true;
    }
  }
  return false;
}

/* ---------- save ---------- */
var KEY = "pockettank.v1";
function save(tank){
  try {
    var d = {
      w:tank.w, h:tank.h, t:tank.t, coins:tank.coins, algae:tank.algae,
      dark:tank.dark, grass:tank.grass, decor:tank.decor, bubbles:tank.bubbles,
      badges:tank.badges||[], pellets:tank.pellets,
      fish:tank.fish.map(function(f){
        return { id:f.id, name:f.name, color:f.color, x:f.x, y:f.y, vx:f.vx, vy:f.vy,
          hunger:f.hunger, energy:f.energy, stress:f.stress, curiosity:f.curiosity, bored:f.bored,
          bold:f.bold, social:f.social, lazy:f.lazy, trust:f.trust, age:f.age, grown:f.grown,
          school:f.school, badges:f.badges, seen:f.seen, tail:f.tail, dir:f.dir, seed:f.seed };
      })
    };
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch(e){ return false; }
}
function load(){
  try {
    var raw = localStorage.getItem(KEY);
    if (!raw) return null;
    var d = JSON.parse(raw);
    if (!d || !d.fish || !d.fish.length) return null;
    var t = makeTank(d.w || 360, d.h || 640);
    t.t = d.t || 0; t.coins = d.coins || 0; t.algae = d.algae || 0; t.dark = !!d.dark;
    t.grass = d.grass || t.grass; t.decor = d.decor || [];
    t.bubbles = d.bubbles || t.bubbles;
    t.badges = d.badges || []; t.pellets = d.pellets || [];
    t.fish = d.fish.map(function(o){
      var f = makeFish(o.name, o.color, o.x, o.y);
      f.id = o.id || f.id; f.vx = o.vx || 0; f.vy = o.vy || 0;
      f.hunger = o.hunger; f.energy = o.energy; f.stress = o.stress;
      f.curiosity = o.curiosity; f.bored = o.bored || 0;
      f.bold = o.bold; f.social = o.social; f.lazy = o.lazy; f.trust = o.trust;
      f.age = o.age; f.grown = !!o.grown; f.school = !!o.school;
      f.badges = o.badges || []; f.seen = o.seen || f.seen; f.tail = o.tail || 0;
      f.dir = o.dir || 1; f.seed = o.seed == null ? Math.random() : o.seed;
      return f;
    });
    return t;
  } catch(e){ return null; }
}
// ===== LOGIC END =====
