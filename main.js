const VERSION = "110";
const CHANNEL = "scarlet-frontier-log-v11";
const META_KEY = "com.scarletfrontier.log/v11";
const MAX_EVENTS = 60;
const STORAGE_KEY = "scarlet-log-hud-v11";
const UI_KEY = "scarlet-log-ui-v11";

const SKILLS = [
  { n:"Насилие", a:"ТЕЛО", attr:"attrBody" }, { n:"Атлетика", a:"ТЕЛО", attr:"attrBody" }, { n:"Стойкость", a:"ТЕЛО", attr:"attrBody" }, { n:"Выживание", a:"ТЕЛО", attr:"attrBody" },
  { n:"Стрельба", a:"РЕАКЦИЯ", attr:"attrReact" }, { n:"Скрытность", a:"РЕАКЦИЯ", attr:"attrReact" }, { n:"Пилотирование", a:"РЕАКЦИЯ", attr:"attrReact" },
  { n:"Следствие", a:"РАЗУМ", attr:"attrMind" }, { n:"Влияние", a:"РАЗУМ", attr:"attrMind" }, { n:"Медицина", a:"РАЗУМ", attr:"attrMind" }, { n:"Техника", a:"РАЗУМ", attr:"attrMind" }, { n:"Психика", a:"РАЗУМ", attr:"attrMind" }
];
const DICE = ["d4","d6","d8","d10","d12"];

let OBR = null;
let online = false;
let seen = new Set();
let events = [];
let roomActors = {};
let state = { activeId:"", chars:{} };
let adv = 0, dis = 0;
let ui = { compact:false, logOpen:false };

const $ = id => document.getElementById(id);
const clamp = (n,min,max) => Math.max(min, Math.min(max, Number(n)||0));
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const nowTime = () => new Date().toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"});
const sides = d => Number(String(d||"d6").replace("d","")) || 6;
const rollDie = d => Math.floor(Math.random()*sides(d))+1;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

function defaultChar(name="Оперативник"){
  const id = `char_${uid()}`;
  return { id, name, attrBody:"d8", attrReact:"d8", attrMind:"d8", otp:0, otpMax:3, od:3, sp:0, skills:SKILLS.map(s=>({ n:s.n, dice:[] })), weapons:[] };
}
function currentChar(){
  if (!state.activeId || !state.chars[state.activeId]) {
    const c = defaultChar(); state.chars[c.id]=c; state.activeId=c.id;
  }
  return state.chars[state.activeId];
}
function saveLocal(){ localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, events: events.slice(-MAX_EVENTS), roomActors })); }
function loadLocal(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY); if(!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.state?.chars) state = parsed.state;
    events = Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [];
    roomActors = parsed.roomActors || {};
    seen = new Set(events.map(e=>e.id));
  }catch(e){ console.warn(e); }
}

function loadUi(){
  try{ const saved = JSON.parse(localStorage.getItem(UI_KEY)||"{}"); ui = { ...ui, ...saved }; }catch{}
}
function saveUi(){ localStorage.setItem(UI_KEY, JSON.stringify(ui)); }
function applyUi(){
  document.querySelector(".app")?.classList.toggle("compact", !!ui.compact);
  const drawer = $("log-drawer");
  if(drawer) drawer.classList.toggle("collapsed", !ui.logOpen);
  const logBtn = $("toggle-log-btn");
  if(logBtn){ logBtn.setAttribute("aria-expanded", ui.logOpen ? "true" : "false"); logBtn.textContent = ui.logOpen ? "Журнал ▴" : "Журнал ▾"; }
  const compactBtn = $("compact-btn");
  if(compactBtn){ compactBtn.setAttribute("aria-pressed", ui.compact ? "true" : "false"); compactBtn.textContent = ui.compact ? "Развернуть" : "Компакт"; }
}
function toggleLog(){ ui.logOpen = !ui.logOpen; saveUi(); applyUi(); }
function toggleCompact(){ ui.compact = !ui.compact; if(ui.compact) ui.logOpen = false; saveUi(); applyUi(); }

async function waitReady(){ if(OBR?.isReady) return; await new Promise(resolve=>{ const unsub = OBR.onReady(()=>{ try{unsub?.()}catch{} resolve(); }); }); }
async function loadSdk(){
  try{
    const mod = await import("https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@latest/+esm");
    OBR = mod.default;
    if (!OBR?.isAvailable) throw new Error("OBR unavailable");
    await waitReady(); online = true;
    $("net-status").textContent = "online"; $("net-status").className = "status online";
    setupBroadcast(); setupMetadataListener(); await loadRoomState();
    await publishActor();
    if (!events.some(e => e.type === "system" && e.text?.includes("v0.11"))) addSystemLocal("Scarlet Log v0.11: нижний HUD отполирован. Ctrl+Enter — бросок, Shift+Enter — урон, J — журнал.");
  }catch(err){
    online = false;
    $("net-status").textContent = "local"; $("net-status").className = "status local";
    addSystemLocal("Локальный режим: онлайн-синхронизация работает только внутри комнаты Owlbear.");
    console.warn(err);
  }
}
function setupBroadcast(){
  try{ OBR.broadcast.onMessage(CHANNEL, (msg)=>{ const ev = msg?.data ?? msg; if(ev?.id) receiveEvent(ev); }); }
  catch(e){ console.warn("broadcast listener", e); }
}
function setupMetadataListener(){
  try{ OBR.room.onMetadataChange(meta => applyRoomState(meta?.[META_KEY])); }
  catch(e){ console.warn("metadata listener", e); }
}
async function loadRoomState(){
  try{ const meta = await OBR.room.getMetadata(); applyRoomState(meta?.[META_KEY]); }
  catch(e){ console.warn("metadata load", e); }
}
function applyRoomState(rs){
  if(!rs || typeof rs !== "object") return;
  if(rs.actors) roomActors = { ...roomActors, ...rs.actors };
  if(Array.isArray(rs.events)) rs.events.forEach(ev => addEventLocal(ev, false));
  renderAll(); saveLocal();
}
async function saveRoomState(extraEvent=null){
  if(!online || !OBR?.room) return;
  try{
    const meta = await OBR.room.getMetadata();
    const old = meta?.[META_KEY] || {};
    const map = new Map();
    for(const ev of (Array.isArray(old.events)?old.events:[])) if(ev?.id) map.set(ev.id, ev);
    for(const ev of events) if(ev?.id) map.set(ev.id, ev);
    if(extraEvent?.id) map.set(extraEvent.id, extraEvent);
    const nextEvents = Array.from(map.values()).sort((a,b)=>(a.ts||0)-(b.ts||0)).slice(-MAX_EVENTS);
    await OBR.room.setMetadata({ [META_KEY]: { events: nextEvents, actors: { ...(old.actors||{}), ...roomActors }, updated: Date.now() } });
  }catch(e){ console.warn("metadata save", e); }
}
async function publishActor(){
  const c = currentChar();
  roomActors[c.name] = { otp:c.otp, od:c.od, sp:c.sp, updated:Date.now() };
  saveLocal(); renderAll(); await saveRoomState();
}
async function broadcastEvent(ev){
  ev.ts ||= Date.now(); ev.time ||= nowTime();
  addEventLocal(ev, true, true);
  if(online && OBR?.broadcast){
    try{ await OBR.broadcast.sendMessage(CHANNEL, ev, { destination:"REMOTE" }); }
    catch(e){ console.warn("broadcast send", e); }
  }
  await saveRoomState(ev);
}
function receiveEvent(ev){ addEventLocal(ev, true, true); }
function addEventLocal(ev, persist=true, flash=false){
  if(!ev?.id || seen.has(ev.id)) return;
  seen.add(ev.id); events.push(ev); events = events.slice(-MAX_EVENTS);
  if(ev.actor && ev.resourcesAfter) roomActors[ev.actor] = { ...roomActors[ev.actor], ...ev.resourcesAfter, updated:Date.now() };
  renderAll();
  if(flash && (ev.type === "roll" || ev.type === "damage" || ev.type === "resource")) showToast(ev);
  if(persist) saveLocal();
}
function showToast(ev){
  const stack = $("toast-stack"); if(!stack) return;
  const t = document.createElement("div");
  t.className = `toast ${ev.pill || ev.type || "info"}`;
  let title = ev.actor || "Scarlet";
  if(ev.type === "roll") title = `${ev.actor} — ${ev.title}: ${ev.resultLabel}`;
  if(ev.type === "damage") title = `${ev.actor} — урон: ${ev.title}`;
  if(ev.type === "resource") title = `${ev.actor} — ресурсы`;
  t.innerHTML = `<div class="toast-title">${esc(title)}</div><div class="toast-body">${esc(ev.summary || ev.text || "")}</div>`;
  stack.prepend(t);
  setTimeout(()=>{ t.style.opacity="0"; t.style.transform="translateY(-6px)"; t.style.transition=".18s"; }, 5600);
  setTimeout(()=>t.remove(), 5900);
}
function addSystemLocal(text){ addEventLocal({ id:uid(), type:"system", actor:"System", ts:Date.now(), time:nowTime(), text }, true); }

function normWeapon(w){
  if(!w) return { name:"Оружие", dmgCount:1, dmgDie:"d6", ammoLight:0, ammoAP:0, ammoExp:0 };
  let dmgCount = Number(w.dmgCount); let dmgDie = w.dmgDie;
  if(!dmgCount || !DICE.includes(dmgDie)){
    const m = String(w.dmg || "1d6").match(/(\d*)d(4|6|8|10|12)/i);
    dmgCount = m ? (Number(m[1] || 1) || 1) : 1;
    dmgDie = m ? `d${m[2]}` : "d6";
  }
  return { name: String(w.name || "Оружие"), dmgCount: clamp(dmgCount,1,6), dmgDie: DICE.includes(dmgDie)?dmgDie:"d6", ammoLight:Number(w.ammoLight||0), ammoAP:Number(w.ammoAP||0), ammoExp:Number(w.ammoExp||0) };
}
function importCharacter(data, fileName=""){
  const guessedName = String(data?.name || "").trim() || String(fileName || "").replace(/\.json$/i,"").replace(/^scarlet[_-]?/i,"").replace(/[_-]+/g," ").trim() || "Оперативник";
  const c = defaultChar(guessedName);
  c.sourceJsonName = fileName || "";
  c.attrBody = DICE.includes(data?.attrBody) ? data.attrBody : "d8";
  c.attrReact = DICE.includes(data?.attrReact) ? data.attrReact : "d8";
  c.attrMind = DICE.includes(data?.attrMind) ? data.attrMind : "d8";
  c.otp = clamp(data?.otp,0, data?.otpMax || 3);
  c.otpMax = clamp(data?.otpMax || 3,1,6);
  c.od = Array.isArray(data?.od) ? data.od.filter(Boolean).length : clamp(data?.od ?? 3,0,9);
  c.sp = clamp(data?.sp,0,99);
  c.skills = SKILLS.map((sk, i) => {
    const saved = Array.isArray(data?.skills) ? (data.skills.find(x=>x?.n===sk.n) || data.skills[i]) : null;
    const dice = Array.isArray(saved?.dice) ? saved.dice.filter(d=>DICE.includes(d)).slice(0,2) : [];
    return { n:sk.n, dice };
  });
  c.weapons = Array.isArray(data?.weapons) ? data.weapons.map(normWeapon) : [];
  const existing = Object.values(state.chars);
  const onlyBlankDefault = existing.length === 1 && existing[0].name === "Оперативник" && !existing[0].skills.some(x=>x.dice?.length) && !existing[0].weapons?.length;
  if(onlyBlankDefault){ delete state.chars[existing[0].id]; }
  state.chars[c.id]=c; state.activeId=c.id;
  saveLocal(); renderAll(); publishActor();
  addSystemLocal(`Загружен персонаж: ${c.name}. Навыков: ${c.skills.filter(s=>s.dice?.length).length}; оружия: ${c.weapons.length || 1}.`);
  showToast({type:"system", pill:"info", actor:"System", text:`Загружен персонаж: ${c.name}`, summary:`Навыков: ${c.skills.filter(s=>s.dice?.length).length}; оружия: ${c.weapons.length || 1}`});
}

function syncControls(){
  const c = currentChar();
  $("char-name").value = c.name || ""; $("otp-val").textContent = c.otp; $("otp-max").textContent = `/${c.otpMax||3}`; $("od-val").textContent = c.od; $("sp-val").textContent = c.sp;
  const sel = $("char-select"); const old = sel.value;
  sel.innerHTML = Object.values(state.chars).map(ch => `<option value="${esc(ch.id)}"${ch.id===state.activeId?" selected":""}>${esc(ch.name||"Оперативник")}</option>`).join("");
  if(old && state.chars[old]) sel.value = state.activeId;
  renderSkillOptions(); renderWeaponOptions();
}
function skillSummary(skill){ return skill.dice?.length ? `${skill.n} ${skill.dice.join("+")}` : `${skill.n} Зеро`; }
function renderSkillOptions(){
  const c = currentChar(); const sel = $("skill-select"); const old = sel.value;
  sel.innerHTML = c.skills.map((s,i)=>`<option value="${i}">${esc(skillSummary(s))}</option>`).join("");
  if(old) sel.value = old;
}
function weaponSummary(w){ return `${w.name || "Оружие"} ${w.dmgCount}${w.dmgDie}`; }
function renderWeaponOptions(){
  const c = currentChar(); const sel = $("weapon-select"); const old = sel.value;
  if(!c.weapons.length) c.weapons = [normWeapon({name:"Оружие", dmgCount:1, dmgDie:"d6"})];
  sel.innerHTML = c.weapons.map((w,i)=>`<option value="${i}">${esc(weaponSummary(normWeapon(w)))}</option>`).join("");
  if(old) sel.value = old;
}
function renderLatest(){
  const box = $("latest-card"); const ev = [...events].reverse().find(e=>e.type!=="system") || [...events].reverse()[0];
  if(!ev){ box.className="panel latest"; return; }
  box.className = `panel latest ${ev.pill || ev.type || ""}`;
  let title = ev.actor || "Событие"; let body = ev.text || ev.summary || "";
  if(ev.type==="roll") title = `${ev.actor} — ${ev.title} <span class="pill ${ev.pill||"good"}">${ev.resultLabel}</span>`;
  if(ev.type==="damage") title = `${ev.actor} — ${ev.title} <span class="pill damage">Урон</span>`;
  if(ev.type==="chat") title = `${ev.actor} пишет`;
  box.innerHTML = `<div class="latest-label">Последний результат</div><div class="latest-title">${title}</div><div class="latest-body">${esc(body)}</div><div class="latest-meta">${esc(ev.time||"")} · ${esc(ev.type||"")}</div>`;
}
function compactEventLine(ev){
  if(ev.type === "roll") return `${ev.actor || "—"} · ${ev.title} · ${ev.resultLabel}`;
  if(ev.type === "damage") return `${ev.actor || "—"} · ${ev.title} · урон`;
  if(ev.type === "resource") return `${ev.actor || "—"} · ресурсы`;
  if(ev.type === "chat") return `${ev.actor || "—"} · запись`;
  return `${ev.actor || "System"} · система`;
}
function renderLog(){
  const el = $("log"); if(!el) return;
  if(!events.length){ el.innerHTML = `<div class="event"><div class="event-body">Пока нет событий.</div></div>`; return; }
  el.innerHTML = [...events].reverse().map(ev => {
    const cls = `event ${ev.type||"system"} ${ev.pill||""}`;
    const body = ev.text || ev.summary || "";
    const title = compactEventLine(ev);
    return `<div class="${cls}" title="Кликни/наведи, чтобы раскрыть детали"><div class="event-top"><span class="event-actor">${esc(title)}</span><span class="event-time">${esc(ev.time||"")}</span></div><div class="event-body">${esc(body)}</div></div>`;
  }).join("");
}
function renderAll(){ syncControls(); renderLatest(); renderLog(); }

function applyOtpDelta(c, delta){
  const beforeOtp = c.otp, beforeOd = c.od;
  if(delta > 0){
    const total = c.otp + delta;
    if(total <= c.otpMax) c.otp = total;
    else { const extra = total - c.otpMax; c.otp = c.otpMax; if(extra >= 2) c.od += 1; }
  } else if(delta < 0) c.otp = Math.max(0, c.otp + delta);
  return { beforeOtp, afterOtp:c.otp, beforeOd, afterOd:c.od };
}
function buildSkillResult(c, params){
  const sk = c.skills[params.skillIndex] || c.skills[0]; const skDef = SKILLS.find(x=>x.n===sk.n) || SKILLS[0];
  const attrDie = c[skDef.attr] || "d8"; const tn = params.tn; const forceZero = params.forceZero || !sk.dice?.length;
  let resultLabel="", pill="good", otpDelta=0, summary="";
  if(forceZero){
    const r1 = rollDie(attrDie), r2 = rollDie(attrDie), best = Math.min(r1,r2);
    if(r1===1 || r2===1){ resultLabel="Крит. промах"; pill="bad"; otpDelta=-2; }
    else if(best>=tn){ resultLabel="Успех"; pill="good"; otpDelta=0; }
    else { resultLabel="Провал"; pill="bad"; otpDelta=-1; }
    const res = applyOtpDelta(c, otpDelta);
    summary = `Зеро: ${attrDie} → ${r1}, ${r2}; худший ${best} | TN ${tn}\n${resultLabel}. ОТП ${res.beforeOtp}→${res.afterOtp}`;
    return { title:sk.n, resultLabel, pill, summary, resources:res };
  }
  let pool = [...sk.dice]; const net = params.adv - params.dis;
  if(net>0){ const maxDie = pool.reduce((a,b)=>sides(a)>=sides(b)?a:b,pool[0]); for(let i=0;i<net;i++) pool.push(maxDie); }
  if(net<0){ for(let i=0;i<Math.abs(net);i++){ if(pool.length){ let mx=0; pool.forEach((d,idx)=>{ if(sides(d)>sides(pool[mx])) mx=idx; }); pool.splice(mx,1); } } }
  if(!pool.length) return buildSkillResult(c, { ...params, forceZero:true });
  const rolls = pool.map(d=>({die:d, value:rollDie(d)})); const values = rolls.map(r=>r.value); const best = Math.max(...values); const ones = values.filter(v=>v===1).length; const mags = rolls.filter(r=>r.value===sides(r.die)).length;
  let success = best>=tn, insText="";
  if(!success && params.insurance){
    if(c.otp>0){ const ar = rollDie(attrDie); if(ar===1){ resultLabel="Крит. промах"; pill="bad"; otpDelta=-3; insText=`\nСтраховка ${attrDie} → 1: цена −1 и крит −2.`; } else if(ar>=tn){ success=true; resultLabel="Успех"; pill="good"; otpDelta=-1; insText=`\nСтраховка ${attrDie} → ${ar}: провал подхвачен, цена −1 ОТП.`; } else { resultLabel="Провал"; pill="bad"; otpDelta=-2; insText=`\nСтраховка ${attrDie} → ${ar}: не помогла, −2 ОТП всего.`; } }
    else insText="\nСтраховка не сработала: нет ОТП.";
  }
  if(!resultLabel){
    if(ones>=2){ resultLabel="Крит. промах"; pill="bad"; otpDelta=-2; }
    else if(!success){ resultLabel="Провал"; pill="bad"; otpDelta=-1; }
    else if(mags>=2){ resultLabel="Дубль-магнум"; pill="mag"; otpDelta=2; }
    else if(mags===1){ resultLabel="Магнум"; pill="mag"; otpDelta=1; }
    else if(ones>=1){ resultLabel="Осечка"; pill="bad"; otpDelta=-1; }
    else if(best>=tn+3){ resultLabel="Превосходство"; pill="good"; otpDelta=1; }
    else { resultLabel="Успех"; pill="good"; otpDelta=0; }
  }
  const res = applyOtpDelta(c, otpDelta);
  summary = `${pool.join("+")} → ${values.join(", ")} | лучший ${best} | TN ${tn}\n${resultLabel}. ОТП ${res.beforeOtp}→${res.afterOtp}${res.afterOd!==res.beforeOd?`, ОД ${res.beforeOd}→${res.afterOd}`:""}${insText}`;
  return { title:sk.n, resultLabel, pill, summary, resources:res };
}
async function rollSkill(){
  const c = currentChar(); const result = buildSkillResult(c, { skillIndex:Number($("skill-select").value)||0, tn:Number($("tn").value)||4, adv, dis, insurance:$("insurance").checked, forceZero:$("zero").checked });
  saveLocal(); await publishActor(); renderAll();
  await broadcastEvent({ id:uid(), type:"roll", actor:c.name, title:result.title, resultLabel:result.resultLabel, pill:result.pill, summary:result.summary, resourcesAfter:{otp:c.otp, od:c.od, sp:c.sp}, ts:Date.now(), time:nowTime() });
}
function buildDamage(c){
  const w = normWeapon(c.weapons[Number($("weapon-select").value)||0]); const ammo = $("ammo-type").value; const targetSp = clamp($("target-sp").value,0,99);
  let rolls=[], expl=[]; for(let i=0;i<w.dmgCount;i++){ const r=rollDie(w.dmgDie); rolls.push(r); if(ammo==="exp" && r===sides(w.dmgDie)) expl.push(rollDie(w.dmgDie)); }
  const raw = rolls.reduce((a,b)=>a+b,0) + expl.reduce((a,b)=>a+b,0); const effSp = ammo==="ap" ? Math.max(0,targetSp-2) : targetSp; const total = Math.max(0, raw-effSp);
  const ammoName = ammo==="ap"?"бронебойный":ammo==="exp"?"экспансивный":"лёгкий";
  const expText = expl.length ? ` + взрыв ${expl.join(", ")}` : "";
  return { title:w.name, summary:`${w.dmgCount}${w.dmgDie} (${ammoName}) → ${rolls.join(", ")}${expText}\nСумма ${raw} − SP ${effSp}${ammo==="ap"?` (из ${targetSp})`:""} = итоговый урон ${total}`, total };
}
async function rollDamage(){
  const c = currentChar(); const d = buildDamage(c);
  await broadcastEvent({ id:uid(), type:"damage", actor:c.name, title:d.title, pill:"damage", summary:d.summary, resourcesAfter:{otp:c.otp, od:c.od, sp:c.sp}, ts:Date.now(), time:nowTime() });
}
async function changeResource(key, delta){
  const c = currentChar(); const before = { otp:c.otp, od:c.od, sp:c.sp };
  if(key==="otp") c.otp = clamp(c.otp+delta,0,c.otpMax); if(key==="od") c.od=clamp(c.od+delta,0,9); if(key==="sp") c.sp=clamp(c.sp+delta,0,99);
  saveLocal(); await publishActor(); renderAll();
  await broadcastEvent({ id:uid(), type:"resource", actor:c.name, pill:"info", summary:`ОТП ${before.otp}→${c.otp} · ОД ${before.od}→${c.od} · SP ${before.sp}→${c.sp}`, resourcesAfter:{otp:c.otp, od:c.od, sp:c.sp}, ts:Date.now(), time:nowTime() });
}
function exportLog(){
  const lines = [...events].map(e => `[${e.time||""}] ${e.actor||"—"}: ${e.type==="roll"?`${e.title} — ${e.resultLabel}. `:""}${e.summary||e.text||""}`).join("\n\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([lines],{type:"text/plain;charset=utf-8"})); a.download=`scarlet_log_${new Date().toISOString().slice(0,10)}.txt`; a.click(); URL.revokeObjectURL(a.href);
}
async function newTurn(){
  const c = currentChar();
  const before = { otp:c.otp, od:c.od, sp:c.sp };
  c.od = 3;
  saveLocal(); await publishActor(); renderAll();
  await broadcastEvent({ id:uid(), type:"resource", actor:c.name, pill:"info", summary:`Новый ход. ОД ${before.od}→${c.od}. ОТП ${before.otp}/${c.otpMax}. SP ${before.sp}.`, resourcesAfter:{otp:c.otp, od:c.od, sp:c.sp}, ts:Date.now(), time:nowTime() });
}

function bind(){
  $("import-btn").onclick = () => $("file-input").click();
  $("open-sheet-btn").onclick = () => {
    saveLocal();
    const c = currentChar();
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(c))));
    window.open(`fullsheet.html?v=110#${payload}`, "_blank");
  };
  $("file-input").onchange = e => { const file=e.target.files?.[0]; if(!file) return; const r=new FileReader(); r.onload=ev=>{ try{ importCharacter(JSON.parse(ev.target.result), file.name); }catch(err){ alert("Не удалось прочитать JSON: "+err.message); } }; r.readAsText(file); e.target.value=""; };
  $("new-char-btn").onclick = async () => { const c=defaultChar("Оперативник"); state.chars[c.id]=c; state.activeId=c.id; saveLocal(); renderAll(); await publishActor(); };
  $("new-turn-btn").onclick = newTurn;
  $("compact-btn").onclick = toggleCompact;
  $("char-select").onchange = () => { state.activeId=$("char-select").value; saveLocal(); renderAll(); publishActor(); };
  $("char-name").onchange = async () => { const c=currentChar(); c.name=$("char-name").value.trim()||"Оперативник"; saveLocal(); renderAll(); await publishActor(); };
  document.querySelectorAll("[data-res]").forEach(b => b.onclick = () => changeResource(b.dataset.res, Number(b.dataset.delta)));
  document.querySelectorAll("[data-step]").forEach(b => b.onclick = () => { const key=b.dataset.step, delta=Number(b.dataset.delta); if(key==="adv") adv=clamp(adv+delta,0,6); if(key==="dis") dis=clamp(dis+delta,0,6); $("adv-val").textContent=adv; $("dis-val").textContent=dis; });
  $("roll-skill-btn").onclick = rollSkill; $("roll-damage-btn").onclick = rollDamage;
  $("chat-form").onsubmit = async e => { e.preventDefault(); const txt=$("chat-input").value.trim(); if(!txt) return; $("chat-input").value=""; const c=currentChar(); await broadcastEvent({ id:uid(), type:"chat", actor:c.name, pill:"info", text:txt, resourcesAfter:{otp:c.otp, od:c.od, sp:c.sp}, ts:Date.now(), time:nowTime() }); };
  $("toggle-log-btn").onclick = toggleLog;
  $("scene-form").onsubmit = async e => {
    e.preventDefault();
    const txt=$("scene-input").value.trim();
    if(!txt) return;
    $("scene-input").value="";
    const c=currentChar();
    await broadcastEvent({ id:uid(), type:"chat", actor:c.name, pill:"info", text:txt, resourcesAfter:{otp:c.otp, od:c.od, sp:c.sp}, ts:Date.now(), time:nowTime() });
  };
  $("export-log-btn").onclick = exportLog;
  $("clear-local-btn").onclick = () => { if(confirm("Очистить локальный журнал? У других игроков он не удалится.")){ events=[]; seen=new Set(); saveLocal(); renderAll(); } };
  document.addEventListener("keydown", e => {
    const tag = (document.activeElement?.tagName || "").toLowerCase();
    const typing = ["input","textarea","select"].includes(tag);
    if(e.key.toLowerCase() === "j" && !typing){ e.preventDefault(); toggleLog(); }
    if(e.key === "Enter" && e.ctrlKey){ e.preventDefault(); rollSkill(); }
    if(e.key === "Enter" && e.shiftKey){ e.preventDefault(); rollDamage(); }
    if(e.key === "Escape" && ui.logOpen){ e.preventDefault(); toggleLog(); }
  });
}

loadLocal(); loadUi(); if(!Object.keys(state.chars).length){ const c=defaultChar(); state.chars[c.id]=c; state.activeId=c.id; }
bind(); applyUi(); renderAll(); loadSdk();
