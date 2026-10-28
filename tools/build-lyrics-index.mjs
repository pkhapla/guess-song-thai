// สร้าง lyrics-index.js: รายชื่อเพลงของศิลปินใน categories.js ที่มีเนื้อเพลงใน LRCLIB (ใช้ในโหมดต่อเนื้อเพลง)
// เก็บแค่ LRCLIB id ไม่เก็บเนื้อเพลง ตอนเล่นจะดึงเนื้อสดจาก LRCLIB
//
//   node tools/build-lyrics-index.mjs            รันทุกศิลปิน
//   node tools/build-lyrics-index.mjs Bodyslam   รันเฉพาะศิลปินที่ชื่อมีคำนี้ (ของเดิมใน index เก็บไว้)
//
// เขียนไฟล์ทุกครั้งที่จบแต่ละศิลปิน ลองเล่นได้ระหว่างที่รันอยู่
// ผลค้น LRCLIB แคชไว้ใน tools/.lyrics-cache.json รันซ้ำได้เร็ว ลบไฟล์นี้ถ้าอยากค้นใหม่ทั้งหมด

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const load = (file, names) =>
  vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8") + `;({${names}})`);
const { CATEGORIES } = load("categories.js", "CATEGORIES");
const { findLyrics } = load("lyrics-text.js", "findLyrics");

const OUT = path.join(root, "lyrics-index.js");
const CACHE = path.join(root, "tools/.lyrics-cache.json");
const UA = { "User-Agent": "guess-song-thai lyrics index (https://github.com/pkhapla/guess-song-thai)" };

// ---------- ชื่อเพลง (เหมือนใน app.js) ----------

const BAD_WORDS = /karaoke|instrumental|backing track|minus one|cover|คาราโอเกะ|ดนตรี/i;
const VERSION_WORDS = /[\(\[-][^\)\]]*\b(live|acoustic|remix|version|ver\.?|sped up|slowed|remaster(ed)?|demo|unplugged|orchestra|piano)\b/i;
const cleanTitle = title => title
  .replace(/\s*[\(\[](feat\.?|ft\.?|featuring|from|prod\.?)[^\)\]]*[\)\]]/gi, "")
  .replace(/\s+-\s+single$/i, "")
  .trim();
const titleKey = title =>
  cleanTitle(title).replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").toLowerCase().replace(/[\s'".,!?-]/g, "");
const isUsable = title => !BAD_WORDS.test(title) && !VERSION_WORDS.test(title);

// ---------- HTTP ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * 2 ** i;
        await sleep(Math.min(wait, 60000));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await sleep(2000 * 2 ** i);
    }
  }
  console.warn("  ยอมแพ้:", url);
  return null;
}

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const saveCache = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

async function lookup(song) {
  const key = `${song.artist}|${song.key}|${song.duration || ""}`;
  if (!(key in cache)) {
    const found = await findLyrics(song, getJson);
    cache[key] = found ? found.id : 0;
  }
  return cache[key];
}

// ---------- เพลงของศิลปิน (iTunes + Deezer แบบเดียวกับ app.js) ----------

async function itunesTracks(term) {
  const data = await getJson("https://itunes.apple.com/search?" + new URLSearchParams({
    term, country: "th", media: "music", entity: "song", attribute: "artistTerm", limit: "60",
  }));
  const results = (data?.results || []).filter(t =>
    t.kind === "song" && isUsable(t.trackName) && !BAD_WORDS.test(t.collectionName || ""));
  const q = term.toLowerCase();
  const counts = {};
  for (const t of results) if (!/[&,]/.test(t.artistName)) counts[t.artistName] = (counts[t.artistName] || 0) + 1;
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const exact = results.find(t => t.artistName.toLowerCase() === q);
  const name = exact ? exact.artistName : ranked.find(n => n.toLowerCase().includes(q)) || ranked[0];
  if (!name) return { name: null, tracks: [] };
  const tracks = results
    .filter(t => t.artistName.toLowerCase().includes(name.toLowerCase()))
    .map(t => ({
      id: "it" + t.trackId,
      title: cleanTitle(t.trackName),
      key: titleKey(t.trackName),
      art: (t.artworkUrl100 || "").replace("100x100", "400x400"),
      year: Number((t.releaseDate || "").slice(0, 4)) || null,
      duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
      url: t.trackViewUrl,
    }));
  return { name, tracks };
}

async function deezerTracks(term, knownKeys) {
  const found = await getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(term)}&limit=10`);
  const q = term.toLowerCase();
  const list = found?.data || [];
  const exact = list.filter(a => a.name.toLowerCase() === q).sort((a, b) => b.nb_fan - a.nb_fan);
  const candidates = (exact.length ? exact : list.filter(a => a.name.toLowerCase().includes(q))).slice(0, 2);
  if (!candidates.length && !knownKeys.size && list[0]) candidates.push(list[0]);
  for (const artist of candidates) {
    const top = await getJson(`https://api.deezer.com/artist/${artist.id}/top?limit=50`);
    const tracks = (top?.data || [])
      .filter(t => t.readable !== false && isUsable(t.title) &&
        (t.artist.id === artist.id || (t.contributors || []).some(c => c.id === artist.id)))
      .map(t => ({
        id: "dz" + t.id,
        title: cleanTitle(t.title_short || t.title),
        key: titleKey(t.title_short || t.title),
        art: t.album?.cover_big || t.album?.cover_medium || "",
        duration: t.duration || null,
        url: t.link,
      }));
    if (!knownKeys.size || tracks.filter(t => knownKeys.has(t.key)).length >= 2) return { name: artist.name, tracks };
  }
  return { name: null, tracks: [] };
}

async function artistSongs(term) {
  const [main, ...aliases] = term.split("|").map(s => s.trim());
  const it = await itunesTracks(main);
  const knownKeys = new Set(it.tracks.map(t => t.key));
  let dz = { name: null, tracks: [] };
  for (const q of [main, ...aliases]) {
    dz = await deezerTracks(q, knownKeys);
    if (dz.tracks.length) break;
  }
  const hotKeys = new Set(dz.tracks.map(t => t.key));
  const years = {};
  for (const t of it.tracks) if (t.year) years[t.key] = Math.min(years[t.key] || 9999, t.year);
  const name = it.name || dz.name || main;
  const seen = new Set();
  const songs = [];
  for (const t of [...it.tracks, ...dz.tracks]) {
    if (!t.key || seen.has(t.key)) continue;
    seen.add(t.key);
    songs.push({ ...t, artist: name, hot: hotKeys.has(t.key), year: years[t.key] || null });
  }
  return songs;
}

// ---------- main ----------

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

const filter = process.argv[2]?.toLowerCase();
const terms = [...new Set(CATEGORIES.flatMap(c => c.artists))].filter(t => !filter || t.toLowerCase().includes(filter));

const index = fs.existsSync(OUT) ? load("lyrics-index.js", "LYRICS_INDEX").LYRICS_INDEX : {};
// รันทุกศิลปิน: ลบศิลปินที่ไม่อยู่ใน categories.js แล้ว
if (!filter) for (const term of Object.keys(index)) if (!terms.includes(term)) delete index[term];

function writeIndex() {
  fs.writeFileSync(OUT,
    "// สร้างโดย tools/build-lyrics-index.mjs — อย่าแก้เอง รันสคริปต์ใหม่แทน\n" +
    "// เพลงที่มีเนื้อใน LRCLIB ของศิลปินแต่ละคนใน categories.js\n" +
    "// [lrclib id, track id, ชื่อเพลง, ศิลปิน, ปี, ปก, ลิงก์, เพลงฮิต(1)]\n" +
    "const LYRICS_INDEX = {\n" +
    Object.entries(index).map(([term, songs]) =>
      `  ${JSON.stringify(term)}: [\n${songs.map(s => "    " + JSON.stringify(s)).join(",\n")}${songs.length ? "\n" : ""}  ]`).join(",\n") +
    "\n};\n");
}

for (const term of terms) {
  const songs = await artistSongs(term);
  const found = [];
  let done = 0;
  await pool(songs, 3, async song => {
    const lrc = await lookup(song);
    if (lrc) found.push(song.hot ? [lrc, song.id, song.title, song.artist, song.year, song.art, song.url, 1]
      : [lrc, song.id, song.title, song.artist, song.year, song.art, song.url]);
    if (++done % 20 === 0) saveCache();
  });
  saveCache();
  index[term] = found.sort((a, b) => a[2].localeCompare(b[2], "th"));
  writeIndex();
  console.log(`${term}: ${found.length}/${songs.length}`);
}

const total = Object.values(index).reduce((n, s) => n + s.length, 0);
writeIndex();
console.log(`\nเขียน ${path.relative(root, OUT)}: ${total} เพลง จาก ${Object.keys(index).length} ศิลปิน`);
