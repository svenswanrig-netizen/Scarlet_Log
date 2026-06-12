const CHANNEL = "scarlet-frontier-log-v5";
const META_KEY = "com.scarletfrontier.log/v5";
const MAX_EVENTS = 40;
const STORAGE_KEY = "scarlet-log-network-v5";

let OBR = null;
let online = false;
let seen = new Set();
let events = [];
let actors = {};
let state = {
  actor: "",
  otp: 0,
  od: 3,
  sp: 0,
  otpMax: 3,
  extraOdGained: false
};

const $ = (id) => document.getElementById(id);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));

function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n) || 0)); }
function dieSides(die) { return Number(String(die).replace("d", "")); }
function rollDie(die) { return Math.floor(Math.random() * dieSides(die)) + 1; }
function nowTime() { return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
function uid() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function safeActor() { return (state.actor || $("actor-name").value || "Оперативник").trim() || "Оперативник"; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }

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
function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, events: events.slice(-MAX_EVENTS), actors }));
}
function syncInputs() {
  $("actor-name").value = state.actor || "";
  $("otp-val").textContent = state.otp;
  $("od-val").textContent = state.od;
  $("sp-val").textContent = state.sp;
}
function collectActor() {
  state.actor = safeActor();
  actors[state.actor] = { otp: state.otp, od: state.od, sp: state.sp, updated: Date.now() };
  saveLocal();
  renderActors();
}

async function waitForObrReady() {
  if (OBR?.isReady) return;
  await new Promise((resolve) => {
    const unsub = OBR.onReady(() => {
      try { unsub?.(); } catch {}
      resolve();
    });
  });
}

async function loadSdk() {
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@latest/+esm");
    OBR = mod.default;
    if (!OBR?.isAvailable) throw new Error("OBR is not available outside Owlbear");
    await waitForObrReady();
    online = true;
    $("net-status").textContent = "Owlbear online";
    $("net-status").className = "status online";
    setupBroadcast();
    setupRoomMetadataSync();
    await loadRoomState();
    setupTokenContextMenu();
    addSystem("Расширение подключено к комнате Owlbear. Выбери токен и нажми Scarlet в контекстном меню для мини-панели.", false);
  } catch (err) {
    online = false;
    $("net-status").textContent = "local mode";
    $("net-status").className = "status local";
    addSystem("Локальный режим: синхронизация включится только внутри комнаты Owlbear.", false);
    console.warn("Owlbear SDK unavailable", err);
  }
}

function setupBroadcast() {
  if (!OBR?.broadcast) return;
  try {
    OBR.broadcast.onMessage(CHANNEL, (event) => {
      const data = event?.data ?? event;
      if (!data || !data.id) return;
      receiveEvent(data);
    });
  } catch (err) {
    console.warn("broadcast setup failed", err);
    addSystem("Broadcast не подключился. Пробую синхронизацию через metadata комнаты.", false);
  }
}

function setupRoomMetadataSync() {
  if (!OBR?.room?.onMetadataChange) return;
  try {
    OBR.room.onMetadataChange((metadata) => {
      const roomState = metadata?.[META_KEY];
      if (!roomState) return;
      applyRoomState(roomState);
    });
  } catch (err) {
    console.warn("room metadata listener failed", err);
  }
}

function applyRoomState(roomState) {
  if (!roomState || typeof roomState !== "object") return;
  if (roomState.actors && typeof roomState.actors === "object") {
    actors = { ...actors, ...roomState.actors };
  }
  if (Array.isArray(roomState.events)) {
    for (const ev of roomState.events) addEventLocal(ev, false);
  }
  renderLog();
  renderActors();
  saveLocal();
}

async function loadRoomState() {
  if (!OBR?.room) return;
  try {
    const meta = await OBR.room.getMetadata();
    applyRoomState(meta?.[META_KEY]);
  } catch (err) {
    console.warn("room metadata load failed", err);
  }
}

function mergedEventsWith(ev) {
  const map = new Map();
  for (const old of events) if (old?.id) map.set(old.id, old);
  if (ev?.id) map.set(ev.id, ev);
  return Array.from(map.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-MAX_EVENTS);
}

async function saveRoomState(extraEvent = null) {
  if (!OBR?.room || !online) return;
  try {
    const current = await OBR.room.getMetadata();
    const oldState = current?.[META_KEY] || {};
    const oldEvents = Array.isArray(oldState.events) ? oldState.events : [];
    const merged = new Map();
    for (const ev of oldEvents) if (ev?.id) merged.set(ev.id, ev);
    for (const ev of events) if (ev?.id) merged.set(ev.id, ev);
    if (extraEvent?.id) merged.set(extraEvent.id, extraEvent);
    const nextEvents = Array.from(merged.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-MAX_EVENTS);
    const nextActors = { ...(oldState.actors || {}), ...actors };
    await OBR.room.setMetadata({
      [META_KEY]: {
        events: nextEvents,
        actors: nextActors,
        updated: Date.now()
      }
    });
  } catch (err) {
    console.warn("room metadata save failed", err);
  }
}

async function broadcastEvent(ev) {
  if (!ev.ts) ev.ts = Date.now();
  if (!ev.time) ev.time = nowTime();

  // Важно: сначала пишем событие себе локально.
  // В Owlbear broadcast иногда не возвращается отправителю, поэтому иначе кажется,
  // что кнопка не работает, хотя событие ушло в сеть.
  addEventLocal(ev, true);

  if (online && OBR?.broadcast) {
    try {
      // REMOTE = отправить другим участникам. У себя уже добавили выше.
      await OBR.broadcast.sendMessage(CHANNEL, ev, { destination: "REMOTE" });
    } catch (err) {
      console.warn("broadcast send failed", err);
      addSystemLocal("Broadcast не отправился. Событие сохранено локально и в metadata, если она доступна.");
    }
  }
  await saveRoomState(ev);
}
function receiveEvent(ev) {
  addEventLocal(ev, true);
}
function addEventLocal(ev, persist = true) {
  if (!ev || !ev.id || seen.has(ev.id)) return;
  seen.add(ev.id);
  events.push(ev);
  events = events.slice(-MAX_EVENTS);
  if (ev.actor) {
    const res = ev.resourcesAfter || ev.actorState;
    if (res) actors[ev.actor] = { ...actors[ev.actor], ...res, updated: Date.now() };
  }
  renderLog();
  renderActors();
  if (persist) saveLocal();
}
function addSystemLocal(text) {
  const ev = { id: uid(), ts: Date.now(), type: "system", actor: "System", time: nowTime(), text };
  addEventLocal(ev, true);
}
function addSystem(text, network = true) {
  const ev = { id: uid(), ts: Date.now(), type: "system", actor: "System", time: nowTime(), text };
  return network ? broadcastEvent(ev) : addEventLocal(ev, true);
}


function defaultTokenState(item) {
  return {
    actor: state.actor || item?.name || "Оперативник",
    otp: state.otp || 0,
    od: state.od || 3,
    sp: state.sp || 0,
    otpMax: state.otpMax || 3
  };
}

async function setupTokenContextMenu() {
  if (!OBR?.contextMenu || !OBR?.popover) return;
  try {
    await OBR.contextMenu.create({
      id: "com.scarletfrontier.log/token-menu-v05",
      icons: [
        {
          icon: "https://svenswanrig-netizen.github.io/Scarlet_Log/icon.svg?v=050",
          label: "Scarlet"
        }
      ],
      async onClick(context, elementId) {
        const item = context?.items?.[0];
        if (!item) return;
        const current = item.metadata?.["com.scarletfrontier.log/token"] || defaultTokenState(item);
        await OBR.scene.items.updateItems([item], (items) => {
          for (const it of items) {
            it.metadata["com.scarletfrontier.log/token"] = {
              ...current,
              actor: current.actor || it.name || "Оперативник",
              updated: Date.now()
            };
          }
        });
        const url = `https://svenswanrig-netizen.github.io/Scarlet_Log/token.html?v=050&item=${encodeURIComponent(item.id)}`;
        await OBR.popover.open({
          id: "com.scarletfrontier.log/token-popover",
          url,
          height: 430,
          width: 330,
          anchorElementId: elementId,
          anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
          transformOrigin: { horizontal: "CENTER", vertical: "BOTTOM" },
          marginThreshold: 12
        });
      }
    });
  } catch (err) {
    console.warn("token context menu setup failed", err);
    addSystemLocal("Контекстное меню токена не подключилось. Проверь, что открыта сцена Owlbear.");
  }
}

function renderLog() {
  const el = $("log");
  if (!el) return;
  if (!events.length) {
    el.innerHTML = `<div class="event system"><div class="event-body">Пока нет событий.</div></div>`;
    return;
  }
  // Новые события сверху: не нужно листать вниз после каждого броска.
  el.innerHTML = [...events].reverse().map(ev => renderEvent(ev)).join("");
  el.scrollTop = 0;
}
function renderEvent(ev) {
  const cls = `event ${ev.type || "system"}`;
  const actor = esc(ev.actor || "—");
  const time = esc(ev.time || "");
  let body = "";
  if (ev.type === "chat") {
    body = `<div class="event-body">${esc(ev.text)}</div>`;
  } else if (ev.type === "roll") {
    body = `<div class="event-title">${esc(ev.title)} <span class="pill ${ev.pill || "good"}">${esc(ev.resultLabel)}</span></div><div class="event-body">${esc(ev.summary)}</div>`;
  } else if (ev.type === "damage") {
    body = `<div class="event-title">${esc(ev.title)} <span class="pill mag">Урон</span></div><div class="event-body">${esc(ev.summary)}</div>`;
  } else if (ev.type === "resource") {
    body = `<div class="event-title">Ресурсы</div><div class="event-body">${esc(ev.summary)}</div>`;
  } else {
    body = `<div class="event-body">${esc(ev.text || ev.summary || "")}</div>`;
  }
  return `<div class="${cls}"><div class="event-top"><span class="event-actor">${actor}</span><span class="event-time">${time}</span></div>${body}</div>`;
}
function renderActors() {
  const el = $("actors-list");
  if (!el) return;
  const list = Object.entries(actors).sort((a,b) => (b[1].updated || 0) - (a[1].updated || 0));
  if (!list.length) {
    el.innerHTML = `<div class="note">Пока никто не объявился.</div>`;
    return;
  }
  el.innerHTML = list.map(([name, a]) => `
    <div class="actor-item">
      <div class="actor-name">${esc(name)}</div>
      <div class="actor-res">ОТП ${a.otp ?? 0} · ОД ${a.od ?? 0} · SP ${a.sp ?? 0}</div>
    </div>
  `).join("");
}

function applyOtpDelta(delta) {
  const beforeOtp = state.otp;
  const beforeOd = state.od;
  if (delta > 0) {
    let total = state.otp + delta;
    if (total <= state.otpMax) {
      state.otp = total;
    } else {
      const extra = total - state.otpMax;
      state.otp = state.otpMax;
      if (extra >= 2 && !state.extraOdGained) {
        state.od += 1;
        state.extraOdGained = true;
      }
    }
  } else if (delta < 0) {
    state.otp = Math.max(0, state.otp + delta);
  }
  collectActor();
  syncInputs();
  return { beforeOtp, afterOtp: state.otp, beforeOd, afterOd: state.od };
}
function setResource(key, value) {
  if (key === "otp") state.otp = clamp(value, 0, state.otpMax);
  if (key === "od") state.od = clamp(value, 0, 9);
  if (key === "sp") state.sp = clamp(value, 0, 99);
  collectActor();
  syncInputs();
}

function skillRoll() {
  collectActor();
  const actor = safeActor();
  const skillName = $("skill-name").value.trim() || "Проверка";
  const tn = clamp($("tn").value, 3, 7);
  const skillCount = clamp($("skill-count").value, 0, 2);
  const skillDie = $("skill-die").value;
  const attrDie = $("attr-die").value;
  const adv = clamp($("adv").value, 0, 6);
  const dis = clamp($("dis").value, 0, 6);
  const insurance = $("insurance").checked;
  const forceZero = $("zero").checked || skillCount === 0;
  const otpBefore = state.otp;
  const odBefore = state.od;

  let resultLabel = "";
  let pill = "good";
  let summary = "";
  let otpDelta = 0;

  if (forceZero) {
    const r1 = rollDie(attrDie);
    const r2 = rollDie(attrDie);
    const best = Math.min(r1, r2);
    if (r1 === 1 || r2 === 1) {
      resultLabel = "Крит. промах"; pill = "bad"; otpDelta = -2;
      summary = `Зеро: ${attrDie} → ${r1}, ${r2}; берём худший ${best} | TN ${tn}\n1 на атрибуте: −2 ОТП. ОТП ${otpBefore} → ${Math.max(0, otpBefore + otpDelta)}`;
    } else if (best >= tn) {
      resultLabel = "Успех"; pill = "good"; otpDelta = 0;
      summary = `Зеро: ${attrDie} → ${r1}, ${r2}; берём худший ${best} | TN ${tn}\nУспех без ОТП.`;
    } else {
      resultLabel = "Провал"; pill = "bad"; otpDelta = -1;
      summary = `Зеро: ${attrDie} → ${r1}, ${r2}; берём худший ${best} | TN ${tn}\nПровал: −1 ОТП. ОТП ${otpBefore} → ${Math.max(0, otpBefore + otpDelta)}`;
    }
    const res = applyOtpDelta(otpDelta);
    summary = summary.replace(/ОТП \d+ → \d+/, `ОТП ${res.beforeOtp} → ${res.afterOtp}`);
    sendRoll(actor, skillName, resultLabel, pill, summary, res);
    return;
  }

  let pool = Array.from({ length: skillCount }, () => skillDie);
  const net = adv - dis;
  if (net > 0) {
    for (let i = 0; i < net; i++) pool.push(skillDie);
  } else if (net < 0) {
    for (let i = 0; i < Math.abs(net); i++) {
      if (pool.length > 0) pool.pop();
    }
  }

  if (pool.length === 0) {
    $("zero").checked = true;
    return skillRoll();
  }

  const rolls = pool.map(d => ({ die: d, value: rollDie(d) }));
  const values = rolls.map(r => r.value);
  const best = Math.max(...values);
  const ones = values.filter(v => v === 1).length;
  const mags = rolls.filter(r => r.value === dieSides(r.die)).length;
  let success = best >= tn;
  let insuranceText = "";
  let attrValue = null;
  let insuranceCost = 0;
  let insuranceUnavailable = false;

  if (!success && insurance) {
    if (state.otp > 0) {
      insuranceCost = -1;
      attrValue = rollDie(attrDie);
      if (attrValue === 1) {
        resultLabel = "Крит. промах"; pill = "bad"; otpDelta = -3;
        insuranceText = `\nСтраховка: ${attrDie} → 1. Цена страховки −1 ОТП и крит. промах −2 ОТП.`;
      } else if (attrValue >= tn) {
        success = true;
        resultLabel = "Успех"; pill = "good"; otpDelta = -1;
        insuranceText = `\nСтраховка: ${attrDie} → ${attrValue}. Провал подхвачен, цена −1 ОТП.`;
      } else {
        resultLabel = "Провал"; pill = "bad"; otpDelta = -2;
        insuranceText = `\nСтраховка: ${attrDie} → ${attrValue}. Не помогла: цена −1 ОТП и провал −1 ОТП.`;
      }
    } else {
      insuranceUnavailable = true;
      insuranceText = `\nСтраховка не сработала: нет ОТП.`;
    }
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
  const modText = net === 0 ? "" : ` | модификатор пула: ${net > 0 ? "+" : ""}${net}`;
  summary = `${pool.join("+")} → ${values.join(", ")} | лучший ${best} | TN ${tn}${modText}${insuranceText}\nОТП ${res.beforeOtp} → ${res.afterOtp}`;
  if (res.afterOd !== res.beforeOd) summary += ` | ОД ${res.beforeOd} → ${res.afterOd}`;
  if (insuranceUnavailable) summary += `\nИтог без страховки.`;
  sendRoll(actor, skillName, resultLabel, pill, summary, res);
}
function sendRoll(actor, title, resultLabel, pill, summary, res) {
  const ev = {
    id: uid(), ts: Date.now(), type: "roll", actor, time: nowTime(), title, resultLabel, pill, summary,
    resourcesAfter: { otp: state.otp, od: state.od, sp: state.sp },
    meta: res
  };
  broadcastEvent(ev);
}

function damageRoll() {
  collectActor();
  const actor = safeActor();
  const weapon = $("weapon-name").value.trim() || "Оружие";
  const count = clamp($("damage-count").value, 1, 6);
  const die = $("damage-die").value;
  const ammo = $("ammo-type").value;
  const spRaw = clamp($("target-sp").value, 0, 99);
  const sides = dieSides(die);
  const rolls = [];
  const explosions = [];
  for (let i = 0; i < count; i++) {
    const v = rollDie(die);
    rolls.push(v);
    if (ammo === "exp" && v === sides) explosions.push(rollDie(die));
  }
  const base = rolls.reduce((a,b)=>a+b,0) + explosions.reduce((a,b)=>a+b,0);
  const spEff = ammo === "ap" ? Math.max(0, spRaw - 2) : spRaw;
  const total = Math.max(0, base - spEff);
  const ammoLabel = ammo === "ap" ? "бронебойный" : ammo === "exp" ? "экспансивный" : "лёгкий";
  let summary = `${count}${die}, ${ammoLabel}: ${rolls.join(", ")}`;
  if (explosions.length) summary += ` | взрыв: ${explosions.join(", ")}`;
  summary += `\nСумма ${base} − SP ${spEff}`;
  if (ammo === "ap") summary += ` (исходный SP ${spRaw}, бронебойный −2)`;
  summary += ` = итоговый урон ${total}`;
  const ev = {
    id: uid(), ts: Date.now(), type: "damage", actor, time: nowTime(), title: weapon, summary,
    resourcesAfter: { otp: state.otp, od: state.od, sp: state.sp }
  };
  broadcastEvent(ev);
}

function sendChat(text) {
  collectActor();
  const ev = { id: uid(), ts: Date.now(), type: "chat", actor: safeActor(), time: nowTime(), text, actorState: { otp: state.otp, od: state.od, sp: state.sp } };
  broadcastEvent(ev);
}
function resourceEvent(key, before, after) {
  const label = key === "otp" ? "ОТП" : key === "od" ? "ОД" : "SP";
  const ev = {
    id: uid(), ts: Date.now(), type: "resource", actor: safeActor(), time: nowTime(),
    summary: `${label}: ${before} → ${after}`,
    resourcesAfter: { otp: state.otp, od: state.od, sp: state.sp }
  };
  broadcastEvent(ev);
}
function exportLog() {
  const lines = events.map(ev => {
    const head = `[${ev.time || ""}] ${ev.actor || "—"}`;
    if (ev.type === "chat") return `${head}: ${ev.text}`;
    if (ev.type === "roll") return `${head} — ${ev.title}: ${ev.resultLabel}\n${ev.summary}`;
    if (ev.type === "damage") return `${head} — Урон: ${ev.title}\n${ev.summary}`;
    return `${head}: ${ev.text || ev.summary || ""}`;
  }).join("\n\n");
  const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `scarlet_log_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function switchToTab(tabName) {
  qsa(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === tabName));
  qsa(".panel").forEach(p => p.classList.toggle("on", p.id === `tab-${tabName}`));
}

function bindUi() {
  qsa(".tab").forEach(btn => btn.addEventListener("click", () => switchToTab(btn.dataset.tab)));
  $("actor-name").addEventListener("input", () => { state.actor = $("actor-name").value.trim(); saveLocal(); });
  $("announce-btn").addEventListener("click", async () => {
    collectActor();
    syncInputs();
    switchToTab("chat");
    await broadcastEvent({ id: uid(), ts: Date.now(), type: "system", actor: safeActor(), time: nowTime(), text: online ? "подключается к ленте." : "проверяет ленту локально. В Owlbear будет онлайн.", actorState: { otp: state.otp, od: state.od, sp: state.sp } });
  });
  qsa(".round").forEach(btn => btn.addEventListener("click", () => {
    collectActor();
    const key = btn.dataset.res;
    const before = state[key];
    setResource(key, state[key] + Number(btn.dataset.delta));
    resourceEvent(key, before, state[key]);
  }));
  $("roll-skill-btn").addEventListener("click", skillRoll);
  $("roll-damage-btn").addEventListener("click", damageRoll);
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("chat-input").value.trim();
    if (!text) return;
    $("chat-input").value = "";
    sendChat(text);
  });
  $("export-log-btn").addEventListener("click", exportLog);
  $("clear-local-btn").addEventListener("click", () => {
    if (!confirm("Очистить ленту только у себя? У других игроков она не удалится.")) return;
    events = []; seen = new Set(); saveLocal(); renderLog();
  });
}

async function init() {
  loadLocal();
  bindUi();
  syncInputs();
  renderLog();
  renderActors();
  await loadSdk();
}
init();
