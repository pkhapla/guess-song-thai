# 🎵 ทายเพลงไทย

เกมทายเพลงไทยแบบ [songtrivia.io](https://songtrivia.io/) — ฟังตัวอย่างเพลงแล้วเลือกคำตอบจาก 4 ตัวเลือก ตอบเร็วยิ่งได้คะแนนเยอะ

- 2 โหมด: ทายชื่อเพลง / ทายศิลปิน
- 7 หมวด: ฮิตติดชาร์ต, ป๊อปไทย, ร็อกไทย, T-Pop, อินดี้, ยุค 90s–2000s, ลูกทุ่ง & หมอลำ
- เลือกศิลปินเองได้ (คั่นหลายคนด้วย `,`)
- ตัวอย่างเพลง 30 วินาทีจาก iTunes Search API (ร้านค้าประเทศไทย) ไม่ต้องมี backend หรือ API key

## รันในเครื่อง

```bash
python3 -m http.server 8000
# เปิด http://localhost:8000
```

## เพิ่ม/แก้ศิลปิน

แก้ใน `categories.js` — ใช้ชื่อศิลปินตามที่ iTunes ใช้ (ส่วนใหญ่เป็นอักษรอังกฤษ เช่น `Tai Orathai` ไม่ใช่ `ต่าย อรทัย`)

## Deploy บน Render

เป็น Static Site — มี `render.yaml` ให้แล้ว
1. Render Dashboard → **New → Blueprint** → เลือก repo นี้ → Apply
   (หรือ **New → Static Site**, Build Command เว้นว่าง, Publish Directory `.`)
