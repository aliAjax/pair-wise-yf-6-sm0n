// 临时上门码规则：独立模块。
// 码规则变更（长度、时段、宽限期）只改本文件，不影响事项流转与存档。

export const CODE_LENGTH = 6;

// 师傅到场登记的宽限：时段结束后多少分钟内仍可凭码登记
export const CHECK_IN_GRACE_MINUTES = 30;

// 可预约时段
export const SLOTS = [
  { id: "morning", label: "上午 09:00–12:00", start: "09:00", end: "12:00" },
  { id: "afternoon", label: "下午 13:00–17:00", start: "13:00", end: "17:00" },
  { id: "evening", label: "傍晚 17:00–20:00", start: "17:00", end: "20:00" }
];

const CODE_PATTERN = new RegExp(`^\\d{${CODE_LENGTH}}$`);

export function slotById(slotId) {
  return SLOTS.find((slot) => slot.id === slotId);
}

export function slotLabel(slotId) {
  return slotById(slotId)?.label ?? slotId;
}

export function slotStartLabel(slotId) {
  return slotById(slotId)?.start ?? "";
}

// 生成不与当前有效预约重复的六位数字码（密码学随机）
export function generateCode(activeCodes = []) {
  const taken = new Set(activeCodes);
  let code;
  do {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    code = String(buffer[0] % 10 ** CODE_LENGTH).padStart(CODE_LENGTH, "0");
  } while (taken.has(code));
  return code;
}

function toTime(date, hhmm) {
  const [hour, minute] = hhmm.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
}

// 某预约当前可登记的时间窗口；未确认的日期/时段返回 null
export function checkInWindow(appointment, now = new Date()) {
  const slot = appointment && slotById(appointment?.slot);
  if (!slot || !appointment?.date) return null;
  const [year, month, day] = appointment.date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const base = new Date(year, month - 1, day);
  const opensAt = toTime(base, slot.start);
  const closesAt = toTime(base, slot.end);
  closesAt.setMinutes(closesAt.getMinutes() + CHECK_IN_GRACE_MINUTES);
  return { opensAt, closesAt };
}

// 师傅凭码登记。核验失败一律返回 { ok:false, reason }，不触碰任何状态。
// 原因：bad_format / foreign / inactive / old / expired / early
export function evaluateCheckIn(repair, input, now = new Date()) {
  const code = String(input ?? "").trim();
  if (!CODE_PATTERN.test(code)) return { ok: false, reason: "bad_format" };

  const appointment = repair?.appointment;
  if (!appointment || !appointment.code) return { ok: false, reason: "inactive" };

  if (appointment.code !== code) {
    // 该事项历史码（改约后留下的）→ 旧码；别的事项的码 → 无效码
    if (appointment.previousCodes?.includes(code)) return { ok: false, reason: "old" };
    return { ok: false, reason: "foreign" };
  }

  const window = checkInWindow(appointment, now);
  if (!window) return { ok: false, reason: "inactive" };
  if (now > window.closesAt) return { ok: false, reason: "expired" };
  if (now < window.opensAt) return { ok: false, reason: "early" };
  return { ok: true, code };
}

export const CHECK_IN_REASON_TEXT = {
  bad_format: `请输入${CODE_LENGTH}位数字上门码`,
  foreign: "该码不属于本事项，登记无效",
  inactive: "当前没有有效的上门码",
  old: "这是改约前的旧码，已失效",
  expired: "预约时段已过，上门码失效",
  early: "还未到预约时段，暂时无法登记"
};

// 当前时间是否已过登记窗口（用于列表提示过期）
export function isAppointmentStale(appointment, now = new Date()) {
  const window = checkInWindow(appointment, now);
  return Boolean(window) && now > window.closesAt;
}
