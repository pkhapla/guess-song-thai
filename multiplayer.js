"use strict";

// โหมดเล่นกับเพื่อน: ใช้ Supabase Realtime (Broadcast + Presence) ไม่ต้องมีเซิร์ฟเวอร์ของเราเอง
// โฮสต์เป็นคนคุมเกม: ดึงเพลง สร้างโจทย์ สั่งเริ่มแต่ละข้อ และสั่งเฉลย ทุกคนนับคะแนนจากข้อความ "answer" ที่ได้รับ

const MP_GRACE_MS = 5000;  // เผื่อเวลาโหลดเพลง/เน็ตช้า ก่อนโฮสต์บังคับเฉลย
const MP_START_DELAY = 1500;

const mp = {
  client: null,
  channel: null,
  code: null,
  isHost: false,
  hostId: null,
  playerId: getPlayerId(),
  name: "",
  players: {},     // คนที่อยู่ในห้องตอนนี้ { id: { name, host } }
  totals: {},      // คะแนนรวมของเกมนี้ { id: { name, score, correct } }
  answers: {},     // { roundIndex: Set(playerId) }
  phase: "lobby",  // lobby | loading | playing | done
  roundIndex: -1,
  revealed: {},
  timers: [],
  hostGoneTimer: 0,
};

function getPlayerId() {
  try {
    let id = sessionStorage.getItem("mp:id");
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
      sessionStorage.setItem("mp:id", id);
    }
    return id;
  } catch {
    return String(Math.random()).slice(2);
  }
}

function mpConfigured() {
  return typeof SUPABASE_URL === "string" && SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase;
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ไม่มี 0/O/1/I กันสับสน
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function mpSend(event, payload = {}) {
  if (!mp.channel) return;
  mp.channel.send({ type: "broadcast", event, payload });
}

function mpLater(fn, ms) {
  mp.timers.push(setTimeout(fn, ms));
}

function mpClearTimers() {
  mp.timers.forEach(clearTimeout);
  mp.timers = [];
}

// ---------- connect / leave ----------

async function mpConnect(code, asHost) {
  mp.client ||= window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  mp.code = code;
  mp.isHost = asHost;
  mp.hostId = asHost ? mp.playerId : null;
  mp.phase = "lobby";
  mp.players = {};

  const ch = mp.client.channel("room:" + code, {
    config: { broadcast: { self: true }, presence: { key: mp.playerId } },
  });
  mp.channel = ch;

  ch.on("presence", { event: "sync" }, onPresenceSync)
    .on("presence", { event: "join" }, () => {
      // บอกคนที่เพิ่งเข้ามาว่าห้องอยู่สถานะไหน
      if (mp.isHost) mpSend("lobby", { phase: mp.phase, label: state.source?.label || "" });
    })
    .on("broadcast", { event: "lobby" }, ({ payload }) => onLobby(payload))
    .on("broadcast", { event: "start" }, ({ payload }) => onStart(payload))
    .on("broadcast", { event: "round" }, ({ payload }) => onRound(payload))
    .on("broadcast", { event: "answer" }, ({ payload }) => onAnswer(payload))
    .on("broadcast", { event: "reveal" }, ({ payload }) => onReveal(payload))
    .on("broadcast", { event: "end" }, () => onEnd());

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMED_OUT")), 10000);
    ch.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        clearTimeout(t);
        await ch.track({ name: mp.name, host: asHost });
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(t);
        reject(new Error(status));
      }
    });
  });
}

function mpLeave() {
  mpClearTimers();
  clearTimeout(mp.hostGoneTimer);
  if (mp.channel) {
    const ch = mp.channel;
    mp.channel = null;
    ch.untrack().catch(() => {});
    mp.client.removeChannel(ch);
  }
  mp.code = null;
  mp.isHost = false;
  mp.phase = "lobby";
  state.multi = false;
  try { history.replaceState(null, "", location.pathname); } catch { /* ignore */ }
}

function onPresenceSync() {
  const ps = mp.channel.presenceState();
  mp.players = {};
  for (const [id, metas] of Object.entries(ps)) {
    const m = metas[0];
    mp.players[id] = { name: m.name, host: m.host };
    if (m.host) mp.hostId = id;
  }
  renderPlayers();
  renderLiveBoard();

  // โฮสต์หลุด: รอ 3 วิเผื่อเน็ตกระตุก แล้วค่อยปิดห้อง
  clearTimeout(mp.hostGoneTimer);
  if (!mp.isHost && mp.hostId && !mp.players[mp.hostId]) {
    mp.hostGoneTimer = setTimeout(() => {
      if (mp.channel && !mp.players[mp.hostId]) {
        alert("โฮสต์ออกจากห้องแล้ว");
        goHome();
      }
    }, 3000);
  }

  // โฮสต์: ถ้าคนที่ยังไม่ตอบออกจากห้องไป ข้อนี้อาจครบแล้ว
  if (mp.isHost && mp.phase === "playing") hostCheckAllAnswered(mp.roundIndex);
}

// ---------- lobby UI ----------

function roomLink() {
  return `${location.origin}${location.pathname}?room=${mp.code}`;
}

function showLobby() {
  stopGame();
  state.multi = true;
  mp.phase = "lobby";
  $("#lobbyCode").textContent = mp.code;
  $("#lobbyHost").hidden = !mp.isHost;
  $("#lobbyGuest").hidden = mp.isHost;
  $("#lobbyStatus").textContent = "รอโฮสต์เลือกหมวดเพลง...";
  if (mp.isHost) renderCategories($("#lobbyCategoryGrid"), hostStart);
  renderPlayers();
  showScreen("lobby");
}

function renderPlayers() {
  const list = $("#playerList");
  if (!list) return;
  list.innerHTML = "";
  const ids = Object.keys(mp.players);
  for (const id of ids) {
    const p = mp.players[id];
    const li = document.createElement("li");
    li.className = "player-chip" + (id === mp.playerId ? " me" : "");
    li.textContent = (p.host ? "👑 " : "") + p.name + (id === mp.playerId ? " (คุณ)" : "");
    list.appendChild(li);
  }
  $("#playerCount").textContent = `${ids.length} คน`;
}

function onLobby({ phase, label }) {
  if (mp.isHost) return;
  if (phase === "lobby") {
    if (mp.phase !== "lobby" || !$("#screen-lobby").classList.contains("active")) showLobby();
  } else if (phase === "loading") {
    $("#lobbyStatus").textContent = `โฮสต์เลือก ${label} · กำลังโหลดเพลง...`;
  } else if (phase === "playing" && mp.phase === "lobby") {
    $("#lobbyStatus").textContent = "ห้องนี้กำลังเล่นอยู่ · รอเกมถัดไปนะ";
  }
}

// ---------- game flow (โฮสต์) ----------

async function hostStart(source) {
  state.source = source;
  mp.phase = "loading";
  mpSend("lobby", { phase: "loading", label: source.label });
  const loaded = await loadRounds(source, state.mode);
  if (!mp.channel) return; // ออกจากห้องระหว่างโหลด
  if (!loaded) {
    showLobby();
    mpSend("lobby", { phase: "lobby" });
    return;
  }
  mp.phase = "playing";
  mpSend("start", { rounds: loaded.rounds, mode: loaded.mode, label: source.label });
  mpLater(() => hostStartRound(0), MP_START_DELAY);
}

function hostStartRound(index) {
  if (!mp.channel) return;
  mp.roundIndex = index;
  mpSend("round", { index });
  const songWait = ROUND_SECONDS * 1000 + MP_GRACE_MS;
  mpLater(() => hostReveal(index), songWait);
}

function hostCheckAllAnswered(index) {
  if (index < 0 || mp.revealed[index]) return;
  const answered = mp.answers[index] || new Set();
  const waiting = Object.keys(mp.players).filter(id => mp.totals[id] && !answered.has(id));
  if (waiting.length === 0) hostReveal(index);
}

function hostReveal(index) {
  if (!mp.channel || mp.revealed[index] || index !== mp.roundIndex) return;
  mp.revealed[index] = true;
  mpSend("reveal", { index });
  mpLater(() => {
    if (index + 1 < state.rounds.length) hostStartRound(index + 1);
    else mpSend("end");
  }, REVEAL_MS + 1000);
}

// ---------- game flow (ทุกคน) ----------

function onStart({ rounds, mode, label }) {
  mp.phase = "playing";
  mp.answers = {};
  mp.revealed = {};
  mp.roundIndex = -1;
  mp.totals = {};
  for (const [id, p] of Object.entries(mp.players)) mp.totals[id] = { name: p.name, score: 0, correct: 0 };
  state.multi = true;
  beginRounds(rounds, mode, label, { autoplay: false });
  $("#liveBoard").hidden = false;
  renderLiveBoard();
}

function onRound({ index }) {
  if (mp.phase !== "playing" || !mp.totals[mp.playerId]) return; // เข้ามากลางเกม รอเกมถัดไป
  mp.roundIndex = index;
  state.index = index;
  playRound();
  renderLiveBoard();
}

function mpSendAnswer(index, points) {
  mpSend("answer", { index, id: mp.playerId, name: mp.name, points });
}

function onAnswer({ index, id, name, points }) {
  const answered = (mp.answers[index] ||= new Set());
  if (answered.has(id)) return;
  answered.add(id);
  const t = (mp.totals[id] ||= { name, score: 0, correct: 0 });
  t.score += points;
  if (points > 0) t.correct++;
  renderLiveBoard();
  if (mp.isHost) hostCheckAllAnswered(index);
}

function onReveal({ index }) {
  if (mp.phase !== "playing" || index !== state.index || !state.rounds.length) return;
  if (!state.answered) recordAnswer(null);
  mp.revealed[index] = true;
  revealRound();
  renderLiveBoard();
}

function onEnd() {
  if (mp.phase !== "playing") return;
  mp.phase = "done";
  stopGame();
  $("#liveBoard").hidden = true;
  showMpResult();
}

function rankedPlayers() {
  return Object.entries(mp.totals)
    .map(([id, t]) => ({ id, ...t }))
    .sort((a, b) => b.score - a.score);
}

function renderLiveBoard() {
  const board = $("#liveBoard");
  if (!board || !state.multi || mp.phase !== "playing") return;
  board.innerHTML = "";
  const answered = mp.answers[state.index] || new Set();
  rankedPlayers().forEach((p, i) => {
    const li = document.createElement("li");
    li.className = "live-row" + (p.id === mp.playerId ? " me" : "") + (mp.players[p.id] ? "" : " gone");
    li.innerHTML = `<span class="live-rank">${i + 1}</span><span class="live-name"></span><span class="live-done"></span><span class="live-score"></span>`;
    li.querySelector(".live-name").textContent = p.name;
    li.querySelector(".live-done").textContent = answered.has(p.id) ? "✓" : "";
    li.querySelector(".live-score").textContent = p.score.toLocaleString();
    board.appendChild(li);
  });
}

function showMpResult() {
  const ranked = rankedPlayers();
  const medals = ["🥇", "🥈", "🥉"];
  const list = $("#rankList");
  list.innerHTML = "";
  ranked.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = "rank-row" + (p.id === mp.playerId ? " me" : "");
    li.innerHTML = `<span class="rank-pos">${medals[i] || i + 1}</span><span class="rank-name"></span><span class="rank-correct"></span><span class="rank-score"></span>`;
    li.querySelector(".rank-name").textContent = p.name + (p.id === mp.playerId ? " (คุณ)" : "");
    li.querySelector(".rank-correct").textContent = `ถูก ${p.correct}/${state.rounds.length}`;
    li.querySelector(".rank-score").textContent = p.score.toLocaleString();
    list.appendChild(li);
  });
  const myRank = ranked.findIndex(p => p.id === mp.playerId) + 1;
  $("#mpResultTitle").textContent = myRank === 1 ? "🎉 คุณชนะ!" : myRank ? `คุณได้อันดับ ${myRank}` : "จบเกม";
  $("#mpAgainBtn").hidden = !mp.isHost;
  $("#mpWaitText").hidden = mp.isHost;
  renderSongList($("#mpSongList"));
  showScreen("mpresult");
}

// ---------- home: สร้าง/เข้าห้อง ----------

function readName() {
  const input = $("#mpName");
  const name = input.value.trim().slice(0, 20);
  if (!name) { input.focus(); input.classList.add("shake"); setTimeout(() => input.classList.remove("shake"), 400); return null; }
  try { localStorage.setItem("mp:name", name); } catch { /* ignore */ }
  return name;
}

async function enterRoom(code, asHost) {
  if (!mpConfigured()) {
    alert("ยังไม่ได้ตั้งค่า Supabase (ดูไฟล์ config.js)");
    return;
  }
  const name = readName();
  if (!name) return;
  ensureAudio();
  mp.name = name;
  showScreen("loading");
  $("#loadingText").textContent = asHost ? "กำลังสร้างห้อง..." : `กำลังเข้าห้อง ${code}...`;
  try {
    await mpConnect(code, asHost);
  } catch (e) {
    console.warn(e);
    mpLeave();
    alert("เชื่อมต่อห้องไม่สำเร็จ ลองใหม่อีกครั้ง");
    showScreen("home");
    return;
  }
  if (!asHost) {
    // รอ presence สักครู่ ถ้าไม่เจอโฮสต์แปลว่าไม่มีห้องนี้
    for (let i = 0; i < 25 && !mp.hostId; i++) await new Promise(r => setTimeout(r, 100));
    if (!mp.hostId) {
      mpLeave();
      alert(`ไม่พบห้อง ${code}`);
      showScreen("home");
      return;
    }
  }
  try { history.replaceState(null, "", "?room=" + code); } catch { /* ignore */ }
  showLobby();
}

$("#createRoomBtn").addEventListener("click", () => enterRoom(makeRoomCode(), true));

$("#joinForm").addEventListener("submit", e => {
  e.preventDefault();
  const code = $("#roomCodeInput").value.trim().toUpperCase();
  if (code.length < 4) { $("#roomCodeInput").focus(); return; }
  enterRoom(code, false);
});

$("#lobbyCustomForm").addEventListener("submit", e => {
  e.preventDefault();
  const source = parseCustom($("#lobbyCustomInput"));
  if (!source) return;
  hostStart(source);
});

$("#copyLinkBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomLink());
    $("#copyLinkBtn").textContent = "คัดลอกแล้ว ✓";
  } catch {
    prompt("คัดลอกลิงก์นี้ส่งให้เพื่อน", roomLink());
  }
  setTimeout(() => ($("#copyLinkBtn").textContent = "คัดลอกลิงก์ชวนเพื่อน"), 2000);
});

$("#leaveRoomBtn").addEventListener("click", goHome);
$("#mpLeaveBtn").addEventListener("click", goHome);
$("#mpAgainBtn").addEventListener("click", () => {
  showLobby();
  mpSend("lobby", { phase: "lobby" });
});

// ใส่ชื่อเดิมและรหัสห้องจากลิงก์ให้อัตโนมัติ
(function initMultiplayer() {
  try { $("#mpName").value = localStorage.getItem("mp:name") || ""; } catch { /* ignore */ }
  const code = new URLSearchParams(location.search).get("room");
  if (code) {
    $("#roomCodeInput").value = code.toUpperCase();
    $("#mpSection").classList.add("highlight");
    $("#mpSection").scrollIntoView({ block: "center" });
    if (!$("#mpName").value) $("#mpName").focus();
  }
  if (!mpConfigured()) $("#mpSection").classList.add("disabled");
})();
