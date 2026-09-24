import test from "node:test";
import assert from "node:assert/strict";
import {
  generateVisitCode,
  createAppointment,
  invalidateAppointment,
  verifyVisitCode,
  isExpired,
  VERIFY_RESULT,
  CODE_LENGTH
} from "../src/lib/accessCode.js";

const at = (date, hour = 10, minute = 0) =>
  new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
const TODAY = "2026-09-24";

test("生成六位数字码，允许前导零，且避开在用码", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateVisitCode();
    assert.match(code, /^\d{6}$/);
    assert.equal(code.length, CODE_LENGTH);
  }
  const unique = generateVisitCode(["123456"]);
  assert.notEqual(unique, "123456");
});

test("确认日期时段后拿到新预约与新码", () => {
  const appt = createAppointment({ date: TODAY, slot: "morning", now: at(TODAY, 8) });
  assert.match(appt.code, /^\d{6}$/);
  assert.equal(appt.invalid, false);
  assert.ok(appt.windowStart < appt.windowEnd);
});

test("非法日期或时段抛错", () => {
  assert.throws(() => createAppointment({ date: "2026-9-2", slot: "morning" }));
  assert.throws(() => createAppointment({ date: TODAY, slot: "midnight" }));
});

test("时段内码核验通过", () => {
  const appt = createAppointment({ date: TODAY, slot: "morning" });
  const result = verifyVisitCode(appt, appt.code, at(TODAY, 11));
  assert.equal(result.ok, true);
  assert.equal(result.reason, VERIFY_RESULT.OK);
});

test("码支持带空格输入", () => {
  const appt = createAppointment({ date: TODAY, slot: "morning" });
  const spaced = `${appt.code.slice(0, 3)} ${appt.code.slice(3)}`;
  assert.equal(verifyVisitCode(appt, spaced, at(TODAY, 9)).ok, true);
});

test("输错码不通过，且不修改预约", () => {
  const appt = createAppointment({ date: TODAY, slot: "morning" });
  const wrong = appt.code === "000000" ? "111111" : "000000";
  const result = verifyVisitCode(appt, wrong, at(TODAY, 10));
  assert.equal(result.ok, false);
  assert.equal(result.reason, VERIFY_RESULT.MISMATCH);
  assert.equal(appt.invalid, false); // 状态不变
  assert.equal(verifyVisitCode(appt, appt.code, at(TODAY, 10)).ok, true); // 正确码仍可用
});

test("拿别的事项的码：码与本事项不匹配，拒绝", () => {
  const apptA = createAppointment({ date: TODAY, slot: "morning" });
  const apptB = createAppointment({ date: TODAY, slot: "afternoon", activeCodes: [apptA.code] });
  const result = verifyVisitCode(apptA, apptB.code, at(TODAY, 10));
  assert.equal(result.ok, false);
  assert.equal(result.reason, VERIFY_RESULT.MISMATCH);
});

test("时段未到拒绝，过期拒绝", () => {
  const appt = createAppointment({ date: TODAY, slot: "evening" }); // 18:00 开始，提前 30 分钟放行
  assert.equal(verifyVisitCode(appt, appt.code, at(TODAY, 9)).reason, VERIFY_RESULT.NOT_STARTED);
  assert.equal(verifyVisitCode(appt, appt.code, at(TODAY, 17, 29)).reason, VERIFY_RESULT.NOT_STARTED);
  assert.equal(verifyVisitCode(appt, appt.code, at(TODAY, 17, 30)).ok, true); // 宽限开始
  assert.equal(verifyVisitCode(appt, appt.code, at(TODAY, 21, 30)).ok, true); // 宽限结束
  assert.equal(verifyVisitCode(appt, appt.code, at(TODAY, 21, 31)).reason, VERIFY_RESULT.EXPIRED);
  assert.equal(isExpired(appt, at(TODAY, 21, 31)), true);
});

test("改约或取消作废后的旧码立即失效", () => {
  const appt = createAppointment({ date: TODAY, slot: "morning" });
  const canceled = invalidateAppointment(appt, "cancel", at(TODAY, 9));
  assert.equal(canceled.invalid, true);
  assert.equal(canceled.invalidReason, "cancel");
  assert.equal(verifyVisitCode(canceled, appt.code, at(TODAY, 10)).reason, VERIFY_RESULT.NONE);
  assert.equal(verifyVisitCode(appt, appt.code, at(TODAY, 10)).ok, true); // 旧对象保留原值用于存档
});

test("没有预约时核验返回 NONE", () => {
  assert.equal(verifyVisitCode(null, "123456", at(TODAY, 10)).reason, VERIFY_RESULT.NONE);
});
