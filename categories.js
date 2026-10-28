// หมวดหมู่เพลง: แต่ละหมวดคือรายชื่อศิลปิน (ชื่อต้องตรงกับที่ iTunes ประเทศไทยใช้ ส่วนใหญ่เป็นอักษรอังกฤษ)
// years: [ปีเริ่ม, ปีจบ] = หมวดตามยุค เล่นเฉพาะเพลงที่ออกในช่วงปีนั้น (ใช้ปีจาก iTunes)
// ใส่ชื่อสำรองหลัง | ได้ สำหรับค้นใน Deezer ที่ใช้ชื่อภาษาไทย เช่น "Tai Orathai|ต่าย อรทัย"
const CATEGORIES = [
  {
    id: "hits", name: "ฮิตติดชาร์ต", emoji: "🔥", color: "#ff4d6d",
    desc: "เพลงฮิตยุคใหม่ที่ทุกคนร้องได้",
    artists: ["Tilly Birds", "Three Man Down", "Lipta", "Musketeers", "Nont Tanont", "Jeff Satur",
      "Billkin", "PP Krit", "Bowkylion", "Jaonaay", "Whal & Dolph", "The Toys", "Wanyai", "Polycat"],
  },
  {
    id: "pop", name: "ป๊อปไทย", emoji: "🎤", color: "#f59e0b",
    desc: "นักร้องป๊อปขวัญใจคนไทย",
    artists: ["Palmy", "Bird Thongchai|เบิร์ด ธงไชย", "Stamp", "Ink Waruntorn", "Getsunova", "Pop Pongkool", "Lula",
      "Da Endorphine", "Boy Imagine", "Earth Patravee", "Violette Wautier", "Atom Chanakan", "Ben Chalatit"],
  },
  {
    id: "rock", name: "ร็อกไทย", emoji: "🎸", color: "#ef4444",
    desc: "วงร็อกตัวจริง เสียงกีตาร์เต็มๆ",
    artists: ["Bodyslam", "Potato", "Cocktail", "Big Ass", "Clash", "Silly Fools", "Sek Loso", "Labanoon",
      "Klear", "Retrospect", "Sweet Mullet", "Paradox", "Ebola", "Slot Machine", "Taitosmith", "Zeal"],
  },
  {
    id: "tpop", name: "T-Pop", emoji: "✨", color: "#a855f7",
    desc: "ไอดอลและบอยแบนด์/เกิร์ลกรุ๊ปไทย",
    artists: ["4EVE", "BUS", "PROXIE", "BNK48", "PiXXiE", "LYKN", "ATLAS", "Jeff Satur", "Billkin", "PP Krit"],
  },
  {
    id: "indie", name: "อินดี้", emoji: "🌿", color: "#22c55e",
    desc: "สายนอกกระแส ฟังสบายๆ",
    artists: ["Scrubb", "Polycat", "Yes'sir Days", "Phum Viphurit", "Fellow Fellow", "Lomosonic",
      "Mild", "Instinct", "Pause", "Jetset'er", "Moderndog", "Gene Kasidit"],
  },
  {
    id: "retro", name: "ยุค 90s", emoji: "📼", color: "#06b6d4", years: [1985, 1999],
    desc: "เพลงในตำนานปี 1985–1999",
    artists: ["Bird Thongchai|เบิร์ด ธงไชย", "Mai Charoenpura", "Tata Young", "Christina Aguilar", "Asanee & Wasan|อัสนี & วสันต์",
      "Carabao", "Silly Fools", "Pause", "Jintara Poonlarp|จินตหรา พูนลาภ"],
  },
  {
    id: "y2000s", name: "ยุค 2000s", emoji: "💿", color: "#3b82f6", years: [2000, 2009],
    desc: "เพลงฮิตปี 2000–2009 ยุคเทปคาสเซ็ตถึงซีดี",
    artists: ["Bodyslam", "Potato", "Clash", "Big Ass", "Silly Fools", "Sek Loso", "Tata Young", "Palmy", "Labanoon",
      "Zeal", "Da Endorphine", "Ebola", "Retrospect", "Sweet Mullet", "Paradox", "Slot Machine", "Mild", "Scrubb",
      "Tai Orathai|ต่าย อรทัย", "Pai Pongsathon|ไผ่ พงศธร", "Bird Thongchai|เบิร์ด ธงไชย"],
  },
  {
    id: "y2010s", name: "ยุค 2010s", emoji: "📱", color: "#8b5cf6", years: [2010, 2019],
    desc: "เพลงฮิตปี 2010–2019",
    artists: ["Cocktail", "Getsunova", "Stamp", "Ink Waruntorn", "Polycat", "Scrubb", "Lipta", "Bodyslam", "Potato",
      "Labanoon", "Klear", "Musketeers", "The Toys", "Atom Chanakan", "Whal & Dolph", "Pop Pongkool", "Tilly Birds",
      "BNK48", "Fellow Fellow", "Yinglee Srijumpol|หญิงลี ศรีจุมพล", "Takkatan Chonlada|ตั๊กแตน ชลดา",
      "Tai Orathai|ต่าย อรทัย", "Phum Viphurit", "Boy Peacemaker", "Big Ass"],
  },
  {
    id: "y2020s", name: "ยุค 2020s", emoji: "🎧", color: "#ec4899", years: [2020, 2029],
    desc: "เพลงใหม่ตั้งแต่ปี 2020 ถึงปัจจุบัน",
    artists: ["Tilly Birds", "Three Man Down", "4EVE", "PROXIE", "BUS", "PiXXiE", "LYKN", "ATLAS", "Jeff Satur",
      "Billkin", "PP Krit", "Bowkylion", "Jaonaay", "Nont Tanont", "Wanyai", "Lipta", "Earth Patravee", "Boy Imagine",
      "Atom Chanakan", "Violette Wautier", "Cocktail", "Getsunova", "The Toys"],
  },
  {
    id: "lukthung", name: "ลูกทุ่ง & หมอลำ", emoji: "🌾", color: "#eab308",
    desc: "เพลงลูกทุ่ง หมอลำ และเพื่อชีวิต",
    artists: ["Tai Orathai|ต่าย อรทัย", "Pai Pongsathon|ไผ่ พงศธร", "Monkan Kankoon|มนต์แคน แก่นคูน", "Mike Piromporn|ไมค์ ภิรมย์พร", "Jintara Poonlarp|จินตหรา พูนลาภ",
      "Yinglee Srijumpol|หญิงลี ศรีจุมพล", "Bowling Manida|โบว์ลิ่ง มานิดา", "Takkatan Chonlada|ตั๊กแตน ชลดา", "Siriporn Umpaipong|ศิริพร อำไพพงษ์", "Pongsit Kampee",
      "Carabao", "Boy Peacemaker"],
  },
];
