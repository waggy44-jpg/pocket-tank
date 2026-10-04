// ===== VIEW START =====
var cv = document.getElementById("c");
var ctx = cv.getContext("2d");
var W = 360, H = 640;
var tank = null;
var vol = 0.55, bri = 1.0;
var placing = null;   // id of a decoration being placed
var openPanel = null;
var selFish = null;
var firstRun = true;
var lastTap = 0, rapCount = 0, rapWin = 0;
var holdTimer = null, strokePrev = null, moved = 0;
var banners = [];

function fit(){
  var r = cv.getBoundingClientRect();
  var dpr = Math.min(window.devicePixelRatio||1, 2);
  W = Math.max(240, Math.round(r.width));
  H = Math.max(320, Math.round(r.height));
  cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  tank.w = W; tank.h = H; tank.floor = H-16;
}
function say(b, s, ms){
  var el = document.getElementById("banner");
  el.querySelector("b").textContent = b;
  el.querySelector("span").textContent = s || "";
  el.style.display = "block";
  clearTimeout(say._t);
  say._t = setTimeout(function(){ el.style.display = "none"; }, ms || 2600);
}
function chime(kind){
  if (vol <= 0) return;
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    if (!chime.ac) chime.ac = new AC();
    var ac = chime.ac;
    if (ac.state === "suspended") ac.resume();
    var o = ac.createOscillator(), g = ac.createGain();
    var now = ac.currentTime;
    var f = { feed:520, eat:760, card:420, birth:880, light:300, trim:640, chip:900 }[kind] || 500;
    o.type = kind==="birth" ? "triangle" : "sine";
    o.frequency.setValueAtTime(f, now);
    o.frequency.exponentialRampToValueAtTime(f*1.5, now+0.10);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.09*vol, now+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now+0.28);
    o.connect(g); g.connect(ac.destination);
    o.start(now); o.stop(now+0.3);
  } catch(e){}
}

/* ---------- drawing ---------- */
function drawTank(t){
  var dim = tank.dark ? 0.42 : 1.0;
  var gr = ctx.createLinearGradient(0,0,0,H);
  gr.addColorStop(0, darken("#0d3550", dim));
  gr.addColorStop(0.55, darken("#0a2233", dim));
  gr.addColorStop(1, darken("#061522", dim));
  ctx.fillStyle = gr; ctx.fillRect(0,0,W,H);

  // back glow
  var rg = ctx.createRadialGradient(W*0.5, H*0.18, 10, W*0.5, H*0.18, H*0.6);
  rg.addColorStop(0, "rgba(90,190,235,"+(tank.dark?0.03:0.13)+")");
  rg.addColorStop(1, "rgba(90,190,235,0)");
  ctx.fillStyle = rg; ctx.fillRect(0,0,W,H);

  drawSand(t, dim);
  if (t.bubbles) drawBubbles(t, dim);
  drawGrass(t, dim);
  drawDecor(t, dim);
  if (t.decor.some(function(d){ return d.id==="coral"; })) drawCoral(t, dim);
  drawPellets(t);
  for (var i=0;i<t.fish.length;i++) drawFish(t.fish[i], dim);
  drawGlass(t);
  drawPlaceHint(t);
}
function darken(hex, k){
  var n = parseInt(hex.slice(1),16);
  var r = Math.round(((n>>16)&255)*k), g = Math.round(((n>>8)&255)*k), b = Math.round((n&255)*k);
  return "rgb("+r+","+g+","+b+")";
}
function drawSand(t, dim){
  ctx.fillStyle = darken("#c9b489", dim*0.95);
  ctx.beginPath(); ctx.moveTo(0,H);
  var y = t.floor;
  ctx.lineTo(0,y);
  for (var x=0;x<=W;x+=12){
    y = t.floor + Math.sin(x*0.021)*3 + Math.sin(x*0.007)*2;
    ctx.lineTo(x,y);
  }
  ctx.lineTo(W,H); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,.14)";
  for (var i=0;i<26;i++){
    var px = (i*137.5)%W, py = t.floor+4+((i*29)%9);
    ctx.fillRect(px, py, 2, 1.6);
  }
}
function drawGrass(t, dim){
  for (var i=0;i<t.grass.length;i++){
    var g = t.grass[i];
    var sway = Math.sin(g.sway)*7;
    var hue = g.seed > 0.5 ? "#2f8f63" : "#26795a";
    ctx.strokeStyle = darken(hue, dim);
    ctx.lineWidth = 3.4; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(g.x, t.floor+3);
    var seg = 7;
    for (var s=1;s<=seg;s++){
      var u = s/seg;
      ctx.lineTo(g.x + sway*u*u, t.floor+3 - g.h*u);
    }
    ctx.stroke();
    ctx.strokeStyle = darken("#3fbb85", dim);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}
function drawBubbles(t, dim){
  if (dim < 0.5) return;
  var bx = t.bubbles.x, by = t.bubbles.y;
  ctx.strokeStyle = "rgba(140,210,240,.28)";
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(bx, t.floor); ctx.lineTo(bx, by); ctx.stroke();
  for (var i=0;i<16;i++){
    var ph = (t.t*0.55 + i*0.137) % 1;
    var y = t.floor - ph*(t.floor-by);
    var r = 1.4 + ((i*7)%5)*0.6;
    ctx.globalAlpha = (1-ph)*0.75*(dim-0.4)/0.6;
    ctx.fillStyle = "rgba(200,240,255,.9)";
    ctx.beginPath(); ctx.arc(bx + Math.sin(ph*9+i)*4, y, r, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
  }
}
function drawDecor(t, dim){
  for (var i=0;i<t.decor.length;i++){
    var d = t.decor[i];
    var w = Math.sin(t.t*1.4 + d.seed)*3;
    ctx.save(); ctx.translate(d.x, d.y);
    if (d.id === "castle"){
      ctx.fillStyle = darken("#8fa3b0", dim);
      ctx.fillRect(-22, -30, 44, 30);
      ctx.fillRect(-26, -38, 10, 38);
      ctx.fillRect(16, -38, 10, 38);
      ctx.fillStyle = darken("#41525d", dim);
      ctx.fillRect(-8, -16, 16, 16);
      ctx.beginPath(); ctx.arc(0,-30,14,Math.PI,0); ctx.fill();
    } else if (d.id === "urchin"){
      ctx.strokeStyle = darken("#6b4b8a", dim); ctx.lineWidth = 1.6;
      for (var s=0;s<18;s++){
        var a = s/18*6.2832 + t.t*0.15;
        ctx.beginPath(); ctx.moveTo(0,0);
        ctx.lineTo(Math.cos(a)*12, Math.sin(a)*8); ctx.stroke();
      }
      ctx.fillStyle = darken("#4a3168", dim);
      ctx.beginPath(); ctx.ellipse(0,0,7,5,0,0,6.2832); ctx.fill();
    } else if (d.id === "snail"){
      ctx.fillStyle = darken("#c9b08a", dim);
      ctx.beginPath(); ctx.ellipse(0,-3,10,6,0,0,6.2832); ctx.fill();
      ctx.strokeStyle = darken("#a98f6a", dim); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(-2,-7,5,w*0.1,0,6.2832); ctx.stroke();
    }
    ctx.restore();
  }
}
function drawCoral(t, dim){
  var d = t.decor.filter(function(x){ return x.id==="coral"; })[0];
  if (!d) return;
  ctx.save(); ctx.translate(d.x, d.y);
  ctx.strokeStyle = darken("#ff9ec4", dim); ctx.lineWidth = 4; ctx.lineCap = "round";
  for (var b=0;b<3;b++){
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.quadraticCurveTo(b*8-8, -22, b*9-14, -38 - Math.sin(t.t+b)*3);
    ctx.stroke();
  }
  ctx.restore();
}
function drawPellets(t){
  for (var i=0;i<t.pellets.length;i++){
    var p = t.pellets[i];
    ctx.fillStyle = "#e8b25e";
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, 6.2832); ctx.fill();
  }
}
function drawFish(f, dim){
  var st = stageFor(f.age);
  var len = (26 + st*8 + (f.grown?6:0)) * (f.school?0.42:1);
  var hgt = len*0.44;
  var shiver = f.spookedT > 0 ? Math.sin(f.tail*4)*1.6 : 0;

  ctx.save();
  ctx.translate(f.x, f.y + shiver);
  ctx.scale(f.dir, 1);
  ctx.globalAlpha = dim;

  if (f.school){
    ctx.fillStyle = "rgba(255,180,190,.75)";
    for (var k=-1;k<=1;k++){
      ctx.save(); ctx.translate(k*7, k*4);
      ctx.beginPath(); ctx.ellipse(0,0,len*0.5,hgt*0.5,0,0,6.2832); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = dim;
    ctx.restore(); return;
  }

  // tail
  var tw = Math.sin(f.tail)*0.5;
  ctx.fillStyle = shade(f.color, -0.22);
  ctx.beginPath();
  ctx.moveTo(-len*0.42, 0);
  ctx.lineTo(-len*0.72, -hgt*0.62 + tw*hgt*0.5);
  ctx.lineTo(-len*0.66, hgt*0.62 + tw*hgt*0.5);
  ctx.closePath(); ctx.fill();

  // body
  var bg = ctx.createLinearGradient(0,-hgt/2,0,hgt/2);
  bg.addColorStop(0, shade(f.color, 0.30));
  bg.addColorStop(1, shade(f.color, -0.24));
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(0,0,len*0.5,hgt*0.5,0,0,6.2832); ctx.fill();

  // markings arrive with the first growth spurt; elders get a crest
  if (st >= 1){
    ctx.fillStyle = shade(f.color, -0.42);
    ctx.beginPath(); ctx.ellipse(-len*0.06, 0, len*0.2, hgt*0.24, 0,0,6.2832); ctx.fill();
  }
  if (st >= 2){
    ctx.fillStyle = shade(f.color, 0.42);
    ctx.beginPath();
    ctx.moveTo(-len*0.1, -hgt*0.42);
    ctx.lineTo(len*0.04, -hgt*0.86);
    ctx.lineTo(len*0.16, -hgt*0.40);
    ctx.closePath(); ctx.fill();
  }
  // eye
  ctx.fillStyle = "#0a1620";
  ctx.beginPath(); ctx.arc(len*0.32, -hgt*0.14, Math.max(1.7, hgt*0.11), 0, 6.2832); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.beginPath(); ctx.arc(len*0.34, -hgt*0.19, Math.max(0.7, hgt*0.045), 0, 6.2832); ctx.fill();

  // hesitation shows: a fish that isn't sure quivers in place
  if (f.hesitate > 0){
    ctx.strokeStyle = "rgba(255,212,121,.55)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0,0,len*0.62,0,6.2832); ctx.stroke();
  }
  ctx.restore();

  if (selFish === f && openPanel === "pCard"){
    ctx.strokeStyle = "rgba(255,212,121,.7)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(f.x, f.y, len*0.72, 0, 6.2832); ctx.stroke();
  }
}
function shade(hex, k){
  var n = parseInt(hex.slice(1),16);
  var f = function(v){ return Math.max(0, Math.min(255, Math.round(k>0 ? v + (255-v)*k : v*(1+k)))); };
  return "rgb("+f((n>>16)&255)+","+f((n>>8)&255)+","+f(n&255)+")";
}
function drawGlass(t){
  if (t.algae <= 1) return;
  ctx.save();
  ctx.globalAlpha = clamp01(t.algae/100)*0.30;
  ctx.fillStyle = "#3f7a44";
  ctx.fillRect(0,0,W,H);
  // heavier at the corners, like a real film
  var lg = ctx.createLinearGradient(0,0,0,H);
  lg.addColorStop(0, "rgba(90,160,100,.55)");
  lg.addColorStop(0.5, "rgba(60,120,80,.15)");
  lg.addColorStop(1, "rgba(70,140,90,.5)");
  ctx.fillStyle = lg; ctx.fillRect(0,0,W,H);
  ctx.restore();
}
function drawPlaceHint(t){
  if (!placing) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255,212,121,.8)"; ctx.lineWidth = 2;
  ctx.setLineDash([6,5]);
  ctx.beginPath(); ctx.arc(placing.x, placing.y, 26, 0, 6.2832); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/* ---------- input ---------- */
function pos(ev){
  var r = cv.getBoundingClientRect();
  var t = ev.changedTouches ? ev.changedTouches[0] : ev;
  return { x: t.clientX - r.left, y: t.clientY - r.top };
}
function hitFish(x,y){
  for (var i=tank.fish.length-1;i>=0;i--){
    var f = tank.fish[i];
    var st = stageFor(f.age);
    var len = (26 + st*8 + (f.grown?6:0)) * (f.school?0.42:1);
    if (dist(x,y,f.x,f.y) < len*0.62) return f;
  }
  return null;
}
function hitDecor(x,y){
  for (var i=0;i<tank.decor.length;i++){
    if (dist(x,y,tank.decor[i].x, tank.decor[i].y-14) < 34) return tank.decor[i];
  }
  return null;
}

cv.addEventListener("touchstart", function(ev){
  if (openPanel) return;
  ev.preventDefault();
  var p = pos(ev);
  moved = 0; strokePrev = p; rapCount = 0;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(function(){
    holdTimer = null;
    if (moved > 26) return;
    var n = holdAt(tank, p.x, p.y);
    chime("chip");
    say(n ? (n+" came over") : "they are not ready yet",
        n ? "the ones that trust you" : "trust them over a few days", 2000);
  }, 900);
}, {passive:false});

cv.addEventListener("touchmove", function(ev){
  if (openPanel) return;
  ev.preventDefault();
  var p = pos(ev);
  moved += dist(strokePrev.x, strokePrev.y, p.x, p.y);
  if (moved > 26 && holdTimer){ clearTimeout(holdTimer); holdTimer = null; }
  if (strokePrev){
    if (tank.tool){
      var r = stroke(tank, strokePrev.x, strokePrev.y, p.x, p.y, tank.tool);
      if (r.fronds || r.glass) chime("trim");
    } else if (moved > 26){
      var r2 = stroke(tank, strokePrev.x, strokePrev.y, p.x, p.y, null);
      if (r2.fronds) chime("trim");
    }
  }
  strokePrev = p;
}, {passive:false});

cv.addEventListener("touchend", function(ev){
  if (openPanel) return;
  ev.preventDefault();
  clearTimeout(holdTimer); holdTimer = null;
  var p = pos(ev);
  var wasTap = moved <= 26;
  strokePrev = null;

  if (placing){
    if (placing.id === "bubbles"){
      tank.bubbles = { x:clamp(p.x, 26, tank.w-26), y:clamp(p.y, 40, tank.h*0.5) };
      placing = null;
      save(tank);
      chime("chip");
      say("Bubbles placed", "tap the surface to feed them", 2600);
      var hh = document.getElementById("hint");
      hh.textContent = "tap the surface to feed · hold to befriend · swipe to clean";
      hh.style.opacity = 1;
      setTimeout(function(){ hh.style.opacity = 0; }, 7000);
      return;
    }
    if (placeDecor(tank, placing.id, p.x, p.y)){ chime("chip"); say("Placed", placing.name, 1400); }
    placing = null;
    return;
  }
  if (tank.tool) return;                    // a tool in hand takes strokes only
  if (!wasTap) return;

  // two taps turn the light out: the tank goes dormant
  var now = Date.now();
  if (now - lastTap < 320){
    lastTap = 0;
    var dark = sleepTank(tank);
    chime("light");
    say(dark ? "LIGHTS OUT" : "Lights on",
        dark ? "the tank still runs, at a quarter speed" : "good morning", 2200);
    lastTap = 0;
    return;
  }
  lastTap = now;

  // three hard raps scatter the fish and cost you their trust
  rapWin += 1;
  if (rapWin >= 3){
    rapWin = 0;
    var n = rapAt(tank, p.x, p.y);
    if (n) say("They scattered", "that cost you their trust", 1800);
    return;
  }
  setTimeout(function(){ rapWin = 0; }, 900);

  var f = hitFish(p.x,p.y);
  if (f){ selFish = f; showCard(f); chime("card"); return; }
  var d = hitDecor(p.x,p.y);
  if (d && d.id === "castle"){ say("A castle", "fish come to inspect it", 1600); return; }

  if (p.y < tank.h*0.34){                   // feed at the water line
    feedAt(tank, p.x, p.y);
    chime("feed");
    say("Fed", tank.frenzy>0.9 ? "they were waiting for you" : "", 1400);
    return;
  }
});

// mouse: desktop parity with touch
cv.addEventListener("mousedown", function(ev){
  if (openPanel) return;
  var p = { x: ev.clientX - cv.getBoundingClientRect().left, y: ev.clientY - cv.getBoundingClientRect().top };
  moved = 0; strokePrev = p; clearTimeout(holdTimer);
  holdTimer = setTimeout(function(){ holdTimer=null; holdAt(tank,p.x,p.y); }, 900);
});
cv.addEventListener("mousemove", function(ev){
  if (openPanel) return;
  var p = { x: ev.clientX - cv.getBoundingClientRect().left, y: ev.clientY - cv.getBoundingClientRect().top };
  if (!strokePrev) return;
  moved += dist(strokePrev.x,strokePrev.y,p.x,p.y);
  if (moved > 26 && holdTimer){ clearTimeout(holdTimer); holdTimer=null; }
  if (tank.tool || moved > 26) stroke(tank, strokePrev.x, strokePrev.y, p.x, p.y, tank.tool);
  strokePrev = p;
});
cv.addEventListener("mouseup", function(ev){
  clearTimeout(holdTimer); holdTimer = null;
  if (openPanel || moved > 26){ strokePrev=null; return; }
  var p = { x: ev.clientX - cv.getBoundingClientRect().left, y: ev.clientY - cv.getBoundingClientRect().top };
  strokePrev = null;
  var now = Date.now();
  if (now-lastTap < 320){
    lastTap=0; sleepTank(tank); chime("light");
    say(tank.dark?"LIGHTS OUT":"Lights on", tank.dark?"the tank still runs":"good morning", 2000);
    return;
  }
  lastTap = now;
  var f = hitFish(p.x,p.y);
  if (f){ selFish=f; showCard(f); chime("card"); return; }
  if (p.y < tank.h*0.34){ feedAt(tank,p.x,p.y); chime("feed"); say("Fed","",1400); }
});

/* ---------- panels ---------- */
function show(id){
  var ps = document.querySelectorAll(".panel");
  for (var i=0;i<ps.length;i++) ps[i].classList.remove("open");
  if (id){ document.getElementById(id).classList.add("open"); openPanel = id; }
  else openPanel = null;
  document.getElementById("hint").style.opacity = openPanel ? "0" : "";
}
document.addEventListener("click", function(ev){
  if (ev.target.hasAttribute && ev.target.hasAttribute("data-close")) show(null);
});

function bar(label, val, max, color){
  return '<div class="row"><div class="lab">'+label+'</div><div class="bar"><i style="width:'+
    (clamp01(val/max)*100).toFixed(0)+'%;background:'+color+'"></i></div><div class="val">'+Math.round(val)+'</div></div>';
}
var DRV = [["Hunger","hunger","#ffb347"],["Energy","energy","#7ad3ff"],
           ["Stress","stress","#ff8fa8"],["Curiosity","curiosity","#c9a6ff"],
           ["Bored","bored","#a6e07a"]];
var TRA = [["Bold","bold"],["Social","social"],["Lazy","lazy"]];

function showCard(f){
  if (!f) return;
  f.held = false;
  var st = stageFor(f.age);
  // needs, traits and trust are revealed only as the fish shows that side of itself
  var needKeys = ["seek_food","rest","dart_play"].indexOf(f.goal) >= 0;
  if (needKeys) f.seen.needs = true;
  if (["follow_friend","dart_play","explore"].indexOf(f.goal) >= 0) f.seen.traits = true;
  if (f.trust >= 4) f.seen.trust = true;

  var rows = "";
  for (var i=0;i<DRV.length;i++){
    var d = DRV[i];
    rows += f.seen.needs ? bar(d[0], f[d[1]], 10, d[2]) : '<div class="row"><div class="lab">'+d[0]+'</div><div class="bar"><i style="width:0%"></i></div><div class="val">—</div></div>';
  }
  var trustRow = f.seen.trust
    ? bar("Trust", f.trust, 10, "#ffd479")
    : '<div class="row"><div class="lab">Trust</div><div class="bar"><i style="width:0%"></i></div><div class="val">—</div></div>';
  var tr = "";
  for (var j=0;j<TRA.length;j++){
    var t = TRA[j];
    tr += f.seen.traits ? bar(t[0], f[t[1]], 10, "#7ad3ff") : '<div class="row"><div class="lab">'+t[0]+'</div><div class="bar"><i style="width:0%"></i></div><div class="val">—</div></div>';
  }
  var next = st < 3 ? "grows into "+stageName(st+1) : "settled down for good";
  var gates = arrivalGates(tank);
  var toward = "";
  if (f.age > 120 && !gates.room) toward = " &middot; the tank is full at "+TANK_MAX_FISH;

  document.getElementById("cardBody").innerHTML =
    '<div class="fishname">'+f.name+'</div>'+
    '<div class="stageline">'+stageName(st)+' &middot; day '+Math.floor(f.age/60)+
      ' &middot; '+next+toward+'</div>'+
    '<div class="rows">'+rows+trustRow+tr+'</div>'+
    '<div class="goalnow">doing now: <b>'+f.goal.replace(/_/g," ")+'</b> &middot; urgency '+f.urgency+
      (f.hesitate>0 ? ' &middot; <b>hesitating</b>' : '')+'</div>';

  var sl = stateLine(f, tank).split(" -> ");
  document.getElementById("stateLine").innerHTML = sl[0] + '<br>-> <i>'+
    f.goal.replace(/_/g," ")+' urgency '+f.urgency+'</i>';
  document.getElementById("cardNote").innerHTML =
    "Tap MORE for milestones, shop and settings. The sponge only wipes glass; the scissors only trim.";
  show("pCard");
}
document.getElementById("toMore").addEventListener("click", function(){ showMore(); });

var TANK_BADGES = [["fed","First feeding"],["trim","First trimming"],["glass","First glass cleaning"],
                   ["hold","First hold-approach"],["night","First full night's sleep"],
                   ["birth","The tank changed someone"]];
var FISH_BADGES = [["meal","First meal from you"],["hold","First hold-approach"],["reef","First reef"],
                   ["bubbles","First bubbles"],["follow","First follow"],["dart","First dart"]];
function row(list, have){
  var out = '<div class="badges">';
  for (var i=0;i<list.length;i++){
    var on = have.some(function(b){ return b.id===list[i][0]; });
    out += '<div class="badge'+(on?"":" off")+(on&&have.some(function(b){return b.id===list[i][0]&&b.fresh;})?" fresh":"")+'">'+
      '<div class="dot">'+(on?"★":"☆")+'</div><div>'+list[i][1]+'</div></div>';
  }
  return out+'</div>';
}
function showMore(){
  var real = tank.fish.filter(function(f){ return !f.school; });
  var h = '<div class="card"><div class="fishname">'+tank.fish.length+' fish &middot; population</div>';
  for (var i=0;i<real.length;i++){
    var f = real[i], st = stageFor(f.age);
    h += '<div class="stageline" style="margin-top:8px"><b style="color:#dff3ff">'+f.name+'</b> &middot; '+stageName(st)+
      ' &middot; day '+Math.floor(f.age/60)+'</div>';
    h += '<div class="bar"><i style="width:'+(clamp01(f.age/STAGE_AT[3])*100).toFixed(0)+'%;background:#7ad3ff"></i></div>';
    h += row(FISH_BADGES, f.badges);
  }
  h += '<div class="stageline" style="margin-top:14px"><b style="color:#dff3ff">The tank</b></div>';
  h += row(TANK_BADGES, tank.badges||[]);
  var g = arrivalGates(tank);
  var gates = [["two grown adults",g.grown],["trust up to "+r2(g.trust?5.5:0),g.trust],
               ["a bed tall enough to hide in",g.bed],["room for another fry",g.room]];
  h += '<div class="stageline" style="margin-top:14px">fry gates</div><div class="badges">';
  for (var k=0;k<gates.length;k++)
    h += '<div class="badge'+(gates[k][1]?"":" off")+'"><div class="dot">'+(gates[k][1]?"✓":"·")+'</div><div>'+gates[k][0]+'</div></div>';
  h += '</div></div><div class="center"><button class="btn gold" id="mShop">SHOP</button> <button class="btn" id="mSet">SETTINGS</button></div>';
  document.getElementById("moreBody").innerHTML = h;
  document.getElementById("mShop").addEventListener("click", showShop);
  document.getElementById("mSet").addEventListener("click", function(){ show("pSet"); });
  cleared(real, tank);
  show("pMore");
}
function showShop(){
  var h = "";
  for (var i=0;i<SHOP.length;i++){
    var it = SHOP[i], has = owned(tank, it.id);
    h += '<div class="item'+(has?" locked":"")+'"><h3>'+it.name+'</h3><p>'+it.blurb+'</p>'+
      '<div class="price">'+(has ? "in the tank" : it.price+" ◈")+'</div>'+
      (has ? "" : '<div class="center"><button class="btn'+(tank.coins>=it.price?" gold":"")+'" data-buy="'+it.id+'"'+
        (tank.coins>=it.price?"":" disabled")+'>Buy</button></div>')+'</div>';
  }
  document.getElementById("shopBody").innerHTML = h;
  show("pShop");
  var bs = document.querySelectorAll("#shopBody [data-buy]");
  for (var j=0;j<bs.length;j++){
    bs[j].addEventListener("click", function(ev){
      var id = ev.target.getAttribute("data-buy");
      if (buy(tank, id)){
        chime("chip");
        var d = tank.decor.filter(function(x){ return x.id===id; })[0];
        placing = { id:id, x:d.x, y:d.y };
        say("Bought "+d.name, "tap the glass to place it", 2600);
        showShop();
      }
    });
  }
}
document.getElementById("tSponge").addEventListener("click", function(){
  tank.tool = "sponge"; tank.toolUntil = tank.t + 120; show(null); popTool();
});
document.getElementById("tScissors").addEventListener("click", function(){
  tank.tool = "scissors"; tank.toolUntil = tank.t + 120; show(null); popTool();
});
document.getElementById("tDone").addEventListener("click", function(){
  tank.tool = null; tank.toolUntil = 0; show("pCard"); popTool();
});
function popTool(){
  var p = document.getElementById("pop");
  p.style.display = tank.tool ? "block" : "none";
  p.textContent = tank.tool ? (tank.tool==="sponge" ? "SPONGE" : "SCISSORS") + " · DONE" : "";
}
document.getElementById("sReset").addEventListener("click", function(){
  if (!confirm("Start a new tank? This one is gone.")) return;
  tank = newTank(W,H);
  save(tank); show(null); say("A new tank", "two fry, as every tank starts", 2400);
});
document.getElementById("sBri").addEventListener("input", function(){ bri = this.value/100; });
document.getElementById("sVol").addEventListener("input", function(){ vol = this.value/100; });
document.getElementById("sLights").addEventListener("click", function(){
  var on = sleepTank(tank);
  this.textContent = tank.dark ? "Lights on" : "Double-tap";
  this.classList.toggle("on", tank.dark);
});

/* first run: name the fry, pick a colour, place the bubbles */
var NAME = ["",""], PICK = [0,1];
function showName(){
  var h = "";
  for (var i=0;i<2;i++){
    h += '<div class="namerow"><span style="font-size:22px">'+["🟠","🔵"][i]+'</span>'+
      '<input id="nm'+i+'" maxlength="10" placeholder="Fry '+(i+1)+'" value="'+NAME[i]+'"></div>';
    h += '<div class="swatches" id="sw'+i+'">';
    for (var c=0;c<COLORS.length;c++)
      h += '<div class="sw'+(PICK[i]===c?" sel":"")+'" data-i="'+i+'" data-c="'+c+'" style="background:'+COLORS[c]+'"></div>';
    h += '</div>';
  }
  h += '<div class="stageline" style="margin-top:14px">bubbles</div>';
  h += '<div class="stageline" id="bubTxt">place them after they are in</div>';
  document.getElementById("nameBody").innerHTML = h;
  for (var i2=0;i2<2;i2++){
    (function(k){
      var el = document.getElementById("nm"+k);
      el.addEventListener("input", function(){ NAME[k] = el.value; });
    })(i2);
  }
  var sws = document.querySelectorAll(".sw");
  for (var s=0;s<sws.length;s++){
    sws[s].addEventListener("click", function(ev){
      var d = ev.currentTarget;
      PICK[+d.getAttribute("data-i")] = +d.getAttribute("data-c");
      showName();
    });
  }
  show("pName");
}
document.getElementById("nameGo").addEventListener("click", function(){
  tank = newTank(W,H);
  for (var i=0;i<2;i++){
    tank.fish[i].name = (NAME[i]||"").trim() || ("Fry "+(i+1));
    tank.fish[i].color = COLORS[PICK[i]%COLORS.length];
  }
  firstRun = false;
  say("Welcome", "now tap the glass where the bubbles should rise", 3200);
  save(tank);
  show(null);
  placing = { id:"bubbles", x:tank.bubbles.x, y:tank.bubbles.y };
  var h = document.getElementById("hint");
  h.textContent = "tap to place the bubbles";
  h.style.opacity = 1;
  setTimeout(function(){ h.style.opacity = 0; }, 7000);
});

/* ---------- save ---------- */
// save/load live in the LOGIC block (they are pure data, testable without a DOM)

/* ---------- loop ---------- */
var last = 0, saveAcc = 0, chipAcc = 0;
function frame(ts){
  var dt = last ? Math.min((ts-last)/1000, 0.05) : 0.016;
  last = ts;
  if (!openPanel || openPanel === "pCard" || openPanel === "pMore") stepTank(tank, dt);
  drawTank(tank);

  // top chips
  var c = document.getElementById("coins");
  c.textContent = tank.coins + " ◈";
  var cl = document.getElementById("clock");
  if (tank.dark){ cl.style.display = "block"; cl.textContent = tank.dark ? "☾ dormant" : ""; }
  else cl.style.display = "none";

  if (tank.news){
    say(tank.news.b, tank.news.s, 3000);
    tank.news = null;
  }
  chipAcc += dt;
  if (chipAcc > 5){
    chipAcc = 0;
    if (tank.frenzy > 0.8) document.getElementById("coins").style.color = "var(--warn)";
  }
  saveAcc += dt;
  if (saveAcc > 6){ saveAcc = 0; save(tank); }
  requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange", function(){
  if (document.hidden) save(tank);
});
if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0){
  navigator.serviceWorker.register("sw.js").catch(function(){});
}

function boot(){
  var saved = load();
  tank = saved || newTank(W,H);
  firstRun = !saved;
  fit();
  window.addEventListener("resize", fit);
  if (firstRun) setTimeout(showName, 250);
  requestAnimationFrame(frame);
}
// public surface for the test harness
window.PT = {
  makeTank:makeTank, newTank:newTank, makeFish:makeFish, stepTank:stepTank,
  decide:decide, scoreGoals:scoreGoals, stateLine:stateLine, stageFor:stageFor,
  feedAt:feedAt, holdAt:holdAt, rapAt:rapAt, stroke:stroke, sleepTank:sleepTank,
  buy:buy, placeDecor:placeDecor, arrivalGates:arrivalGates, canArrive:canArrive,
  courtTick:courtTick, growth:growth, coverAt:coverAt, targetFor:targetFor,
  eatCheck:eatCheck, addBadge:addBadge, badgeFish:badgeFish, freshAny:freshAny,
  cleared:cleared, owned:owned, shop:SHOP, goals:GOALS, stages:STAGES,
  clamp:clamp, dist:dist, save:save, load:load, boot:boot,
  get tank(){ return tank; }, set tank(v){ tank = v; }
};
boot();
// ===== VIEW END =====