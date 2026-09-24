// 存档：localStorage 读写与历史版本数据迁移。
// 只管数据形状，不碰码规则与状态机逻辑；旧数据读出时自动升级，升级前也可照常使用。

export const STORAGE_KEY = "zfl-14-repairs";
const STORAGE_VERSION = 2;

export function defaultState() {
  return {
    version: STORAGE_VERSION,
    filter: "pending",
    repairs: [
      {
        id: crypto.randomUUID(),
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        cost: 260,
        status: "pending",
        photo: "",
        note: "先检查软管接口",
        appointments: [],
        createdAt: new Date().toISOString()
      }
    ]
  };
}

export function loadState(storage = localStorage) {
  const saved = storage.getItem(STORAGE_KEY);
  if (!saved) return defaultState();

  try {
    const parsed = JSON.parse(saved);
    return migrate(parsed);
  } catch {
    return defaultState();
  }
}

export function saveState(state, storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: STORAGE_VERSION }));
}

// 升级路径：v1（无 version 字段）→ v2；以后加版本时继续向后接
export function migrate(data) {
  if (!data || typeof data !== "object") return defaultState();
  if (data.version >= STORAGE_VERSION) return data;

  const repairs = Array.isArray(data.repairs) ? data.repairs.map(migrateRepair) : [];
  const filterMap = { todo: "pending", pending: "pending", scheduled: "scheduled", doing: "doing", done: "done", all: "all" };
  return {
    version: STORAGE_VERSION,
    filter: filterMap[data.filter] ?? "pending",
    repairs
  };
}

// v1 的 todo 对应新的「待安排」；v1 没有预约概念，appointments 为空
function migrateRepair(repair) {
  const legacyStatus = repair.status || "todo";
  const statusMap = { todo: "pending", doing: "doing", done: "done" };
  return {
    id: repair.id ?? crypto.randomUUID(),
    location: repair.location ?? "",
    title: repair.title ?? "",
    priority: ["high", "medium", "low"].includes(repair.priority) ? repair.priority : "medium",
    cost: Number(repair.cost || 0),
    status: statusMap[legacyStatus] ?? "pending",
    photo: repair.photo ?? "",
    note: repair.note ?? "",
    appointments: Array.isArray(repair.appointments) ? repair.appointments : [],
    createdAt: repair.createdAt ?? null,
    completedAt: repair.completedAt ?? null
  };
}
