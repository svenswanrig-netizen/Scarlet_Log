const VERSION = "060";
const CHANNEL = "scarlet-frontier-log-v6";
const META_KEY = "com.scarletfrontier.log/v6";
const TOKEN_META_KEY = "com.scarletfrontier.log/token";
const MAX_EVENTS = 50;
const STORAGE_KEY = "scarlet-log-network-v6";

let OBR = null;
let online = false;
let seen = new Set();
let events = [];
let actors = {};
let state = { actor: "", otp: 0, od: 3, sp: 0, otpMax: 3, extraOdGained: false };

const $ = (id) => document.getElementById(id);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
const dieSides = (die) => Number(String(die).replace("d", ""));
const rollDie = (die) => Math.floor(Math.random() * dieSides(die)) + 1;
const nowTime = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const safeActor = () => ($("actor-name").value || state.actor || "Оперативник").trim() || "Оперативник";

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    Object.assign(state, parsed.state || {});
    events = Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [];
    actors = parsed.actors || {};
    seen = new Set(events.map(e => e.id));
  } catch {}
}
function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, events: events.slice(-MAX_EVENTS), actors })); }
function syncInputs() { $("actor-name").value = state.actor || ""; $("otp-val").textContent = state.otp; $("od-val").textContent = state.od; $("sp-val").textContent = state.sp; }
function collectActor() {
  state.actor = safeActor();
  actors[state.actor] = { otp: state.otp, od: state.od, sp: state.sp, updated: Date.now() };
  saveLocal();
  renderActors();
}

async function waitForObrReady() {
  if (OBR?.isReady) return;
  await new Promise((resolve) => {
    const unsub = OBR.onReady(() => { try { unsub?.(); } catch {} resolve(); });
  });
}
async function loadSdk() {
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@latest/+esm");
    OBR = mod.default;
    if (!OBR?.isAvailable) throw new Error("OBR unavailable");
    await waitForObrReady();
    online = true;
    $("net-status").textContent = "Owlbear online";
    $("net-status").className = "status online";
    setupBroadcast();
    setupRoomMetadataSync();
    await loadRoomState();
    setupTokenContextMenu();
    if (!events.some(e => e.type === "system" && e.text?.includes("v0.6"))) addSystemLocal("Scarlet Log v0.6 подключён. Выбери токен на карте и нажми Scarlet в контекстном меню.");
    collectActor();
    await saveRoomState();
  } catch (err) {
    online = false;
    $("net-status").textContent = "local mode";
    $("net-status").className = "status local";
    addSystemLocal("Локальный режим: синхронизация работает только внутри комнаты Owlbear.");
    console.warn(err);
  }
}
function setupBroadcast() {
  try {
    OBR.broadcast.onMessage(CHANNEL, (event) => {
      const data = event?.data ?? event;
      if (data?.id) receiveEvent(data);
    });
  } catch (err) { console.warn("broadcast setup failed", err); }
}
function setupRoomMetadataSync() {
  try {
    OBR.room.onMetadataChange((metadata) => applyRoomState(metadata?.[META_KEY]));
  } catch (err) { console.warn("metadata listener failed", err); }
}
function applyRoomState(roomState) {
  if (!roomState || typeof roomState !== "object") return;
  if (roomState.actors) actors = { ...actors, ...roomState.actors };
  if (Array.isArray(roomState.events)) for (const ev of roomState.events) addEventLocal(ev, false);
  renderAll();
  saveLocal();
}
async function loadRoomState() {
  try { const meta = await OBR.room.getMetadata(); applyRoomState(meta?.[META_KEY]); }
  catch (err) { console.warn("metadata load failed", err); }
}
async function saveRoomState(extraEvent = null) {
  if (!online || !OBR?.room) return;
  try {
    const current = await OBR.room.getMetadata();
    const old = current?.[META_KEY] || {};
    const map = new Map();
    for (const ev of (Array.isArray(old.events) ? old.events : [])) if (ev?.id) map.set(ev.id, ev);
    for (const ev of events) if (ev?.id) map.set(ev.id, ev);
    if (extraEvent?.id) map.set(extraEvent.id, extraEvent);
    const nextEvents = Array.from(map.values()).sort((a,b)=>(a.ts||0)-(b.ts||0)).slice(-MAX_EVENTS);
    await OBR.room.setMetadata({ [META_KEY]: { events: nextEvents, actors: { ...(old.actors || {}), ...actors }, updated: Date.now() } });
  } catch (err) { console.warn("metadata save failed", err); }
}
async function broadcastEvent(ev) {
  ev.ts ||= Date.now(); ev.time ||= nowTime();
  addEventLocal(ev, true);
  if (online && OBR?.broadcast) {
    try { await OBR.broadcast.sendMessage(CHANNEL, ev, { destination: "REMOTE" }); }
    catch (err) { console.warn("broadcast failed", err); }
  }
  await saveRoomState(ev);
}
function receiveEvent(ev) { addEventLocal(ev, true); }
function addEventLocal(ev, persist = true) {
  if (!ev?.id || seen.has(ev.id)) return;
  seen.add(ev.id);
  events.push(ev);
  events = events.slice(-MAX_EVENTS);
  if (ev.actor && (ev.resourcesAfter || ev.actorState)) actors[ev.actor] = { ...actors[ev.actor], ...(ev.resourcesAfter || ev.actorState), updated: Date.now() };
  renderAll();
  if (persist) saveLocal();
}
function addSystemLocal(text) { addEventLocal({ id: uid(), ts: Date.now(), type: "system", actor: "System", time: nowTime(), text }, true); }

function renderAll() { renderLatest(); renderLog(); renderActors(); }
function latestVisibleEvent() { return [...events].reverse().find(e => e.type !== "system") || [...events].reverse()[0]; }
function renderLatest() {
  const box = $("latest-card"); if (!box) return;
  const ev = latestVisibleEvent();
  if (!ev) return;
  const tone = ev.pill || (ev.type === "damage" ? "mag" : ev.type === "resource" ? "info" : "");
  box.className = `latest-card ${tone || ""}`.trim();
  let title = ev.actor ? `${esc(ev.actor)}` : "Событие";
  let body = esc(ev.text || ev.summary || "");
  if (ev.type === "roll") title = `${esc(ev.actor)} — ${esc(ev.title)} <span class="pill ${ev.pill || "good"}">${esc(ev.resultLabel)}</span>`;
  else if (ev.type === "damage") title = `${esc(ev.actor)} — ${esc(ev.title)} <span class="pill mag">Урон</span>`;
  else if (ev.type === "resource") title = `${esc(ev.actor)} — ресурсы <span class="pill info">изменение</span>`;
  else if (ev.type === "chat") title = `${esc(ev.actor)} пишет`;
  else box.classList.add("empty");
  box.innerHTML = `<div class="latest-kicker">Последнее событие</div><div class="latest-title">${title}</div><div class="latest-body">${body}</div><div class="latest-meta"><span>${esc(ev.time || "")}</span><span>${esc(ev.type || "")}</span></div>`;
}
function renderLog() {
  const el = $("log"); if (!el) return;
  if (!events.length) { el.innerHTML = `<div class="event system"><div class="event-body">Пока нет событий.</div></div>`; return; }
  el.innerHTML = [...events].reverse().map(renderEvent).join("");
  el.scrollTop = 0;
}
function renderEvent(ev) {
  const cls = `event ${ev.type || "system"}`;
  const actor = esc(ev.actor || "—");
  const time = esc(ev.time || "");
  let body = "";
  if (ev.type === "chat") body = `<div class="event-body">${esc(ev.text)}</div>`;
  else if (ev.type === "roll") body = `<div class="event-title">${esc(ev.title)} <span class="pill ${ev.pill || "good"}">${esc(ev.resultLabel)}</span></div><div class="event-body">${esc(ev.summary)}</div>`;
  else if (ev.type === "damage") body = `<div class="event-title">${esc(ev.title)} <span class="pill mag">Урон</span></div><div class="event-body">${esc(ev.summary)}</div>`;
  else if (ev.type === "resource") body = `<div class="event-title">Ресурсы</div><div class="event-body">${esc(ev.summary)}</div>`;
  else body = `<div class="event-body">${esc(ev.text || ev.summary || "")}</div>`;
  return `<div class="${cls}"><div class="event-top"><span class="event-actor">${actor}</span><span class="event-time">${time}</span></div>${body}</div>`;
}
function renderActors() {
  const el = $("actors-list"); if (!el) return;
  const list = Object.entries(actors).sort((a,b)=>(b[1].updated||0)-(a[1].updated||0));
  if (!list.length) { el.innerHTML = `<div class="note">Пока нет персонажей.</div>`; return; }
  el.innerHTML = list.map(([name,a]) => `<div class="actor-item"><div class="actor-name">${esc(name)}</div><div class="actor-res">ОТП ${a.otp ?? 0} · ОД ${a.od ?? 0} · SP ${a.sp ?? 0}</div></div>`).join("");
}

function applyOtpDelta(delta) {
  const beforeOtp = state.otp, beforeOd = state.od;
  if (delta > 0) {
    const total = state.otp + delta;
    if (total <= state.otpMax) state.otp = total;
    else {
      const extra = total - state.otpMax;
      state.otp = state.otpMax;
      if (extra >= 2 && !state.extraOdGained) { state.od += 1; state.extraOdGained = true; }
    }
  } else if (delta < 0) state.otp = Math.max(0, state.otp + delta);
  collectActor(); syncInputs();
  return { beforeOtp, afterOtp: state.otp, beforeOd, afterOd: state.od };
}
function setResource(key, value) {
  if (key === "otp") state.otp = clamp(value, 0, state.otpMax);
  if (key === "od") state.od = clamp(value, 0, 9);
  if (key === "sp") state.sp = clamp(value, 0, 99);
  collectActor(); syncInputs();
}
function buildSkillResult({ actor, skillName, tn, skillCount, skillDie, attrDie, adv, dis, insurance, forceZero }) {
  let resultLabel = "", pill = "good", summary = "", otpDelta = 0;
  if (forceZero || skillCount === 0) {
    const r1 = rollDie(attrDie), r2 = rollDie(attrDie), best = Math.min(r1, r2);
    if (r1 === 1 || r2 === 1) { resultLabel = "Крит. промах"; pill = "bad"; otpDelta = -2; }
    else if (best >= tn) { resultLabel = "Успех"; pill = "good"; otpDelta = 0; }
    else { resultLabel = "Провал"; pill = "bad"; otpDelta = -1; }
    const res = applyOtpDelta(otpDelta);
    summary = `Зеро: ${attrDie} → ${r1}, ${r2}; берём худший ${best} | TN ${tn}\n${resultLabel}: ОТП ${res.beforeOtp} → ${res.afterOtp}`;
    return { title: skillName, resultLabel, pill, summary, res };
  }
  let pool = Array.from({ length: skillCount }, () => skillDie);
  const net = adv - dis;
  if (net > 0) for (let i=0;i<net;i++) pool.push(skillDie);
  if (net < 0) for (let i=0;i<Math.abs(net);i++) if (pool.length) pool.pop();
  if (!pool.length) return buildSkillResult({ actor, skillName, tn, skillCount: 0, skillDie, attrDie, adv, dis, insurance, forceZero: true });
  const rolls = pool.map(d => ({ die:d, value:rollDie(d) }));
  const values = rolls.map(r=>r.value); const best = Math.max(...values); const ones = values.filter(v=>v===1).length; const mags = rolls.filter(r=>r.value===dieSides(r.die)).length;
  let success = best >= tn, insuranceText = "";
  if (!success && insurance) {
    if (state.otp > 0) {
      const attr = rollDie(attrDie);
      if (attr === 1) { resultLabel="Крит. промах"; pill="bad"; otpDelta=-3; insuranceText=`\nСтраховка: ${attrDie} → 1. Цена −1 ОТП + крит −2 ОТП.`; }
      else if (attr >= tn) { success=true; resultLabel="Успех"; pill="good"; otpDelta=-1; insuranceText=`\nСтраховка: ${attrDie} → ${attr}. Провал подхвачен, цена −1 ОТП.`; }
      else { resultLabel="Провал"; pill="bad"; otpDelta=-2; insuranceText=`\nСтраховка: ${attrDie} → ${attr}. Не помогла: цена −1 ОТП и провал −1 ОТП.`; }
    } else insuranceText="\nСтраховка не сработала: нет ОТП.";
  }
  if (!resultLabel) {
    if (ones >= 2) { resultLabel="Крит. промах"; pill="bad"; otpDelta=-2; }
    else if (!success) { resultLabel="Провал"; pill="bad"; otpDelta=-1; }
    else if (mags >= 2) { resultLabel="Дубль-магнум"; pill="mag"; otpDelta=2; }
    else if (mags === 1) { resultLabel="Магнум"; pill="mag"; otpDelta=1; }
    else if (ones >= 1) { resultLabel="Осечка"; pill="bad"; otpDelta=-1; }
    else if (best >= tn + 3) { resultLabel="Превосходство"; pill="good"; otpDelta=1; }
    else { resultLabel="Успех"; pill="good"; otpDelta=0; }
  }
  const res = applyOtpDelta(otpDelta);
  const modText = net === 0 ? "" : ` | мод. пула: ${net > 0 ? "+" : ""}${net}`;
  summary = `${pool.join("+")} → ${values.join(", ")} | лучший ${best} | TN ${tn}${modText}${insuranceText}\nОТП ${res.beforeOtp} → ${res.afterOtp}`;
  if (res.afterOd !== res.beforeOd) summary += ` | ОД ${res.beforeOd} → ${res.afterOd}`;
  return { title: skillName, resultLabel, pill, summary, res };
}
async function skillRoll() {
  collectActor();
  const actor = safeActor();
  const result = buildSkillResult({ actor, skillName: $("skill-name").value.trim() || "Проверка", tn: clamp($("tn").value,3,7), skillCount: clamp($("skill-count").value,0,2), skillDie: $("skill-die").value, attrDie: $("attr-die").value, adv: clamp($("adv").value,0,6), dis: clamp($("dis").value,0,6), insurance: $("insurance").checked, forceZero: $("zero").checked });
  await broadcastEvent({ id: uid(), ts: Date.now(), type:"roll", actor, time: nowTime(), title: result.title, resultLabel: result.resultLabel, pill: result.pill, summary: result.summary, resourcesAfter:{otp:state.otp, od:state.od, sp:state.sp}, meta: result.res });
}
async function damageRoll() {
  collectActor();
  const actor = safeActor();
  const weapon = $("weapon-name").value.trim() || "Оружие";
  const count = clamp($("damage-count").value,1,6), die = $("damage-die").value, ammo = $("ammo-type").value, spRaw = clamp($("target-sp").value,0,99);
  const sides = dieSides(die), rolls = [], explosions = [];
  for (let i=0;i<count;i++) { const v = rollDie(die); rolls.push(v); if (ammo === "exp" && v === sides) explosions.push(rollDie(die)); }
  const base = rolls.reduce((a,b)=>a+b,0) + explosions.reduce((a,b)=>a+b,0);
  const spEff = ammo === "ap" ? Math.max(0, spRaw - 2) : spRaw;
  const total = Math.max(0, base - spEff);
  const ammoLabel = ammo === "ap" ? "бронебойный" : ammo === "exp" ? "экспансивный" : "лёгкий";
  let summary = `${count}${die}, ${ammoLabel}: ${rolls.join(", ")}`;
  if (explosions.length) summary += ` | взрыв: ${explosions.join(", ")}`;
  summary += `\nСумма ${base} − SP ${spEff}`;
  if (ammo === "ap") summary += ` (исходный SP ${spRaw}, бронебойный −2)`;
  summary += ` = итоговый урон ${total}`;
  await broadcastEvent({ id: uid(), ts: Date.now(), type:"damage", actor, time: nowTime(), title: weapon, summary, resourcesAfter:{otp:state.otp, od:state.od, sp:state.sp} });
}
async function resourceChange(key, delta) {
  const before = state[key] || 0; setResource(key, before + delta);
  const label = key === "otp" ? "ОТП" : key === "od" ? "ОД" : "SP";
  await broadcastEvent({ id: uid(), ts: Date.now(), type:"resource", actor: safeActor(), time: nowTime(), summary: `${label}: ${before} → ${state[key]}`, resourcesAfter:{otp:state.otp, od:state.od, sp:state.sp} });
}
async function sendChat(text) { collectActor(); await broadcastEvent({ id: uid(), ts: Date.now(), type:"chat", actor:safeActor(), time:nowTime(), text, actorState:{otp:state.otp, od:state.od, sp:state.sp} }); }

async function setupTokenContextMenu() {
  if (!OBR?.contextMenu || !OBR?.popover) return;
  try {
    await OBR.contextMenu.create({
      id: "com.scarletfrontier.log/token-menu-v06",
      icons: [{ icon: `https://svenswanrig-netizen.github.io/Scarlet_Log/icon.svg?v=${VERSION}`, label: "Scarlet" }],
      async onClick(context, elementId) {
        const item = context?.items?.[0]; if (!item) return;
        const current = item.metadata?.[TOKEN_META_KEY] || { actor: item.name || safeActor(), otp: state.otp, od: state.od, sp: state.sp, otpMax: state.otpMax };
        await OBR.scene.items.updateItems([item], (items) => { for (const it of items) it.metadata[TOKEN_META_KEY] = { ...current, actor: current.actor || it.name || "Оперативник", updated: Date.now() }; });
        const url = `https://svenswanrig-netizen.github.io/Scarlet_Log/token.html?v=${VERSION}&item=${encodeURIComponent(item.id)}`;
        await OBR.popover.open({ id:"com.scarletfrontier.log/token-popover-v06", url, height:590, width:360, anchorElementId: elementId, anchorOrigin:{horizontal:"CENTER", vertical:"TOP"}, transformOrigin:{horizontal:"CENTER", vertical:"BOTTOM"}, marginThreshold:12 });
      }
    });
  } catch (err) { console.warn("context menu failed", err); addSystemLocal("Контекстное меню токена не подключилось. Открой расширение в комнате Owlbear."); }
}

function exportLog() {
  const lines = [...events].map(ev => `[${ev.time || ""}] ${ev.actor || "—"} — ${ev.title || ev.type || "событие"}\n${ev.text || ev.summary || ""}`).join("\n\n");
  const blob = new Blob([lines], { type:"text/plain;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "scarlet_log.txt"; a.click(); URL.revokeObjectURL(a.href);
}
function switchTab(id) { qsa(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === id)); qsa(".panel").forEach(p => p.classList.toggle("on", p.id === `tab-${id}`)); }
function bind() {
  qsa(".tab").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  qsa("[data-res]").forEach(btn => btn.addEventListener("click", () => resourceChange(btn.dataset.res, Number(btn.dataset.delta))));
  $("actor-name").addEventListener("input", () => { collectActor(); saveRoomState(); });
  $("sync-btn").addEventListener("click", async () => { collectActor(); await saveRoomState(); addSystemLocal("Состояние синхронизировано с комнатой."); });
  $("roll-skill-btn").addEventListener("click", skillRoll);
  $("roll-damage-btn").addEventListener("click", damageRoll);
  $("chat-form").addEventListener("submit", (e) => { e.preventDefault(); const text = $("chat-input").value.trim(); if (!text) return; $("chat-input").value = ""; sendChat(text); });
  $("clear-local-btn").addEventListener("click", () => { events = []; seen = new Set(); saveLocal(); renderAll(); });
  $("export-log-btn").addEventListener("click", exportLog);
}
async function init() { loadLocal(); bind(); syncInputs(); renderAll(); await loadSdk(); }
init();
