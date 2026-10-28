"use strict";

// จัดการเนื้อเพลงสำหรับโหมดต่อเนื้อเพลง: ตัดคำ เทียบคำตอบ เลือกท่อนโจทย์ และค้นเนื้อจาก LRCLIB
// ไม่แตะ DOM เลย ใช้ได้ทั้งในเบราว์เซอร์และใน tools/build-lyrics-index.mjs

const LRCLIB = "https://lrclib.net/api";
const THAI_CHAR = /[฀-๿]/;
const MIN_ANSWER_WORDS = 3;
const MAX_ANSWER_WORDS = 12;

const thaiSegmenter = new Intl.Segmenter("th", { granularity: "word" });

function normalizeLyric(text) {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/ํา/g, "ำ"); // นิคหิต + สระอา ที่พิมพ์แยกกัน = สระอำ
}

// ตัดเป็นคำ ข้ามช่องว่าง/เครื่องหมาย และแปลง ๆ เป็นคำซ้ำ ("เร็วๆ" = "เร็ว ๆ" = "เร็วเร็ว")
function lyricWords(text) {
  const words = [];
  for (const s of thaiSegmenter.segment(normalizeLyric(text))) {
    for (const part of s.segment.split(/(ๆ)/)) {
      if (part === "ๆ") { if (words.length) words.push(words[words.length - 1]); }
      else if (/[\p{L}\p{N}]/u.test(part)) words.push(part.replace(/[^\p{L}\p{M}\p{N}]/gu, ""));
    }
  }
  return words.filter(Boolean);
}

const compactLyric = text => lyricWords(text).join("");

// หาว่าคำไหนของเฉลยอยู่ในสิ่งที่พิมพ์มา (ตามลำดับ) คืนค่า index ของคำในเฉลย
// เทียบกับข้อความที่ต่อกันไม่มีช่องว่าง เพราะคนพิมพ์อาจเว้นวรรคไม่ตรงกับที่ตัดคำไว้
function matchWords(words, guess) {
  const g = compactLyric(guess);
  const memo = new Map();
  // best(i, j) = จำนวนตัวอักษรที่จับคู่ได้มากที่สุด ใช้คำที่ i เป็นต้นไป กับข้อความตั้งแต่ตำแหน่ง j
  const best = (i, j) => {
    if (i >= words.length) return { len: 0, picks: [] };
    const key = i * 1000 + j;
    if (memo.has(key)) return memo.get(key);
    let out = best(i + 1, j);
    for (let k = g.indexOf(words[i], j); k >= 0; k = g.indexOf(words[i], k + 1)) {
      const rest = best(i + 1, k + words[i].length);
      if (rest.len + words[i].length > out.len) out = { len: rest.len + words[i].length, picks: [i, ...rest.picks] };
    }
    memo.set(key, out);
    return out;
  };
  return best(0, 0).picks;
}

// แยกเนื้อเพลงเป็นบรรทัด ตัดเวลา [00:12.34] เครื่องหมายท่อนซ้ำ และบรรทัดที่ไม่ใช่เนื้อร้องภาษาไทย
function lyricLines(text) {
  return (text || "").split(/\r?\n/)
    .map(l => l
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\((?:[^)]*(?:ซ้ำ|ดนตรี|hook|chorus|verse|intro|outro|solo|rap)[^)]*|\s*[x×*]?\s*\d+\s*)\)/gi, "")
      .replace(/^[\s*#•\-–—>]+|[\s*#•\-–—]+$/g, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(l => THAI_CHAR.test(l) && !/^(hook|chorus|verse|intro|outro|ซ้ำ|ดนตรี)\b/i.test(l));
}

// คู่ "ท่อนโจทย์ → ท่อนต่อไป" ที่ใช้เป็นโจทย์ได้
// ท่อนต่อไปต้องยาว 3–12 คำ และทั้งสองท่อนต้องไม่ซ้ำที่อื่นในเพลง (ไม่งั้น "ท่อนต่อไป" จะกำกวม)
function lyricPairs(lines) {
  const keys = lines.map(compactLyric);
  const count = {};
  for (const k of keys) count[k] = (count[k] || 0) + 1;
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const words = lyricWords(lines[i + 1]);
    if (words.length < MIN_ANSWER_WORDS || words.length > MAX_ANSWER_WORDS) continue;
    if (count[keys[i]] > 1 || count[keys[i + 1]] > 1) continue;
    // ท่อนโจทย์สั้นเกินไปให้แถมบรรทัดก่อนหน้าเป็นบริบท
    const prompt = lyricWords(lines[i]).length < 4 && i > 0 ? [lines[i - 1], lines[i]] : [lines[i]];
    pairs.push({ prompt, answer: lines[i + 1], words });
  }
  return pairs;
}

const lyricText = r => r && (r.plainLyrics || r.syncedLyrics) || "";

// หาเนื้อเพลงจาก LRCLIB: ค้นตรงตัว → ค้นชื่อเพลง+ศิลปิน → ค้นชื่อเพลงอย่างเดียว (ต้องยาวใกล้กัน)
// song = { title, artist, duration } คืนค่า { id, text } หรือ null
// get(url) ต้องคืน JSON หรือ null (ให้คนเรียกจัดการ retry/cache เอง)
async function findLyrics(song, get) {
  const ok = r => r && lyricPairs(lyricLines(lyricText(r))).length >= 2;
  const q = params => new URLSearchParams(params).toString();
  const near = r => song.duration && Math.abs((r.duration || 0) - song.duration) <= 4;

  const params = { artist_name: song.artist, track_name: song.title };
  if (song.duration) params.duration = Math.round(song.duration);
  let r = await get(`${LRCLIB}/get?${q(params)}`);
  if (!ok(r)) {
    const list = await get(`${LRCLIB}/search?${q({ track_name: song.title, artist_name: song.artist })}`) || [];
    r = list.find(ok);
  }
  if (!ok(r) && song.duration) {
    const title = song.title.replace(/\s*[\(\[].*$/, "").trim();
    const list = await get(`${LRCLIB}/search?${q({ track_name: title })}`) || [];
    r = list.find(x => near(x) && ok(x));
  }
  return ok(r) ? { id: r.id, text: lyricText(r) } : null;
}
