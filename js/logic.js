
"use strict";
/* ============================================================
   HEX ISLE — a Catan-style settlement game with original assets
   ============================================================ */
const RES = ["timber","clay","grain","wool","stone"];
const RES_ICON = {timber:"🪵", clay:"🧱", grain:"🌾", wool:"🐑", stone:"⛰"};
const TERRAIN_STYLE = {
  timber:{c:"#2e7d32", n:"Forest"}, clay:{c:"#b5651d", n:"Clay Pit"},
  grain:{c:"#d4a017", n:"Fields"}, wool:{c:"#7cb342", n:"Pasture"},
  stone:{c:"#78909c", n:"Quarry"}, desert:{c:"#d7c194", n:"Desert"}
};
const PIPS = {2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
const COSTS = {
  road:{timber:1,clay:1}, settlement:{timber:1,clay:1,grain:1,wool:1},
  city:{stone:3,grain:2}, dev:{stone:1,grain:1,wool:1}
};
const DEV_DEFS = {
  guard:{name:"Guard", desc:"Move the bandit and steal 1 card."},
  trail:{name:"Trailblazer", desc:"Place 2 free roads."},
  harvest:{name:"Harvest", desc:"Take any 2 resources from the bank."},
  embargo:{name:"Embargo", desc:"Take all of one resource from every player."},
  landmark:{name:"Landmark", desc:"Worth 1 victory point."}
};
const PLAYER_DEFS = [
  {name:"You", color:"#d64545", ai:false},
  {name:"Marina", color:"#4d8fd6", ai:true},
  {name:"Rusty", color:"#e8933c", ai:true},
  {name:"Pearl", color:"#e8e8e8", ai:true},
];
const WIN_VP = 10;

/* ---------- utils ---------- */
const $ = id => document.getElementById(id);
function load(k,fb){ try{ const v=JSON.parse(localStorage.getItem(k)); return v??fb; }catch(e){ return fb; } }
function save(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function mulberry(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function shuffle(a,rand){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function toast(m){ const t=$("toast"); t.textContent=m; t.classList.add("show");
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove("show"),2200); }
function fmtRes(o){ return RES.filter(r=>o[r]>0).map(r=>`${o[r]}${RES_ICON[r]}`).join(" ")||"—"; }
function clone(o){ return JSON.parse(JSON.stringify(o)); }

/* ---------- board generation (axial coords, pointy-top hexes) ---------- */
const DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const key=(q,r)=>q+","+r;
let G=null; // game state

function genBoard(rand){
  // 19 hexes, radius 2
  const hexes=[];
  for(let q=-2;q<=2;q++) for(let r=-2;r<=2;r++){
    if(Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=2) hexes.push({q,r,idx:hexes.length});
  }
  const hmap={}; hexes.forEach(h=>hmap[key(h.q,h.r)]=h);
  // terrains
  const terr=shuffle(["timber","timber","timber","timber","grain","grain","grain","grain",
    "wool","wool","wool","wool","clay","clay","clay","stone","stone","stone","desert"],rand);
  hexes.forEach((h,i)=>{ h.terrain=terr[i]; h.number=0; h.bandit = terr[i]==="desert"; });
  // numbers, avoiding adjacent 6/8
  const nums=[2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
  const nonDesert=hexes.filter(h=>h.terrain!=="desert");
  let tries=0;
  while(true){
    tries++;
    shuffle(nums,rand);
    nonDesert.forEach((h,i)=>h.number=nums[i]);
    let bad=false;
    for(const h of nonDesert){
      if(h.number!==6&&h.number!==8) continue;
      for(const d of DIRS){ const n=hmap[key(h.q+d[0],h.r+d[1])];
        if(n&&(n.number===6||n.number===8)){ bad=true; break; } }
      if(bad) break;
    }
    if(!bad||tries>60) break;
  }
  // geometry
  const S_=46; // hex size, scaled at draw
  const raw=hexes.map(h=>({x:S_*Math.sqrt(3)*(h.q+h.r/2), y:S_*1.5*h.r}));
  const xs=raw.map(p=>p.x), ys=raw.map(p=>p.y);
  const cx=(Math.min(...xs)+Math.max(...xs))/2, cy=(Math.min(...ys)+Math.max(...ys))/2;
  hexes.forEach((h,i)=>{ h.x=raw[i].x-cx; h.y=raw[i].y-cy; });
  // vertices & edges via corner dedupe
  const vmap={}, emap={};
  const corner=(h,i)=>{ const a=(60*i-30)*Math.PI/180;
    return {x:h.x+S_*Math.cos(a), y:h.y+S_*Math.sin(a)}; };
  hexes.forEach(h=>{
    h.corners=[];
    for(let i=0;i<6;i++){
      const c=corner(h,i), k=Math.round(c.x)+","+Math.round(c.y);
      if(!vmap[k]) vmap[k]={key:k,x:c.x,y:c.y,owner:-1,type:null,port:null,hexes:[]};
      vmap[k].hexes.push(h.idx); h.corners.push(k);
    }
    for(let i=0;i<6;i++){
      const a=h.corners[i], b=h.corners[(i+1)%6];
      const ek=[a,b].sort().join("|");
      if(!emap[ek]) emap[ek]={key:ek,a,b,owner:-1};
    }
  });
  const verts=Object.values(vmap), edges=Object.values(emap);
  // ports: 9 evenly spaced coastal vertices (<=2 adjacent hexes)
  const coastal=verts.filter(v=>v.hexes.length<=2)
    .sort((a,b)=>Math.atan2(a.y,a.x)-Math.atan2(b.y,b.x));
  const ptypes=shuffle(["3:1","3:1","3:1","3:1","timber","clay","grain","wool","stone"],rand);
  for(let i=0;i<9;i++){
    const v=coastal[Math.floor(i*coastal.length/9)];
    const t=ptypes[i];
    v.port = t==="3:1" ? {ratio:3,res:null} : {ratio:2,res:t};
  }
  return {hexes,verts,edges,vmap,emap,hexSize:S_};
}

;

"use strict";
/* ================= game state ================= */
function newGameState(humans){
  const rand = Math.random;
  const board = genBoard(rand);
  const players = PLAYER_DEFS.map((d,i)=>({
    idx:i, name: d.name+(i<humans?"":""), color:d.color, ai: i>=humans,
    res:{timber:0,clay:0,grain:0,wool:0,stone:0},
    dev:[], guards:0, roads:[], settles:[], cities:[],
    longest:0, largestArmy:false, vp:0
  }));
  // rename humans in pass&play
  players.forEach((p,i)=>{ if(i<humans) p.name = humans===1 ? "You" : "Player "+(i+1); });
  const devDeck = shuffle(
    Array(14).fill("guard").concat(Array(5).fill("landmark"),["trail","trail"],["harvest","harvest"],["embargo","embargo"]
  ).map(t=>({type:t, boughtTurn:-1})), rand);
  G = {
    board, players, devDeck, turn:0, phase:"setup", setupStep:0,
    setupOrder:[0,1,2,3,3,2,1,0].filter(i=>i<players.length),
    mode:null,            // interaction mode for clicks
    dice:[1,1], rolled:false, devPlayed:-1, freeRoads:0,
    longestHolder:-1, armyHolder:-1, over:false, humans,
    log:[], boardId:Math.random().toString(36).slice(2), netPrompt:null, seq:0
  };
  log("Welcome to Hex Isle! Place settlements: "+G.setupOrder.map(i=>players[i].name).join(" → "));
  return G;
}

/* ---------- rules helpers ---------- */
function vNeighbors(vkey){
  // vertices adjacent to a vertex (share an edge)
  const out=[];
  for(const e of G.board.edges){ if(e.a===vkey) out.push(e.b); else if(e.b===vkey) out.push(e.a); }
  return out;
}
function vHexes(vkey){ return G.board.vmap[vkey].hexes.map(i=>G.board.hexes[i]); }
function edgeVerts(ekey){ const e=G.board.emap[ekey]; return [e.a,e.b]; }
function playerRoadNet(pi){
  // set of vertex keys touching player's roads/settlements/cities
  const s=new Set();
  const p=G.players[pi];
  p.roads.forEach(k=>{ const e=G.board.emap[k]; s.add(e.a); s.add(e.b); });
  p.settles.forEach(k=>s.add(k)); p.cities.forEach(k=>s.add(k));
  return s;
}
function legalSettle(pi,vkey,setup){
  const v=G.board.vmap[vkey];
  if(v.owner!==-1) return false;
  for(const n of vNeighbors(vkey)) if(G.board.vmap[n].owner!==-1) return false; // distance rule
  if(setup) return true;
  return playerRoadNet(pi).has(vkey);
}
function legalRoad(pi,ekey,setupVkey){
  const e=G.board.emap[ekey];
  if(e.owner!==-1) return false;
  if(setupVkey) return e.a===setupVkey||e.b===setupVkey;
  const net=playerRoadNet(pi);
  return net.has(e.a)||net.has(e.b);
}
function legalCity(pi,vkey){
  const v=G.board.vmap[vkey];
  return v.owner===pi && v.type==="settlement";
}
function canAfford(p,cost){ return RES.every(r=>p.res[r]>=(cost[r]||0)); }
function pay(p,cost){ RES.forEach(r=>p.res[r]-=(cost[r]||0)); }
function gain(p,res,n=1){ p.res[res]+=n; }
function totalCards(p){ return RES.reduce((a,r)=>a+p.res[r],0); }
function bestBankRate(pi,giveRes){
  // 2:1 only for the specific resource of a port you own; 3:1 generic; else 4:1
  let rate=4;
  const p=G.players[pi];
  for(const vk of [...p.settles,...p.cities]){
    const port=G.board.vmap[vk].port;
    if(!port) continue;
    if(port.res===giveRes) return 2;
    if(port.res===null) rate=3;
  }
  return rate;
}
function computeVP(pi){
  const p=G.players[pi];
  let vp=p.settles.length + p.cities.length*2;
  vp += p.dev.filter(d=>d.type==="landmark").length;
  if(G.longestHolder===pi) vp+=2;
  if(G.armyHolder===pi) vp+=2;
  p.vp=vp; return vp;
}
function longestRoad(pi){
  // longest simple path (in edges) through player's road graph
  const adj={};
  G.players[pi].roads.forEach(k=>{ const e=G.board.emap[k];
    (adj[e.a]=adj[e.a]||[]).push(e.b); (adj[e.b]=adj[e.b]||[]).push(e.a); });
  let best=0;
  function dfs(v,seen){
    let m=0;
    for(const n of (adj[v]||[])){ const ek=[v,n].sort().join("|");
      if(seen.has(ek)) continue; seen.add(ek);
      m=Math.max(m,1+dfs(n,seen)); seen.delete(ek); }
    return m;
  }
  for(const v of Object.keys(adj)) best=Math.max(best,dfs(v,new Set()));
  return best;
}
function updateLongest(){
  let best=0,holder=G.longestHolder;
  G.players.forEach((p,i)=>{ p.longest=longestRoad(i);
    if(p.longest>=5&&p.longest>best){ best=p.longest; holder=i; } });
  if(holder!==G.longestHolder){
    G.longestHolder=holder;
    if(holder>=0) log(`${G.players[holder].name} takes Longest Road (${best})! 🏅`);
  }
  G.players.forEach((_,i)=>computeVP(i));
}
function updateArmy(pi){
  const p=G.players[pi];
  if(p.guards>=3){
    let top=p.guards,holder=pi;
    G.players.forEach((q,i)=>{ if(i!==pi&&q.guards>top){ top=q.guards; holder=i; } });
    if(G.armyHolder!==holder){ G.armyHolder=holder; log(`${G.players[holder].name} takes Largest Guard! ⚔️`); }
  }
  G.players.forEach((_,i)=>computeVP(i));
}
function checkWin(){
  for(let i=0;i<G.players.length;i++){
    if(computeVP(i)>=WIN_VP && !G.over){
      G.over=true; onWin(i); return true;
    }
  }
  return false;
}

/* ================= rendering ================= */
function legalSettleList(){
  const pi=G.turn, out=[];
  const setup=(G.phase==="setup");
  const placed=G._setupPlaced||0;
  for(const v of G.board.verts) if(legalSettle(pi,v.key,setup)) out.push(v.key);
  return out;
}
function legalRoadList(){
  const pi=G.turn, out=[];
  const setupV=G._setupVkey||null;
  for(const e of G.board.edges) if(legalRoad(pi,e.key,setupV)){ out.push(e.key); }
  return out;
}

;

"use strict";
/* ================= UI panels ================= */
function log(m){ G.log.unshift(m); if(G.log.length>70)G.log.pop();
  const el=$("log"); el.innerHTML=G.log.map(x=>`<div>${x}</div>`).join(""); }
function renderPlayers(){
  const el=$("players"); el.innerHTML="";
  G.players.forEach((p,i)=>{
    const d=document.createElement("div");
    d.className="pcard"+(i===G.turn&&!G.over?" active":"");
    d.innerHTML=`<div class="dot" style="background:${p.color}"></div>
      <div class="nm">${p.name}${p.ai?' 🤖':''}</div>
      <div class="sub">🃏${p.resTotal??totalCards(p)} ⛏${p.devTotal??p.dev.length}</div>
      <div class="vp">${p.vpShown??p.vp} VP</div>`;
    el.appendChild(d);
  });
}
function renderMyRes(){
  const p=G.players[G.turn];
  const show = p.ai ? null : p; // in solo, turn player is human; pass&play shows current human
  const el=$("resrow"); el.innerHTML="";
  const me = G.players[Math.min(G.turn, G.humans-1)] && !G.players[G.turn].ai ? G.players[G.turn] : null;
  const target = (!G.players[G.turn].ai) ? G.players[G.turn] : G.players[0];
  // show current human's resources (player 0 in solo; turn player in pass&play)
  const who = (typeof NET!=="undefined"&&NET.active) ? G.players[NET.myIdx] :
    (G.humans===1 ? G.players[0] : (G.players[G.turn].ai?null:G.players[G.turn]));
  $("myres").querySelector("h4").textContent = who? (who.name==="You"?"Your resources":`${who.name}'s resources`) : "Resources";
  if(!who){ el.innerHTML="<span style='opacity:.6'>AI turn…</span>"; return; }
  RES.forEach(r=>{ const c=document.createElement("div"); c.className="chip";
    c.textContent=`${RES_ICON[r]} ${who.res[r]}`; el.appendChild(c); });
}
function setBanner(t){ $("turn-banner").textContent=t; }
function hintBar(t){ const h=$("hint-bar"); if(!t){h.style.display="none";return;}
  h.textContent=t; h.style.display="block"; }
function refreshUI(){
  renderPlayers(); renderMyRes();
  const p=G.players[G.turn];
  setBanner(G.over?"Game over":`${p.name==="You"?"Your":p.name+"'s"} turn${G.phase==="setup"?" (setup)":""}`);
  updateButtons();
  if(typeof netHookUI!=="undefined") netHookUI();
}
function updateButtons(){
  const p=G.players[G.turn], human=!p.ai&&!G.over&&netCanAct();
  const main=G.phase==="main";
  $("b-roll").disabled=!(human&&main&&!G.rolled);
  $("b-road").disabled=!(human&&main&&G.rolled&&canAfford(p,COSTS.road));
  $("b-settle").disabled=!(human&&main&&G.rolled&&canAfford(p,COSTS.settlement));
  $("b-city").disabled=!(human&&main&&G.rolled&&canAfford(p,COSTS.city)&&p.settles.length>0);
  $("b-dev").disabled=!(human&&main&&G.rolled&&canAfford(p,COSTS.dev)&&G.devDeck.length>0);
  $("b-trade").disabled=!(human&&main&&G.rolled);
  $("b-cards").disabled=!(human&&main&&p.dev.length>0);
  $("b-end").disabled=!(human&&(main&&G.rolled||G.phase==="setup"&&false));
  if(G.phase==="setup") $("b-end").disabled=true;
}

/* ================= setup draft ================= */
function setupTurn(){
  const pi=G.setupOrder[G.setupStep], p=G.players[pi];
  G.turn=pi; G._setupPlaced=0; G._setupVkey=null;
  refreshUI();
  if(p.ai){ setTimeout(aiSetup, 700); }
  else if(NET.active&&!NET.isHost){ G.mode="setup-settle"; draw(); }
  else { G.mode="setup-settle"; hintBar(netIsRemote(pi)?`Waiting for ${p.name}…`:`${p.name}: tap a glowing spot for your settlement`); draw(); }
}
function placeSetupSettle(vkey){
  const pi=G.turn;
  G.board.vmap[vkey].owner=pi; G.board.vmap[vkey].type="settlement";
  G.players[pi].settles.push(vkey);
  G._setupVkey=vkey; G._setupPlaced=1;
  sfx.place();
  if(G.players[pi].ai){ /* ai continues */ }
  else { G.mode="setup-road"; hintBar("Now tap a glowing road next to it"); }
  draw(); refreshUI();
}
function placeSetupRoad(ekey){
  const pi=G.turn, p=G.players[pi];
  G.board.emap[ekey].owner=pi; p.roads.push(ekey);
  sfx.place(); computeVP(pi);
  // 2nd placement grants starting resources
  if(G.setupStep>=G.setupOrder.length/2){
    const res=vHexes(G._setupVkey).filter(h=>h.terrain!=="desert").map(h=>h.terrain);
    res.forEach(r=>gain(p,r));
    if(!p.ai) toast("Starting resources: "+fmtRes(Object.fromEntries(res.map(r=>[r,1]))));
  }
  log(`${p.name} founded a settlement.`);
  G.setupStep++; G.mode=null; hintBar(null);
  if(G.setupStep>=G.setupOrder.length){
    G.phase="main"; G.turn=0; log("Setup complete! "+G.players[0].name+" starts.");
    startTurn();
  } else setupTurn();
  draw(); refreshUI();
}

/* ================= turn flow ================= */
function startTurn(){
  const p=G.players[G.turn];
  G.rolled=false; G.devPlayed=-1; G.freeRoads=0; G.mode=null; hintBar(null);
  computeVP(G.turn); refreshUI(); draw();
  if(p.ai){ setTimeout(aiTurn, 900); }
  else { toast(`${p.name}, roll the dice!`); }
}
function rollDice(){
  const p=G.players[G.turn];
  if(G.rolled) return;
  G.rolled=true;
  const d1=1+Math.floor(Math.random()*6), d2=1+Math.floor(Math.random()*6);
  // little animation
  let n=0; sfx.dice();
  const iv=setInterval(()=>{
    $("dice").textContent="🎲 "+(1+Math.floor(Math.random()*6))+"+"+(1+Math.floor(Math.random()*6));
    if(++n>6){ clearInterval(iv);
      G.dice=[d1,d2]; const tot=d1+d2;
      $("dice").textContent=`🎲 ${tot}`;
      log(`${p.name} rolled ${tot}.`);
      if(tot===7) onSeven(); else { produce(tot); afterRoll(); }
    }
  },90);
}
function produce(tot){
  for(const h of G.board.hexes){
    if(h.number!==tot||h.bandit) continue;
    for(const vk of h.corners){
      const v=G.board.vmap[vk];
      if(v.owner===-1) continue;
      const n=v.type==="city"?2:1;
      gain(G.players[v.owner],h.terrain,n);
    }
  }
}
function afterRoll(){ refreshUI(); draw(); }
function onSeven(){
  // discards
  const needDiscard=G.players.map((p,i)=>i).filter(i=>totalCards(G.players[i])>7);
  const doRobber=()=>{
    const p=G.players[G.turn];
    if(p.ai) aiRobber();
    else if(netIsRemote(G.turn)){ G.mode="robber"; G.netPrompt={for:G.turn,kind:"robber",seq:++netPromptSeq}; hintBar(`Waiting for ${p.name}…`); draw(); refreshUI(); }
    else { G.mode="robber"; hintBar("Rolled 7! Tap a hex to move the bandit"); draw(); refreshUI(); }
  };
  if(!needDiscard.length){ doRobber(); return; }
  // handle discards sequentially; human gets modal
  let di=0;
  const next=()=>{
    if(di>=needDiscard.length){ doRobber(); return; }
    const pi=needDiscard[di++], p=G.players[pi];
    const target=Math.floor(totalCards(p)/2);
    if(p.ai){ aiDiscard(p,target); next(); }
    else if(netIsRemote(pi)){ G.netPrompt={for:pi,kind:"discard",target,seq:++netPromptSeq}; netWaitResume(next); hintBar(`Waiting for ${p.name} to discard…`); draw(); }
    else showDiscard(p,target,next);
  };
  next();
}
function showDiscard(p,target,done){
  $("discard-target").textContent=target;
  const ui=$("discard-ui"); ui.innerHTML="";
  const sel={timber:0,clay:0,grain:0,wool:0,stone:0};
  RES.forEach(r=>{
    const row=document.createElement("div"); row.className="tres";
    row.innerHTML=`<span>${RES_ICON[r]} ${r} (have ${p.res[r]})</span>`;
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
    if(tot!==target){ toast(`Discard exactly ${target}`); return; }
    RES.forEach(r=>p.res[r]-=sel[r]);
    log(`${p.name} discarded ${target} cards.`);
    $("discard-modal").classList.remove("open"); sfx.place(); done();
  };
}
function moveRobber(hidx, pi){
  const B=G.board;
  B.hexes.forEach(h=>h.bandit=false); B.hexes[hidx].bandit=true;
  log(`${G.players[pi].name} moved the bandit to ${TERRAIN_STYLE[B.hexes[hidx].terrain].n}.`);
  // victims: opponents with building adjacent
  const victims=new Set();
  for(const vk of B.hexes[hidx].corners){ const v=B.vmap[vk];
    if(v.owner!==-1&&v.owner!==pi&&totalCards(G.players[v.owner])>0) victims.add(v.owner); }
  return [...victims];
}
function stealFrom(pi,vi){
  const v=G.players[vi];
  const pool=RES.filter(r=>v.res[r]>0);
  if(!pool.length) return;
  const r=pool[Math.floor(Math.random()*pool.length)];
  v.res[r]--; G.players[pi].res[r]++;
  log(`${G.players[pi].name} stole ${RES_ICON[r]} from ${v.name}.`);
}
function endTurn(){
  if(G.over) return;
  G.turn=(G.turn+1)%G.players.length; G.turnCount++;
  log(`— ${G.players[G.turn].name}'s turn —`);
  startTurn();
}
function onWin(pi){
  const p=G.players[pi];
  computeVP(pi);
  const st=load("hexisle-stats",{played:0,won:0});
  st.played++; if(pi===0&&G.humans===1) st.won++;
  save("hexisle-stats",st);
  sfx.win(); confetti();
  $("win-title").textContent=`${p.name} wins!`;
  $("win-detail").textContent=`${p.vpShown??p.vp} victory points in a ${G.players.length}-player game. `+
    (pi===0?"The isle is yours! 🏝️":"The AI takes this one — rematch?");
  $("win-modal").classList.add("open");
  refreshUI(); draw(); netOnWin(pi);
}

;

"use strict";
/* ================= building ================= */
function buildRoad(ekey, free){
  const pi=G.turn, p=G.players[pi];
  if(!free){ if(!canAfford(p,COSTS.road)) return false; pay(p,COSTS.road); }
  G.board.emap[ekey].owner=pi; p.roads.push(ekey);
  sfx.build(); log(`${p.name} built a road.`);
  updateLongest(); G.mode=null; hintBar(null);
  refreshUI(); draw(); checkWin();
  return true;
}
function buildSettle(vkey){
  const pi=G.turn, p=G.players[pi];
  if(!canAfford(p,COSTS.settlement)) return false;
  pay(p,COSTS.settlement);
  const v=G.board.vmap[vkey]; v.owner=pi; v.type="settlement"; p.settles.push(vkey);
  sfx.build(); log(`${p.name} built a settlement (+1 VP).`);
  G.mode=null; hintBar(null);
  computeVP(pi); refreshUI(); draw(); checkWin();
  return true;
}
function buildCity(vkey){
  const pi=G.turn, p=G.players[pi];
  if(!canAfford(p,COSTS.city)) return false;
  pay(p,COSTS.city);
  const v=G.board.vmap[vkey]; v.type="city";
  p.settles.splice(p.settles.indexOf(vkey),1); p.cities.push(vkey);
  sfx.build(); log(`${p.name} built a city (+1 VP).`);
  G.mode=null; hintBar(null);
  computeVP(pi); refreshUI(); draw(); checkWin();
  return true;
}
function buyDev(){
  if(NET.active&&!NET.isHost){ netSend({t:'a',a:'buyDev'}); return false; }
  const p=G.players[G.turn];
  if(!G.devDeck.length||!canAfford(p,COSTS.dev)) return false;
  pay(p,COSTS.dev);
  const c=G.devDeck.pop(); c.boughtTurn=G.turnCount; p.dev.push(c);
  sfx.card(); log(`${p.name} bought a development card.`);
  computeVP(p.idx); refreshUI(); draw(); checkWin();
  return true;
}
/* ================= dev cards ================= */
function playableDev(p){
  return p.dev.filter(d=>d.type!=="landmark" && d.boughtTurn!==G.turnCount);
}
function openDevCards(){
  const p=G.players[G.turn], el=$("devlist"); el.innerHTML="";
  if(!p.dev.length) el.innerHTML="<p>No development cards yet.</p>";
  p.dev.forEach((d,i)=>{
    const row=document.createElement("div"); row.className="dcard";
    const playable=d.type!=="landmark"&&d.boughtTurn!==G.turnCount&&G.devPlayed!==G.turnCount;
    row.innerHTML=`<div class="inf"><b>${DEV_DEFS[d.type].name}</b><span>${DEV_DEFS[d.type].desc}</span></div>`;
    const b=document.createElement("button"); b.textContent="Play"; b.disabled=!playable;
    b.onclick=()=>{ $("cards-modal").classList.remove("open"); playDev(p,i); };
    row.appendChild(b); el.appendChild(row);
  });
  $("cards-modal").classList.add("open");
}
function playDev(p,di){
  if(NET.active&&!NET.isHost){ netSend({t:'a',a:'playDev',i:di}); return; }
  const d=p.dev[di];
  if(d.boughtTurn===G.turnCount||G.devPlayed===G.turnCount) return;
  G.devPlayed=G.turnCount;
  if(d.type==="guard"){
    p.dev.splice(di,1); p.guards++;
    log(`${p.name} played a Guard!`);
    updateArmy(p.idx);
    if(p.ai) aiRobber();
    else if(netIsRemote(p.idx)){ G.mode="robber"; G.netPrompt={for:p.idx,kind:"robber",seq:++netPromptSeq}; hintBar("Waiting for "+p.name+"..."); }
    else { G.mode="robber"; hintBar("Move the bandit: tap a hex"); draw(); }
  } else if(d.type==="trail"){
    p.dev.splice(di,1); G.freeRoads=2;
    log(`${p.name} played Trailblazer: 2 free roads.`);
    if(p.ai) aiFreeRoads(); else { G.mode="freeroad"; hintBar(netIsRemote(p.idx)?"Waiting for "+p.name+"...":"Place 2 free roads (0 placed)"); draw(); }
  } else if(d.type==="harvest"){
    p.dev.splice(di,1);
    log(`${p.name} played Harvest.`);
    if(p.ai){ const rs=aiNeededRes(p,2); rs.forEach(r=>gain(p,r)); log(`${p.name} harvested ${fmtRes(Object.fromEntries(rs.map(r=>[r,1])))}.`); refreshUI(); draw(); }
    else if(netIsRemote(p.idx)){ G.netPrompt={for:p.idx,kind:"pickRes",n:2,pickKind:"harvest",seq:++netPromptSeq}; hintBar("Waiting for "+p.name+"..."); }
    else pickResources("Harvest: choose 2 resources",2,rs=>{ rs.forEach(r=>gain(p,r)); refreshUI(); draw(); });
  } else if(d.type==="embargo"){
    p.dev.splice(di,1);
    log(`${p.name} played Embargo!`);
    if(p.ai){ const r=aiBestEmbargo(p); doEmbargo(p,r); }
    else if(netIsRemote(p.idx)){ G.netPrompt={for:p.idx,kind:"pickRes",n:1,pickKind:"embargo",seq:++netPromptSeq}; hintBar("Waiting for "+p.name+"..."); }
    else pickResources("Embargo: choose a resource to seize",1,rs=>doEmbargo(p,rs[0]));
  }
  refreshUI(); draw(); checkWin();
}
function doEmbargo(p,res){
  let got=0;
  G.players.forEach((q,i)=>{ if(i!==p.idx&&q.res[res]>0){ got+=q.res[res]; q.res[res]=0; } });
  p.res[res]+=got;
  log(`${p.name} seized ${got} ${RES_ICON[res]} ${res}!`);
  sfx.card(); refreshUI(); draw();
}
function pickResources(title,n,done){
  $("pick-title").textContent=title;
  const ui=$("pick-ui"); ui.innerHTML="";
  const sel=[];
  const upd=()=>{ $("pick-go")?.remove(); };
  const row=document.createElement("div"); row.className="row";
  RES.forEach(r=>{
    const b=document.createElement("button"); b.textContent=`${RES_ICON[r]} ${r}`;
    b.onclick=()=>{ if(sel.length<n){ sel.push(r); b.disabled=true;
      if(sel.length===n){ $("pick-modal").classList.remove("open"); done(sel); } } };
    row.appendChild(b);
  });
  ui.appendChild(row);
  const cancel=document.createElement("button"); cancel.textContent="Cancel";
  cancel.onclick=()=>$("pick-modal").classList.remove("open");
  ui.appendChild(cancel);
  $("pick-modal").classList.add("open");
}
/* ================= trading ================= */
function openTrade(){
  const p=G.players[G.turn];
  // bank
  const bg=$("bank-give"), bt=$("bank-get"); bg.innerHTML=""; bt.innerHTML="";
  RES.forEach(r=>{ const o=document.createElement("option"); o.value=r; o.textContent=`${RES_ICON[r]} ${r}`; bg.appendChild(o); });
  RES.forEach(r=>{ const o=document.createElement("option"); o.value=r; o.textContent=`${RES_ICON[r]} ${r}`; bt.appendChild(o); });
  const upd=()=>{
    const rate=bestBankRate(p.idx,bg.value);
    $("bank-rate").textContent=`Your best rate: ${rate}:1 ${bg.value?`on ${RES_ICON[bg.value]}`:""}. You have ${fmtRes(p.res)}.`;
  };
  bg.onchange=upd; upd();
  $("bank-go").onclick=()=>{
    if(NET.active&&!NET.isHost){ netSend({t:"a",a:"bank",give:bg.value,get:bt.value}); $("trade-modal").classList.remove("open"); return; }
    const rate=bestBankRate(p.idx,bg.value);
    if(p.res[bg.value]<rate){ toast(`Need ${rate} ${RES_ICON[bg.value]}`); return; }
    p.res[bg.value]-=rate; p.res[bt.value]++;
    sfx.trade(); log(`${p.name} traded ${rate}${RES_ICON[bg.value]} → 1${RES_ICON[bt.value]} with the bank.`);
    refreshUI(); draw(); upd();
  };
  // player trade
  const ui=$("ptrade-ui"); ui.innerHTML="";
  const others=G.players.filter((q,i)=>i!==p.idx);
  if(!others.length){ ui.innerHTML="<p>No other players.</p>"; }
  others.forEach(q=>{
    const row=document.createElement("div"); row.className="dcard";
    row.innerHTML=`<div class="inf"><b>${q.name}</b><span>🃏 ${totalCards(q)} cards</span></div>`;
    const b=document.createElement("button"); b.textContent="Offer";
    b.onclick=()=>playerOfferUI(p,q);
    row.appendChild(b); ui.appendChild(row);
  });
  $("trade-modal").classList.add("open");
}
function playerOfferUI(p,q){
  $("trade-modal").classList.remove("open");
  $("pick-title").textContent=`Offer to ${q.name}: you give…`;
  const ui=$("pick-ui"); ui.innerHTML="";
  const give={timber:0,clay:0,grain:0,wool:0,stone:0};
  RES.forEach(r=>{
    const row=document.createElement("div"); row.className="tres";
    row.innerHTML=`<span>${RES_ICON[r]} ${r} (you have ${p.res[r]})</span>`;
    const ctl=document.createElement("div"); ctl.className="ctl";
    const m=document.createElement("button"); m.textContent="−";
    const lab=document.createElement("b"); lab.textContent="0";
    const pl=document.createElement("button"); pl.textContent="+";
    m.onclick=()=>{ if(give[r]>0){give[r]--;lab.textContent=give[r];} };
    pl.onclick=()=>{ if(give[r]<p.res[r]){give[r]++;lab.textContent=give[r];} };
    ctl.append(m,lab,pl); row.appendChild(ctl); ui.appendChild(row);
  });
  const next=document.createElement("button"); next.textContent="Next: what you want →"; next.className="primary";
  next.style.marginTop="10px";
  next.onclick=()=>{
    if(!RES.some(r=>give[r]>0)){ toast("Offer something first"); return; }
    playerWantUI(p,q,give);
  };
  ui.appendChild(next);
  const cancel=document.createElement("button"); cancel.textContent="Cancel"; cancel.style.marginTop="8px";
  cancel.onclick=()=>$("pick-modal").classList.remove("open");
  ui.appendChild(cancel);
  $("pick-modal").classList.add("open");
}
function playerWantUI(p,q,give){
  $("pick-title").textContent=`Offer to ${q.name}: you want…`;
  const ui=$("pick-ui"); ui.innerHTML="";
  const want={timber:0,clay:0,grain:0,wool:0,stone:0};
  RES.forEach(r=>{
    const row=document.createElement("div"); row.className="tres";
    row.innerHTML=`<span>${RES_ICON[r]} ${r} (${q.name} has ${q.res[r]})</span>`;
    const ctl=document.createElement("div"); ctl.className="ctl";
    const m=document.createElement("button"); m.textContent="−";
    const lab=document.createElement("b"); lab.textContent="0";
    const pl=document.createElement("button"); pl.textContent="+";
    m.onclick=()=>{ if(want[r]>0){want[r]--;lab.textContent=want[r];} };
    pl.onclick=()=>{ want[r]++;lab.textContent=want[r]; };
    ctl.append(m,lab,pl); row.appendChild(ctl); ui.appendChild(row);
  });
  const send=document.createElement("button"); send.textContent=`Send to ${q.name}`; send.className="primary"; send.style.marginTop="10px";
  send.onclick=()=>{ $("pick-modal").classList.remove("open"); if(NET.active&&!NET.isHost){ netSend({t:"a",a:"offer",to:q.idx,give,want}); } else resolveOffer(p,q,give,want); };
  ui.appendChild(send);
  const cancel=document.createElement("button"); cancel.textContent="Cancel"; cancel.style.marginTop="8px";
  cancel.onclick=()=>$("pick-modal").classList.remove("open");
  ui.appendChild(cancel);
}
function resolveOffer(p,q,give,want){
  // q decides
  const desc=`${p.name} offers ${fmtRes(give)} for ${fmtRes(want)}`;
  if(q.ai){
    const ok=aiEvaluateTrade(q,give,want);
    if(ok && RES.every(r=>q.res[r]>=want[r])){
      RES.forEach(r=>{ p.res[r]-=give[r]; q.res[r]+=give[r]; q.res[r]-=want[r]; p.res[r]+=want[r]; });
      log(`🤝 ${desc} — ${q.name} accepts!`); sfx.trade();
    } else log(`✋ ${desc} — ${q.name} declines.`);
    refreshUI(); draw();
  } else if(netIsRemote(q.idx)){
    G.netPrompt={for:q.idx,kind:'tradeOffer',from:p.idx,give,want,seq:++netPromptSeq};
    log(p.name+' offers '+fmtRes(give)+' for '+fmtRes(want)+' — waiting for '+q.name+'...');
    refreshUI(); draw();
  } else {
    // pass & play: ask q directly
    $("offer-title").textContent=`${q.name}, trade offer`;
    $("offer-text").textContent=desc+". Accept?";
    $("offer-modal").classList.add("open");
    $("offer-yes").onclick=()=>{
      $("offer-modal").classList.remove("open");
      if(!RES.every(r=>q.res[r]>=want[r]&&p.res[r]>=give[r])){ toast("Someone lacks the cards"); return; }
      RES.forEach(r=>{ p.res[r]-=give[r]; q.res[r]+=give[r]; q.res[r]-=want[r]; p.res[r]+=want[r]; });
      log(`🤝 ${desc} — accepted!`); sfx.trade(); refreshUI(); draw();
    };
    $("offer-no").onclick=()=>{ $("offer-modal").classList.remove("open"); log(`✋ ${desc} — declined.`); };
  }
}

;

"use strict";
/* ================= AI ================= */
function vertexScore(vkey){
  // heuristic value of settling here
  const v=G.board.vmap[vkey];
  let score=0; const seen=new Set();
  for(const h of vHexes(vkey)){
    if(h.terrain==="desert") continue;
    score+=PIPS[h.number]||0; seen.add(h.terrain);
  }
  score+=seen.size*1.5;
  if(v.port) score+= v.port.res? 3 : 2;
  return score;
}
function aiSetup(){
  const pi=G.turn, p=G.players[pi];
  if(G._setupPlaced===0){
    // best legal vertex
    let best=null,bs=-1;
    for(const v of G.board.verts){
      if(!legalSettle(pi,v.key,true)) continue;
      const s=vertexScore(v.key)+Math.random()*2;
      if(s>bs){bs=s;best=v.key;}
    }
    placeSetupSettle(best);
    setTimeout(()=>{
      // road toward best neighboring vertex
      const e=G.board.edges.filter(e=>e.a===best||e.b===best);
      let be=null,bs2=-1;
      for(const ed of e){ const o=ed.a===best?ed.b:ed.a;
        const s=vertexScore(o)+Math.random();
        if(s>bs2){bs2=s;be=ed.key;} }
      placeSetupRoad(be);
    },700);
  }
}
function aiGoal(p){
  // what should I build toward? returns {type, deficit}
  const canCity=p.settles.length>0;
  const goals=[];
  if(canCity&&canAfford(p,COSTS.city)) return {type:"city",def:{}};
  if(canAfford(p,COSTS.settlement)&&bestSettleSpot(p.idx)) return {type:"settlement",def:{}};
  const def={};
  const consider=(type,cost,ok)=>{ if(!ok) return;
    let missing=0; const d={};
    RES.forEach(r=>{ const m=(cost[r]||0)-p.res[r]; if(m>0){d[r]=m;missing+=m;} });
    goals.push({type,def:d,missing}); };
  consider("city",COSTS.city,canCity);
  consider("settlement",COSTS.settlement,!!bestSettleSpot(p.idx));
  consider("dev",COSTS.dev,G.devDeck.length>0);
  consider("road",COSTS.road,true);
  goals.sort((a,b)=>a.missing-b.missing);
  return goals[0]||{type:"road",def:{}};
}
function aiNeed(p,r){
  const g=aiGoal(p);
  return (g.def[r]||0)*3 + (p.res[r]<=1?1:0);
}
function bestSettleSpot(pi){
  let best=null,bs=2;
  for(const v of G.board.verts){
    if(!legalSettle(pi,v.key,false)) continue;
    const s=vertexScore(v.key);
    if(s>bs){bs=s;best=v.key;}
  }
  return best;
}
function aiTurn(){
  const p=G.players[G.turn];
  if(G.over) return;
  log(`🤖 ${p.name} is thinking…`);
  // 1) roll
  setTimeout(()=>{
    if(G.over) return;
    rollDice();
    // wait for dice animation + possible robber, then act
    setTimeout(()=>aiMain(p), 1400);
  }, 600);
}
function aiMain(p){
  if(G.over||G.turn!==p.idx) return;
  p._devBought=0;
  if(G.mode==="robber"){ /* aiRobber was called via onSeven */ }
  // if robber still pending (mode set), aiRobber handles then we continue
  const step=()=>{
    if(G.over||G.turn!==p.idx) return;
    if($("discard-modal").classList.contains("open")){ setTimeout(step,800); return; }
    // play guard if useful
    const gd=p.dev.findIndex(d=>d.type==="guard"&&d.boughtTurn!==G.turnCount);
    const leader=Math.max(...G.players.map(q=>q.vp));
    if(gd>=0&&G.devPlayed!==G.turnCount&&(leader>=7||Math.random()<0.35)){
      playDev(p,gd); setTimeout(step,900); return;
    }
    // build loop
    let acted=true;
    while(acted&&!G.over){
      acted=false;
      if(canAfford(p,COSTS.city)&&p.settles.length){ buildCity(p.settles[0]); acted=true; continue; }
      const spot=bestSettleSpot(p.idx);
      if(spot&&canAfford(p,COSTS.settlement)){ buildSettle(spot); acted=true; continue; }
      if(p._devBought<2&&canAfford(p,COSTS.dev)&&G.devDeck.length&&(totalCards(p)>=8||Math.random()<0.45)){ buyDev(); p._devBought++; acted=true; continue; }
      const re=aiBestRoad(p.idx);
      if(re&&canAfford(p,COSTS.road)){ buildRoad(re); acted=true; continue; }
      // bank trade toward goal
      if(aiBankTrade(p)){ acted=true; continue; }
    }
    // maybe offer trade to human
    aiMaybeOffer(p);
    setTimeout(()=>{ if(!G.over&&G.turn===p.idx){ log(`${p.name} ends turn.`); endTurn(); } }, 900);
  };
  // if a robber move is pending for AI, do it first
  if(G.mode==="robber"&&!p.ai===false){ aiRobber(); setTimeout(step,900); }
  else step();
}
function aiBestRoad(pi){
  // legal road edge leading toward highest-value vertex
  let best=null,bs=-1;
  for(const e of G.board.edges){
    if(!legalRoad(pi,e.key,null)) continue;
    const s=Math.max(vertexScore(e.a),vertexScore(e.b))+Math.random();
    if(s>bs){bs=s;best=e.key;}
  }
  return best;
}
function aiBankTrade(p){
  const g=aiGoal(p);
  const needScore=r=>(g.def[r]||0)*3+(p.res[r]===0?1:0);
  for(const r of RES){
    if((g.def[r]||0)>0||p.res[r]===0){
      let bg=null,br=99;
      for(const g2 of RES){
        if(g2===r) continue;
        const rate=bestBankRate(p.idx,g2);
        // trade surplus (keep 1 buffer) or goal-excess
        if(p.res[g2]>=rate+1&&(p.res[g2]>=5||(g.def[g2]||0)===0)){ if(rate<br){br=rate;bg=g2;} }
      }
      if(bg){ p.res[bg]-=br; p.res[r]++;
        log(`🤖 ${p.name} bank-traded ${br}${RES_ICON[bg]} → 1${RES_ICON[r]}.`);
        refreshUI(); draw(); return true; }
    }
  }
  return false;
}
function aiRobber(){
  const pi=G.turn, p=G.players[pi];
  // pick hex maximizing opponents' expected loss
  let best=null,bs=-1;
  for(const h of G.board.hexes){
    if(h.bandit) continue;
    let s=0;
    for(const vk of h.corners){ const v=G.board.vmap[vk];
      if(v.owner!==-1&&v.owner!==pi){
        const opp=G.players[v.owner];
        s+=(PIPS[h.number]||0)*(v.type==="city"?2:1)*(1+opp.vp*0.15);
        if(totalCards(opp)>0) s+=0.5;
      } }
    s+=Math.random()*2;
    if(s>bs){bs=s;best=h.idx;}
  }
  const victims=moveRobber(best,pi);
  if(victims.length){
    victims.sort((a,b)=>totalCards(G.players[b])-totalCards(G.players[a]));
    stealFrom(pi,victims[0]);
  } else log("The bandit finds no victims.");
  G.mode=null; hintBar(null); refreshUI(); draw();
  sfx.place();
}
function aiDiscard(p,target){
  // ditch surplus, keep toward goal
  const g=aiGoal(p);
  let left=target;
  const order=[...RES].sort((a,b)=>(aiNeed(p,a)-p.res[a])-(aiNeed(p,b)-p.res[b]));
  for(const r of order){
    while(left>0&&p.res[r]>0){ p.res[r]--; left--; }
    if(left<=0) break;
  }
  log(`🤖 ${p.name} discarded ${target} cards.`);
}
function aiEvaluateTrade(q,give,want){
  // q is asked: give `want`, receive `give`
  let score=0;
  RES.forEach(r=>{
    if(give[r]>0) score+=aiNeed(q,r)*give[r]*2;
    if(want[r]>0) score-=aiNeed(q,r)*want[r]*1.6 + (q.res[r]<=want[r]?4:0);
  });
  return score>1;
}
function aiMaybeOffer(p){
  if(G.humans!==1) return;
  const human=G.players[0];
  const g=aiGoal(p);
  const needR=RES.find(r=>(g.def[r]||0)>0);
  if(!needR) return;
  const surplus=RES.find(r=>r!==needR&&p.res[r]>=3);
  if(!surplus||Math.random()<0.5) return;
  const give={[surplus]:1}, want={[needR]:1};
  $("offer-title").textContent=`${p.name} offers a trade`;
  $("offer-text").textContent=`${p.name} offers ${fmtRes({[surplus]:1})} for your ${fmtRes({[needR]:1})}. Accept?`;
  $("offer-modal").classList.add("open");
  $("offer-yes").onclick=()=>{
    $("offer-modal").classList.remove("open");
    if(human.res[needR]<1){ toast("You don't have it"); return; }
    human.res[needR]--; p.res[needR]++; p.res[surplus]--; human.res[surplus]++;
    log(`🤝 You traded with ${p.name}.`); sfx.trade(); refreshUI(); draw();
  };
  $("offer-no").onclick=()=>{ $("offer-modal").classList.remove("open"); log(`✋ You declined ${p.name}'s offer.`); };
}
function aiFreeRoads(){
  const p=G.players[G.turn];
  let n=0;
  const step=()=>{
    if(n>=2||G.over){ return; }
    const e=aiBestRoad(p.idx);
    if(!e) return;
    G.board.emap[e].owner=p.idx; p.roads.push(e);
    log(`🤖 ${p.name} placed a free road.`);
    n++; updateLongest(); refreshUI(); draw();
    setTimeout(step,700);
  };
  step();
}
function aiNeededRes(p,n){
  const g=aiGoal(p), out=[];
  RES.forEach(r=>{ for(let i=0;i<(g.def[r]||0)&&out.length<n;i++) out.push(r); });
  while(out.length<n) out.push(RES[Math.floor(Math.random()*5)]);
  return out;
}
function aiBestEmbargo(p){
  let best="timber",bs=-1;
  RES.forEach(r=>{ let s=0; G.players.forEach((q,i)=>{ if(i!==p.idx) s+=q.res[r]; });
    if(s>bs){bs=s;best=r;} });
  return best;
}

;
