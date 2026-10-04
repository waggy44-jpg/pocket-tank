// Icon generator: writes real PNGs (no PIL on this box). Draws at 4x and
// downsamples with a box filter, so edges are smooth rather than jagged.
const fs = require("fs");
const zlib = require("zlib");

function crc32(buf){
  let c, table = [];
  for (let n=0;n<256;n++){
    c = n;
    for (let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1);
    table[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (let i=0;i<buf.length;i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type,"ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w,h,rgba){
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  const raw = Buffer.alloc((w*4+1)*h);
  for (let y=0;y<h;y++){
    raw[y*(w*4+1)] = 0;
    rgba.copy(raw, y*(w*4+1)+1, y*w*4, (y+1)*w*4);
  }
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, {level:9})),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
function down(src, sw, sh, dw, dh){
  const out = Buffer.alloc(dw*dh*4);
  const fx = sw/dw, fy = sh/dh;
  for (let y=0;y<dh;y++){
    for (let x=0;x<dw;x++){
      let r=0,g=0,b=0,a=0,n=0;
      const x0=Math.floor(x*fx), x1=Math.min(sw, Math.ceil((x+1)*fx));
      const y0=Math.floor(y*fy), y1=Math.min(sh, Math.ceil((y+1)*fy));
      for (let yy=y0;yy<y1;yy++) for (let xx=x0;xx<x1;xx++){
        const i=(yy*sw+xx)*4;
        r+=src[i]; g+=src[i+1]; b+=src[i+2]; a+=src[i+3]; n++;
      }
      const o=(y*dw+x)*4;
      out[o]=Math.round(r/n); out[o+1]=Math.round(g/n);
      out[o+2]=Math.round(b/n); out[o+3]=Math.round(a/n);
    }
  }
  return out;
}
// signed distance helpers, drawn at 4x
function inRoundRect(x,y,cx,cy,hw,hh,r){
  const dx = Math.abs(x-cx) - (hw-r), dy = Math.abs(y-cy) - (hh-r);
  if (dx<=0 && dy<=0) return true;
  const ax=Math.max(dx,0), ay=Math.max(dy,0);
  return ax*ax+ay*ay <= r*r;
}
// a fish: body ellipse + triangular tail + eye. Tail sweeps from the centre
// so the swing is symmetric, not a slant.
function fish(px,py,scale,ang,col){
  const s = scale;
  const ca=Math.cos(ang), sa=Math.sin(ang);
  // local -> world along the fish's facing direction
  const P = (lx,ly) => [ px + lx*s*ca - ly*s*sa, py + lx*s*sa + ly*s*ca ];
  // tail: a swept fork, symmetric about the body centreline
  const a1 = P(-0.40, 0);
  const b1 = P(-0.92, -0.46);
  const c1 = P(-0.80, 0);
  const b2 = P(-0.92, 0.46);
  const c2 = P(-0.80, 0);
  ctx_fill_tri(px,py, a1[0],a1[1], b1[0],b1[1], c1[0],c1[1], shadeC(col,-30));
  ctx_fill_tri(px,py, a1[0],a1[1], b2[0],b2[1], c2[0],c2[1], shadeC(col,-30));
  // body
  ctx_fill_ellipse(px,py, 0.52*s, 0.30*s, ang, col);
  // dorsal crest
  const d1=P(-0.10,-0.24), d2=P(0.06,-0.52), d3=P(0.22,-0.22);
  ctx_fill_tri(px,py, d1[0],d1[1], d2[0],d2[1], d3[0],d3[1], shadeC(col,45));
  // eye, on the facing side and above the centreline
  const e = P(0.32,-0.06);
  ctx_fill_circle(e[0], e[1], 0.065*s, "#08131c");
}
let buf, W4, H4;
function put(x,y,r,g,b,a){
  const i=((y|0)*W4+(x|0))*4;
  const ia = a/255, na = ia + (1-ia);
  if (na<=0) return;
  buf[i]   = Math.round(r*ia + buf[i]*(1-ia));
  buf[i+1] = Math.round(g*ia + buf[i+1]*(1-ia));
  buf[i+2] = Math.round(b*ia + buf[i+2]*(1-ia));
  buf[i+3] = Math.round(255*na);
}
function hex(h){ const n=parseInt(h.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function shadeC(h,k){
  const c=hex(h);
  return [Math.max(0,Math.min(255,Math.round(k>0?c[0]+(255-c[0])*k/100:c[0]*(1+k/100)))),
          Math.max(0,Math.min(255,Math.round(k>0?c[1]+(255-c[1])*k/100:c[1]*(1+k/100)))),
          Math.max(0,Math.min(255,Math.round(k>0?c[2]+(255-c[2])*k/100:c[2]*(1+k/100))))];
}
function ctx_fill_ellipse(cx,cy,rx,ry,ang,col){
  const c = typeof col === "string" ? hex(col) : col;
  const ca=Math.cos(ang), sa=Math.sin(ang), rad=Math.max(rx,ry)+2;
  for (let y=Math.floor(cy-rad);y<=cy+rad;y++)
    for (let x=Math.floor(cx-rad);x<=cx+rad;x++){
      const dx=x-cx, dy=y-cy;
      const u=(dx*ca+dy*sa)/rx, v=(-dx*sa+dy*ca)/ry;
      if (u*u+v*v <= 1) put(x,y,c[0],c[1],c[2],255);
    }
}
function ctx_fill_tri(cx,cy, x1,y1, x2,y2, x3,y3, col){
  const c = typeof col === "string" ? hex(col) : col;
  const minx=Math.floor(Math.min(x1,x2,x3)), maxx=Math.ceil(Math.max(x1,x2,x3));
  const miny=Math.floor(Math.min(y1,y2,y3)), maxy=Math.ceil(Math.max(y1,y2,y3));
  const s=(y1===y2)?0:1;
  for (let y=miny;y<=maxy;y++) for (let x=minx;x<=maxx;x++){
    const d1=(x-x2)*(y1-y2)-(x1-x2)*(y-y2);
    const d2=(x-x3)*(y2-y3)-(x2-x3)*(y-y2);
    const d3=(x-x1)*(y3-y1)-(x3-x1)*(y-y1);
    const neg=(d1<0)||(d2<0)||(d3<0), pos=(d1>0)||(d2>0)||(d3>0);
    if (!(neg&&pos)) put(x,y,c[0],c[1],c[2],255);
  }
}
function ctx_fill_circle(cx,cy,r,col){
  ctx_fill_ellipse(cx,cy,r,r,0,col);
}

function build(size, maskable){
  const S = 4;
  W4 = H4 = size*S;
  buf = Buffer.alloc(W4*H4*4);
  // background: deep tank gradient, inset for maskable safe zone
  const inset = maskable ? size*S*0.14 : 0;
  const R = maskable ? 0 : size*S*0.22;
  for (let y=0;y<H4;y++){
    const t = y/H4;
    const r = Math.round(13 + t*8), g = Math.round(52 - t*30), b = Math.round(80 - t*46);
    for (let x=0;x<W4;x++){
      if (!maskable && !inRoundRect(x,y,W4/2,H4/2,W4/2-R,H4/2-R,R)) continue;
      const i=(y*W4+x)*4;
      buf[i]=r; buf[i+1]=g; buf[i+2]=b; buf[i+3]=255;
    }
  }
  // seagrass: three blades rising from the floor, sway symmetric about centre
  const floor = H4*0.80;
  for (let k=0;k<3;k++){
    const bx = W4*(0.24 + k*0.26);
    const hgt = H4*(0.22 + (k%2)*0.08);
    for (let t=0;t<=1.001;t+=0.004){
      const bend = Math.sin(t*Math.PI*0.9)*(k-1)*W4*0.045;
      ctx_fill_circle(bx + bend, floor - hgt*t, W4*0.016, "#2f8f63");
    }
  }
  // sand
  for (let y=Math.floor(floor);y<H4;y++){
    for (let x=0;x<W4;x++){
      const i=(y*W4+x)*4;
      if (buf[i+3]===0) continue;
      if (!maskable && !inRoundRect(x,y,W4/2,H4/2,W4/2-R,H4/2-R,R)) continue;
      buf[i]=201; buf[i+1]=180; buf[i+2]=137;
    }
  }
  // bubbles rising
  for (let k=0;k<5;k++){
    const bx = W4*0.78, by = floor - (H4*0.30)*(k/5);
    ctx_fill_circle(bx + Math.sin(k*1.7)*W4*0.03, by, W4*(0.014+ (k%3)*0.006), "#bfe8ff");
  }
  // two fish, facing each other
  fish(W4*0.42, H4*0.40, W4*0.30, 0, "#ffb347");
  fish(W4*0.66, H4*0.56, W4*0.20, Math.PI, "#7ad3ff");
  return png(size,size, down(buf, W4,H4, size,size));
}
const dir = __dirname;
fs.writeFileSync(dir+"/icon-192.png", build(192,false));
fs.writeFileSync(dir+"/icon-512.png", build(512,false));
fs.writeFileSync(dir+"/icon-maskable.png", build(512,true));
console.log("icons written");