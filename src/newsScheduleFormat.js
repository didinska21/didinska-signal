/**
 * Logic untuk format & konversi jadwal news (data mentahnya ada di
 * ../data/newsSchedule.js, sengaja dipisah dari folder src/ ini).
 */
import { NEWS_SCHEDULE } from "../data/newsSchedule.js";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // WIB = UTC+7, tidak ada DST
const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function formatWIB(utcIsoString) {
  const utcDate = new Date(utcIsoString);
  const wib = new Date(utcDate.getTime() + WIB_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  const dayName = DAY_NAMES[wib.getUTCDay()];
  const date = wib.getUTCDate();
  const month = MONTH_NAMES[wib.getUTCMonth()];
  const year = wib.getUTCFullYear();
  const hour = pad(wib.getUTCHours());
  const minute = pad(wib.getUTCMinutes());
  return `${dayName}, ${date} ${month} ${year}, ${hour}:${minute} WIB`;
}

const CATEGORY_LABELS = {
  fomc: "FOMC",
  nfp: "NFP",
  ppi: "PPI",
  cpi: "CPI",
};

/**
 * Gabung SEMUA kategori (FOMC/NFP/PPI/CPI) jadi satu daftar, cuma yang
 * belum lewat, diurutkan dari yang paling DEKAT dulu. Dipakai buat menu
 * "⏰ Segera Terjadi".
 */
export function formatUpcomingAllText() {
  const now = Date.now();
  const all = [];

  for (const [key, isoList] of Object.entries(NEWS_SCHEDULE)) {
    for (const utcIso of isoList) {
      if (new Date(utcIso).getTime() >= now) {
        all.push({ key, utcIso });
      }
    }
  }

  all.sort((a, b) => new Date(a.utcIso).getTime() - new Date(b.utcIso).getTime());

  if (all.length === 0) {
    return `⏰ <b>Segera Terjadi</b>

Belum ada jadwal mendatang yang tercatat di kategori mana pun.`;
  }

  const lines = all.map((e) => `🔜 <b>${CATEGORY_LABELS[e.key]}</b> — ${formatWIB(e.utcIso)}`);

  return `⏰ <b>Segera Terjadi</b>

${lines.join("\n")}`;
}
export function formatNewsScheduleText(key, label) {
  const rawEvents = NEWS_SCHEDULE[key] || [];
  const now = Date.now();

  const upcoming = rawEvents
    .filter((utcIso) => new Date(utcIso).getTime() >= now)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  if (upcoming.length === 0) {
    return `📌 <b>${label}</b>

Belum ada jadwal ${label.split(" ")[0]} mendatang yang tercatat.`;
  }

  const lines = upcoming.map((utcIso) => `🔜 ${formatWIB(utcIso)}`);

  return `📌 <b>${label}</b>

${lines.join("\n")}`;
}
