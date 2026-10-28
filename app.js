"use strict";

const ROUNDS = 10;
const ROUND_SECONDS = 15;
const REVEAL_MS = 2600;
const ARTISTS_PER_GAME = 8; // จำกัดจำนวนศิลปินที่ดึงต่อเกม เพื่อไม่ให้โดน iTunes rate limit
const BAD_WORDS = /karaoke|instrumental|backing track|minus one|cover|คาราโอเกะ|ดนตรี/i;
// เวอร์ชันพิเศษของเพลงเดิม (ข้ามไป ใช้ต้นฉบับแทน)
const VERSION_WORDS = /[\(\[-][^\)\]]*\b(live|acoustic|remix|version|ver\.?|sped up|slowed|remaster(ed)?|demo|unplugged|orchestra|piano)\b/i;

// ---------- iTunes fetch layer ----------

const memoryCache = {};

function storageGet(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}
function storageSet(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function cleanTitle(title) {
  return title
    .replace(/\s*[\(\[](feat\.?|ft\.?|featuring|from|prod\.?)[^\)\]]*[\)\]]/gi, "")
    .replace(/\s+-\s+single$/i, "")
    .trim();
}

function titleKey(title) {
  // ตัดวงเล็บออกทั้งหมด เช่น "นอนได้แล้ว (Sleep Now)" กับ "นอนได้แล้ว" ถือเป็นเพลงเดียวกัน
  return cleanTitle(title).replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").toLowerCase().replace(/[\s'".,!?-]/g, "");
}

// ดึงเพลงของศิลปินหนึ่งคน คืนค่า { name, tracks[] }
async function fetchArtist(term) {
  const cacheKey = "artist:" + term.toLowerCase();
  if (memoryCache[cacheKey]) return memoryCache[cacheKey];
  const stored = storageGet(cacheKey);
  if (stored) return (memoryCache[cacheKey] = stored);

  const url = "https://itunes.apple.com/search?" + new URLSearchParams({
    term, country: "th", media: "music", entity: "song", attribute: "artistTerm", limit: "60",
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error("iTunes " + res.status);
  const data = await res.json();

  const results = data.results.filter(t =>
    t.kind === "song" && t.previewUrl && !BAD_WORDS.test(t.trackName) && !BAD_WORDS.test(t.collectionName || "") &&
    !VERSION_WORDS.test(t.trackName));

  // หาชื่อศิลปินหลัก: ถ้าคำค้นตรงกับชื่อศิลปินก็ใช้ ถ้าไม่ (เช่นค้นเป็นภาษาไทย) ใช้ศิลปินเดี่ยวที่เจอบ่อยสุด
  const q = term.toLowerCase();
  const solo = results.filter(t => !/[&,]/.test(t.artistName));
  const counts = {};
  for (const t of solo) counts[t.artistName] = (counts[t.artistName] || 0) + 1;
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const exact = results.find(t => t.artistName.toLowerCase() === q); // เช่น "Whal & Dolph" ที่มี & ในชื่อวง
  const name = exact ? exact.artistName : ranked.find(n => n.toLowerCase().includes(q)) || ranked[0];
  if (!name) return (memoryCache[cacheKey] = { name: term, tracks: [] });

  const lowerName = name.toLowerCase();
  const seen = new Set();
  const tracks = [];
  for (const t of results) {
    if (!t.artistName.toLowerCase().includes(lowerName)) continue;
    const key = titleKey(t.trackName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tracks.push({
      id: t.trackId,
      title: cleanTitle(t.trackName),
      key,
      artist: name,
      art: (t.artworkUrl100 || "").replace("100x100", "400x400"),
      preview: t.previewUrl,
      url: t.trackViewUrl,
    });
  }
  const out = { name, tracks };
  storageSet(cacheKey, out);
  return (memoryCache[cacheKey] = out);
}

// ดึงหลายศิลปินแบบขนานทีละ 4
// ตัดเพลงซ้ำข้ามศิลปินด้วย (เพลงที่ร้องร่วมกันจะโผล่ในผลค้นหาของทั้งสองคน หรือชื่อเพลงชนกัน)
// เพื่อไม่ให้ 1 เกมมีเพลงซ้ำ และตัวเลือกชื่อเพลงไม่ซ้ำกันเอง
async function buildPool(artists, onProgress) {
  const all = [];
  const seenKeys = new Set();
  let done = 0;
  const queue = [...new Map(artists.map(a => [a.trim().toLowerCase(), a])).values()];
  const total = queue.length;
  async function worker() {
    while (queue.length) {
      const a = queue.shift();
      try {
        const r = await fetchArtist(a);
        for (const t of r.tracks) {
          if (seenKeys.has(t.key)) continue;
          seenKeys.add(t.key);
          all.push(t);
        }
      } catch (e) {
        console.warn("fetch failed", a, e);
      }
      onProgress && onProgress(++done, total);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return all;
}

// ---------- helpers ----------

const $ = sel => document.querySelector(sel);
const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const sample = (arr, n) => shuffle(arr).slice(0, n);

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === "screen-" + id));
  window.scrollTo({ top: 0 });
}

function bestKey(source, mode) { return `best:${source}:${mode}`; }
function getBest(source, mode) {
  try { return Number(localStorage.getItem(bestKey(source, mode))) || 0; } catch { return 0; }
}
function setBest(source, mode, score) {
  try { localStorage.setItem(bestKey(source, mode), String(score)); } catch { /* ignore */ }
}

// ---------- state ----------

const state = {
  mode: "title",       // โหมดที่เลือกไว้: "title" | "artist"
  playMode: "title",   // โหมดที่ใช้จริงในเกมนี้
  source: null,        // { id, label, artists[] }
  rounds: [],
  index: 0,
  score: 0,
  streak: 0,
  answered: false,
  timerStart: 0,
  rafId: 0,
  revealTimer: 0,
  onPlaying: null,
  multi: false,        // true เมื่อเล่นในห้องกับเพื่อน (ควบคุมโดย multiplayer.js)
};

let audio = null; // ใช้ element เดียวตลอดเกม (กัน autoplay block บนมือถือ)
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

// ต้องเรียกภายใน user gesture (คลิก) เพื่อ "ปลดล็อก" เสียง
function ensureAudio() {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  if (!audio.src || audio.src === SILENT_WAV) {
    audio.src = SILENT_WAV;
    audio.play().catch(() => {});
  }
}

// ---------- home ----------

function categorySource(c) {
  return { id: c.id, label: `${c.emoji} ${c.name}`, artists: c.artists };
}

// onRandom: ถ้าไม่ส่งมา จะสุ่มหมวดแล้วเล่นคนเดียว (ห้องเล่นกับเพื่อนส่งของตัวเองมาเพื่อให้ทุกคนเห็นการสุ่ม)
function renderCategories(grid = $("#categoryGrid"), onPick = source => startGame(source), onRandom) {
  grid.innerHTML = "";
  const rnd = document.createElement("button");
  rnd.className = "cat-card cat-random";
  rnd.style.setProperty("--c", "#ff4d8d");
  rnd.innerHTML = `
      <span class="cat-emoji">🎲</span>
      <span class="cat-name">สุ่มหมวด</span>
      <span class="cat-desc">ให้ดวงเลือกหมวดให้ ลุ้นไปด้วยกัน</span>`;
  rnd.addEventListener("click", async () => {
    if (spinning) return;
    ensureAudio();
    const target = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    if (onRandom) { onRandom(target); return; }
    await spinCategory(target.id);
    onPick(categorySource(target));
  });
  grid.appendChild(rnd);

  for (const c of CATEGORIES) {
    const btn = document.createElement("button");
    btn.className = "cat-card";
    btn.style.setProperty("--c", c.color);
    const best = getBest(c.id, state.mode);
    btn.innerHTML = `
      <span class="cat-emoji">${c.emoji}</span>
      <span class="cat-name"></span>
      <span class="cat-desc"></span>
      ${best ? `<span class="cat-best">🏆 สถิติ ${best.toLocaleString()}</span>` : ""}`;
    btn.querySelector(".cat-name").textContent = c.name;
    btn.querySelector(".cat-desc").textContent = c.desc;
    btn.addEventListener("click", () => {
      ensureAudio();
      onPick(categorySource(c));
    });
    grid.appendChild(btn);
  }
}

// ---------- สุ่มหมวด ----------

let spinning = false;
const SPIN_LAPS = 3;

// เล่นแอนิเมชันวงล้อวิ่งผ่านทุกหมวดแล้วหยุดที่ targetId
// ลำดับและจังหวะขึ้นกับ targetId อย่างเดียว ทุกเครื่องในห้องจึงเห็นเหมือนกัน
function spinCategory(targetId) {
  const target = CATEGORIES.findIndex(c => c.id === targetId);
  if (target < 0) return Promise.resolve();
  spinning = true;

  const grid = $("#spinGrid");
  grid.innerHTML = "";
  const chips = CATEGORIES.map(c => {
    const el = document.createElement("div");
    el.className = "spin-chip";
    el.style.setProperty("--c", c.color);
    el.innerHTML = `<span class="cat-emoji">${c.emoji}</span><span class="spin-name"></span>`;
    el.querySelector(".spin-name").textContent = c.name;
    grid.appendChild(el);
    return el;
  });
  $("#spinTitle").textContent = "🎲 กำลังสุ่มหมวด...";
  $("#spinResult").textContent = "";
  showScreen("spin");

  const steps = SPIN_LAPS * CATEGORIES.length + target;
  return new Promise(resolve => {
    let i = 0;
    const tick = () => {
      chips.forEach((el, k) => el.classList.toggle("hit", k === i % chips.length));
      if (i === steps) {
        const c = CATEGORIES[target];
        chips[target].classList.add("win");
        grid.classList.add("done");
        $("#spinTitle").textContent = "🎉 ได้หมวดนี้!";
        $("#spinResult").textContent = `${c.emoji} ${c.name}`;
        setTimeout(() => { grid.classList.remove("done"); spinning = false; resolve(); }, 1400);
        return;
      }
      i++;
      // เริ่มเร็วแล้วค่อยๆ ช้าลงตอนใกล้หยุด
      const t = i / steps;
      setTimeout(tick, 55 + 420 * t ** 3);
    };
    tick();
  });
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-btn").forEach(b => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", String(on));
  });
  renderCategories();
}

document.querySelectorAll(".mode-btn").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));

function parseCustom(input) {
  const artists = input.value.split(",").map(s => s.trim()).filter(Boolean);
  if (!artists.length) { input.focus(); return null; }
  return { id: "custom:" + artists.map(a => a.toLowerCase()).sort().join("|"), label: "🎧 " + artists.join(", "), artists, custom: true };
}

$("#customForm").addEventListener("submit", e => {
  e.preventDefault();
  const source = parseCustom($("#customInput"));
  if (!source) return;
  ensureAudio();
  startGame(source);
});

// ---------- game setup ----------

function pickRounds(pool) {
  // เลือกเพลงให้หลากหลาย: ศิลปินละไม่เกิน 2 เพลง (ถ้าทำได้)
  const artists = new Set(pool.map(t => t.artist));
  const maxPer = artists.size >= 5 ? 2 : ROUNDS;
  const picked = [];
  const count = {};
  for (const t of shuffle(pool)) {
    if (picked.length >= ROUNDS) break;
    if ((count[t.artist] || 0) >= maxPer) continue;
    count[t.artist] = (count[t.artist] || 0) + 1;
    picked.push(t);
  }
  return picked;
}

function makeChoices(song, pool, mode) {
  if (mode === "artist") {
    const others = [...new Set(pool.map(t => t.artist))].filter(a => a !== song.artist);
    return shuffle([song.artist, ...sample(others, 3)]);
  }
  // ทายชื่อเพลง: ใส่เพลงของศิลปินเดียวกันปน 1 ตัวเลือกให้ยากขึ้น
  const others = pool.filter(t => t.key !== song.key);
  const same = sample(others.filter(t => t.artist === song.artist), 1);
  const rest = sample(others.filter(t => !same.includes(t)), 3 - same.length);
  const titles = [...same, ...rest].map(t => t.title);
  return shuffle([song.title, ...new Set(titles)].slice(0, 4));
}

// ดึงเพลงและสร้างโจทย์ 10 ข้อ คืนค่า { rounds, mode } หรือ null ถ้าเพลงไม่พอ
async function loadRounds(source, wantedMode) {
  showScreen("loading");
  $("#loadingText").textContent = "กำลังรวบรวมเพลง...";

  const artists = source.artists.length > ARTISTS_PER_GAME ? sample(source.artists, ARTISTS_PER_GAME) : source.artists;
  const pool = await buildPool(artists, (d, n) => {
    $("#loadingText").textContent = `กำลังรวบรวมเพลง... (${d}/${n})`;
  });
  const uniqueArtists = new Set(pool.map(t => t.artist)).size;

  let mode = wantedMode;
  if (mode === "artist" && uniqueArtists < 4) {
    if (source.custom) alert("โหมดทายศิลปินต้องมีอย่างน้อย 4 ศิลปิน — จะสลับเป็นโหมดทายชื่อเพลงให้นะ");
    mode = "title";
  }
  if (pool.length < ROUNDS + 3) {
    alert(pool.length === 0
      ? "หาเพลงไม่เจอ ลองพิมพ์ชื่อศิลปินเป็นภาษาอังกฤษ เช่น Bodyslam, Palmy หรือรอสักครู่แล้วลองใหม่"
      : `เจอเพลงแค่ ${pool.length} เพลง ไม่พอเล่น 10 ข้อ ลองเพิ่มศิลปินอีกคน`);
    return null;
  }
  const rounds = pickRounds(pool).map(song => ({ song, choices: makeChoices(song, pool, mode) }));
  return { rounds, mode };
}

// เริ่มเกมจากโจทย์ที่มีอยู่แล้ว (ใช้ทั้งเล่นคนเดียวและเล่นในห้อง)
function beginRounds(rounds, mode, label, { autoplay = true } = {}) {
  state.rounds = rounds.map(r => ({ ...r, picked: null, points: 0 }));
  state.playMode = mode;
  state.index = 0;
  state.score = 0;
  state.streak = 0;
  state.answered = true;
  $("#categoryLabel").textContent = label;
  $("#scoreLabel").textContent = "0";
  $("#choices").innerHTML = "";
  $("#revealText").textContent = state.multi ? "เตรียมตัว..." : "";
  showScreen("game");
  if (autoplay) playRound();
}

async function startGame(source) {
  state.multi = false;
  state.source = source;
  const loaded = await loadRounds(source, state.mode);
  if (!loaded) { showScreen("home"); return; }
  beginRounds(loaded.rounds, loaded.mode, source.label);
}

// ---------- game loop ----------

function playRound() {
  const round = state.rounds[state.index];
  const { song } = round;
  state.answered = false;
  clearTimeout(state.revealTimer);

  $("#roundLabel").textContent = `ข้อ ${state.index + 1}/${state.rounds.length}`;
  $("#questionText").textContent = state.playMode === "artist" ? "ใครร้องเพลงนี้?" : "เพลงนี้ชื่ออะไร?";
  $("#revealText").textContent = "กำลังโหลดเพลง...";
  $("#nextBtn").hidden = true;

  const disc = $("#disc");
  disc.classList.remove("revealed", "spin");
  $("#artwork").src = song.art;
  setTimerBar(1);

  const box = $("#choices");
  box.innerHTML = "";
  round.choices.forEach((text, i) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.innerHTML = `<span class="key">${i + 1}</span>`;
    b.append(text);
    b.dataset.value = text;
    b.disabled = true;
    b.addEventListener("click", () => answer(text));
    box.appendChild(b);
  });

  // เริ่มจับเวลาเมื่อเพลงเริ่มเล่นจริง
  if (state.onPlaying) audio.removeEventListener("playing", state.onPlaying);
  audio.src = song.preview;
  audio.currentTime = 0;
  const onPlaying = state.onPlaying = () => {
    if (state.answered) return;
    $("#revealText").textContent = "";
    disc.classList.add("spin");
    box.querySelectorAll(".choice").forEach(b => (b.disabled = false));
    state.timerStart = performance.now();
    tick();
  };
  audio.addEventListener("playing", onPlaying, { once: true });
  audio.play().catch(() => {
    // ถ้า browser ไม่ยอมเล่น ให้ผู้เล่นกดเล่นเอง
    audio.removeEventListener("playing", onPlaying);
    $("#revealText").innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = "▶ แตะเพื่อฟังเพลง";
    btn.onclick = () => { $("#revealText").textContent = ""; audio.addEventListener("playing", onPlaying, { once: true }); audio.play(); };
    $("#revealText").appendChild(btn);
  });
}

function setTimerBar(frac) {
  $("#timerBar").style.transform = `scaleX(${Math.max(0, frac)})`;
}

function tick() {
  cancelAnimationFrame(state.rafId);
  const loop = () => {
    if (state.answered) return;
    const elapsed = (performance.now() - state.timerStart) / 1000;
    setTimerBar(1 - elapsed / ROUND_SECONDS);
    if (elapsed >= ROUND_SECONDS) { answer(null); return; }
    state.rafId = requestAnimationFrame(loop);
  };
  state.rafId = requestAnimationFrame(loop);
}

// บันทึกคำตอบและคิดคะแนน
function recordAnswer(value) {
  state.answered = true;
  cancelAnimationFrame(state.rafId);

  const round = state.rounds[state.index];
  const correctValue = state.playMode === "artist" ? round.song.artist : round.song.title;
  const elapsed = state.timerStart ? (performance.now() - state.timerStart) / 1000 : ROUND_SECONDS;
  const ok = value === correctValue;

  round.picked = value;
  if (ok) {
    state.streak++;
    // ตอบเร็ว = คะแนนเยอะ (500–1000) + โบนัสตอบถูกติดกัน
    const speed = Math.max(0, 1 - elapsed / ROUND_SECONDS);
    round.points = Math.round(500 + 500 * speed) + Math.min(state.streak - 1, 5) * 50;
    state.score += round.points;
  } else {
    state.streak = 0;
  }
  document.querySelectorAll(".choice").forEach(b => (b.disabled = true));
  return round;
}

function answer(value) {
  if (state.answered) return;
  const round = recordAnswer(value);
  if (state.multi) {
    // เล่นในห้อง: รอทุกคนตอบก่อนค่อยเฉลย
    document.querySelectorAll(".choice").forEach(b => b.classList.toggle("selected", b.dataset.value === value));
    $("#revealText").textContent = value === null ? "⏰ หมดเวลา · รอเพื่อน..." : "ส่งคำตอบแล้ว · รอเพื่อน...";
    mpSendAnswer(state.index, round.points);
    return;
  }
  revealRound();
  $("#nextBtn").hidden = false;
  $("#nextBtn").textContent = state.index + 1 < state.rounds.length ? "ข้อต่อไป →" : "ดูผลคะแนน →";
  state.revealTimer = setTimeout(next, REVEAL_MS + 1200);
}

// เฉลยคำตอบของข้อปัจจุบัน
function revealRound() {
  const round = state.rounds[state.index];
  const value = round.picked;
  const correctValue = state.playMode === "artist" ? round.song.artist : round.song.title;
  const ok = round.points > 0;

  document.querySelectorAll(".choice").forEach(b => {
    b.disabled = true;
    b.classList.remove("selected");
    if (b.dataset.value === correctValue) b.classList.add("correct");
    else if (b.dataset.value === value) b.classList.add("wrong");
    else b.classList.add("dim");
  });

  $("#disc").classList.remove("spin");
  $("#disc").classList.add("revealed");
  $("#scoreLabel").textContent = state.score.toLocaleString();
  const label = ok
    ? `<span class="toast-points">+${round.points}${state.streak > 1 ? ` 🔥x${state.streak}` : ""}</span> · `
    : value === null ? "⏰ หมดเวลา · " : "❌ ผิด · ";
  const reveal = $("#revealText");
  reveal.innerHTML = label;
  reveal.append(`${round.song.title} — ${round.song.artist}`);
}

function next() {
  clearTimeout(state.revealTimer);
  state.index++;
  if (state.index < state.rounds.length) playRound();
  else showResult();
}

$("#nextBtn").addEventListener("click", next);

document.addEventListener("keydown", e => {
  if (!$("#screen-game").classList.contains("active")) return;
  if (e.target.tagName === "INPUT") return;
  const n = Number(e.key);
  if (n >= 1 && n <= 4 && !state.answered) {
    const b = document.querySelectorAll(".choice")[n - 1];
    if (b && !b.disabled) b.click();
  } else if ((e.key === "Enter" || e.key === " ") && state.answered && !state.multi && !$("#nextBtn").hidden) {
    e.preventDefault();
    next();
  }
});

// ---------- result ----------

function renderSongList(list) {
  list.innerHTML = "";
  for (const r of state.rounds) {
    const li = document.createElement("li");
    li.className = "song-item" + (r.points > 0 ? " ok" : "");
    li.innerHTML = `
      <img alt="" loading="lazy">
      <div class="song-meta"><b></b><span></span></div>
      <span class="song-pts">${r.points > 0 ? "+" + r.points : "0"}</span>
      <a class="song-link" target="_blank" rel="noopener">ฟังเต็ม ↗</a>`;
    li.querySelector("img").src = r.song.art;
    li.querySelector("b").textContent = r.song.title;
    li.querySelector(".song-meta span").textContent = r.song.artist;
    li.querySelector("a").href = r.song.url;
    list.appendChild(li);
  }
}

function showResult() {
  audio.pause();
  const correct = state.rounds.filter(r => r.points > 0).length;
  const { id } = state.source;
  const prevBest = getBest(id, state.playMode);
  const isBest = state.score > prevBest;
  if (isBest) setBest(id, state.playMode, state.score);

  $("#finalScore").textContent = state.score.toLocaleString();
  $("#finalSub").textContent = `ตอบถูก ${correct}/${state.rounds.length} ข้อ` + (isBest && state.score > 0 ? " · 🏆 สถิติใหม่!" : prevBest ? ` · สถิติ ${prevBest.toLocaleString()}` : "");
  renderSongList($("#songList"));
  showScreen("result");
}

$("#againBtn").addEventListener("click", () => { ensureAudio(); startGame(state.source); });
$("#homeBtn").addEventListener("click", goHome);
$("#homeLink").addEventListener("click", e => { e.preventDefault(); goHome(); });

function stopGame() {
  if (audio) audio.pause();
  cancelAnimationFrame(state.rafId);
  clearTimeout(state.revealTimer);
  state.answered = true;
}

function goHome() {
  stopGame();
  mpLeave();
  renderCategories();
  showScreen("home");
}

renderCategories();
