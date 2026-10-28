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
async function buildPool(artists, onProgress) {
  const all = [];
  let done = 0;
  const queue = [...artists];
  async function worker() {
    while (queue.length) {
      const a = queue.shift();
      try {
        const r = await fetchArtist(a);
        all.push(...r.tracks);
      } catch (e) {
        console.warn("fetch failed", a, e);
      }
      onProgress && onProgress(++done, artists.length);
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
  mode: "title",       // "title" | "artist"
  source: null,        // { id, label, artists[] }
  pool: [],
  rounds: [],
  index: 0,
  score: 0,
  streak: 0,
  answered: false,
  timerStart: 0,
  rafId: 0,
  revealTimer: 0,
};

let audio = null; // สร้างครั้งเดียวตอนผู้เล่นกดเริ่ม (กัน autoplay block บนมือถือ)

function ensureAudio() {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  // "ปลดล็อก" เสียงภายใน user gesture
  audio.play().catch(() => {});
  audio.pause();
}

// ---------- home ----------

function renderCategories() {
  const grid = $("#categoryGrid");
  grid.innerHTML = "";
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
      startGame({ id: c.id, label: `${c.emoji} ${c.name}`, artists: c.artists });
    });
    grid.appendChild(btn);
  }
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

$("#customForm").addEventListener("submit", e => {
  e.preventDefault();
  const artists = $("#customInput").value.split(",").map(s => s.trim()).filter(Boolean);
  if (!artists.length) { $("#customInput").focus(); return; }
  ensureAudio();
  startGame({ id: "custom:" + artists.map(a => a.toLowerCase()).sort().join("|"), label: "🎧 " + artists.join(", "), artists, custom: true });
});

// ---------- game setup ----------

function pickRounds(pool) {
  // เลือกเพลงให้หลากหลาย: ศิลปินละไม่เกิน 2 เพลง (ถ้าทำได้)
  const byArtist = {};
  for (const t of shuffle(pool)) (byArtist[t.artist] ||= []).push(t);
  const artists = Object.keys(byArtist);
  const maxPer = artists.length >= 5 ? 2 : ROUNDS;
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

async function startGame(source) {
  state.source = source;
  showScreen("loading");
  $("#loadingText").textContent = "กำลังรวบรวมเพลง...";

  const artists = source.artists.length > ARTISTS_PER_GAME ? sample(source.artists, ARTISTS_PER_GAME) : source.artists;
  const pool = await buildPool(artists, (d, n) => {
    $("#loadingText").textContent = `กำลังรวบรวมเพลง... (${d}/${n})`;
  });
  const uniqueArtists = new Set(pool.map(t => t.artist)).size;

  let mode = state.mode;
  if (mode === "artist" && uniqueArtists < 4) {
    if (!source.custom) mode = "title";
    else {
      alert("โหมดทายศิลปินต้องมีอย่างน้อย 4 ศิลปิน — จะสลับเป็นโหมดทายชื่อเพลงให้นะ");
      mode = "title";
    }
  }
  if (pool.length < ROUNDS + 3) {
    alert(pool.length === 0
      ? "หาเพลงไม่เจอ ลองพิมพ์ชื่อศิลปินเป็นภาษาอังกฤษ เช่น Bodyslam, Palmy หรือรอสักครู่แล้วลองใหม่"
      : `เจอเพลงแค่ ${pool.length} เพลง ไม่พอเล่น 10 ข้อ ลองเพิ่มศิลปินอีกคน`);
    showScreen("home");
    return;
  }

  state.pool = pool;
  state.playMode = mode;
  state.rounds = pickRounds(pool).map(song => ({ song, choices: makeChoices(song, pool, mode), picked: null, points: 0 }));
  state.index = 0;
  state.score = 0;
  state.streak = 0;
  $("#categoryLabel").textContent = source.label;
  $("#scoreLabel").textContent = "0";
  showScreen("game");
  playRound();
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

function answer(value) {
  if (state.answered) return;
  state.answered = true;
  cancelAnimationFrame(state.rafId);

  const round = state.rounds[state.index];
  const correctValue = state.playMode === "artist" ? round.song.artist : round.song.title;
  const elapsed = (performance.now() - state.timerStart) / 1000;
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

  document.querySelectorAll(".choice").forEach(b => {
    b.disabled = true;
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

  $("#nextBtn").hidden = false;
  $("#nextBtn").textContent = state.index + 1 < state.rounds.length ? "ข้อต่อไป →" : "ดูผลคะแนน →";
  state.revealTimer = setTimeout(next, REVEAL_MS + 1200);
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
  const n = Number(e.key);
  if (n >= 1 && n <= 4 && !state.answered) {
    const b = document.querySelectorAll(".choice")[n - 1];
    if (b && !b.disabled) b.click();
  } else if ((e.key === "Enter" || e.key === " ") && state.answered) {
    e.preventDefault();
    next();
  }
});

// ---------- result ----------

function showResult() {
  audio.pause();
  const correct = state.rounds.filter(r => r.points > 0).length;
  const { id } = state.source;
  const prevBest = getBest(id, state.playMode);
  const isBest = state.score > prevBest;
  if (isBest) setBest(id, state.playMode, state.score);

  $("#finalScore").textContent = state.score.toLocaleString();
  $("#finalSub").textContent = `ตอบถูก ${correct}/${state.rounds.length} ข้อ` + (isBest && state.score > 0 ? " · 🏆 สถิติใหม่!" : prevBest ? ` · สถิติ ${prevBest.toLocaleString()}` : "");

  const list = $("#songList");
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
  showScreen("result");
}

$("#againBtn").addEventListener("click", () => { ensureAudio(); startGame(state.source); });
$("#homeBtn").addEventListener("click", goHome);
$("#homeLink").addEventListener("click", e => { e.preventDefault(); goHome(); });

function goHome() {
  if (audio) audio.pause();
  cancelAnimationFrame(state.rafId);
  clearTimeout(state.revealTimer);
  state.answered = true;
  renderCategories();
  showScreen("home");
}

renderCategories();
