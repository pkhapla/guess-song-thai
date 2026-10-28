// หมวดหมู่เพลง: แต่ละหมวดคือรายชื่อศิลปิน (ชื่อต้องตรงกับที่ iTunes ประเทศไทยใช้ ส่วนใหญ่เป็นอักษรอังกฤษ)
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
    id: "retro", name: "ยุค 90s–2000s", emoji: "📼", color: "#06b6d4",
    desc: "เพลงในตำนานที่ได้ยินแล้วนึกถึงวันวาน",
    artists: ["Bird Thongchai|เบิร์ด ธงไชย", "Mai Charoenpura", "Tata Young", "Christina Aguilar", "Asanee & Wasan|อัสนี & วสันต์",
      "Carabao", "Sek Loso", "Silly Fools", "Moderndog", "Pause", "Jetset'er", "Groove Riders", "Lomosonic"],
  },
  {
    id: "lukthung", name: "ลูกทุ่ง & หมอลำ", emoji: "🌾", color: "#eab308",
    desc: "เพลงลูกทุ่ง หมอลำ และเพื่อชีวิต",
    artists: ["Tai Orathai|ต่าย อรทัย", "Pai Pongsathon|ไผ่ พงศธร", "Monkan Kankoon|มนต์แคน แก่นคูน", "Mike Piromporn|ไมค์ ภิรมย์พร", "Jintara Poonlarp|จินตหรา พูนลาภ",
      "Yinglee Srijumpol|หญิงลี ศรีจุมพล", "Bowling Manida|โบว์ลิ่ง มานิดา", "Takkatan Chonlada|ตั๊กแตน ชลดา", "Siriporn Umpaipong|ศิริพร อำไพพงษ์", "Pongsit Kampee",
      "Carabao", "Boy Peacemaker"],
  },
];
