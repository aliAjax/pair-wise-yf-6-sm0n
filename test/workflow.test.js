import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUSES,
  canTransition,
  scheduleVisit,
  rescheduleVisit,
  cancelVisit,
  registerArrival,
  completeRepair,
  activeWorkCost,
  VERIFY_RESULT
} from "../src/lib/workflow.js";

const TODAY = "2026-09-24";
const at = (hour = 10, minute = 0) =>
  new Date(`${TODAY}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);

let seq = 0;
function makeRepair(overrides = {}) {
  seq += 1;
  return {
    id: `r${seq}`,
    location: "厨房",
    title: "渗水",
    priority: "high",
    cost: 100,
    status: "pending",
    appointments: [],
    ...overrides
  };
}

test("状态机只允许合法流转：待安排→等上门→处理中→已完成，取消回到待安排", () => {
  assert.equal(canTransition("pending", "scheduled"), true);
  assert.equal(canTransition("scheduled", "doing"), true);
  assert.equal(canTransition("scheduled", "pending"), true);
  assert.equal(canTransition("doing", "done"), true);
  assert.equal(canTransition("pending", "done"), false);
  assert.equal(canTransition("done", "doing"), false);
  assert.equal(canTransition("scheduled", "done"), false);
});

test("确认日期时段后生成六位码并进入等上门", () => {
  const result = scheduleVisit(makeRepair(), { date: TODAY, slot: "morning" }, [], at(8));
  assert.equal(result.ok, true);
  assert.match(result.code, /^\d{6}$/);
  assert.equal(result.repair.status, "scheduled");
  assert.equal(result.repair.appointments.length, 1);
});

test("非待安排状态不能再排约", () => {
  const doing = makeRepair({ status: "doing" });
  assert.equal(scheduleVisit(doing, { date: TODAY, slot: "morning" }, [], at(8)).ok, false);
});

test("改约：旧码作废、生成新码，事项仍等上门，旧码存档保留", () => {
  const scheduled = scheduleVisit(makeRepair(), { date: TODAY, slot: "morning" }, [], at(8)).repair;
  const oldCode = scheduled.appointments[0].code;

  const result = rescheduleVisit(scheduled, { date: TODAY, slot: "afternoon" }, [], at(8));
  assert.equal(result.ok, true);
  assert.equal(result.repair.status, "scheduled");
  assert.notEqual(result.code, oldCode);
  assert.equal(result.repair.appointments.length, 2);
  assert.equal(result.repair.appointments[0].invalid, true);
  assert.equal(result.repair.appointments[0].invalidReason, "reschedule");
  assert.equal(result.repair.appointments[0].code, oldCode);
  // 旧码即便时间没过也不能再登记
  const oldAttempt = registerArrival({ ...result.repair, appointments: [result.repair.appointments[0]] }, oldCode, at(9));
  assert.equal(oldAttempt.ok, false);
  assert.equal(oldAttempt.reason, VERIFY_RESULT.NONE);
});

test("取消：旧码作废，事项回到待安排", () => {
  const scheduled = scheduleVisit(makeRepair(), { date: TODAY, slot: "morning" }, [], at(8)).repair;
  const result = cancelVisit(scheduled, at(8));
  assert.equal(result.ok, true);
  assert.equal(result.repair.status, "pending");
  assert.equal(result.repair.appointments[0].invalid, true);
  assert.equal(result.repair.appointments[0].invalidReason, "cancel");
});

test("到场凭当前预约码登记成功，进入处理中；原预约存档保留", () => {
  const scheduled = scheduleVisit(makeRepair(), { date: TODAY, slot: "morning" }, [], at(8)).repair;
  const code = scheduled.appointments[0].code;
  const result = registerArrival(scheduled, code, at(10));
  assert.equal(result.ok, true);
  assert.equal(result.repair.status, "doing");
  assert.equal(result.repair.appointments[0].code, code);
});

test("输错码不改变状态，正确码随后仍可登记", () => {
  const scheduled = scheduleVisit(makeRepair(), { date: TODAY, slot: "morning" }, [], at(8)).repair;
  const wrong = registerArrival(scheduled, "999999", at(10));
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, VERIFY_RESULT.MISMATCH);
  assert.equal(scheduled.status, "scheduled"); // 入参未被修改

  const right = registerArrival(scheduled, scheduled.appointments[0].code, at(10));
  assert.equal(right.ok, true);
  assert.equal(right.repair.status, "doing");
});

test("过期码不改变状态", () => {
  const scheduled = scheduleVisit(makeRepair(), { date: TODAY, slot: "morning" }, [], at(8)).repair;
  const result = registerArrival(scheduled, scheduled.appointments[0].code, at(23));
  assert.equal(result.ok, false);
  assert.equal(result.reason, VERIFY_RESULT.EXPIRED);
  assert.equal(scheduled.status, "scheduled");
});

test("拿别的事项的码登记被拒绝且状态不变", () => {
  const a = scheduleVisit(makeRepair(), { date: TODAY, slot: "morning" }, [], at(8)).repair;
  const b = scheduleVisit(makeRepair(), { date: TODAY, slot: "afternoon" }, [a], at(8)).repair;
  const result = registerArrival(a, b.appointments[0].code, at(10));
  assert.equal(result.ok, false);
  assert.equal(result.reason, VERIFY_RESULT.MISMATCH);
  assert.equal(a.status, "scheduled");
});

test("待安排/已完工的事项没有码可登记", () => {
  assert.equal(registerArrival(makeRepair(), "123456", at(10)).reason, VERIFY_RESULT.NONE);
});

test("处理中可完工，完工后不能再动", () => {
  const doing = makeRepair({ status: "doing" });
  const done = completeRepair(doing);
  assert.equal(done.ok, true);
  assert.equal(done.repair.status, "done");
  assert.ok(done.repair.completedAt);
  assert.equal(completeRepair(makeRepair({ status: "pending" })).ok, false);
});

test("费用统计只算处理中与已完成的单", () => {
  const repairs = [
    makeRepair({ status: "pending", cost: 10 }),
    makeRepair({ status: "scheduled", cost: 20 }),
    makeRepair({ status: "doing", cost: 30 }),
    makeRepair({ status: "done", cost: 40 })
  ];
  assert.equal(activeWorkCost(repairs), 70);
});

test("不同事项排约不会生成重复在用码", () => {
  const a = scheduleVisit(makeRepair(), { date: TODAY, slot: "morning" }, [], at(8));
  const b = scheduleVisit(makeRepair(), { date: TODAY, slot: "afternoon" }, [a.repair], at(8));
  assert.notEqual(a.code, b.code);
});

test("状态标签包含四个流转阶段", () => {
  assert.deepEqual(Object.keys(STATUSES), ["pending", "scheduled", "doing", "done"]);
});
