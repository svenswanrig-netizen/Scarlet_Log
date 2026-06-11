const CHANNEL = "ru.scarlet-frontier.roll-log.v1";
const LS_KEY = "scarlet_owlbear_log_v1";
const DICE = ["d4", "d6", "d8", "d10", "d12"];

let OBR = null;
let online = false;
let adv = 0;
let dis = 0;
let state = loadState();

const $ = (id) => document.getElementById(id);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const dN = (die) => Number(String(die).replace("d", ""));
const nowTime = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

init();

async function init() {
  bindUi();
  applyState();
  renderLog();
  await initOwlbear();
}

async function initOwlbear() {
  try {
    const mod = await import("https://esm.sh/@owlbear-rodeo/sdk@2.4.0");
    OBR = mod.default;
    if (!OBR?.isAvailable) {
      setStatus(false);
      return;
    }
    OBR.onReady(async () => {
      online = true;
      setStatus(true);
      try {
        const playerName = await OBR.player.getName();
        if (!state.actorName && playerName) {
          state.actorName = playerName;
          $("actorName").value = playerName;
          saveState();
        }
      } catch (_) {}
      OBR.broadcast.onMessage(CHANNEL, (event) => {
        if (event?.data?.kind === "scarlet-log-entry") {
          addEntry(event.data.entry, false);
        }
      });
    });
  } catch (err) {
    console.warn("Owlbear SDK unavailable, local mode only", err);
    setStatus(false);
  }
}

function setStatus(isOnline) {
  const el = $("status");
  el.textContent = isOnline ? "OWLBEAR" : "LOCAL";
  el.className = `status ${isOnline ? "online" : "local"}`;
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || freshState();
  } catch (_) {
    return freshState();
  }
}
function freshState() {
  return { actorName: "", otp: 0, od: 3, log: [] };
}
function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function applyState() {
  $("actorName").value = state.actorName || "";
  $("otpVal").textContent = state.otp;
  $("odVal").textContent = state.od;
  $("advVal").textContent = adv;
  $("disVal").textContent = dis;
}

function bindUi() {
  $("actorName").addEventListener("input", () => {
    state.actorName = $("actorName").value.trim();
    saveState();
  });

  document.querySelectorAll("[data-res]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = btn.dataset.res;
      const delta = Number(btn.dataset.delta);
      if (res === "otp") state.otp = clamp(state.otp + delta, 0, 3);
      if (res === "od") state.od = clamp(state.od + delta, 0, 4);
      saveState();
      applyState();
    });
  });

  $("advPlus").onclick = () => { adv = clamp(adv + 1, 0, 9); applyState(); };
  $("advMinus").onclick = () => { adv = clamp(adv - 1, 0, 9); applyState(); };
  $("disPlus").onclick = () => { dis = clamp(dis + 1, 0, 9); applyState(); };
  $("disMinus").onclick = () => { dis = clamp(dis - 1, 0, 9); applyState(); };

  $("rollSkill").onclick = () => {
    const result = rollSkillCheck({
      actor: getActor(),
      skillName: $("skillName").value.trim() || "Проверка",
      skillCount: Number($("skillCount").value),
      skillDie: $("skillDie").value,
      attrDie: $("attrDie").value,
      tn: clamp(Number($("tn").value) || 4, 3, 7),
      advantage: adv,
      disadvantage: dis,
      forceZero: $("forceZero").checked,
      useInsurance: $("insurance").value === "1",
      otp: state.otp,
      od: state.od,
    });
    state.otp = result.otpAfter;
    state.od = result.odAfter;
    applyState();
    addAndBroadcast(result.entry);
  };

  $("rollDamage").onclick = () => {
    const result = rollDamage({
      actor: getActor(),
      weaponName: $("weaponName").value.trim() || "Оружие",
      count: Number($("damageCount").value),
      die: $("damageDie").value,
      ammoType: $("ammoType").value,
      sp: Math.max(0, Number($("targetSp").value) || 0),
    });
    addAndBroadcast(result.entry);
  };

  $("clearLog").onclick = () => {
    if (!confirm("Очистить локальный лог? У других игроков уже полученные записи не удалятся.")) return;
    state.log = [];
    saveState();
    renderLog();
  };
}

function getActor() {
  state.actorName = $("actorName").value.trim();
  saveState();
  return state.actorName || "Оперативник";
}

function addAndBroadcast(entry) {
  addEntry(entry, true);
  if (online && OBR?.broadcast) {
    OBR.broadcast.sendMessage(CHANNEL, { kind: "scarlet-log-entry", entry }, { destination: "REMOTE" });
  }
}

function addEntry(entry, shouldSave = true) {
  if (state.log.some((e) => e.id === entry.id)) return;
  state.log.unshift(entry);
  state.log = state.log.slice(0, 40);
  if (shouldSave) saveState();
  renderLog();
}

function renderLog() {
  const log = $("log");
  if (!state.log.length) {
    log.innerHTML = `<div class="empty">Пока пусто. Первый бросок появится здесь.</div>`;
    return;
  }
  log.innerHTML = state.log.map((e) => `
    <article class="entry ${escapeHtml(e.tone || "")}">
      <div class="meta"><span>${escapeHtml(e.time)}</span><span>${escapeHtml(e.actor)}</span></div>
      <div class="title">${escapeHtml(e.title)}</div>
      <div class="text">${escapeHtml(e.text)}</div>
      ${e.delta ? `<div class="delta">${escapeHtml(e.delta)}</div>` : ""}
    </article>
  `).join("");
}

function rollSkillCheck(cfg) {
  let otp = cfg.otp;
  let od = cfg.od;
  const otpBefore = otp;
  const odBefore = od;
  const net = cfg.advantage - cfg.disadvantage;
  let notes = [];
  let pool = Array.from({ length: cfg.skillCount }, () => cfg.skillDie);
  let zeroReason = "";

  if (cfg.forceZero || pool.length === 0) {
    zeroReason = cfg.forceZero ? "Добровольный Зеро" : "Зеро: нет костей навыка";
    return finishZeroRoll(cfg, otp, od, otpBefore, odBefore, zeroReason);
  }

  if (net > 0) {
    for (let i = 0; i < net; i++) pool.push(cfg.skillDie);
    notes.push(`преимущества/помехи: ${cfg.advantage}/${cfg.disadvantage}, итог +${net} кость`);
  } else if (net < 0) {
    const remove = Math.min(pool.length, Math.abs(net));
    pool.splice(0, remove);
    notes.push(`преимущества/помехи: ${cfg.advantage}/${cfg.disadvantage}, снято ${remove} кость`);
    if (pool.length === 0) {
      return finishZeroRoll(cfg, otp, od, otpBefore, odBefore, "Зеро: пул навыка снят помехами");
    }
  } else if (cfg.advantage || cfg.disadvantage) {
    notes.push(`преимущества/помехи компенсировали друг друга: ${cfg.advantage}/${cfg.disadvantage}`);
  }

  const rolls = pool.map((die) => ({ die, value: rollDie(die) }));
  const values = rolls.map((r) => r.value);
  const best = Math.max(...values);
  const ones = values.filter((v) => v === 1).length;
  const mags = rolls.filter((r) => r.value === dN(r.die)).length;
  let success = best >= cfg.tn;
  let result = "";
  let tone = "";
  let resourceDelta = 0;
  let attrText = "";

  if (!success && cfg.useInsurance) {
    if (otp > 0) {
      otp -= 1;
      resourceDelta -= 1;
      const attr = rollDie(cfg.attrDie);
      attrText = `; страховка ${cfg.attrDie} → ${attr}`;
      if (attr === 1) {
        result = "Крит. промах";
        tone = "hot";
        resourceDelta -= 2;
        otp = clamp(otp - 2, 0, 3);
        success = false;
        notes.push("страховка: −1 ОТП; 1 на атрибуте = крит. промах");
      } else if (attr >= cfg.tn) {
        result = "Успех страховкой";
        tone = "good";
        success = true;
        notes.push("страховка: −1 ОТП; атрибут не даёт Магнумов/Осечек/ОТП");
      } else {
        result = "Провал";
        tone = "bad";
        resourceDelta -= 1;
        otp = clamp(otp - 1, 0, 3);
        notes.push("страховка не спасла: дополнительно −1 ОТП за провал");
      }
    } else {
      notes.push("страховка не сработала: нет ОТП");
    }
  }

  if (!result) {
    if (ones >= 2) {
      result = "Крит. промах";
      tone = "hot";
      resourceDelta -= 2;
      otp = clamp(otp - 2, 0, 3);
    } else if (!success) {
      result = "Провал";
      tone = "bad";
      resourceDelta -= 1;
      otp = clamp(otp - 1, 0, 3);
    } else if (mags >= 2) {
      result = "Дубль-магнум";
      tone = "hot";
      const change = gainOtp(otp, od, 2);
      otp = change.otp;
      od = change.od;
      resourceDelta += 2;
      if (change.overflowText) notes.push(change.overflowText);
    } else if (mags === 1) {
      result = "Магнум";
      tone = "hot";
      const change = gainOtp(otp, od, 1);
      otp = change.otp;
      od = change.od;
      resourceDelta += 1;
      if (change.overflowText) notes.push(change.overflowText);
    } else if (ones >= 1) {
      result = "Осечка";
      tone = "bad";
      resourceDelta -= 1;
      otp = clamp(otp - 1, 0, 3);
    } else if (best >= cfg.tn + 3) {
      result = "Превосходство";
      tone = "good";
      const change = gainOtp(otp, od, 1);
      otp = change.otp;
      od = change.od;
      resourceDelta += 1;
      if (change.overflowText) notes.push(change.overflowText);
    } else {
      result = "Успех";
      tone = "good";
    }
  }

  const diceText = rolls.map((r) => `${r.die}=${r.value}`).join(", ");
  const text = `${diceText}${attrText} | TN ${cfg.tn} | ${result}`;
  const delta = buildDelta(otpBefore, otp, odBefore, od, notes);

  return {
    otpAfter: otp,
    odAfter: od,
    entry: {
      id: uid(),
      time: nowTime(),
      actor: cfg.actor,
      title: `${cfg.skillName}: ${result}`,
      text,
      delta,
      tone,
      kind: "skill",
      resourceDelta,
    },
  };
}

function finishZeroRoll(cfg, otp, od, otpBefore, odBefore, reason) {
  const r1 = rollDie(cfg.attrDie);
  const r2 = rollDie(cfg.attrDie);
  const best = Math.min(r1, r2);
  let result, tone;
  let notes = [reason, "Обычные преимущества/помехи не учитываются; берётся худший из двух бросков атрибута"];
  if (r1 === 1 || r2 === 1) {
    result = "Крит. промах";
    tone = "hot";
    otp = clamp(otp - 2, 0, 3);
  } else if (best >= cfg.tn) {
    result = "Успех";
    tone = "good";
    notes.push("Зеро не генерирует ОТП");
  } else {
    result = "Провал";
    tone = "bad";
    otp = clamp(otp - 1, 0, 3);
  }
  return {
    otpAfter: otp,
    odAfter: od,
    entry: {
      id: uid(),
      time: nowTime(),
      actor: cfg.actor,
      title: `${cfg.skillName}: ${result}`,
      text: `${cfg.attrDie} → ${r1}, ${r2}; выбран ${best} | TN ${cfg.tn} | ${result}`,
      delta: buildDelta(otpBefore, otp, odBefore, od, notes),
      tone,
      kind: "skill",
    },
  };
}

function rollDamage(cfg) {
  const rolls = [];
  const extra = [];
  const max = dN(cfg.die);
  for (let i = 0; i < cfg.count; i++) {
    const v = rollDie(cfg.die);
    rolls.push(v);
    if (cfg.ammoType === "exp" && v === max) {
      extra.push(rollDie(cfg.die));
    }
  }
  const raw = rolls.reduce((a, b) => a + b, 0) + extra.reduce((a, b) => a + b, 0);
  const effectiveSp = cfg.ammoType === "ap" ? Math.max(0, cfg.sp - 2) : cfg.sp;
  const finalDamage = Math.max(0, raw - effectiveSp);
  const ammoLabel = { light: "Лёгкий", ap: "Бронебойный", exp: "Экспансивный" }[cfg.ammoType];
  const expText = extra.length ? `; взрыв: ${extra.join(", ")}` : "";
  const spText = cfg.ammoType === "ap" ? `SP ${cfg.sp} → ${effectiveSp}` : `SP ${cfg.sp}`;
  return {
    entry: {
      id: uid(),
      time: nowTime(),
      actor: cfg.actor,
      title: `${cfg.weaponName}: урон ${finalDamage}`,
      text: `${cfg.count}${cfg.die}, ${ammoLabel}: ${rolls.join(", ")}${expText}; сумма ${raw}; ${spText}; итог ${finalDamage}`,
      delta: cfg.ammoType === "exp" && extra.length ? "Экспансивный боеприпас: кость взорвалась один раз." : "",
      tone: "dmg",
      kind: "damage",
    },
  };
}

function gainOtp(otp, od, amount) {
  const total = otp + amount;
  const newOtp = Math.min(3, total);
  const overflow = Math.max(0, total - 3);
  let overflowText = "";
  if (overflow >= 2 && od < 4) {
    od = Math.min(4, od + 1);
    overflowText = "Переполнение ОТП: 2 лишних ОТП → +1 ОД.";
  } else if (overflow > 0) {
    overflowText = "Лишние ОТП сверх лимита сгорели.";
  }
  return { otp: newOtp, od, overflowText };
}

function buildDelta(otpBefore, otpAfter, odBefore, odAfter, notes = []) {
  const parts = [`ОТП ${otpBefore} → ${otpAfter}`];
  if (odBefore !== odAfter) parts.push(`ОД ${odBefore} → ${odAfter}`);
  if (notes.length) parts.push(notes.join("; "));
  return parts.join(" | ");
}

function rollDie(die) {
  return Math.floor(Math.random() * dN(die)) + 1;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
