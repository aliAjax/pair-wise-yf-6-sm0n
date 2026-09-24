// 持久化：活动事项与存档分开存储；旧版数据（无 version）打开后自动迁移、照常使用。

import { normalizeRepair } from "./workflow.js";

export const ACTIVE_KEY = "zfl-14-repairs";
export const ARCHIVE_KEY = "zfl-14-repairs-archive";
export const STATE_VERSION = 2;

function seedRepairs() {
  return [
    normalizeRepair({
      id: crypto.randomUUID(),
      location: "厨房",
      title: "水槽下方渗水",
      priority: "high",
      cost: 260,
      status: "todo",
      photo: "",
      note: "先检查软管接口"
    })
  ];
}

export function loadState() {
  const savedRaw = localStorage.getItem(ACTIVE_KEY);
  const archiveRaw = localStorage.getItem(ARCHIVE_KEY);

  let repairs;
  let archived = archiveRaw ? parseArray(archiveRaw) : [];

  if (!savedRaw) {
    repairs = seedRepairs();
  } else {
    const saved = JSON.parse(savedRaw);
    const legacyRepairs = Array.isArray(saved) ? saved : saved?.repairs;
    const normalized = Array.isArray(legacyRepairs) ? legacyRepairs.map(normalizeRepair) : [];

    // 旧版"已完成"直接归入存档；其余进入对应新栏
    repairs = normalized.filter((repair) => repair.status !== "done");
    const finished = normalized
      .filter((repair) => repair.status === "done")
      .map((repair) => ({ ...repair, archivedAt: repair.appointment?.checkedInAt || "" }));
    archived = finished.concat(archived);
  }

  return {
    version: STATE_VERSION,
    repairs,
    archived
  };
}

function parseArray(raw) {
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.map(normalizeRepair) : [];
}

export function saveActive(repairs) {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify({ version: STATE_VERSION, repairs }));
}

export function saveArchive(archived) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archived));
}

export function saveState({ repairs, archived }) {
  saveActive(repairs);
  saveArchive(archived);
}
