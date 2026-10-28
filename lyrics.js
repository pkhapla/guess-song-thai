"use strict";

// โหมดต่อเนื้อเพลง: เห็นท่อนหนึ่ง แข่งกันพิมพ์ท่อนต่อไปให้ถูกทุกคำ คนแรกที่ถูกครบได้ 1 คะแนน
// คำที่ใครพิมพ์ถูกจะเปิดให้ทุกคนเห็น ตัวช่วยทำงานเมื่อโหวตถึงครึ่งหนึ่ง (ยอมแพ้ต้องครบทุกคน)
//
// ใช้กติกาชุดเดียวกันทั้งเล่นคนเดียวและเล่นในห้อง: lySend() ส่ง event ไปที่ onLyricsEvent()
// เล่นคนเดียวเรียกตรงๆ เล่นในห้องส่งผ่าน broadcast "ly" ส่วนการตรวจคำตอบ/นับโหวตทำที่โฮสต์คนเดียว

const LY_LIVE_LOOKUPS = 60; // ศิลปินที่พิมพ์เอง: ค้นเนื้อสดได้ไม่เกินกี่เพลงต่อเกม (กัน LRCLIB rate limit)
const LY_HINTS = ["word", "title", "giveup"];
const LY_REVEAL_MS = 6000; // เล่นในห้อง: เวลาอ่านเฉลยก่อนข้อถัดไป

// ---------- โหลดโจทย์ ----------

function indexSongs(source) {
  const songs = [];
  for (const term of source.artists) {
    for (const [lrc, id, title, artist, year, art, url, hot] of LYRICS_INDEX[term] || []) {
      songs.push({ lrc, id, title, key: titleKey(title), artist, year, art, url, hot: !!hot });
    }
  }
  const [from, to] = source.years || [0, 9999];
  const seen = new Set();
  return songs.filter(s => {
    if (seen.has(s.key) || (source.years && !(s.year >= from && s.year <= to))) return false;
    seen.add(s.key);
    return true;
  });
}

function lyricsSongCount(source) {
  return indexSongs(source).length;
}

// LRCLIB จำกัดความถี่หรือเน็ตมีปัญหา: เลิกหาทันที (ลองเพลงถัดไปก็โดนเหมือนกัน) แล้วบอกผู้เล่นตรงๆ
let lrclibBusy = false;

async function lrclibGet(url) {
  if (lrclibBusy) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch { /* ลองใหม่ */ }
    if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
  }
  lrclibBusy = true;
  return null;
}

async function fetchLyricsById(id) {
  const key = "lyr:" + id;
  try { const hit = localStorage.getItem(key); if (hit) return hit; } catch { /* ignore */ }
  const r = await lrclibGet(`${LRCLIB}/get/${id}`);
  const text = lyricText(r);
  try { if (text) localStorage.setItem(key, text); } catch { /* ignore */ }
  return text;
}

// คืนค่า { rounds, mode } หรือ null ถ้าเนื้อเพลงไม่พอ (รูปแบบเดียวกับ loadRounds)
async function loadLyricsRounds(source) {
  showScreen("loading");
  let candidates, getText;
  if (source.custom) {
    $("#loadingText").textContent = "กำลังรวบรวมเพลง...";
    const pool = await buildPool(source.artists, (d, n) => {
      $("#loadingText").textContent = `กำลังรวบรวมเพลง... (${d}/${n})`;
    });
    candidates = pickRounds(pool, LY_LIVE_LOOKUPS);
    getText = async song => (await findLyrics(song, lrclibGet))?.text;
  } else {
    candidates = pickRounds(indexSongs(source), Infinity);
    getText = song => fetchLyricsById(song.lrc);
  }

  const rounds = [];
  let checked = 0;
  lrclibBusy = false;
  $("#loadingText").textContent = "กำลังหาเนื้อเพลง...";
  async function worker() {
    while (candidates.length && rounds.length < ROUNDS && !lrclibBusy) {
      const song = candidates.shift();
      const pairs = lyricPairs(lyricLines(await getText(song).catch(() => "")));
      checked++;
      if (pairs.length && rounds.length < ROUNDS) {
        rounds.push({ song, choices: [], ...pairs[Math.floor(Math.random() * pairs.length)] });
      }
      $("#loadingText").textContent = `กำลังหาเนื้อเพลง... (${rounds.length}/${ROUNDS}${source.custom ? ` · ค้นแล้ว ${checked} เพลง` : ""})`;
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  if (rounds.length < ROUNDS) {
    alert(lrclibBusy
      ? "เว็บเนื้อเพลง (LRCLIB) ไม่ตอบหรือเรียกถี่เกินไป รอสักครู่แล้วลองใหม่นะ"
      : rounds.length === 0 ? "หาเนื้อเพลงไม่เจอเลย ลองหมวดหรือศิลปินอื่นนะ"
      : `เจอเนื้อเพลงแค่ ${rounds.length} เพลง ไม่พอเล่น ${ROUNDS} ข้อ ลองหมวดอื่นหรือเพิ่มศิลปิน`);
    return null;
  }
  return { rounds: shuffle(rounds), mode: "lyrics" };
}

// ---------- เล่นแต่ละข้อ ----------

const lyIsHost = () => !state.multi || mp.isHost;
const lyMyName = () => mp.name || "คุณ";

// ผู้เล่นที่นับโหวต: คนที่อยู่ในห้องและเล่นเกมนี้มาตั้งแต่ต้น
function lyActivePlayers() {
  if (!state.multi) return [mp.playerId];
  return Object.keys(mp.players).filter(id => mp.totals[id]);
}

function lyNeeded(hint) {
  const n = lyActivePlayers().length;
  return hint === "giveup" ? n : Math.ceil(n / 2);
}

function lyVoteCount(hint) {
  const active = new Set(lyActivePlayers());
  return [...state.ly.votes[hint]].filter(id => active.has(id)).length;
}

function playLyricsRound() {
  const round = state.rounds[state.index];
  state.answered = false;
  state.ly = {
    open: new Set(),
    votes: { word: new Set(), title: new Set(), giveup: new Set() },
    titleShown: false,
    feed: [],
  };

  $("#roundLabel").textContent = `ข้อ ${state.index + 1}/${state.rounds.length}`;
  $("#questionText").textContent = "ร้องต่อท่อนนี้ให้ถูกทุกคำ";
  $("#revealText").textContent = "";
  $("#nextBtn").hidden = true;
  const disc = $("#disc");
  disc.classList.remove("revealed", "spin");
  $("#artwork").src = round.song.art;

  const prompt = $("#lyPrompt");
  prompt.innerHTML = "";
  for (const line of round.prompt) {
    const p = document.createElement("p");
    p.textContent = line;
    prompt.appendChild(p);
  }
  const input = $("#lyInput");
  input.value = "";
  input.disabled = false;
  $("#lyForm button").disabled = false;
  $("#lySkipBtn").hidden = !(state.multi && mp.isHost);
  renderLySlots();
  renderLyFeed();
  renderLyHints();
  input.focus();
}

function renderLySlots(fresh = [], missed = false) {
  const round = state.rounds[state.index];
  const box = $("#lySlots");
  box.innerHTML = "";
  round.words.forEach((w, i) => {
    const el = document.createElement("span");
    const open = state.ly.open.has(i);
    el.className = "ly-word" + (open ? " open" : missed ? " missed" : "") + (fresh.includes(i) ? " new" : "");
    el.textContent = open || missed ? w : "";
    box.appendChild(el);
  });
}

function renderLyFeed() {
  const list = $("#lyFeed");
  list.innerHTML = "";
  for (const text of state.ly.feed) {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  }
}

function lyLog(text) {
  state.ly.feed = [text, ...state.ly.feed].slice(0, 3);
  renderLyFeed();
}

function renderLyHints() {
  document.querySelectorAll(".ly-hint").forEach(b => {
    const hint = b.dataset.hint;
    const used = (hint === "title" && state.ly.titleShown) ||
      (hint === "word" && state.ly.open.size === state.rounds[state.index].words.length);
    b.disabled = state.answered || used;
    b.classList.toggle("voted", state.ly.votes[hint].has(mp.playerId));
    b.querySelector(".ly-votes").textContent = state.multi && !used ? `${lyVoteCount(hint)}/${lyNeeded(hint)}` : "";
  });
}

function showSongHint() {
  const { song } = state.rounds[state.index];
  $("#disc").classList.add("revealed");
  $("#revealText").textContent = `🎵 ${song.title} — ${song.artist}`;
}

// ---------- ส่ง/รับ event ----------

function lySend(payload) {
  payload = { index: state.index, ...payload };
  if (state.multi) mpSend("ly", payload);
  else onLyricsEvent(payload);
}

function onLyricsEvent(e) {
  if (state.playMode !== "lyrics" || !state.ly || e.index !== state.index || state.answered) return;
  if (e.type === "guess") { if (lyIsHost()) hostLyricsGuess(e); }
  else if (e.type === "progress") applyProgress(e);
  else if (e.type === "vote") applyVote(e);
  else if (e.type === "hint") applyHint(e);
}

// โฮสต์ตรวจคำตอบ: ถูกครบ = จบข้อ ไม่งั้นบอกทุกคนว่าเปิดคำไหนได้บ้าง
function hostLyricsGuess({ id, name, text }) {
  const round = state.rounds[state.index];
  if (compactLyric(text) === compactLyric(round.answer)) {
    lyFinish({ winner: id, name, reason: "win" });
    return;
  }
  const matched = matchWords(round.words, text);
  lySend({ type: "progress", id, name, words: matched, total: matched.length });
}

function applyProgress({ id, name, words, total }) {
  const fresh = words.filter(i => !state.ly.open.has(i));
  fresh.forEach(i => state.ly.open.add(i));
  renderLySlots(fresh);
  const who = id === mp.playerId ? "คุณ" : name;
  const all = state.rounds[state.index].words.length;
  lyLog(fresh.length ? `🔓 ${who} เปิดได้ ${fresh.length} คำ (ถูก ${total}/${all})`
    : `${who} ถูก ${total}/${all} คำ · ไม่มีคำใหม่`);
}

function applyVote({ id, name, hint, on }) {
  const votes = state.ly.votes[hint];
  if (!votes || on === votes.has(id)) return;
  on ? votes.add(id) : votes.delete(id);
  if (on && state.multi) {
    const label = { word: "เฉลย 1 คำ", title: "เฉลยชื่อเพลง", giveup: "ยอมแพ้" }[hint];
    lyLog(`🙋 ${id === mp.playerId ? "คุณ" : name} โหวต${label}`);
  }
  renderLyHints();
  lyCheckVotes();
}

// โฮสต์: โหวตถึงเกณฑ์แล้วใช้ตัวช่วยทันที (เรียกซ้ำตอนมีคนเข้า/ออกห้องด้วย เพราะเกณฑ์เปลี่ยน)
function lyCheckVotes() {
  if (!lyIsHost() || !state.ly || state.answered) return;
  if (lyVoteCount("giveup") >= lyNeeded("giveup")) {
    lyFinish({ reason: "giveup" });
    return;
  }
  if (!state.ly.titleShown && lyVoteCount("title") >= lyNeeded("title")) {
    state.ly.titleShown = true; // กันส่งซ้ำก่อน event กลับมา
    lySend({ type: "hint", hint: "title" });
  }
  if (state.ly.votes.word.size && lyVoteCount("word") >= lyNeeded("word")) {
    // สุ่มเปิดคำที่ยังไม่มีใครเปิด (โฮสต์สุ่มแล้วส่ง index ไป ทุกเครื่องจึงได้คำเดียวกัน)
    const closed = state.rounds[state.index].words.map((_, i) => i).filter(i => !state.ly.open.has(i));
    state.ly.votes.word.clear();
    if (closed.length) lySend({ type: "hint", hint: "word", word: sample(closed, 1)[0] });
  }
}

function applyHint({ hint, word }) {
  if (hint === "title") {
    state.ly.titleShown = true;
    state.ly.votes.title.clear();
    showSongHint();
    lyLog("🎵 เปิดชื่อเพลงและนักร้องแล้ว");
  } else if (hint === "word") {
    state.ly.votes.word.clear();
    state.ly.open.add(word);
    renderLySlots([word]);
    lyLog("💡 เฉลยให้ 1 คำ");
  }
  renderLyHints();
}

// ---------- จบข้อ ----------

function lyFinish(result) {
  if (state.multi) hostReveal(state.index, result);
  else {
    lyricsReveal({ index: state.index, ...result });
    $("#nextBtn").hidden = false;
    $("#nextBtn").textContent = state.index + 1 < state.rounds.length ? "ข้อต่อไป →" : "ดูผลคะแนน →";
  }
}

// เรียกจาก onReveal (เล่นในห้อง) หรือ lyFinish (เล่นคนเดียว) ผลเหมือนกันทุกเครื่อง
function lyricsReveal({ index, winner, name, reason }) {
  if (index !== state.index || !state.ly) return;
  const round = state.rounds[index];
  state.answered = true;
  round.points = winner === mp.playerId ? 1 : 0;
  state.score += round.points;

  $("#lyInput").disabled = true;
  $("#lyForm button").disabled = true;
  $("#lySkipBtn").hidden = true;
  renderLySlots([], true);
  renderLyHints();
  $("#disc").classList.add("revealed");
  $("#scoreLabel").textContent = state.score.toLocaleString();

  const label = reason === "win"
    ? (winner === mp.playerId ? "🎉 คุณร้องถูก! +1" : `🏆 ${name} ร้องถูก`)
    : reason === "giveup" ? "🏳️ ยอมแพ้" : "⏭ โฮสต์ข้ามข้อนี้";
  const reveal = $("#revealText");
  reveal.innerHTML = "";
  if (reason === "win" && winner === mp.playerId) {
    const pts = document.createElement("span");
    pts.className = "toast-points";
    pts.textContent = label;
    reveal.append(pts, ` · ${round.song.title} — ${round.song.artist}`);
  } else {
    reveal.append(`${label} · ${round.song.title} — ${round.song.artist}`);
  }
}

// ---------- ปุ่ม ----------

$("#lyForm").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("#lyInput").value.trim();
  if (!text || state.answered) return;
  lySend({ type: "guess", id: mp.playerId, name: lyMyName(), text });
});

document.querySelectorAll(".ly-hint").forEach(b => b.addEventListener("click", () => {
  if (state.answered) return;
  const hint = b.dataset.hint;
  if (!LY_HINTS.includes(hint)) return;
  lySend({ type: "vote", id: mp.playerId, name: lyMyName(), hint, on: !state.ly.votes[hint].has(mp.playerId) });
}));

$("#lySkipBtn").addEventListener("click", () => {
  if (!state.multi || !mp.isHost || state.answered) return;
  lyFinish({ reason: "skip" });
});
