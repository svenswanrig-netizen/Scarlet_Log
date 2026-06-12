const CHANNEL = "scarlet-frontier-log-v6";
const ROOM_META_KEY = "com.scarletfrontier.log/v6";
const TOKEN_META_KEY = "com.scarletfrontier.log/token";
const MAX_EVENTS = 50;
const POP_ID = "com.scarletfrontier.log/token-popover-v06";

let OBR = null;
let online = false;
let itemId = new URLSearchParams(location.search).get("item");
let item = null;
let state = { actor: "Оперативник", otp: 0, od: 3, sp: 0, otpMax: 3, extraOdGained: false };

const $ = (id) => document.getElementById(id);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
const dieSides = (die) => Number(String(die).replace("d", ""));
const rollDie = (die) => Math.floor(Math.random() * dieSides(die)) + 1;
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const nowTime = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const safeActor = () => ($("actor").value || state.actor || item?.name || "Оперативник").trim() || "Оперативник";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

function setStatus(text) { $("status").textContent = text; }
function syncUi() { $("actor").value = state.actor || "Оперативник"; $("otp").textContent = state.otp || 0; $("od").textContent = state.od ?? 3; $("sp").textContent = state.sp || 0; }
function collect() { state.actor = safeActor(); state.otp = clamp(state.otp, 0, state.otpMax || 3); state.od = clamp(state.od, 0, 9); state.sp = clamp(state.sp, 0, 99); }
function renderResult(ev) {
  const box = $("result"); if (!box) return;
  const tone = ev.pill || (ev.type === "damage" ? "mag" : ev.type === "resource" ? "good" : "");
  box.className = `result ${tone || ""}`.trim();
  let title = "Событие";
  if (ev.type === "roll") title = `${esc(ev.title)} <span class="pill ${ev.pill || "good"}">${esc(ev.resultLabel)}</span>`;
  else if (ev.type === "resource") title = `Ресурсы`;
  else if (ev.type === "chat") title = `Сообщение`;
  box.innerHTML = `<div class="rk">Только что</div><div class="rt">${title}</div><div class="rb">${esc(ev.summary || ev.text || "")}</div>`;
}
async function waitReady() {
  if (OBR?.isReady) return;
  await new Promise((resolve) => { const unsub = OBR.onReady(() => { try { unsub?.(); } catch {} resolve(); }); });
}
async function loadSdk() {
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@latest/+esm");
    OBR = mod.default;
    if (!OBR?.isAvailable) throw new Error("not in Owlbear");
    await waitReady(); online = true; await loadToken();
  } catch (err) { console.warn(err); setStatus("Локальный режим: токен доступен только внутри Owlbear."); }
}
async function loadToken() {
  if (!itemId) { setStatus("Токен не передан. Открой через контекстное меню токена."); return; }
  const items = await OBR.scene.items.getItems([itemId]);
  item = items?.[0];
  if (!item) { setStatus("Токен не найден. Возможно, он удалён или сцена сменилась."); return; }
  const meta = item.metadata?.[TOKEN_META_KEY];
  state = { ...state, ...(meta || {}), actor: meta?.actor || item.name || state.actor };
  syncUi(); setStatus("Готово: бросок покажется здесь и уйдёт всем в общий лог.");
}
async function saveToken() {
  if (!online || !item) return;
  collect();
  await OBR.scene.items.updateItems([item], (items) => { for (const it of items) it.metadata[TOKEN_META_KEY] = { ...state, updated: Date.now() }; });
  const fresh = await OBR.scene.items.getItems([item.id]); item = fresh?.[0] || item;
}
async function saveRoomEvent(ev) {
  if (!online || !OBR?.room) return;
  try {
    const meta = await OBR.room.getMetadata(); const old = meta?.[ROOM_META_KEY] || {};
    const map = new Map();
    for (const e of (Array.isArray(old.events) ? old.events : [])) if (e?.id) map.set(e.id, e);
    if (ev?.id) map.set(ev.id, ev);
    const events = Array.from(map.values()).sort((a,b)=>(a.ts||0)-(b.ts||0)).slice(-MAX_EVENTS);
    const actors = { ...(old.actors || {}) };
    if (ev.actor && (ev.resourcesAfter || ev.actorState)) actors[ev.actor] = { ...actors[ev.actor], ...(ev.resourcesAfter || ev.actorState), updated: Date.now() };
    await OBR.room.setMetadata({ [ROOM_META_KEY]: { ...old, events, actors, updated: Date.now() } });
  } catch (err) { console.warn("room save failed", err); }
}
async function sendEvent(ev) {
  ev.ts ||= Date.now(); ev.time ||= nowTime();
  renderResult(ev);
  if (online && OBR?.broadcast) {
    try { await OBR.broadcast.sendMessage(CHANNEL, ev, { destination: "ALL" }); }
    catch (err) { console.warn("broadcast failed", err); }
  }
  await saveRoomEvent(ev);
}
async function resourceChange(key, delta) {
  collect(); const before = state[key] || 0;
  if (key === "otp") state.otp = clamp(before + delta, 0, state.otpMax || 3);
  if (key === "od") state.od = clamp(before + delta, 0, 9);
  if (key === "sp") state.sp = clamp(before + delta, 0, 99);
  syncUi(); await saveToken();
  const label = key === "otp" ? "ОТП" : key === "od" ? "ОД" : "SP";
  await sendEvent({ id: uid(), type: "resource", actor: safeActor(), summary: `${label}: ${before} → ${state[key]}`, resourcesAfter: { otp: state.otp, od: state.od, sp: state.sp } });
}
function applyOtpDelta(delta) {
  const beforeOtp = state.otp, beforeOd = state.od;
  if (delta > 0) {
    const total = state.otp + delta;
    if (total <= (state.otpMax || 3)) state.otp = total;
    else { const extra = total - (state.otpMax || 3); state.otp = state.otpMax || 3; if (extra >= 2 && !state.extraOdGained) { state.od += 1; state.extraOdGained = true; } }
  } else if (delta < 0) state.otp = Math.max(0, state.otp + delta);
  return { beforeOtp, afterOtp: state.otp, beforeOd, afterOd: state.od };
}
async function quickRoll() {
  collect(); const actor = safeActor();
  const skillName = $("skill").value.trim() || "Проверка";
  const tn = clamp($("tn").value, 3, 7), skillCount = clamp($("count").value, 0, 2), skillDie = $("die").value, attrDie = $("attr").value;
  const adv = clamp($("adv").value, 0, 6), dis = clamp($("dis").value, 0, 6), insurance = $("ins").checked, forceZero = $("zero").checked || skillCount === 0;
  let resultLabel = "", pill = "good", summary = "", otpDelta = 0;

  if (forceZero) {
    const r1 = rollDie(attrDie), r2 = rollDie(attrDie), best = Math.min(r1, r2);
    if (r1 === 1 || r2 === 1) { resultLabel = "Крит. промах"; pill = "bad"; otpDelta = -2; }
    else if (best >= tn) { resultLabel = "Успех"; pill = "good"; otpDelta = 0; }
    else { resultLabel = "Провал"; pill = "bad"; otpDelta = -1; }
    const res = applyOtpDelta(otpDelta);
    summary = `Зеро: ${attrDie} → ${r1}, ${r2}; берём худший ${best} | TN ${tn}\n${resultLabel}: ОТП ${res.beforeOtp} → ${res.afterOtp}`;
    syncUi(); await saveToken();
    await sendEvent({ id: uid(), type: "roll", actor, title: skillName, resultLabel, pill, summary, resourcesAfter: { otp: state.otp, od: state.od, sp: state.sp }, meta: res });
    setStatus("Бросок отправлен. Результат здесь и в общем логе."); return;
  }

  let pool = Array.from({ length: skillCount }, () => skillDie);
  const net = adv - dis;
  if (net > 0) for (let i=0;i<net;i++) pool.push(skillDie);
  if (net < 0) for (let i=0;i<Math.abs(net);i++) if (pool.length) pool.pop();
  if (!pool.length) { $("zero").checked = true; return quickRoll(); }

  const rolls = pool.map(d => ({ die: d, value: rollDie(d) }));
  const values = rolls.map(r => r.value), best = Math.max(...values), ones = values.filter(v => v === 1).length, mags = rolls.filter(r => r.value === dieSides(r.die)).length;
  let success = best >= tn, insuranceText = "";
  if (!success && insurance) {
    if (state.otp > 0) {
      const attr = rollDie(attrDie);
      if (attr === 1) { resultLabel = "Крит. промах"; pill = "bad"; otpDelta = -3; insuranceText = `\nСтраховка: ${attrDie} → 1. Цена −1 ОТП + крит −2 ОТП.`; }
      else if (attr >= tn) { success = true; resultLabel = "Успех"; pill = "good"; otpDelta = -1; insuranceText = `\nСтраховка: ${attrDie} → ${attr}. Провал подхвачен, цена −1 ОТП.`; }
      else { resultLabel = "Провал"; pill = "bad"; otpDelta = -2; insuranceText = `\nСтраховка: ${attrDie} → ${attr}. Не помогла: цена −1 ОТП и провал −1 ОТП.`; }
    } else insuranceText = "\nСтраховка не сработала: нет ОТП.";
  }
  if (!resultLabel) {
    if (ones >= 2) { resultLabel = "Крит. промах"; pill = "bad"; otpDelta = -2; }
    else if (!success) { resultLabel = "Провал"; pill = "bad"; otpDelta = -1; }
    else if (mags >= 2) { resultLabel = "Дубль-магнум"; pill = "mag"; otpDelta = 2; }
    else if (mags === 1) { resultLabel = "Магнум"; pill = "mag"; otpDelta = 1; }
    else if (ones >= 1) { resultLabel = "Осечка"; pill = "bad"; otpDelta = -1; }
    else if (best >= tn + 3) { resultLabel = "Превосходство"; pill = "good"; otpDelta = 1; }
    else { resultLabel = "Успех"; pill = "good"; otpDelta = 0; }
  }
  const res = applyOtpDelta(otpDelta);
  const modText = net === 0 ? "" : ` | мод. пула: ${net > 0 ? "+" : ""}${net}`;
  summary = `${pool.join("+")} → ${values.join(", ")} | лучший ${best} | TN ${tn}${modText}${insuranceText}\nОТП ${res.beforeOtp} → ${res.afterOtp}`;
  if (res.afterOd !== res.beforeOd) summary += ` | ОД ${res.beforeOd} → ${res.afterOd}`;
  syncUi(); await saveToken();
  await sendEvent({ id: uid(), type: "roll", actor, title: skillName, resultLabel, pill, summary, resourcesAfter: { otp: state.otp, od: state.od, sp: state.sp }, meta: res });
  setStatus("Бросок отправлен. Результат здесь и в общем логе.");
}
async function sendChat(text) {
  collect(); await saveToken();
  await sendEvent({ id: uid(), type: "chat", actor: safeActor(), text, actorState: { otp: state.otp, od: state.od, sp: state.sp } });
  setStatus("Сообщение отправлено.");
}
function bind() {
  qsa("[data-res]").forEach(btn => btn.addEventListener("click", () => resourceChange(btn.dataset.res, Number(btn.dataset.delta))));
  $("actor").addEventListener("input", async () => { collect(); syncUi(); await saveToken(); });
  $("roll").addEventListener("click", quickRoll);
  $("chat-form").addEventListener("submit", (e) => { e.preventDefault(); const text = $("chat").value.trim(); if (!text) return; $("chat").value = ""; sendChat(text); });
  $("close").addEventListener("click", () => { try { OBR?.popover?.close(POP_ID); } catch {} });
}
async function init() { bind(); syncUi(); await loadSdk(); }
init();
