const VERSION="152";
const CHANNEL="scarlet-frontier-hud-v15-2";
const META_KEY="com.scarletfrontier.hud/v15.2";
const STORAGE_KEY="scarlet-hud-v15-2";
const MAX_EVENTS=80;
const SKILLS=[
  {n:"Насилие",attr:"attrBody"},{n:"Атлетика",attr:"attrBody"},{n:"Стойкость",attr:"attrBody"},{n:"Выживание",attr:"attrBody"},
  {n:"Стрельба",attr:"attrReact"},{n:"Скрытность",attr:"attrReact"},{n:"Пилотирование",attr:"attrReact"},
  {n:"Следствие",attr:"attrMind"},{n:"Влияние",attr:"attrMind"},{n:"Медицина",attr:"attrMind"},{n:"Техника",attr:"attrMind"},{n:"Психика",attr:"attrMind"}
];
const DICE=["d4","d6","d8","d10","d12"];
let OBR=null, online=false, seen=new Set(), events=[], adv=0, dis=0;
let state={activeId:"", chars:{}};

const $ = id => document.getElementById(id);
const clamp = (n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));
const uid = ()=>`${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const nowTime = ()=>new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
const sides = d => Number(String(d||"d6").replace("d",""))||6;
const rollDie = d => Math.floor(Math.random()*sides(d))+1;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

function defaultChar(name="Оперативник"){
  return {
    id: uid(), name,
    attrBody:"d8", attrReact:"d8", attrMind:"d8",
    otp:0, otpMax:3, od:3, sp:0, damageCount:0,
    skills: SKILLS.map(s=>({n:s.n, dice:[]})),
    weapons:[{name:"Оружие", dmgCount:1, dmgDie:"d6", ammoLight:0, ammoAP:0, ammoExp:0}]
  };
}
function currentChar(){
  if(!state.activeId || !state.chars[state.activeId]){
    const c=defaultChar(); state.chars[c.id]=c; state.activeId=c.id;
  }
  return state.chars[state.activeId];
}
function normalizeCharacter(c){
  if(c.damageCount===undefined){
    let cnt=0;
    if(c.injuries){
      for(const arr of [c.injuries.light,c.injuries.med,c.injuries.heavy,c.injuries.crit]) if(Array.isArray(arr)) cnt+=arr.filter(Boolean).length;
    }
    c.damageCount=cnt;
  }
  c.damageCount=clamp(c.damageCount,0,8);
  if(!Array.isArray(c.skills)) c.skills=SKILLS.map(s=>({n:s.n,dice:[]}));
  if(!Array.isArray(c.weapons) || !c.weapons.length) c.weapons=[normWeapon({})];
}
function saveLocal(){ localStorage.setItem(STORAGE_KEY, JSON.stringify({state,events})); }
function loadLocal(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw){ const data=JSON.parse(raw); if(data?.state) state=data.state; if(Array.isArray(data?.events)) events=data.events; }
  }catch{}
  if(!Object.keys(state.chars).length){ const c=defaultChar(); state.chars[c.id]=c; state.activeId=c.id; }
  for(const c of Object.values(state.chars)) normalizeCharacter(c);
  for(const ev of events) if(ev?.id) seen.add(ev.id);
}

async function waitReady(){ if(OBR?.isReady) return; await new Promise(r=>{ const unsub=OBR.onReady(()=>{ try{unsub?.()}catch{} r(); }); }); }
async function loadSdk(){
  try{
    const mod = await import("https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@latest/+esm");
    OBR = mod.default;
    if(!OBR?.isAvailable) throw new Error("OBR unavailable");
    await waitReady();
    online=true; $("net-status").textContent="online"; $("net-status").className="net online";
    setupBroadcast(); setupMetadataListener(); await loadRoomState();
  }catch(e){ console.warn("OBR offline", e); }
}
function setupBroadcast(){ try{ OBR.broadcast.onMessage(CHANNEL,msg=>{ const ev=msg?.data??msg; if(ev?.id) receiveEvent(ev); }); }catch(e){} }
function setupMetadataListener(){ try{ OBR.room.onMetadataChange(meta=>applyRoomState(meta?.[META_KEY])); }catch(e){} }
async function loadRoomState(){ try{ const meta=await OBR.room.getMetadata(); applyRoomState(meta?.[META_KEY]); }catch(e){} }
function applyRoomState(rs){ if(!rs || typeof rs!=="object") return; if(Array.isArray(rs.events)) rs.events.forEach(ev=>addEventLocal(ev,false,false)); renderAll(); saveLocal(); }
async function saveRoomState(extraEvent=null){
  if(!online || !OBR?.room) return;
  try{
    const meta=await OBR.room.getMetadata(); const old=meta?.[META_KEY] || {};
    const map=new Map();
    for(const ev of (Array.isArray(old.events)?old.events:[])) if(ev?.id) map.set(ev.id,ev);
    for(const ev of events) if(ev?.id) map.set(ev.id,ev);
    if(extraEvent?.id) map.set(extraEvent.id,extraEvent);
    const next=Array.from(map.values()).sort((a,b)=>(a.ts||0)-(b.ts||0)).slice(-MAX_EVENTS);
    await OBR.room.setMetadata({[META_KEY]:{events:next,updated:Date.now()}});
  }catch(e){}
}
async function broadcastEvent(ev){ ev.ts ||= Date.now(); ev.time ||= nowTime(); addEventLocal(ev,true,true); if(online && OBR?.broadcast){ try{ await OBR.broadcast.sendMessage(CHANNEL,ev,{destination:"REMOTE"}); }catch(e){} } await saveRoomState(ev); }
function receiveEvent(ev){ addEventLocal(ev,true,true); }
function addEventLocal(ev,persist=true,flash=false){
  if(!ev?.id || seen.has(ev.id)) return;
  seen.add(ev.id); events.push(ev); events=events.slice(-MAX_EVENTS);
  renderAll(); if(flash && ["roll","damage","chat","scene"].includes(ev.type)) showToast(ev); if(persist) saveLocal();
}
function showToast(ev){
  const box=$("toast-stack"); if(!box) return;
  const t=document.createElement("div"); t.className=`toast ${ev.pill||""}`;
  const title=ev.type==="roll"?`${ev.actor} — ${ev.title}: ${ev.resultLabel}`:ev.type==="damage"?`${ev.actor} — ${ev.title}`:ev.actor||"Scarlet";
  t.innerHTML=`<div class="toast-title">${esc(title)}</div><div class="toast-body">${esc(ev.summary||ev.text||"")}</div>`;
  box.prepend(t); setTimeout(()=>{t.style.opacity="0"; t.style.transform="translateY(6px)"; t.style.transition=".2s";},4200); setTimeout(()=>t.remove(),4500);
}

function syncControls(){
  const c=currentChar();
  $("char-name").value=c.name||""; $("otp-val").textContent=c.otp; $("otp-max").textContent=`/${c.otpMax||3}`;
  $("od-val").textContent=Math.min(c.od,3); $("od-bonus").textContent=c.od>3?`+${c.od-3}`:""; $("sp-val").textContent=c.sp;
  renderResourcePips("otp",c.otp,c.otpMax||3); renderResourcePips("od",Math.min(c.od,3),3); renderDamagePips();
  const cs=$("char-select"); cs.innerHTML=Object.values(state.chars).map(ch=>`<option value="${esc(ch.id)}"${ch.id===state.activeId?" selected":""}>${esc(ch.name||"Оперативник")}</option>`).join("");
  renderSkillOptions(); renderWeaponOptions(); $("adv-val").textContent=adv; $("dis-val").textContent=dis;
}
function renderAll(){ syncControls(); renderLatest(); renderRecentFeed(); renderLog(); }
function renderResourcePips(key,value,max){
  const box=$(`${key}-pips`); box.innerHTML="";
  for(let i=0;i<max;i++){
    const p=document.createElement("button"); p.type="button"; p.className=`res-pip ${i<value?"on":""}`;
    p.onclick=()=>setResourceValue(key, value===i+1 ? i : i+1); box.appendChild(p);
  }
}
function setResourceValue(key,value){ const c=currentChar(); if(key==="otp") c.otp=clamp(value,0,c.otpMax||3); if(key==="od") c.od=clamp(value,0,9); saveLocal(); renderAll(); saveRoomState(); }
function adjustSp(delta){ const c=currentChar(); c.sp=clamp(c.sp+Number(delta),0,99); saveLocal(); renderAll(); saveRoomState(); }

function damageStage(count){ if(count<=0) return "none"; if(count<=4) return "light"; if(count<=6) return "medium"; if(count<=7) return "heavy"; return "critical"; }
function damageStageRu(stage){ return ({none:"без ранений",light:"лёгкое",medium:"среднее",heavy:"тяжёлое",critical:"критическое"})[stage]||stage; }
function transitionText(name,from,to){ if(from===to) return ""; if(from==="none") return `${name} получает ${damageStageRu(to)} ранение.`; if(to==="none") return `${name} больше не имеет ранений.`; return `${name}: состояние переходит из «${damageStageRu(from)}» в «${damageStageRu(to)}».`; }
async function setDamageCount(next){
  const c=currentChar(); const prev=c.damageCount||0; const from=damageStage(prev); c.damageCount=clamp(next,0,8); const to=damageStage(c.damageCount);
  saveLocal(); renderAll(); saveRoomState();
  if(from!==to){ const text=transitionText(c.name,from,to); if(text) await broadcastEvent({id:uid(),type:"system",actor:"System",title:"Состояние",summary:text,text,pill:"damage",ts:Date.now(),time:nowTime()}); }
}
function renderDamagePips(){
  const c=currentChar(), box=$("damage-pips");
  box.innerHTML="";
  const kinds=["light","light","light","light","medium","medium","heavy","critical"];
  for(let i=0;i<8;i++){
    const b=document.createElement("button");
    b.type="button"; b.className=`dmg-pip ${kinds[i]} ${i<c.damageCount?"on":""}`; b.title=`${i+1}`;
    b.onclick=()=>setDamageCount(c.damageCount===i+1 ? i : i+1);
    box.appendChild(b);
    if(i===3 || i===5 || i===6){ const sep=document.createElement("span"); sep.className="dmg-sep"; box.appendChild(sep); }
  }
}

function renderSkillOptions(){ const c=currentChar(), sel=$("skill-select"), old=sel.value; sel.innerHTML=c.skills.map((s,i)=>`<option value="${i}">${esc(s.n)}</option>`).join(""); if(old && c.skills[Number(old)]) sel.value=old; renderDiceEditor(); }
function diceOptionHtml(selected){ return ["",...DICE].map(d=>`<option value="${d}"${d===selected?" selected":""}>${d||"—"}</option>`).join(""); }
function renderDiceEditor(){ const c=currentChar(), i=Number($("skill-select").value)||0, sk=c.skills[i]||c.skills[0]; $("die-1").innerHTML=diceOptionHtml(sk?.dice?.[0]||""); $("die-2").innerHTML=diceOptionHtml(sk?.dice?.[1]||""); }
function applyDiceEditor(){ const c=currentChar(), i=Number($("skill-select").value)||0, sk=c.skills[i]; if(!sk) return; sk.dice=[$("die-1").value,$("die-2").value].filter(d=>DICE.includes(d)); saveLocal(); renderSkillOptions(); saveRoomState(); }

function normWeapon(w){ let dmgCount=Number(w?.dmgCount), dmgDie=w?.dmgDie; if(!dmgCount || !DICE.includes(dmgDie)){ const m=String(w?.dmg||"1d6").match(/(\d*)d(4|6|8|10|12)/i); dmgCount=m?Number(m[1]||1):1; dmgDie=m?`d${m[2]}`:"d6"; } return {name:String(w?.name||"Оружие"), dmgCount:clamp(dmgCount,1,6), dmgDie:DICE.includes(dmgDie)?dmgDie:"d6", ammoLight:Number(w?.ammoLight||0), ammoAP:Number(w?.ammoAP||0), ammoExp:Number(w?.ammoExp||0)}; }
function weaponSummary(w){ const x=normWeapon(w); return `${x.name} ${x.dmgCount}${x.dmgDie}`; }
function renderWeaponOptions(){ const c=currentChar(), sel=$("weapon-select"), old=sel.value; if(!c.weapons?.length) c.weapons=[normWeapon({})]; sel.innerHTML=c.weapons.map((w,i)=>`<option value="${i}">${esc(weaponSummary(w))}</option>`).join(""); if(old) sel.value=old; }

function grantOtp(c,amount){ if(amount<=0) return {before:c.otp,after:c.otp,odBefore:c.od,odAfter:c.od,text:""}; const before=c.otp, odBefore=c.od, max=c.otpMax||3; let total=c.otp+amount; let overflow=Math.max(0,total-max); c.otp=Math.min(max,total); if(overflow>=2) c.od=clamp(c.od+1,0,9); return {before,after:c.otp,odBefore,odAfter:c.od,text:`ОТП ${before}→${c.otp}${c.od!==odBefore?` · ОД ${odBefore}→${c.od}`:""}`}; }
function applyOtpDelta(c,delta){ const before=c.otp, odBefore=c.od; c.otp=clamp(c.otp+delta,0,c.otpMax||3); return {before,after:c.otp,odBefore,odAfter:c.od,text:`ОТП ${before}→${c.otp}`}; }
function buildSkillPool(base,net){ let pool=[...base]; if(net>0){ const largest=pool.length?pool.reduce((a,b)=>sides(a)>=sides(b)?a:b,pool[0]):null; if(largest) for(let i=0;i<net;i++) pool.push(largest); } else if(net<0){ for(let i=0;i<Math.abs(net);i++){ if(!pool.length) break; let mx=0; pool.forEach((d,idx)=>{ if(sides(d)>sides(pool[mx])) mx=idx; }); pool.splice(mx,1); } } return pool; }
function pickAttrDie(skill){ const c=currentChar(); const ref=SKILLS.find(s=>s.n===skill?.n)||SKILLS[0]; return c[ref.attr]||"d8"; }

async function rollSkill(){
  const c=currentChar(), i=Number($("skill-select").value)||0, sk=c.skills[i], tn=Number($("tn").value)||4;
  const forceZero=$("zero").checked, useIns=$("insurance").checked, net=adv-dis, attrDie=pickAttrDie(sk);
  let baseDice=[...(sk?.dice||[])].filter(d=>DICE.includes(d)); let pool=forceZero?[]:buildSkillPool(baseDice,net); let summary="", label="Провал", pill="fail";
  if(forceZero || pool.length===0){
    const r1=rollDie(attrDie), r2=rollDie(attrDie), best=Math.min(r1,r2);
    if([r1,r2].includes(1)){ const ch=applyOtpDelta(c,-2); label="Крит. промах"; pill="crit"; summary=`Зеро ${attrDie}: ${r1}, ${r2} → ${best} | TN ${tn}. Крит. промах. ${ch.text}`; }
    else if(best>=tn){ label="Успех"; pill="success"; summary=`Зеро ${attrDie}: ${r1}, ${r2} → ${best} | TN ${tn}. Успех без ОТП.`; }
    else { const ch=applyOtpDelta(c,-1); summary=`Зеро ${attrDie}: ${r1}, ${r2} → ${best} | TN ${tn}. Провал. ${ch.text}`; }
  } else {
    const rolls=pool.map(d=>({die:d,val:rollDie(d)})); const vals=rolls.map(r=>r.val); const best=Math.max(...vals); const success=best>=tn; const ones=vals.filter(v=>v===1).length; const mags=rolls.filter(r=>r.val===sides(r.die)).length;
    if(!success && useIns && c.otp>0){ const cost=applyOtpDelta(c,-1); const av=rollDie(attrDie); const insText=` · Страховка ${attrDie}: ${av} (${cost.text})`; if(av===1){ const ch=applyOtpDelta(c,-2); label="Крит. промах"; pill="crit"; summary=`${sk.n}: ${vals.join(", ")} | TN ${tn}${insText}. Крит страховки. ${ch.text}`; } else if(av>=tn){ label="Успех"; pill="success"; summary=`${sk.n}: ${vals.join(", ")} | TN ${tn}${insText}. Провал подхвачен атрибутом.`; } }
    if(!summary){
      if(ones>=2){ const ch=applyOtpDelta(c,-2); label="Крит. промах"; pill="crit"; summary=`${sk.n}: ${vals.join(", ")} | TN ${tn}. Змеиные глаза. ${ch.text}`; }
      else if(!success){ const ch=applyOtpDelta(c,-1); label="Провал"; pill="fail"; summary=`${sk.n}: ${vals.join(", ")} | TN ${tn}. Провал. ${ch.text}`; }
      else if(mags>=2){ const ch=grantOtp(c,2); label="Дубль-магнум"; pill="double"; summary=`${sk.n}: ${vals.join(", ")} | TN ${tn}. Дубль-магнум. ${ch.text}`; }
      else if(mags===1){ const ch=grantOtp(c,1); label="Магнум"; pill="magnum"; summary=`${sk.n}: ${vals.join(", ")} | TN ${tn}. Магнум. ${ch.text}`; }
      else if(ones>=1){ const ch=applyOtpDelta(c,-1); label="Осечка"; pill="bad"; summary=`${sk.n}: ${vals.join(", ")} | TN ${tn}. Успех с осечкой. ${ch.text}`; }
      else if(best>=tn+3){ const ch=grantOtp(c,1); label="Превосходство"; pill="success"; summary=`${sk.n}: ${vals.join(", ")} | TN ${tn}. Превосходство. ${ch.text}`; }
      else { label="Успех"; pill="success"; summary=`${sk.n}: ${vals.join(", ")} | TN ${tn}. Действие выполнено.`; }
    }
  }
  saveLocal(); renderAll(); await saveRoomState(); await broadcastEvent({id:uid(),type:"roll",actor:c.name,title:sk?.n||"Проверка",resultLabel:label,pill,summary,ts:Date.now(),time:nowTime()});
}

async function rollDamage(){
  const c=currentChar(), w=normWeapon(c.weapons[Number($("weapon-select").value)||0]), ammo=$("ammo-type").value, targetSp=clamp($("target-sp").value,0,99);
  const rolls=[], explosions=[]; let total=0;
  for(let i=0;i<w.dmgCount;i++){ const v=rollDie(w.dmgDie); rolls.push(v); total+=v; if(ammo==="exp" && v===sides(w.dmgDie)){ const ex=rollDie(w.dmgDie); explosions.push(ex); total+=ex; } }
  let effSp=targetSp; if(ammo==="ap") effSp=Math.max(0,targetSp-2); const final=Math.max(0,total-effSp);
  const ammoLabel={light:"Лёгкий",ap:"Бронебойный",exp:"Экспансивный"}[ammo]; const exText=explosions.length?` + взрыв ${explosions.join(", ")}`:""; const spText=ammo==="ap"?`SP ${targetSp}→${effSp}`:`SP ${effSp}`;
  const summary=`${w.name}: ${w.dmgCount}${w.dmgDie} → ${rolls.join(", ")}${exText}; ${spText}; итог ${final}`;
  await broadcastEvent({id:uid(),type:"damage",actor:c.name,title:`Урон · ${ammoLabel}`,pill:"damage",summary,ts:Date.now(),time:nowTime()});
}


function renderRecentFeed(){
  const box=$("recent-feed"); if(!box) return;
  const items=[...events].reverse().filter(ev=>["roll","damage"].includes(ev.type)).slice(0,2);
  box.innerHTML=items.map(ev=>`<div class="feed-row"><span class="t">${esc(ev.time||"")}</span><b>${esc(ev.actor||"Система")}</b> — ${esc(ev.resultLabel || ev.title || ev.type)}<br>${esc(ev.summary||ev.text||"")}</div>`).join("") || '<div class="feed-row">Пока нет бросков.</div>';
}

function renderLatest(){
  const ev=[...events].reverse().find(e=>e.type!=="system") || [...events].reverse()[0]; const box=$("latest-card");
  if(!ev){ box.className="last-card"; box.innerHTML='<div class="last-label">Последний результат</div><div class="last-title">Нет событий</div><div class="last-body">Броски и урон появятся здесь у всех игроков с открытым HUD.</div>'; return; }
  box.className=`last-card ${ev.pill||ev.type||""}`;
  let title=ev.actor||"Событие"; if(ev.type==="roll") title=`${esc(ev.actor)} — <span class="result">${esc(ev.resultLabel)}</span>`; if(ev.type==="damage") title=`${esc(ev.actor)} — УРОН`; if(ev.type==="chat"||ev.type==="scene") title=`${esc(ev.actor)} — ЗАПИСЬ`;
  box.innerHTML=`<div class="last-label">Последний результат</div><div class="last-title">${title}</div><div class="last-body">${esc(ev.summary||ev.text||"")}</div><div class="last-meta">${esc(ev.time||"")}</div>`;
}
function renderLog(){ const log=$("log"); log.innerHTML=[...events].reverse().map(ev=>`<div class="log-item ${esc(ev.pill||"")}"><div class="log-top"><span class="log-title">${esc(logTitle(ev))}</span><span class="log-time">${esc(ev.time||"")}</span></div><div class="log-text">${esc(ev.summary||ev.text||"")}</div></div>`).join("") || '<div class="log-item"><div class="log-text">Журнал пуст.</div></div>'; }
function logTitle(ev){ if(ev.type==="roll") return `${ev.actor} · ${ev.title} · ${ev.resultLabel}`; if(ev.type==="damage") return `${ev.actor} · ${ev.title}`; if(ev.type==="chat") return `${ev.actor} · запись`; if(ev.type==="scene") return `Сцена · ${ev.actor}`; return ev.title || ev.actor || "System"; }
function toggleJournal(open){ const j=$("journal"); const next=typeof open==="boolean"?open:!j.classList.contains("open"); j.classList.toggle("open",next); j.setAttribute("aria-hidden",String(!next)); }
function addChat(text,type="chat"){ const t=String(text||"").trim(); if(!t) return; broadcastEvent({id:uid(),type,actor:currentChar().name,text:t,summary:t,pill:"info",ts:Date.now(),time:nowTime()}); }

function importCharacter(data,fileName=""){
  const guessed=String(data?.name||"").trim() || String(fileName||"").replace(/\.json$/i,"").replace(/^scarlet[_-]?/i,"").replace(/[_-]+/g," ").trim() || "Оперативник";
  const c=defaultChar(guessed);
  c.attrBody=DICE.includes(data?.attrBody)?data.attrBody:"d8"; c.attrReact=DICE.includes(data?.attrReact)?data.attrReact:"d8"; c.attrMind=DICE.includes(data?.attrMind)?data.attrMind:"d8";
  c.otp=clamp(data?.otp,0,data?.otpMax||3); c.otpMax=clamp(data?.otpMax||3,1,6); c.od=Array.isArray(data?.od)?data.od.filter(Boolean).length:clamp(data?.od??3,0,9); if(c.od===0 && data?.od===undefined) c.od=3; c.sp=clamp(data?.sp,0,99);
  const cnt=(data?.damageCount!==undefined)?data.damageCount:((data?.injLight||[]).filter(Boolean).length+(data?.injMedium||[]).filter(Boolean).length+(data?.injHeavy||[]).filter(Boolean).length+(data?.injCrit||[]).filter(Boolean).length); c.damageCount=clamp(cnt,0,8);
  c.skills=SKILLS.map((sk,i)=>{ const saved=Array.isArray(data?.skills)?(data.skills.find(x=>x?.n===sk.n)||data.skills[i]):null; const dice=Array.isArray(saved?.dice)?saved.dice.filter(d=>DICE.includes(d)).slice(0,2):[]; return {n:sk.n,dice}; });
  c.weapons=Array.isArray(data?.weapons)&&data.weapons.length?data.weapons.map(normWeapon):[normWeapon({})];
  const existing=Object.values(state.chars); const onlyBlank=existing.length===1 && existing[0].name==="Оперативник" && !existing[0].skills.some(s=>s.dice?.length); if(onlyBlank) delete state.chars[existing[0].id];
  state.chars[c.id]=c; state.activeId=c.id; saveLocal(); renderAll(); saveRoomState();
  broadcastEvent({id:uid(),type:"system",actor:"System",title:"Импорт",text:`Загружен персонаж: ${c.name}`,summary:`Загружен персонаж: ${c.name}`,ts:Date.now(),time:nowTime()});
}

function openFullSheet(){
  const c=currentChar(); const skillText=c.skills.map(s=>`${s.n}: ${s.dice?.join("+")||"Зеро"}`).join("\n"); const weaponText=c.weapons.map(w=>weaponSummary(w)).join("\n");
  const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(c.name)} — Scarlet Sheet</title><style>body{margin:0;background:#0f1014;color:#eef1f7;font:15px Inter,system-ui,sans-serif;padding:24px}.card{max-width:980px;margin:auto;background:#171a20;border:1px solid #303642;border-radius:14px;padding:22px}h1{margin:0 0 10px;color:#ff6b6b}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.box{background:#20242d;border:1px solid #303642;border-radius:10px;padding:12px}.muted{color:#9aa4b7}.mono{font-family:monospace;white-space:pre-wrap}</style></head><body><div class="card"><h1>${esc(c.name)}</h1><p class="muted">Локальный просмотр персонажа из Owlbear HUD.</p><div class="grid"><div class="box">ОТП: <b>${c.otp}/${c.otpMax}</b></div><div class="box">ОД: <b>${c.od}</b></div><div class="box">SP: <b>${c.sp}</b></div><div class="box">Урон: <b>${c.damageCount}/8</b></div></div><h2>Навыки</h2><pre class="mono">${esc(skillText)}</pre><h2>Оружие</h2><pre class="mono">${esc(weaponText)}</pre></div></body></html>`;
  const blob=new Blob([html],{type:"text/html"}); window.open(URL.createObjectURL(blob),"_blank");
}

function bind(){
  $("char-select").onchange=e=>{ state.activeId=e.target.value; saveLocal(); renderAll(); saveRoomState(); };
  $("char-name").onchange=e=>{ currentChar().name=e.target.value.trim()||"Оперативник"; saveLocal(); renderAll(); saveRoomState(); };
  document.querySelectorAll('[data-res="sp"]').forEach(b=>b.onclick=()=>adjustSp(Number(b.dataset.delta)));
  document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{ const key=b.dataset.step, d=Number(b.dataset.delta); if(key==="adv") adv=clamp(adv+d,0,9); if(key==="dis") dis=clamp(dis+d,0,9); renderAll(); });
  $("skill-select").onchange=()=>renderDiceEditor(); $("die-1").onchange=applyDiceEditor; $("die-2").onchange=applyDiceEditor;
  $("roll-skill-btn").onclick=rollSkill; $("roll-damage-btn").onclick=rollDamage;
  $("new-turn-btn").onclick=()=>{ currentChar().od=3; saveLocal(); renderAll(); saveRoomState(); };
  $("toggle-log-btn").onclick=()=>toggleJournal(); $("close-log-btn").onclick=()=>toggleJournal(false);
  $("chat-form").onsubmit=e=>{ e.preventDefault(); addChat($("chat-input").value,"chat"); $("chat-input").value=""; };
  $("scene-form").onsubmit=e=>{ e.preventDefault(); addChat($("scene-input").value,"scene"); $("scene-input").value=""; };
  $("import-btn").onclick=()=>$("file-input").click();
  $("file-input").onchange=e=>{ const file=e.target.files?.[0]; if(!file) return; const r=new FileReader(); r.onload=ev=>{ try{ importCharacter(JSON.parse(ev.target.result),file.name); }catch(err){ alert("Ошибка JSON: "+err.message); } }; r.readAsText(file); e.target.value=""; };
  $("open-sheet-btn").onclick=openFullSheet;
  $("export-log-btn").onclick=()=>{ const txt=[...events].map(ev=>`[${ev.time}] ${logTitle(ev)} — ${ev.summary||ev.text||""}`).join("\n"); const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([txt],{type:"text/plain;charset=utf-8"})); a.download="scarlet_log.txt"; a.click(); };
  $("clear-local-btn").onclick=()=>{ if(confirm("Очистить локальный журнал?")){ events=[]; seen.clear(); saveLocal(); renderAll(); } };
  document.addEventListener("keydown",e=>{ const tag=document.activeElement?.tagName; const typing=["INPUT","TEXTAREA","SELECT"].includes(tag); if(e.ctrlKey&&e.key==="Enter"){ e.preventDefault(); rollSkill(); } if(e.shiftKey&&e.key==="Enter"){ e.preventDefault(); rollDamage(); } if((e.ctrlKey&&e.key.toLowerCase()==="j")||(!typing&&e.key.toLowerCase()==="j")){ e.preventDefault(); toggleJournal(); } if(e.key==="Escape") toggleJournal(false); });
}
async function init(){ loadLocal(); bind(); renderAll(); await loadSdk(); renderAll(); }
init();
