// 事项流转：四个状态之间的合法转移与费用统计口径。
// 状态：pending 待安排 / scheduled 等上门 / doing 处理中 / done 已完成
// 码的生成与核验交给 accessCode.js，存档（旧预约记录）只在本模块追加与清空。

import {
  createAppointment,
  invalidateAppointment,
  verifyVisitCode,
  VERIFY_RESULT
} from "./accessCode.js";

export const STATUSES = {
  pending: "待安排",
  scheduled: "等上门",
  doing: "处理中",
  done: "已完成"
};

const CAN_TRANSITION = {
  pending: new Set(["scheduled"]),
  scheduled: new Set(["doing", "pending"]),
  doing: new Set(["done"]),
  done: new Set()
};

export function canTransition(from, to) {
  return Boolean(CAN_TRANSITION[from]?.has(to));
}

function currentAppointment(repair) {
  if (repair.status !== "scheduled") return null;
  return repair.appointments?.[repair.appointments.length - 1] ?? null;
}

function activeCodesExcept(repairs, exceptId) {
  return repairs
    .filter((repair) => repair.id !== exceptId)
    .map(currentAppointment)
    .filter(Boolean)
    .map((appointment) => appointment.code);
}

function transition(repair, to, patch = {}) {
  if (!canTransition(repair.status, to)) {
    throw new Error(`不能把「${STATUSES[repair.status]}」直接改为「${STATUSES[to]}」`);
  }
  return { ...repair, status: to, ...patch };
}

// 租客确认日期和时段：生成新码，事项进入等上门
export function scheduleVisit(repair, { date, slot }, allRepairs = [], now = new Date()) {
  if (repair.status !== "pending") {
    return { ok: false, reason: "not_pending" };
  }
  const appointment = createAppointment({
    date,
    slot,
    activeCodes: activeCodesExcept(allRepairs, repair.id),
    now
  });
  const next = transition(repair, "scheduled", {
    appointments: [...(repair.appointments ?? []), appointment]
  });
  return { ok: true, repair: next, code: appointment.code, appointment };
}

// 改约：旧码作废存档，新码生效，仍停留在等上门
export function rescheduleVisit(repair, { date, slot }, allRepairs = [], now = new Date()) {
  const old = currentAppointment(repair);
  if (!old) {
    return { ok: false, reason: "no_appointment" };
  }
  const history = repair.appointments.slice(0, -1);
  history.push(invalidateAppointment(old, "reschedule", now));

  const appointment = createAppointment({
    date,
    slot,
    activeCodes: activeCodesExcept(allRepairs, repair.id),
    now
  });
  return {
    ok: true,
    repair: { ...repair, appointments: [...history, appointment] },
    code: appointment.code,
    appointment
  };
}

// 租客取消：旧码作废存档，事项回到待安排
export function cancelVisit(repair, now = new Date()) {
  const old = currentAppointment(repair);
  if (!old) {
    return { ok: false, reason: "no_appointment" };
  }
  const archived = invalidateAppointment(old, "cancel", now);
  const next = transition(repair, "pending", {
    appointments: [...repair.appointments.slice(0, -1), archived]
  });
  return { ok: true, repair: next };
}

// 师傅到场凭当前预约的码登记；输错、过期、别的事项的码都不改变状态
export function registerArrival(repair, input, now = new Date()) {
  const appointment = currentAppointment(repair);
  const result = verifyVisitCode(appointment, input, now);
  if (!result.ok) return result;
  return { ...result, repair: transition(repair, "doing") };
}

// 开工后完工
export function completeRepair(repair) {
  if (repair.status !== "doing") {
    return { ok: false, reason: "not_doing" };
  }
  return { ok: true, repair: { ...repair, status: "done", completedAt: new Date().toISOString() } };
}

// 费用统计只算开工（处理中）或完工的单
export function activeWorkCost(repairs) {
  return repairs
    .filter((repair) => repair.status === "doing" || repair.status === "done")
    .reduce((total, repair) => total + Number(repair.cost || 0), 0);
}

export { VERIFY_RESULT };
