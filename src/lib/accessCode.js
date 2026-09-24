// 上门码规则：六位数字码的生成、预约时段窗口与核验。
// 纯逻辑模块，不依赖 DOM、存储或事项状态机。

export const CODE_LENGTH = 6;

// 到场登记的宽限时间：时段开始前 / 结束后各 30 分钟内仍算有效
const GRACE_BEFORE_MS = 30 * 60 * 1000;
const GRACE_AFTER_MS = 30 * 60 * 1000;

export const SLOTS = {
  morning: { value: "morning", label: "上午 08:00–12:00", startHour: 8, endHour: 12 },
  afternoon: { value: "afternoon", label: "下午 13:00–17:00", startHour: 13, endHour: 17 },
  evening: { value: "evening", label: "晚上 18:00–21:00", startHour: 18, endHour: 21 }
};

export const VERIFY_RESULT = {
  OK: "ok",
  NONE: "none", // 当前没有有效预约码
  MISMATCH: "mismatch", // 码不对：输错，或拿了别的事项的码
  EXPIRED: "expired", // 时段已过
  NOT_STARTED: "not_started" // 还没到预约时段
};

// 生成六位数字码（允许前导零）；activeCodes 为其他事项当前在用的码，避免撞码
export function generateVisitCode(activeCodes = []) {
  const used = new Set(activeCodes);
  for (let i = 0; i < 1000; i += 1) {
    const code = randomSixDigits();
    if (!used.has(code)) return code;
  }
  return String(Date.now() % 1_000_000).padStart(CODE_LENGTH, "0");
}

function randomSixDigits() {
  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return String(buffer[0] % 1_000_000).padStart(CODE_LENGTH, "0");
  }
  return String(Math.floor(Math.random() * 1_000_000)).padStart(CODE_LENGTH, "0");
}

function slotTimestamp(date, hour) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
}

// 确认日期与时段后生成一条新预约（含新码）
export function createAppointment({ date, slot, activeCodes = [], now = new Date() }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) {
    throw new Error("日期格式应为 YYYY-MM-DD");
  }
  const config = SLOTS[slot];
  if (!config) throw new Error("未知的上门时段");

  return {
    code: generateVisitCode(activeCodes),
    date,
    slot,
    windowStart: slotTimestamp(date, config.startHour) - GRACE_BEFORE_MS,
    windowEnd: slotTimestamp(date, config.endHour) + GRACE_AFTER_MS,
    createdAt: now.toISOString(),
    invalid: false,
    invalidReason: null,
    invalidatedAt: null
  };
}

// 改约 / 取消时把旧码标记作废，原预约对象保留用于存档
export function invalidateAppointment(appointment, reason, now = new Date()) {
  if (!appointment) return appointment;
  return {
    ...appointment,
    invalid: true,
    invalidReason: reason, // "reschedule" | "cancel"
    invalidatedAt: now.toISOString()
  };
}

export function isExpired(appointment, now = new Date()) {
  return Boolean(appointment) && now.getTime() > appointment.windowEnd;
}

// 师傅到场核验：只回答“这条当前预约的码此刻是否有效”，不修改任何状态
export function verifyVisitCode(appointment, input, now = new Date()) {
  if (!appointment || appointment.invalid) {
    return { ok: false, reason: VERIFY_RESULT.NONE };
  }
  const code = String(input ?? "").replace(/\D/g, "").padStart(CODE_LENGTH, "0").slice(-CODE_LENGTH);
  if (code !== appointment.code) {
    return { ok: false, reason: VERIFY_RESULT.MISMATCH };
  }
  const at = now.getTime();
  if (at > appointment.windowEnd) {
    return { ok: false, reason: VERIFY_RESULT.EXPIRED };
  }
  if (at < appointment.windowStart) {
    return { ok: false, reason: VERIFY_RESULT.NOT_STARTED };
  }
  return { ok: true, reason: VERIFY_RESULT.OK };
}
