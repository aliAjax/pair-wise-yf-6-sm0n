// 维修事项流转：待安排(todo) → 等上门(scheduled) → 处理中(doing) → 已完成(done→存档)。
// 状态机只负责事项本身，码规则在 codes.js，存档在 archive.js。

import { generateCode, evaluateCheckIn, slotById } from "./codes.js";

export const STATUSES = {
  todo: "待安排",
  scheduled: "等上门",
  doing: "处理中",
  done: "已完成"
};

export const BOARD_COLUMNS = ["todo", "scheduled", "doing", "done"];

// 旧版状态 → 新版状态
const LEGACY_STATUS = { todo: "todo", doing: "doing", done: "done" };

export function normalizeRepair(repair = {}) {
  return {
    id: repair.id || crypto.randomUUID(),
    location: String(repair.location ?? ""),
    title: String(repair.title ?? ""),
    priority: repair.priority || "medium",
    cost: Number(repair.cost || 0),
    status: LEGACY_STATUS[repair.status] || (repair.appointment?.code ? "scheduled" : "todo"),
    photo: String(repair.photo ?? ""),
    note: String(repair.note ?? ""),
    appointment: repair.appointment ? normalizeAppointment(repair.appointment) : null
  };
}

function normalizeAppointment(appointment) {
  return {
    date: appointment.date || "",
    slot: appointment.slot || "",
    code: appointment.code || "",
    previousCodes: Array.isArray(appointment.previousCodes) ? [...appointment.previousCodes] : [],
    createdAt: appointment.createdAt || "",
    checkedInAt: appointment.checkedInAt || ""
  };
}

export function createRepair(data) {
  return normalizeRepair({
    id: crypto.randomUUID(),
    location: data.location,
    title: data.title,
    priority: data.priority,
    cost: Number(data.cost || 0),
    photo: data.photo,
    note: data.note,
    status: "todo"
  });
}

function buildAppointment(allRepairs, date, slot) {
  const activeCodes = allRepairs
    .filter((repair) => repair.status === "scheduled" && repair.appointment?.code)
    .map((repair) => repair.appointment.code);
  return {
    date,
    slot,
    code: generateCode(activeCodes),
    previousCodes: [],
    createdAt: new Date().toISOString(),
    checkedInAt: ""
  };
}

// 租客确认日期和时段：首次安排（todo → scheduled）与改约（scheduled 换新码）共用。
// 改约后旧码进入 previousCodes，不再有效。
export function arrangeVisit(repair, { date, slot }, allRepairs = [repair]) {
  if (!["todo", "scheduled"].includes(repair.status)) {
    throw new Error("当前状态不能安排上门");
  }
  if (!date || !slotById(slot)) throw new Error("请确认日期和时段");

  const previous = repair.appointment?.previousCodes ?? [];
  if (repair.appointment?.code) previous.push(repair.appointment.code);

  repair.appointment = buildAppointment(allRepairs, date, slot);
  repair.appointment.previousCodes = previous;
  repair.status = "scheduled";
  return repair;
}

// 租客取消预约：事项回到待安排，码立即失效（保留在 previousCodes 留痕）。
export function cancelAppointment(repair) {
  if (repair.status !== "scheduled") throw new Error("只有等待上门的事项可以取消");
  const previous = repair.appointment?.previousCodes ?? [];
  if (repair.appointment?.code) previous.push(repair.appointment.code);
  repair.appointment = {
    date: "",
    slot: "",
    code: "",
    previousCodes: previous,
    createdAt: "",
    checkedInAt: ""
  };
  repair.status = "todo";
  return repair;
}

// 师傅到场凭当前预约的码登记：核验通过才 scheduled → doing，其余任何输入都不改状态。
export function checkIn(repair, input, now = new Date()) {
  if (repair.status !== "scheduled") return { ok: false, reason: "inactive" };
  const result = evaluateCheckIn(repair, input, now);
  if (!result.ok) return result;
  repair.status = "doing";
  repair.appointment.checkedInAt = now.toISOString();
  return { ok: true, checkedInAt: repair.appointment.checkedInAt };
}

// 完工：doing → done，随后由 archive 模块移走。
export function completeRepair(repair) {
  if (repair.status !== "doing") throw new Error("只有处理中的事项可以标记完工");
  repair.status = "done";
  return repair;
}

// 费用统计：只算开工（doing）或完工（done）的单
export function billableCost(repairs) {
  return repairs
    .filter((repair) => repair.status === "doing" || repair.status === "done")
    .reduce((total, repair) => total + Number(repair.cost || 0), 0);
}
