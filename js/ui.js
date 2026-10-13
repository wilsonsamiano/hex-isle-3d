
"use strict";
/* ================= input ================= */
function humanRobber(hidx){
  const pi=G.turn;
  const victims=moveRobber(hidx,pi);
  G.mode=null; hintBar(null); sfx.place();
  const done=()=>{ refreshUI(); draw(); };
  if(victims.length===1){ stealFrom(pi,victims[0]); done(); }
  else if(victims.length>1){
    $("pick-title").textContent="Steal from…";
    const ui=$("pick-ui"); ui.innerHTML="";
    victims.forEach(vi=>{
      const b=document.createElement("button");
      b.textContent=`${G.players[vi].name} (🃏${totalCards(G.players[vi])})`;
      b.style.margin="4px";
      b.onclick=()=>{ $("pick-modal").classList.remove("open"); stealFrom(pi,vi); done(); };
      ui.appendChild(b);
    });
    $("pick-modal").classList.add("open");
  } else { toast("No victims on that hex."); done(); }
}
/* ================= buttons ================= */
function setMode(m,label){
  if(G.mode===m){ G.mode=null; hintBar(null); }
  else { G.mode=m; hintBar(label); sfx.select(); }
  draw();
}
$("b-roll").onclick=()=>rollDice();
$("b-road").onclick=()=>setMode("road","Tap a glowing road spot (1🪵 1🧱)");
$("b-settle").onclick=()=>setMode("settle","Tap a glowing spot (1🪵 1🧱 1🌾 1🐑)");
$("b-city").onclick=()=>setMode("city","Tap one of your settlements (3⛰ 2🌾)");
$("b-dev").onclick=()=>buyDev();
$("b-trade").onclick=()=>openTrade();
$("b-cards").onclick=()=>openDevCards();
$("b-end").onclick=()=>{ if(NET.active&&!NET.isHost){ netSend({t:"a",a:"end"}); return; } G.mode=null; hintBar(null); endTurn(); };
$("dev-close").onclick=()=>$("cards-modal").classList.remove("open");
$("win-again").onclick=()=>{ $("win-modal").classList.remove("open"); $("setup-modal").classList.add("open"); };
function startGame(humans){
  $("setup-modal").classList.remove("open");
  newGameState(humans);
  G.turnCount=0;
  setupTurn();
}
/* ================= sound & confetti ================= */
let AC=null;
function ac(){ if(!AC){ try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){} }
  if(AC&&AC.state==="suspended")AC.resume(); return AC; }
function tone(f,d,type,v,delay){
  const c=ac(); if(!c) return; type=type||"sine"; v=v||0.1; delay=delay||0;
  const o=c.createOscillator(),g=c.createGain(),t=c.currentTime+delay;
  o.type=type; o.frequency.value=f;
  g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.001,t+d);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t+d+0.03);
}
const sfx={
  select(){ tone(660,.05); }, place(){ tone(420,.07,"triangle",.14); },
  build(){ tone(220,.12,"triangle",.16); tone(330,.1,"triangle",.12,.08); },
  dice(){ for(let i=0;i<5;i++) tone(200+Math.random()*400,.04,"square",.05,i*.07); },
  card(){ tone(520,.08,"triangle",.12); tone(780,.1,"triangle",.1,.08); },
  trade(){ tone(440,.08,"sine",.12); tone(660,.1,"sine",.12,.08); },
  win(){ [523,659,784,1047,1319,1568].forEach((f,i)=>tone(f,.25,"triangle",.13,i*.14)); }
};
function confetti(){
  const c=document.createElement("canvas");
  c.style.cssText="position:fixed;inset:0;pointer-events:none;z-index:300";
  document.body.appendChild(c);
  c.width=innerWidth; c.height=innerHeight;
  const x=c.getContext("2d"), cols=["#e8b64c","#d64545","#4d8fd6","#4dff88","#fff"];
  const ps=Array.from({length:240},()=>({x:Math.random()*c.width,y:-20-Math.random()*c.height*.4,
    w:5+Math.random()*6,h:8+Math.random()*8,vy:2+Math.random()*4,vx:-1.5+Math.random()*3,
    r:Math.random()*6,vr:-.1+Math.random()*.2,c:cols[Math.random()*cols.length|0]}));
  let f=0;
  (function tick(){ x.clearRect(0,0,c.width,c.height);
    ps.forEach(p=>{ p.x+=p.vx;p.y+=p.vy;p.r+=p.vr; x.save(); x.translate(p.x,p.y); x.rotate(p.r);
      x.fillStyle=p.c; x.fillRect(-p.w/2,-p.h/2,p.w,p.h); x.restore(); });
    if(++f<450) requestAnimationFrame(tick); else c.remove();
  })();
}
/* ================= init ================= */
(function init(){
  const st=load("hexisle-stats",{played:0,won:0});
  $("setup-stats").textContent = st.played? `${st.won} wins in ${st.played} solo games (${Math.round(st.won/st.played*100)}%)` : "No games yet — your legend starts today.";
  $("m-solo").onclick=()=>startGame(1);
  $("m-p2").onclick=()=>startGame(2);
  $("m-p3").onclick=()=>startGame(3);
  $("m-p4").onclick=()=>startGame(4);
})();

;
"use strict";
/* ================= Hex Isle 3D layer =================
   Reuses all game logic from logic0-4 + ui.js.
   Replaces: draw(), rollDice(), pointer input, fitCanvas().
   Board coords (x,y) -> world (x*S, 0, y*S), S=0.055. */
const S3 = 0.055;
const WX = x => x*S3, WZ = y => y*S3;
const HEXR = 46*S3; // 2.53

let renderer, scene, camera, waterTex, terrainGroup, dynGroup, pickGroup, hoverMesh;
let lastBoardId = null, prevDynKeys = new Set(), tweens = [], pulseT = 0;
let hoverKey = null, diceObjs = [], diceTray = null, pickList = [];
const SHARED_GEO = new Set();
const cam = {theta:0.65, phi:0.92, r:36, tx:0, ty:0, tz:0};

/* ---------- canvas helpers ---------- */
function cnv(w,h){ const c=document.createElement("canvas"); c.width=w; c.height=h; return c; }
function hexPath2D(x,w,h){
  x.beginPath();
  for(let i=0;i<6;i++){ const a=(60*i-30)*Math.PI/180;
    const px=w/2+Math.cos(a)*w*0.48, py=h/2+Math.sin(a)*h*0.48;
    i?x.lineTo(px,py):x.moveTo(px,py); }
  x.closePath();
}
const TILE_IMG = {}; // filled from TILE_B64 below
function makeTileTexture(terrain){
  const c=cnv(256,256), x=c.getContext("2d");
  hexPath2D(x,256,256); x.save(); x.clip();
  const img=TILE_IMG[terrain];
  if(img) x.drawImage(img,0,0,256,256);
  else { x.fillStyle=TERRAIN_STYLE[terrain].c; x.fillRect(0,0,256,256); }
  // vignette
  const g=x.createRadialGradient(128,128,80,128,128,180);
  g.addColorStop(0,"rgba(0,0,0,0)"); g.addColorStop(1,"rgba(0,0,0,.35)");
  x.fillStyle=g; x.fillRect(0,0,256,256);
  x.restore();
  hexPath2D(x,256,256);
  x.lineWidth=10; x.strokeStyle="rgba(30,20,10,.55)"; x.stroke();
  hexPath2D(x,256,256);
  x.lineWidth=3; x.strokeStyle="rgba(255,240,200,.35)"; x.stroke();
  const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding;
  t.anisotropy=4; return t;
}
function makeTokenTexture(num, hot, dim){
  const c=cnv(128,128), x=c.getContext("2d");
  x.beginPath(); x.arc(64,64,60,0,7); x.fillStyle=dim?"#c9bda0":"#f5ecd7"; x.fill();
  x.lineWidth=5; x.strokeStyle="#8a7a5a"; x.stroke();
  x.fillStyle=hot?"#c02020":"#333"; x.font="bold 46px sans-serif";
  x.textAlign="center"; x.textBaseline="middle"; x.fillText(num,64,52);
  x.fillStyle=hot?"#c02020":"#666"; x.font="20px sans-serif";
  x.fillText("•".repeat(PIPS[num]||0),64,92);
  const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; return t;
}
function makePipTexture(v){
  const c=cnv(128,128), x=c.getContext("2d");
  x.fillStyle="#f8f4e8"; x.beginPath();
  x.roundRect?x.roundRect(4,4,120,120,22):x.rect(4,4,120,120); x.fill();
  x.lineWidth=6; x.strokeStyle="#cbbf9a"; x.stroke();
  const P={1:[[64,64]],2:[[40,40],[88,88]],3:[[40,40],[64,64],[88,88]],
    4:[[40,40],[88,40],[40,88],[88,88]],5:[[40,40],[88,40],[64,64],[40,88],[88,88]],
    6:[[40,34],[88,34],[40,64],[88,64],[40,94],[88,94]]}[v];
  x.fillStyle="#222";
  P.forEach(p=>{ x.beginPath(); x.arc(p[0],p[1],11,0,7); x.fill(); });
  const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; return t;
}
function makeWaterTexture(){
  const c=cnv(256,256), x=c.getContext("2d");
  x.fillStyle="#14507e"; x.fillRect(0,0,256,256);
  for(let i=0;i<90;i++){
    x.strokeStyle=`rgba(140,200,240,${0.05+Math.random()*0.12})`;
    x.lineWidth=1+Math.random()*3;
    const y=Math.random()*256, w=20+Math.random()*60, sx=Math.random()*256;
    x.beginPath(); x.moveTo(sx,y);
    x.quadraticCurveTo(sx+w/2,y-6+Math.random()*12,sx+w,y); x.stroke();
  }
  const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding;
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(10,10); return t;
}
function makeLabelSprite(text){
  const c=cnv(160,80), x=c.getContext("2d");
  x.fillStyle="rgba(20,16,8,.82)"; x.beginPath();
  x.roundRect?x.roundRect(4,8,152,64,14):x.rect(4,8,152,64); x.fill();
  x.strokeStyle="#e8c96a"; x.lineWidth=3; x.stroke();
  x.fillStyle="#ffe9a8"; x.font="bold 34px sans-serif";
  x.textAlign="center"; x.textBaseline="middle"; x.fillText(text,80,42);
  const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding;
  const m=new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false});
  const sp=new THREE.Sprite(m); sp.scale.set(2.2,1.1,1); return sp;
}

/* ---------- shared geo/mat caches ---------- */
const GEO = {}, MAT = {};
function matFor(color){
  if(!MAT[color]) MAT[color]=new THREE.MeshStandardMaterial({color,roughness:.55,metalness:.08});
  return MAT[color];
}
function initShared(){
  GEO.settleBase=new THREE.BoxGeometry(.55,.4,.55);
  GEO.settleRoof=new THREE.ConeGeometry(.46,.36,4);
  GEO.cityBase=new THREE.BoxGeometry(.72,.55,.72);
  GEO.cityRoof=new THREE.ConeGeometry(.6,.42,4);
  GEO.cityTower=new THREE.BoxGeometry(.26,.5,.26);
  GEO.road=new THREE.BoxGeometry(1,.16,.3);
  GEO.pickV=new THREE.SphereGeometry(.55,8,6);
  GEO.pickE=new THREE.BoxGeometry(1,.8,.8);
  GEO.ring=new THREE.RingGeometry(.3,.46,24);
  GEO.token=new THREE.CylinderGeometry(.55,.55,.1,24);
  GEO.banditCloak=new THREE.ConeGeometry(.34,.95,10);
  GEO.banditHead=new THREE.SphereGeometry(.2,10,8);
  GEO.dockBase=new THREE.CylinderGeometry(.5,.55,.35,10);
  GEO.dockPole=new THREE.CylinderGeometry(.07,.07,1.5,6);
  GEO.flag=new THREE.ConeGeometry(.3,.5,3);
  GEO.die=new THREE.BoxGeometry(.85,.85,.85);
  GEO.robberRing=new THREE.RingGeometry(.5,.62,6);
  GEO.proxy=new THREE.MeshBasicMaterial({visible:false});
  Object.values(GEO).forEach(g=>{ if(g&&g.isBufferGeometry) SHARED_GEO.add(g); });
}

/* ---------- init ---------- */
function initGL(){
  const wrap=$("board-wrap");
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputEncoding=THREE.sRGBEncoding;
  const gl=$("gl"); gl.appendChild(renderer.domElement);
  const rs=()=>{ const r=wrap.getBoundingClientRect();
    renderer.setSize(Math.max(50,r.width),Math.max(50,r.height));
    camera.aspect=r.width/Math.max(1,r.height); camera.updateProjectionMatrix(); };
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x0a1c30);
  scene.fog=new THREE.Fog(0x0a1c30,70,150);
  camera=new THREE.PerspectiveCamera(50,1,.1,400);
  const hemi=new THREE.HemisphereLight(0xcfe8ff,0x2c4a2c,.95); scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xfff0d0,1.15);
  sun.position.set(24,34,14); sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,far:90});
  scene.add(sun);
  waterTex=makeWaterTexture();
  const water=new THREE.Mesh(new THREE.PlaneGeometry(220,220),
    new THREE.MeshStandardMaterial({map:waterTex,color:0x9fc8e8,roughness:.3,metalness:.15}));
  water.rotation.x=-Math.PI/2; water.position.y=-.62; water.receiveShadow=true; scene.add(water);
  terrainGroup=new THREE.Group(); scene.add(terrainGroup);
  dynGroup=new THREE.Group(); scene.add(dynGroup);
  pickGroup=new THREE.Group(); scene.add(pickGroup);
  // dice tray floating on water
  diceTray=new THREE.Group();
  const trayBase=new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.5,.5,20),matFor("#7a5230"));
  trayBase.position.y=-.35; trayBase.receiveShadow=true; diceTray.add(trayBase);
  const trayRim=new THREE.Mesh(new THREE.TorusGeometry(2.4,.22,10,24),matFor("#5d3d22"));
  trayRim.rotation.x=Math.PI/2; trayRim.position.y=-.1; diceTray.add(trayRim);
  const trayFelt=new THREE.Mesh(new THREE.CylinderGeometry(2.25,2.25,.1,20),matFor("#1d5c38"));
  trayFelt.position.y=-.12; diceTray.add(trayFelt);
  diceTray.position.set(16.5,0,8.5); diceTray.scale.setScalar(.8); scene.add(diceTray);
  initShared();
  // hover ring
  hoverMesh=new THREE.Mesh(GEO.ring,new THREE.MeshBasicMaterial({color:0xffe98a,transparent:true,opacity:.9,side:THREE.DoubleSide}));
  hoverMesh.rotation.x=-Math.PI/2; hoverMesh.visible=false; scene.add(hoverMesh);
  bindPointer(renderer.domElement);
  updateLayoutMode();
  window.addEventListener("resize",rs);
  window.addEventListener("resize",()=>updateLayoutMode());
  rs();
  updateCamera();
  (function loop(){
    requestAnimationFrame(loop);
    const dt=Math.min(.05,loop._l?(performance.now()-loop._l)/1000:.016); loop._l=performance.now();
    pulseT+=dt;
    waterTex.offset.x+=dt*.008; waterTex.offset.y+=dt*.005;
    // tweens
    for(let i=tweens.length-1;i>=0;i--){ const tw=tweens[i]; tw.t+=dt;
      const k=Math.min(1,tw.t/tw.dur), e=1-Math.pow(1-k,3);
      tw.obj.scale.setScalar(tw.from+(tw.to-tw.from)*e);
      if(k>=1){ tweens.splice(i,1); tw.done&&tw.done(); } }
    // highlight pulse
    dynGroup.children.forEach(o=>{ if(o.userData.pulse) o.scale.setScalar(1+.09*Math.sin(pulseT*5)); });
    if(hoverMesh.visible) hoverMesh.scale.setScalar(1+.12*Math.sin(pulseT*6));
    renderer.render(scene,camera);
  })();
}
function updateCamera(){
  const {theta,phi,r,tx,ty,tz}=cam;
  camera.position.set(tx+r*Math.sin(phi)*Math.sin(theta), ty+r*Math.cos(phi), tz+r*Math.sin(phi)*Math.cos(theta));
  camera.lookAt(tx,ty,tz);
}

/* ---------- terrain ---------- */
const hexTopGeo={};
function hexShapeGeo(h){
  // shape from actual board corners -> exact hex; shape -y maps to world +z after rotate
  const sh=new THREE.Shape();
  h.corners.forEach((ck,i)=>{
    const v=G.board.vmap[ck], x=WX(v.x), y=-WZ(v.y);
    i?sh.lineTo(x,y):sh.moveTo(x,y);
  });
  sh.closePath();
  const g=new THREE.ShapeGeometry(sh);
  // planar UVs 0..1
  g.computeBoundingBox(); const bb=g.boundingBox, sx=bb.max.x-bb.min.x, sy=bb.max.y-bb.min.y;
  const p=g.attributes.position, uv=g.attributes.uv;
  for(let i=0;i<p.count;i++) uv.setXY(i,(p.getX(i)-bb.min.x)/sx,(p.getY(i)-bb.min.y)/sy);
  g.rotateX(-Math.PI/2); // shape (x,y) -> world (x, z=y), normal faces up
  return g;
}
function darken(hex,f){
  const n=parseInt(hex.slice(1),16);
  const r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  return `rgb(${r*f|0},${g*f|0},${b*f|0})`;
}
function buildTerrain3D(){
  // clear
  while(terrainGroup.children.length){ const o=terrainGroup.children.pop(); disposeDeep(o); }
  while(pickGroup.children.length){ const o=pickGroup.children.pop(); }
  pickList=[];
  for(const k in hexTopGeo) delete hexTopGeo[k];
  const B=G.board;
  const tileTex={};
  for(const h of B.hexes){
    const cx=WX(h.x), cz=WZ(h.y);
    // body
    const body=new THREE.Mesh(new THREE.CylinderGeometry(HEXR*.985,HEXR*1.0,.9,6),
      matFor(darken(TERRAIN_STYLE[h.terrain].c,.5)));
    body.position.set(cx,0,cz); body.castShadow=true; body.receiveShadow=true;
    terrainGroup.add(body);
    // picture top
    if(!tileTex[h.terrain]) tileTex[h.terrain]=makeTileTexture(h.terrain);
    const tg=hexShapeGeo(h); hexTopGeo[h.idx]=tg; SHARED_GEO.add(tg);
    const top=new THREE.Mesh(tg,new THREE.MeshStandardMaterial({map:tileTex[h.terrain],roughness:.8}));
    top.position.set(0,.451,0); top.receiveShadow=true;
    top.userData={kind:"h",idx:h.idx};
    terrainGroup.add(top); pickList.push(top);
    // number token
    if(h.number){
      const hot=(h.number===6||h.number===8);
      const tok=new THREE.Mesh(GEO.token,new THREE.MeshStandardMaterial({
        map:makeTokenTexture(h.number,hot,h.bandit),roughness:.6}));
      tok.position.set(cx,.56,cz); tok.castShadow=true;
      tok.userData={tokenOf:h.idx,hot};
      terrainGroup.add(tok); h._tok=tok;
    }
    // bandit pick proxy (whole hex already pickable via top)
  }
  // ports
  for(const v of B.verts){
    if(!v.port) continue;
    const px=WX(v.x), pz=WZ(v.y);
    const out=Math.hypot(px,pz)||1, ox=px/out, oz=pz/out;
    const g=new THREE.Group();
    const base=new THREE.Mesh(GEO.dockBase,matFor("#7a5230")); base.position.y=-.3; base.castShadow=true; g.add(base);
    const pole=new THREE.Mesh(GEO.dockPole,matFor("#4c3319")); pole.position.y=.4; g.add(pole);
    const flag=new THREE.Mesh(GEO.flag,matFor(v.port.ratio===3?"#e8c96a":"#7fd4ff"));
    flag.rotation.z=-Math.PI/2; flag.position.set(.25,1.0,0); g.add(flag);
    const label=makeLabelSprite(v.port.ratio===3?"3:1":("2:1 "+(RES_ICON[v.port.res]||"")));
    label.position.y=1.9; g.add(label);
    g.position.set(px+ox*.9,.1,pz+oz*.9);
    terrainGroup.add(g);
  }
  // vertex + edge pick proxies
  for(const v of B.verts){
    const m=new THREE.Mesh(GEO.pickV,GEO.proxy);
    m.position.set(WX(v.x),.6,WZ(v.y)); m.userData={kind:"v",key:v.key};
    pickGroup.add(m); pickList.push(m);
  }
  for(const e of B.edges){
    const a=B.vmap[e.a], b=B.vmap[e.b];
    const ax=WX(a.x),az=WZ(a.y),bx=WX(b.x),bz=WZ(b.y);
    const len=Math.hypot(bx-ax,bz-az);
    const m=new THREE.Mesh(GEO.pickE,GEO.proxy);
    m.position.set((ax+bx)/2,.55,(az+bz)/2);
    m.rotation.y=-Math.atan2(bz-az,bx-ax);
    m.scale.set(Math.max(.4,len),1,1);
    m.userData={kind:"e",key:e.key};
    pickGroup.add(m); pickList.push(m);
  }
}
function disposeDeep(o){
  const sharedMats=new Set(Object.values(MAT)); sharedMats.add(GEO.proxy);
  o.traverse(c=>{
    if(c.geometry&&!SHARED_GEO.has(c.geometry)) c.geometry.dispose();
    const ms=Array.isArray(c.material)?c.material:(c.material?[c.material]:[]);
    ms.forEach(m=>{ if(sharedMats.has(m)) return;
      if(m.map&&!Object.values(PIP_TEX).includes(m.map)) m.map.dispose();
      m.dispose(); });
  });
}

/* ---------- pieces ---------- */
function houseMesh(pi,city){
  const col=G.players[pi].color, g=new THREE.Group();
  const base=new THREE.Mesh(city?GEO.cityBase:GEO.settleBase,matFor(col));
  base.position.y=.2+(city?.075:0); base.castShadow=true; g.add(base);
  const roof=new THREE.Mesh(city?GEO.cityRoof:GEO.settleRoof,matFor(darken(col.startsWith("#")?col:"#888888",.75)));
  roof.rotation.y=Math.PI/4; roof.position.y=.2+.4+(city?.28:.18); roof.castShadow=true; g.add(roof);
  if(city){ const tw=new THREE.Mesh(GEO.cityTower,matFor(col)); tw.position.set(.18,.75,0); tw.castShadow=true; g.add(tw); }
  return g;
}
function banditMesh(){
  const g=new THREE.Group();
  const cloak=new THREE.Mesh(GEO.banditCloak,matFor("#151515")); cloak.position.y=.48; cloak.castShadow=true; g.add(cloak);
  const head=new THREE.Mesh(GEO.banditHead,matFor("#2b2b2b")); head.position.y=1.0; head.castShadow=true; g.add(head);
  return g;
}
function roadMesh(pi,e){
  const B=G.board,a=B.vmap[e.a],b=B.vmap[e.b];
  const ax=WX(a.x),az=WZ(a.y),bx=WX(b.x),bz=WZ(b.y);
  const len=Math.hypot(bx-ax,bz-az);
  const m=new THREE.Mesh(GEO.road,matFor(G.players[pi].color));
  m.position.set((ax+bx)/2,.55,(az+bz)/2);
  m.rotation.y=-Math.atan2(bz-az,bx-ax);
  m.scale.x=Math.max(.3,len-.35);
  m.castShadow=true; return m;
}
function hlRing(x,z,color,op){
  const m=new THREE.Mesh(GEO.ring,new THREE.MeshBasicMaterial({color,transparent:true,opacity:op??.85,side:THREE.DoubleSide,depthWrite:false}));
  m.rotation.x=-Math.PI/2; m.position.set(x,.52,z); m.userData.pulse=true; return m;
}
function syncPieces3D(){
  while(dynGroup.children.length){ const o=dynGroup.children.pop(); disposeDeep(o); }
  const B=G.board, keys=new Set();
  // settlements & cities
  B.verts.forEach(v=>{
    if(v.owner<0) return;
    const g=houseMesh(v.owner,v.type==="city");
    g.position.set(WX(v.x),.45,WZ(v.y));
    const k=(v.type==="city"?"city:":"set:")+v.key; keys.add(k);
    if(!prevDynKeys.has(k)){ g.scale.setScalar(.01); tweens.push({obj:g,t:0,dur:.35,from:.01,to:1}); }
    dynGroup.add(g);
  });
  // roads
  B.edges.forEach(e=>{
    if(e.owner<0) return;
    const m=roadMesh(e.owner,e), k="road:"+e.key; keys.add(k);
    if(!prevDynKeys.has(k)){ m.scale.setScalar(.01); tweens.push({obj:m,t:0,dur:.3,from:.01,to:1}); }
    dynGroup.add(m);
  });
  // bandit + dimmed token
  B.hexes.forEach(h=>{
    if(h.bandit){
      const b=banditMesh(); b.position.set(WX(h.x)+1.0,.45,WZ(h.y)+.7);
      const k="bandit:"+h.idx; keys.add(k);
      if(!prevDynKeys.has(k)){ b.scale.setScalar(.01); tweens.push({obj:b,t:0,dur:.35,from:.01,to:1}); }
      dynGroup.add(b);
      if(h._tok){ h._tok.material.color.set(0x9a917e); }
    } else if(h._tok){ h._tok.material.color.set(0xffffff); }
  });
  // highlights
  const mode=G.mode;
  if(G.phase==="setup"||!G.players[G.turn].ai){
    if(mode==="settle"||mode==="setup-settle"){
      legalSettleList().forEach(k=>{ const v=B.vmap[k]; dynGroup.add(hlRing(WX(v.x),WZ(v.y),0xffe98a)); });
    } else if(mode==="road"||mode==="setup-road"||mode==="freeroad"){
      legalRoadList().forEach(k=>{ const e=B.emap[k],a=B.vmap[e.a],b=B.vmap[e.b];
        const m=roadMesh(G.turn,{a:e.a,b:e.b});
        m.material=new THREE.MeshBasicMaterial({color:0xffe98a,transparent:true,opacity:.75});
        m.userData.pulse=true; dynGroup.add(m); });
    } else if(mode==="city"){
      G.players[G.turn].settles.forEach(k=>{ const v=B.vmap[k]; dynGroup.add(hlRing(WX(v.x),WZ(v.y),0x7fd4ff)); });
    } else if(mode==="robber"){
      B.hexes.forEach(h=>{ if(h.bandit) return;
        const m=new THREE.Mesh(hexTopGeo[h.idx],new THREE.MeshBasicMaterial({color:0xff4030,transparent:true,opacity:.28,depthWrite:false}));
        m.position.y=.46; m.userData.pulse=true; dynGroup.add(m); });
    }
  }
  prevDynKeys=keys;
}

/* ---------- draw (replaces 2D) ---------- */
function draw(){
  if(!G) return;
  if(G.boardId!==lastBoardId){ buildTerrain3D(); lastBoardId=G.boardId; prevDynKeys=new Set(); }
  syncPieces3D();
  if(typeof netAfterDraw!=="undefined") netAfterDraw();
}

/* ---------- 3D dice ---------- */
const PIP_TEX={};
function dieMesh(){
  for(let v=1;v<=6;v++) if(!PIP_TEX[v]) PIP_TEX[v]=makePipTexture(v);
  // faces: +x=1,-x=6,+y=2,-y=5,+z=3,-z=4
  const mats=[1,6,2,5,3,4].map(v=>new THREE.MeshStandardMaterial({map:PIP_TEX[v],roughness:.4}));
  const m=new THREE.Mesh(GEO.die,mats);
  m.castShadow=true; return m;
}
const FACE_N={1:[1,0,0],6:[-1,0,0],2:[0,1,0],5:[0,-1,0],3:[0,0,1],4:[0,0,-1]};
function orientDieTop(die,v){
  const n=new THREE.Vector3(...FACE_N[v]), up=new THREE.Vector3(0,1,0);
  const q=new THREE.Quaternion().setFromUnitVectors(n,up);
  const yaw=new THREE.Quaternion().setFromAxisAngle(up,Math.random()*Math.PI*2);
  die.quaternion.copy(yaw.multiply(q));
}
function rollDice3D(d1,d2,done,quick){
  diceObjs.forEach(d=>scene.remove(d)); diceObjs=[];
  const t0=performance.now(), T1=quick?550:1100, T2=quick?280:420, HOLD=quick?450:1300;
  const dice=[dieMesh(),dieMesh()];
  const vals=[d1,d2];
  const starts=[new THREE.Vector3(15.0,7,7.0),new THREE.Vector3(18.0,8,9.5)];
  const ends=[new THREE.Vector3(15.9,.35,8.1),new THREE.Vector3(17.1,.35,8.9)];
  dice.forEach((d,i)=>{ d.position.copy(starts[i]); scene.add(d); diceObjs.push(d); });
  sfx.dice();
  const spinA=dice.map(()=>new THREE.Vector3(Math.random()*9,Math.random()*9,Math.random()*9));
  (function anim(){
    const el=performance.now()-t0;
    if(el<T1){
      const k=el/T1, e=1-Math.pow(1-k,2);
      dice.forEach((d,i)=>{
        d.position.lerpVectors(starts[i],ends[i],e);
        d.position.y+=Math.sin(k*Math.PI*3+i)*1.4*(1-k);
        d.rotation.x+=spinA[i].x*.06; d.rotation.y+=spinA[i].y*.06; d.rotation.z+=spinA[i].z*.06;
      });
      requestAnimationFrame(anim);
    } else if(el<T1+T2){
      const k=(el-T1)/T2, e=k*k;
      dice.forEach((d,i)=>{
        d.position.lerpVectors(d.position.clone(),ends[i],.2);
        d.position.y=ends[i].y;
        const target=new THREE.Quaternion();
        orientDieTop({quaternion:target},vals[i]);
        d.quaternion.slerp(target,.25);
      });
      if(k<1) requestAnimationFrame(anim);
    }
  })();
  setTimeout(()=>{
    diceObjs.forEach(d=>{ // shrink out, then remove
      tweens.push({obj:d,t:0,dur:.4,from:1,to:.01,done:()=>{ scene.remove(d);
        d.material.forEach(m=>m.dispose()); }});
    });
    diceObjs=[]; done();
  },T1+T2+HOLD);
}
// override logic's rollDice with the 3D version (same game flow afterwards)
function rollDice(){
  const p=G.players[G.turn];
  if(G.rolled) return;
  if(typeof NET!=="undefined"&&NET.active&&!NET.isHost){ netSend({t:"a",a:"roll"}); return; }
  G.rolled=true;
  const d1=1+Math.floor(Math.random()*6), d2=1+Math.floor(Math.random()*6);
  if(typeof netSendDice!=="undefined") netSendDice(d1,d2);
  $("dice").textContent="🎲 …";
  rollDice3D(d1,d2,()=>{
    G.dice=[d1,d2]; const tot=d1+d2;
    $("dice").textContent=`🎲 ${tot}`;
    log(`${p.name} rolled ${tot}.`);
    if(tot===7) onSeven(); else { produce(tot); afterRoll(); }
  }, p.ai);
}

/* ---------- pointer: orbit camera + tap picking ---------- */
function bindPointer(el){
  const ray=new THREE.Raycaster(), ptr=new THREE.Vector2();
  const pts=new Map(); // pointerId -> {x,y}
  let tapCand=null, pinchD=0, mid=null, lastAng=null;
  const clampT=(v,a,b)=>Math.max(a,Math.min(b,v));
  function panBy(dx,dy){ // Google Maps style: content follows the finger
    const s=cam.r*0.0016, t=cam.theta;
    const rx=Math.cos(t), rz=-Math.sin(t), fx=-Math.sin(t), fz=-Math.cos(t);
    cam.tx=clampT(cam.tx-(rx*dx+fx*dy)*s,-18,18);
    cam.tz=clampT(cam.tz-(rz*dx+fz*dy)*s,-18,18);
  }
  const setPtr=e=>{ const r=el.getBoundingClientRect();
    ptr.x=((e.clientX-r.left)/r.width)*2-1; ptr.y=-((e.clientY-r.top)/r.height)*2+1; };
  function castAt(e){
    setPtr(e); ray.setFromCamera(ptr,camera);
    const hits=ray.intersectObjects(pickList,false);
    return hits.length?hits[0].object.userData:null;
  }
  el.addEventListener("pointerdown",e=>{
    el.setPointerCapture&&el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===1) tapCand={x:e.clientX,y:e.clientY,t:performance.now()};
    else { tapCand=null; pinchD=0; mid=null; lastAng=null; } // entering 2-finger mode: no jump
  });
  el.addEventListener("pointermove",e=>{
    if(e.pointerType==="mouse"&&!pts.has(e.pointerId)){ // hover (no buttons)
      const u=castAt(e);
      if(u&&u.kind==="v"&&(G.mode==="settle"||G.mode==="setup-settle"||G.mode==="city")){
        const v=G.board.vmap[u.key];
        hoverMesh.position.set(WX(v.x),.55,WZ(v.y)); hoverMesh.visible=true; hoverKey=u.key;
      } else { hoverMesh.visible=false; hoverKey=null; }
      return;
    }
    const p=pts.get(e.pointerId); if(!p) return;
    const dx=e.clientX-p.x, dy=e.clientY-p.y;
    p.x=e.clientX; p.y=e.clientY;
    if(pts.size===1){
      if(tapCand&&Math.hypot(e.clientX-tapCand.x,e.clientY-tapCand.y)>8) tapCand=null;
      if(!tapCand){ panBy(dx,dy); updateCamera(); } // one finger: pan the map
    } else if(pts.size===2){ // two fingers: pinch zoom + twist rotate + drag pan
      const [a,b]=[...pts.values()];
      const d=Math.hypot(a.x-b.x,a.y-b.y), m={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      const ang=Math.atan2(b.y-a.y,b.x-a.x);
      if(pinchD) cam.r=clampT(cam.r*pinchD/d,15,70);
      if(lastAng!==null){
        let da=ang-lastAng;
        while(da>Math.PI)da-=2*Math.PI; while(da<-Math.PI)da+=2*Math.PI;
        cam.theta-=da;
      }
      if(mid) panBy(m.x-mid.x,m.y-mid.y);
      pinchD=d; mid=m; lastAng=ang; updateCamera();
    }
  });
  function endPointer(e){
    const wasTap=tapCand&&pts.size===1&&(performance.now()-tapCand.t)<600;
    pts.delete(e.pointerId);
    if(pts.size<2){ pinchD=0; mid=null; lastAng=null; }
    if(pts.size===0){ if(wasTap) onTap(castAt(e)); tapCand=null; }
    else tapCand=null;
  }
  el.addEventListener("pointerup",endPointer);
  el.addEventListener("pointercancel",endPointer);
  el.addEventListener("wheel",e=>{ e.preventDefault();
    cam.r=clampT(cam.r*(1+e.deltaY*.001),15,70); updateCamera(); },{passive:false});
}
function applyFreeRoad(ekey){
  const p=G.players[G.turn];
  G.board.emap[ekey].owner=p.idx; p.roads.push(ekey);
  sfx.build(); log(p.name+" placed a free road."); G.freeRoads--;
  updateLongest(); refreshUI(); draw(); checkWin();
  if(G.freeRoads<=0){ G.mode=null; hintBar(null); draw(); }
  else hintBar("Place free roads ("+(2-G.freeRoads)+" of 2 placed)");
}
function onTap(u){
  if(!G||G.over) return;
  if(typeof NET!=="undefined"&&NET.active){
    if(!NET.isHost){ netGuestTap(u); return; }
    if(G.turn!==NET.myIdx) return;
  }
  const p=G.players[G.turn];
  if(p.ai) return;
  const mode=G.mode;
  if(G.phase==="setup"){
    if(mode==="setup-settle"){ if(u&&u.kind==="v"&&legalSettle(p.idx,u.key,true)) placeSetupSettle(u.key); }
    else if(mode==="setup-road"){ if(u&&u.kind==="e"&&legalRoad(p.idx,u.key,G._setupVkey)) placeSetupRoad(u.key); }
    return;
  }
  if(mode==="road"||mode==="freeroad"){
    if(!(u&&u.kind==="e")||!legalRoad(p.idx,u.key,null)) return;
    const ek=u.key;
    if(mode==="freeroad") applyFreeRoad(ek); else buildRoad(ek,false);
  } else if(mode==="settle"){
    if(u&&u.kind==="v"&&legalSettle(p.idx,u.key,false)) buildSettle(u.key);
  } else if(mode==="city"){
    if(u&&u.kind==="v"&&legalCity(p.idx,u.key)) buildCity(u.key);
  } else if(mode==="robber"){
    if(u&&u.kind==="h"&&!G.board.hexes[u.idx].bandit) humanRobber(u.idx);
  }
}

/* ---------- tile photo loading ---------- */
function loadTilePhotos(){
  const jobs=Object.entries(TILE_B64).map(([terr,b64])=>new Promise(res=>{
    const img=new Image();
    img.onload=()=>{ TILE_IMG[terr]=img; res(); };
    img.onerror=()=>res();
    img.src="data:image/jpeg;base64,"+b64;
  }));
  return Promise.all(jobs);
}

/* ---------- bottom action bar on touch / narrow screens ----------
   iPadOS reserves the top edge for system gestures, so the header buttons
   move to a thumb-zone bar under the board where taps always land. */
function updateLayoutMode(){
  // single source of truth for button placement AND bar visibility:
  // multiple touch signals so one lying detector can't hide the buttons
  const coarse=matchMedia("(pointer:coarse)").matches;
  const touch=coarse||("ontouchstart" in window)||navigator.maxTouchPoints>0;
  const narrow=window.innerWidth<=820;
  const barMode=touch||narrow;
  document.body.classList.toggle("is-touch",touch);
  document.body.classList.toggle("is-narrow",narrow);
  document.body.classList.toggle("bar-mode",barMode);
  const bar=$("actionbar"), btns=$("gamebtns"), hdr=document.querySelector("header");
  if(!bar||!btns||!hdr) return;
  if(barMode && btns.parentElement!==bar) bar.appendChild(btns);
  else if(!barMode && btns.parentElement!==hdr){
    const sp=hdr.querySelector(".spacer");
    hdr.insertBefore(btns, sp ? sp.nextSibling : null);
  }
}

/* ---------- boot ---------- */
try { initGL(); } catch(e){ console.error("GL init failed", e); }
// tile photos arrive async; rebuild terrain with pictures once they're in
loadTilePhotos().then(()=>{ if (typeof G !== "undefined" && G && lastBoardId){ buildTerrain3D(); draw(); } });

;
/* ---------- Hex Isle 3D: online multiplayer (host-authoritative, PeerJS room codes) ----------
   Solo and pass-and-play are untouched when NET.active is false.
   Host owns all randomness (board, dice, dev deck, steals) and validates every action.
   Guests hold a masked copy: own resources/dev cards visible, everyone else's hidden. */

const NET = { active:false, isHost:false, peer:null, conn:null, code:null, myIdx:-1, myName:"You", started:false };
const netConns = new Map();          // host: seat idx -> PeerJS DataConnection
let netLobby = null;                 // host lobby {count, seats:[{name,ai,host}]}
let netPromptSeq = 0;                // host: prompt sequence numbers
let netShownPrompt = -1;             // guest: last prompt seq shown
let netSeenSeq = 0;                  // guest: last applied state seq
let netResume = null;                // host: continuation after a remote prompt resolves

function netCanAct(){
  if(!NET.active||!G||G.over) return true;
  return G.turn===NET.myIdx;
}
function netIsRemote(pi){
  return NET.active&&NET.isHost&&G&&pi!==NET.myIdx&&!G.players[pi].ai;
}
function netSend(m){ if(NET.conn&&NET.conn.open) NET.conn.send(m); }
function netAfterDraw(){
  if(NET.active&&NET.isHost&&NET.started&&G) netBroadcast();
}

/* ----- guest tap -> action intent ----- */
function netGuestTap(u){
  if(!G||G.over||G.turn!==NET.myIdx) return;
  const mode=G.mode;
  if(G.phase==="setup"){
    if(mode==="setup-settle"&&u&&u.kind==="v") netSend({t:"a",a:"ss",v:u.key});
    else if(mode==="setup-road"&&u&&u.kind==="e") netSend({t:"a",a:"sr",e:u.key});
    return;
  }
  if((mode==="road"||mode==="freeroad")&&u&&u.kind==="e") netSend({t:"a",a:mode==="freeroad"?"fr":"br",e:u.key});
  else if(mode==="settle"&&u&&u.kind==="v") netSend({t:"a",a:"bs",v:u.key});
  else if(mode==="city"&&u&&u.kind==="v") netSend({t:"a",a:"bc",v:u.key});
  else if(mode==="robber"&&u&&u.kind==="h") netSend({t:"a",a:"rb",h:u.idx});
}

/* ----- host: validate + apply a guest action ----- */
function netOnAction(idx,m){
  if(!NET.active||!NET.isHost||!NET.started||!G||G.over) return;
  if(idx<0||!G.players[idx]||G.players[idx].ai) return;
  const p=G.players[idx];
  switch(m.a){
    case "ss": // setup settlement
      if(G.phase!=="setup"||G.turn!==idx||G.mode!=="setup-settle") break;
      if(!(m.v&&legalSettle(idx,m.v,true))) break;
      placeSetupSettle(m.v); break;
    case "sr": // setup road
      if(G.phase!=="setup"||G.turn!==idx||G.mode!=="setup-road") break;
      if(!(m.e&&legalRoad(idx,m.e,G._setupVkey))) break;
      placeSetupRoad(m.e); break;
    case "br": // build road
      if(G.phase!=="main"||G.turn!==idx||G.mode!=="road") break;
      if(!(m.e&&legalRoad(idx,m.e,null))) break;
      buildRoad(m.e,false); break;
    case "fr": // free road (dev card)
      if(G.phase!=="main"||G.turn!==idx||G.mode!=="freeroad") break;
      if(!(m.e&&legalRoad(idx,m.e,null))) break;
      applyFreeRoad(m.e); break;
    case "bs": // build settlement
      if(G.phase!=="main"||G.turn!==idx||G.mode!=="settle") break;
      if(!(m.v&&legalSettle(idx,m.v,false))) break;
      buildSettle(m.v); break;
    case "bc": // build city
      if(G.phase!=="main"||G.turn!==idx||G.mode!=="city") break;
      if(!(m.v&&legalCity(idx,m.v))) break;
      buildCity(m.v); break;
    case "roll":
      if(G.phase==="main"&&G.turn===idx&&!G.rolled) rollDice(); break;
    case "mode": { // guest pressed/toggled a build-mode button
      const okMode=x=>x===null||x==="road"||x==="settle"||x==="city";
      if(G.phase==="main"&&G.turn===idx&&okMode(G.mode)&&okMode(m.mode)){
        G.mode=m.mode; refreshUI(); draw();
      }
      break;
    }
    case "end":
      if(G.turn===idx) { G.mode=null; hintBar(null); endTurn(); } break;
    case "buyDev":
      if(G.phase==="main"&&G.turn===idx) buyDev(); break;
    case "playDev": {
      const di=m.i;
      if(G.phase!=="main"||G.turn!==idx||!Number.isInteger(di)) break;
      if(G.devPlayed===G.turnCount||!p.dev[di]) break;
      netRemotePlayDev(p,di); break;
    }
    case "rb": netRemoteRobber(idx,m.h); break;
    case "discard": netRemoteDiscard(idx,m.res); break;
    case "steal": {
      const pr=G.netPrompt;
      if(!pr||pr.for!==idx||pr.kind!=="steal"||!pr.victims.includes(m.v)) break;
      stealFrom(idx,m.v);
      G.netPrompt=null; netBroadcast(); refreshUI(); draw(); break;
    }
    case "tradeResp": {
      const pr=G.netPrompt;
      if(!pr||pr.for!==idx||pr.kind!=="tradeOffer") break;
      const from=G.players[pr.from];
      if(m.accept&&RES.every(r=>p.res[r]>=pr.want[r]&&from.res[r]>=pr.give[r])){
        RES.forEach(r=>{ from.res[r]-=pr.give[r]; p.res[r]+=pr.give[r]; p.res[r]-=pr.want[r]; from.res[r]+=pr.want[r]; });
        log("🤝 "+from.name+" ↔ "+p.name+" trade accepted!"); sfx.trade();
      } else log("✋ Trade declined.");
      G.netPrompt=null; netBroadcast(); refreshUI(); draw(); break;
    }
    case "devPick": {
      const pr=G.netPrompt;
      if(!pr||pr.for!==idx||pr.kind!=="pickRes") break;
      if(pr.pickKind==="harvest"){
        (Array.isArray(m.res)?m.res.slice(0,pr.n):[]).forEach(r=>{ if(RES.includes(r)) gain(p,r); });
        log(p.name+" harvested resources."); refreshUI(); draw();
      } else if(pr.pickKind==="embargo"&&RES.includes(m.res)){
        doEmbargo(p,m.res);
      }
      G.netPrompt=null; netBroadcast(); break;
    }
    case "bank": {
      if(G.phase!=="main"||G.turn!==idx) break;
      const rate=bestBankRate(idx,m.give);
      if(RES.includes(m.give)&&RES.includes(m.get)&&p.res[m.give]>=rate){
        p.res[m.give]-=rate; p.res[m.get]++;
        sfx.trade(); log(p.name+" traded "+rate+RES_ICON[m.give]+" → 1"+RES_ICON[m.get]+" with the bank.");
        refreshUI(); draw();
      }
      break;
    }
    case "offer": {
      if(G.phase!=="main"||G.turn!==idx) break;
      const q=G.players[m.to];
      if(!q||m.to===idx) break;
      const give=m.give||{}, want=m.want||{};
      if(!RES.every(r=>(give[r]||0)<=p.res[r])) break;
      resolveOffer(p,q,give,want); break;
    }
  }
}

/* host: remote player's dev card play (card already validated above) */
function netRemotePlayDev(p,di){
  const d=p.dev[di];
  if(G.devPlayed===G.turnCount) return;
  if(d.type==="landmark"){ toast("Landmarks count automatically."); return; }
  p.dev.splice(di,1);
  G.devPlayed=G.turnCount;
  log(p.name+" played "+DEV_DEFS[d.type].n+"."); sfx.trade();
  if(d.type==="guard"){
    G.mode="robber"; G.netPrompt={for:p.idx,kind:"robber",seq:++netPromptSeq};
    hintBar("Waiting for "+p.name+"…");
  } else if(d.type==="trail"){
    G.freeRoads=2; G.mode="freeroad";
    hintBar("Waiting for "+p.name+"…");
  } else if(d.type==="harvest"){
    G.netPrompt={for:p.idx,kind:"pickRes",n:2,pickKind:"harvest",seq:++netPromptSeq};
    hintBar("Waiting for "+p.name+"…");
  } else if(d.type==="embargo"){
    G.netPrompt={for:p.idx,kind:"pickRes",n:1,pickKind:"embargo",seq:++netPromptSeq};
    hintBar("Waiting for "+p.name+"…");
  }
  refreshUI(); draw(); checkWin();
}

/* host: remote player's robber placement */
function netRemoteRobber(idx,hidx){
  const p=G.players[idx];
  if(G.turn!==idx||G.mode!=="robber") return;
  if(!(Number.isInteger(hidx)&&G.board.hexes[hidx]&&!G.board.hexes[hidx].bandit)) return;
  const victims=moveRobber(hidx,idx);
  if(!victims.length){ G.mode=null; G.netPrompt=null; hintBar(null); refreshUI(); draw(); return; }
  G.mode=null;
  G.netPrompt={for:idx,kind:"steal",victims,seq:++netPromptSeq};
  hintBar("Waiting for "+p.name+"…"); refreshUI(); draw();
}

/* host: remote player's discard after a 7 */
function netRemoteDiscard(idx,sel){
  const pr=G.netPrompt;
  if(!pr||pr.for!==idx||pr.kind!=="discard") return;
  const p=G.players[idx];
  let sum=0;
  RES.forEach(r=>{ const n=Math.max(0,Math.min(sel&&sel[r]||0,p.res[r])); p.res[r]-=n; sum+=n; });
  log(p.name+" discarded "+sum+" cards.");
  G.netPrompt=null; netBroadcast();
  const r=netResume; netResume=null; if(r) r();
}
function netWaitResume(fn){ netResume=fn; }

/* ----- host: masked state broadcast ----- */
function maskState(forIdx){
  const s=JSON.parse(JSON.stringify(G,(k,v)=>k==="_tok"?undefined:v)); // _tok are THREE meshes: strip, guest rebuilds them
  s.players.forEach((pl,i)=>{
    if(i===forIdx) return;
    const real=G.players[i];
    pl.resTotal=totalCards(real);
    pl.devTotal=real.dev.length;
    const hidden=real.dev.filter(d=>d.type==="landmark").length;
    pl.vpShown=real.vp-hidden;               // landmarks stay secret until revealed
    pl.res={timber:0,clay:0,grain:0,wool:0,stone:0};
    pl.dev=[];
  });
  s.devDeck=s.devDeck.map(()=>null);
  return s;
}
function netBroadcast(){
  G.seq=(G.seq||0)+1;
  netConns.forEach((c,idx)=>{ if(c.open) c.send({t:"state",seq:G.seq,state:maskState(idx)}); });
}
function netSendDice(d1,d2){
  if(NET.active&&NET.isHost) netConns.forEach(c=>{ if(c.open) c.send({t:"dice",d1,d2}); });
}
function netOnWin(pi){
  if(NET.active&&NET.isHost) netConns.forEach(c=>{ if(c.open) c.send({t:"gameover",winner:pi}); });
}

/* ----- guest: apply host state ----- */
function netOnState(m){
  if(!m.state||m.seq<=netSeenSeq) return;
  netSeenSeq=m.seq;
  const oldToks=(G&&G.board)?G.board.hexes.map(h=>h._tok):[];
  G=m.state;
  if(G&&G.board) G.board.hexes.forEach((h,i)=>{ if(oldToks[i]) h._tok=oldToks[i]; });
  draw(); refreshUI();
}

/* ----- guest: prompt UI (driven by host's netPrompt) ----- */
function netCheckPrompt(){
  if(!NET.active||NET.isHost||!G) return;
  const pr=G.netPrompt;
  if(pr&&pr.for===NET.myIdx){
    if(pr.seq===netShownPrompt) return;
    netShownPrompt=pr.seq;
    if(pr.kind==="discard") netUiDiscard(pr);
    else if(pr.kind==="steal") netUiSteal(pr);
    else if(pr.kind==="tradeOffer") netUiTradeOffer(pr);
    else if(pr.kind==="pickRes") netUiPickRes(pr);
  } else if(netShownPrompt!==-1){
    netShownPrompt=-1;
    ["discard-modal","pick-modal","offer-modal"].forEach(id=>$(id).classList.remove("open"));
  }
}
function netUiDiscard(pr){
  const p=G.players[NET.myIdx];
  $("discard-target").textContent=pr.target;
  const ui=$("discard-ui"); ui.innerHTML="";
  const sel={timber:0,clay:0,grain:0,wool:0,stone:0};
  RES.forEach(r=>{
    const row=document.createElement("div"); row.className="tres";
    row.innerHTML="<span>"+RES_ICON[r]+" "+r+" (have "+p.res[r]+")</span>";
    const ctl=document.createElement("div"); ctl.className="ctl";
    const minus=document.createElement("button"); minus.textContent="−";
    const lab=document.createElement("b"); lab.textContent="0"; lab.style.minWidth="24px"; lab.style.textAlign="center";
    const plus=document.createElement("button"); plus.textContent="+";
    minus.onclick=()=>{ if(sel[r]>0){sel[r]--;lab.textContent=sel[r];} };
    plus.onclick=()=>{ if(sel[r]<p.res[r]){sel[r]++;lab.textContent=sel[r];} };
    ctl.append(minus,lab,plus); row.appendChild(ctl); ui.appendChild(row);
  });
  $("discard-modal").classList.add("open");
  $("discard-go").onclick=()=>{
    const tot=RES.reduce((a,r)=>a+sel[r],0);
    if(tot!==pr.target){ toast("Discard exactly "+pr.target); return; }
    $("discard-modal").classList.remove("open");
    netSend({t:"a",a:"discard",res:sel});
  };
}
function netUiSteal(pr){
  $("pick-title").textContent="Steal from…";
  const ui=$("pick-ui"); ui.innerHTML="";
  pr.victims.forEach(vi=>{
    const b=document.createElement("button");
    b.textContent=G.players[vi].name+" (🃏"+(G.players[vi].resTotal??totalCards(G.players[vi]))+")";
    b.onclick=()=>{ $("pick-modal").classList.remove("open"); netSend({t:"a",a:"steal",v:vi}); };
    ui.appendChild(b);
  });
  $("pick-modal").classList.add("open");
}
function netUiTradeOffer(pr){
  const from=G.players[pr.from];
  $("offer-title").textContent=from.name+" offers a trade";
  $("offer-text").textContent=from.name+" offers "+fmtRes(pr.give)+" for "+fmtRes(pr.want)+". Accept?";
  $("offer-yes").onclick=()=>{ $("offer-modal").classList.remove("open"); netSend({t:"a",a:"tradeResp",accept:true}); };
  $("offer-no").onclick=()=>{ $("offer-modal").classList.remove("open"); netSend({t:"a",a:"tradeResp",accept:false}); };
  $("offer-modal").classList.add("open");
}
function netUiPickRes(pr){
  const multi=pr.n>1;
  $("pick-title").textContent=pr.pickKind==="embargo"?"Embargo: choose a resource to seize":"Harvest: choose "+pr.n+" resources";
  const ui=$("pick-ui"); ui.innerHTML="";
  const sel=multi?[]:null;
  const done=()=>{
    $("pick-modal").classList.remove("open");
    netSend({t:"a",a:"devPick",res:multi?sel:ui._one});
  };
  RES.forEach(r=>{
    const b=document.createElement("button");
    b.textContent=RES_ICON[r]+" "+r;
    b.onclick=()=>{
      if(multi){ if(sel.length>=pr.n){ toast("Pick "+pr.n); return; } sel.push(r); sfx.place();
        if(sel.length>=pr.n) done();
      } else { ui._one=r; done(); }
    };
    ui.appendChild(b);
  });
  const c=document.createElement("button"); c.textContent="Cancel"; c.style.opacity=".6";
  c.onclick=()=>$("pick-modal").classList.remove("open"); ui.appendChild(c);
  $("pick-modal").classList.add("open");
}

/* ----- guest: per-frame UI hook (called from refreshUI) ----- */
function netHookUI(){
  if(!NET.active||!G) return;
  if(NET.isHost) return;
  if(!G.over){
    if(G.turn===NET.myIdx){
      if(G.phase==="setup") hintBar(G.mode==="setup-settle"?"Your turn: tap a glowing spot for your settlement":"Your turn: tap a glowing road");
      else if(!G.rolled) hintBar("Your turn — tap Roll");
      else if(G.netPrompt&&G.netPrompt.for===NET.myIdx&&G.netPrompt.kind==="robber") hintBar("Move the bandit: tap a hex");
      else if(G.mode==="road") hintBar("Tap a glowing road spot");
      else if(G.mode==="settle") hintBar("Tap a glowing spot");
      else if(G.mode==="city") hintBar("Tap one of your settlements");
      else if(G.mode==="freeroad") hintBar("Place your free roads");
      else hintBar(null);
    } else hintBar(null);
  }
  netCheckPrompt();
}

/* ----- guest: messages from host ----- */
function netOnHostMsg(m){
  if(!m) return;
  switch(m.t){
    case "welcome": NET.myIdx=m.idx; NET.code=m.code; break;
    case "lobby": netRenderGuestLobby(m); break;
    case "deny": toast(m.reason||"Couldn't join"); netReset(); break;
    case "start":
      NET.started=true;
      $("net-modal").classList.remove("open"); $("setup-modal").classList.remove("open");
      toast("Game started!"); break;
    case "state": netOnState(m); break;
    case "dice": sfx.dice(); rollDice3D(m.d1,m.d2,()=>{},false); break;
    case "gameover": onWin(m.winner); break;
    case "toast": toast(m.msg); break;
  }
}

/* ----- connection plumbing ----- */
function netLoadPeer(){
  if(window.Peer) return Promise.resolve();
  return new Promise((res,rej)=>{
    const s=document.createElement("script");
    s.src="https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
    s.onload=res; s.onerror=()=>rej(new Error("net"));
    document.head.appendChild(s);
  });
}
function netGenCode(){
  const A="ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s="";
  for(let i=0;i<4;i++) s+=A[Math.floor(Math.random()*A.length)];
  return s;
}
function netReset(){
  try{ NET.peer&&NET.peer.destroy(); }catch(e){}
  NET.active=false; NET.isHost=false; NET.peer=null; NET.conn=null;
  NET.code=null; NET.myIdx=-1; NET.started=false;
  netConns.clear(); netLobby=null; netResume=null; netShownPrompt=-1; netSeenSeq=0;
  $("net-modal").classList.remove("open"); $("setup-modal").classList.add("open");
}

/* host: a guest connected */
function netHostConn(c){
  c.on("data",m=>{
    if(!m) return;
    if(m.t==="join") netGuestJoin(c,m);
    else if(m.t==="a") netOnAction(netSeatOf(c),m);
  });
  c.on("open",()=>{
    if(!netLobby||NET.started){ c.send({t:"deny",reason:"Game already started"}); setTimeout(()=>c.close(),400); return; }
    let idx=netLobby.seats.findIndex(s=>!s);
    if(idx===-1) idx=netLobby.seats.length;
    if(idx>=netLobby.count){ c.send({t:"deny",reason:"Lobby full"}); setTimeout(()=>c.close(),400); return; }
    netLobby.seats[idx]={name:"Player "+(idx+1),ai:false};
    netConns.set(idx,c);
    c.on("close",()=>netGuestDown(idx));
    c.send({t:"welcome",idx,code:NET.code,count:netLobby.count});
    netBroadcastLobby();
  });
}
function netSeatOf(c){ for(const [i,cc] of netConns) if(cc===c) return i; return -1; }
function netGuestJoin(c,m){
  const idx=netSeatOf(c);
  if(idx>0){ netLobby.seats[idx].name=String(m.name||"").slice(0,16)||("Player "+(idx+1)); netBroadcastLobby(); }
}
function netBroadcastLobby(){
  const msg={t:"lobby",count:netLobby.count,seats:netLobby.seats.map(s=>s?{name:s.name,ai:s.ai,host:!!s.host}:null)};
  netConns.forEach(c=>{ if(c.open) c.send(msg); });
  netRenderHostLobby();
}
/* host: a guest disconnected mid-game */
function netGuestDown(idx){
  netConns.delete(idx);
  if(!NET.started){ if(netLobby){ netLobby.seats[idx]=null; netBroadcastLobby(); } return; }
  const p=G&&G.players[idx];
  if(!p||p.ai) return;
  p.ai=true; p.name=p.name+" (AI)";
  log("⚠ "+p.name+" disconnected — AI takes over.");
  toast("A player disconnected — AI takes over their seat.");
  if(G.netPrompt&&G.netPrompt.for===idx){ G.netPrompt=null; const r=netResume; netResume=null; if(r) r(); }
  netBroadcast(); refreshUI(); draw();
  if(G.turn===idx&&!G.over){
    if(G.phase==="setup") setTimeout(aiSetup,700);
    else if(G.mode==="robber") aiRobber();
    else setTimeout(aiTurn,700);
  }
}
/* guest: host disconnected */
function netHostDown(){
  if(!NET.active||NET.isHost) return;
  toast("Host disconnected — back to the menu.");
  netReset();
}

/* ----- lobby UI ----- */
function netSeatRow(s,i){
  const d=document.createElement("div"); d.className="tres";
  d.innerHTML="<span>"+(s.host?"⭐ ":"")+s.name+"</span><span style='opacity:.6'>"+(s.ai?"AI":(s.host?"Host":"Guest"))+"</span>";
  return d;
}
function netShowHostCreate(){
  $("setup-modal").classList.remove("open");
  $("net-title").textContent="Host online game";
  const b=$("net-body"); b.innerHTML="";
  const lab=document.createElement("p"); lab.innerHTML="<b>Your name</b>";
  const nm=document.createElement("input"); nm.id="net-name"; nm.maxLength=16; nm.placeholder="You"; nm.style.cssText="width:100%;padding:10px;font-size:16px;border-radius:8px;border:1px solid #999";
  const pl=document.createElement("p"); pl.innerHTML="<b>Players</b>";
  const row=document.createElement("div"); row.className="row";
  [2,3,4].forEach(n=>{
    const l=document.createElement("label"); l.style.cssText="display:flex;gap:6px;align-items:center;font-size:18px";
    const r=document.createElement("input"); r.type="radio"; r.name="netcount"; r.value=n; if(n===4) r.checked=true;
    l.append(r,document.createTextNode(n+"P")); row.appendChild(l);
  });
  const go=document.createElement("button"); go.id="net-create-btn"; go.textContent="Create room"; go.style.cssText="margin-top:10px;font-size:18px;padding:12px 22px";
  go.onclick=netCreateRoom;
  const note=document.createElement("p"); note.style.cssText="opacity:.65;font-size:13px";
  note.textContent="Needs internet once (to get a room code). Empty seats become AI. If you leave, the room ends.";
  b.append(lab,nm,pl,row,go,note);
  $("net-modal").classList.add("open");
}
async function netCreateRoom(){
  const name=($("net-name").value||"").trim().slice(0,16)||"You";
  const count=parseInt((document.querySelector('input[name="netcount"]:checked')||{}).value||"4",10);
  $("net-create-btn").disabled=true;
  try{ await netLoadPeer(); }catch(e){ toast("Couldn't load networking — check internet."); $("net-create-btn").disabled=false; return; }
  for(let attempt=0;attempt<5;attempt++){
    const code=netGenCode();
    const peer=new Peer("hexisle3d-"+code.toLowerCase());
    const opened=await new Promise(res=>{
      const to=setTimeout(()=>res("timeout"),12000);
      peer.on("open",()=>{ clearTimeout(to); res(true); });
      peer.on("error",e=>{ clearTimeout(to); res(e&&e.type==="unavailable-id"?"taken":"fatal"); });
    });
    if(opened===true){
      NET.peer=peer; NET.active=true; NET.isHost=true; NET.code=code; NET.myIdx=0;
      netLobby={count,seats:[{name,ai:false,host:true}]};
      peer.on("connection",c=>netHostConn(c));
      peer.on("disconnected",()=>{ try{peer.reconnect();}catch(e){} });
      netRenderHostLobby();
      return;
    }
    try{ peer.destroy(); }catch(e){}
    if(opened==="fatal"){ toast("Network error — check internet."); $("net-create-btn").disabled=false; return; }
  }
  toast("Couldn't get a room code — try again.");
  $("net-create-btn").disabled=false;
}
function netRenderHostLobby(){
  if(!netLobby) return;
  $("net-title").textContent="Room "+NET.code;
  const b=$("net-body"); b.innerHTML="";
  const code=document.createElement("div");
  code.style.cssText="font-size:44px;font-weight:bold;letter-spacing:12px;text-align:center;margin:6px 0";
  code.textContent=NET.code;
  const cp=document.createElement("button"); cp.textContent="Copy code";
  cp.onclick=()=>{ (navigator.clipboard?navigator.clipboard.writeText(NET.code):Promise.reject()).then(()=>toast("Code copied"),()=>toast("Code: "+NET.code)); };
  const wrap=document.createElement("div"); wrap.style.cssText="display:flex;gap:10px;align-items:center;justify-content:center";
  wrap.append(code,cp);
  const seats=document.createElement("div"); seats.id="net-seats";
  netLobby.seats.forEach((s,i)=>{
    if(s) seats.appendChild(netSeatRow(s,i));
    else { const d=document.createElement("div"); d.className="tres";
      d.innerHTML="<span style='opacity:.5'>Empty seat</span><span style='opacity:.5'>AI</span>";
      seats.appendChild(d); }
  });
  const go=document.createElement("button"); go.textContent="Start game"; go.style.cssText="margin-top:10px;font-size:18px;padding:12px 22px";
  go.onclick=netStartGame;
  const note=document.createElement("p"); note.style.cssText="opacity:.65;font-size:13px";
  note.textContent="Share the code with up to "+(netLobby.count-1)+" friends. Empty seats become AI opponents.";
  b.append(wrap,seats,go,note);
  $("net-modal").classList.add("open");
}
function netStartGame(){
  const filled=netLobby.seats.filter(Boolean).length;
  if(filled<2){ toast("Need at least 2 players to start"); return; }
  const n=netLobby.count;
  newGameState(n);
  for(let i=0;i<n;i++){
    const s=netLobby.seats[i];
    if(s){ G.players[i].name=s.name; G.players[i].ai=false; }
    else { G.players[i].name=PLAYER_DEFS[i].name; G.players[i].ai=true; }
  }
  G.humans=filled;
  NET.started=true; netLobby.count=n;
  $("net-modal").classList.remove("open"); $("setup-modal").classList.remove("open");
  netConns.forEach(c=>{ if(c.open) c.send({t:"start"}); });
  setupTurn(); // draw() -> netAfterDraw() broadcasts initial state
}
function netShowJoinForm(){
  $("setup-modal").classList.remove("open");
  $("net-title").textContent="Join online game";
  const b=$("net-body"); b.innerHTML="";
  const l1=document.createElement("p"); l1.innerHTML="<b>Your name</b>";
  const nm=document.createElement("input"); nm.id="net-name2"; nm.maxLength=16; nm.placeholder="You"; nm.style.cssText="width:100%;padding:10px;font-size:16px;border-radius:8px;border:1px solid #999";
  const l2=document.createElement("p"); l2.innerHTML="<b>Room code</b>";
  const cd=document.createElement("input"); cd.id="net-code"; cd.maxLength=4; cd.placeholder="AB3D"; cd.style.cssText="width:100%;padding:10px;font-size:22px;letter-spacing:8px;text-transform:uppercase;border-radius:8px;border:1px solid #999";
  const go=document.createElement("button"); go.textContent="Join"; go.style.cssText="margin-top:10px;font-size:18px;padding:12px 22px";
  go.onclick=netJoinRoom;
  b.append(l1,nm,l2,cd,go);
  $("net-modal").classList.add("open");
}
async function netJoinRoom(){
  const code=(($("net-code").value||"").trim().toLowerCase());
  const name=(($("net-name2").value||"").trim().slice(0,16))||"You";
  if(!code){ toast("Enter a room code"); return; }
  try{ await netLoadPeer(); }catch(e){ toast("Couldn't load networking — check internet."); return; }
  $("net-title").textContent="Joining…"; $("net-body").innerHTML="<p>Connecting…</p>";
  const peer=new Peer();
  NET.peer=peer; NET.myName=name;
  let settled=false;
  peer.on("open",()=>{
    const c=peer.connect("hexisle3d-"+code,{reliable:true});
    NET.conn=c; NET.active=true; NET.isHost=false;
    c.on("open",()=>{ settled=true; c.send({t:"join",name}); });
    c.on("data",m=>netOnHostMsg(m));
    c.on("close",()=>netHostDown());
    c.on("error",()=>netHostDown());
    setTimeout(()=>{ if(!settled&&!NET.started){ toast("Couldn't reach that room — check the code."); netReset(); } },15000);
  });
  peer.on("error",()=>{ if(!settled){ toast("Couldn't reach that room — check the code."); netReset(); } });
}
function netRenderGuestLobby(m){
  $("net-title").textContent="Room "+(NET.code||"");
  const b=$("net-body"); b.innerHTML="";
  const p=document.createElement("p"); p.textContent="Waiting for the host to start…";
  b.appendChild(p);
  if(m&&m.seats) m.seats.forEach((s)=>{
    if(s) b.appendChild(netSeatRow(s));
    else { const d=document.createElement("div"); d.className="tres";
      d.innerHTML="<span style='opacity:.5'>Empty seat</span><span style='opacity:.5'>AI</span>";
      b.appendChild(d); }
  });
  $("net-modal").classList.add("open");
}

/* guest: keep the host's G.mode in sync with the build-mode buttons (toggle-aware) */
const _setMode=setMode;
setMode=function(m,label){
  _setMode(m,label);
  if(NET.active&&!NET.isHost) netSend({t:"a",a:"mode",mode:G.mode});
};

/* wire setup-modal buttons */
$("m-host").onclick=()=>netShowHostCreate();
$("m-join").onclick=()=>netShowJoinForm();
$("net-close").onclick=()=>{ if(!NET.started) netReset(); else $("net-modal").classList.remove("open"); };

;
