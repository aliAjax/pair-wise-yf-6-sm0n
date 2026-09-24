// 纯逻辑测试：node test.js
import assert from "node:assert/strict";

import {
  generateCode,
  evaluateCheckIn,
  checkInWindow,
  CODE_LENGTH
} from "./src/services/codes.js";
import {
  normalizeRepair,
  createRepair,
  arrangeVisit,
  cancelAppointment,
  checkIn,
  completeRepair,
  billableCost
} from "./src/services/workflow.js";
import { archiveRepair, removeFromArchive } from "./src/services/archive.js";

const DATE = "2099-06-01";
const at = (hhmm, day = DATE) => new Date(`${day}T${hhmm}:00`);

const makeTodo = () =>
  createRepair({ location: "厨房", title: "渗水", priority: "high", cost: 100, photo: "", note: "" });

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

// ---- 码规则 ----
test("生成六位数字码", () => {
  const code = generateCode();
  assert.match(code, new RegExp(`^\\d{${CODE_LENGTH}}$`));
});

test("新码避开当前有效码", () => {
  // 极端情况下允许重试；生成一万个码不应撞到已占用集合
  const taken = new Set();
  for (let i = 0; i < 10000; i++) {
    const code = generateCode(taken);
    assert.equal(taken.has(code), false);
    taken.add(code);
  }
});

test("登记窗口：时段开始到结束后宽限 30 分钟", () => {
  const repair = normalizeRepair({ status: "scheduled", appointment: { date: DATE, slot: "morning", code: "123456" } });
  const { opensAt, closesAt } = checkInWindow(repair.appointment);
  assert.equal(opensAt.getHours(), 9);
  assert.equal(closesAt.getHours(), 12);
  assert.equal(closesAt.getMinutes(), 30);
});

test("正确码在时段内登记成功", () => {
  const repair = normalizeRepair({ status: "scheduled", appointment: { date: DATE, slot: "morning", code: "123456" } });
  assert.deepEqual(evaluateCheckIn(repair, "123456", at("10:00")).ok, true);
});

test("格式错误 / 他人码 / 旧码 / 过期 / 太早 全部拒绝", () => {
  const repair = normalizeRepair({
    status: "scheduled",
    appointment: { date: DATE, slot: "morning", code: "123456", previousCodes: ["654321"] }
  });
  assert.equal(evaluateCheckIn(repair, "12").reason, "bad_format");
  assert.equal(evaluateCheckIn(repair, "abc123").reason, "bad_format");
  assert.equal(evaluateCheckIn(repair, "999999", at("10:00")).reason, "foreign");
  assert.equal(evaluateCheckIn(repair, "654321", at("10:00")).reason, "old");
  assert.equal(evaluateCheckIn(repair, "123456", at("13:00")).reason, "expired");
  assert.equal(evaluateCheckIn(repair, "123456", at("08:00")).reason, "early");
});

test("没有有效预约时任何码都不接受", () => {
  const todo = normalizeRepair({ status: "todo" });
  assert.equal(evaluateCheckIn(todo, "123456", at("10:00")).reason, "inactive");
});

// ---- 事项流转 ----
test("确认日期时段后生成码并进入等上门", () => {
  const repair = makeTodo();
  arrangeVisit(repair, { date: DATE, slot: "morning" }, [repair]);
  assert.equal(repair.status, "scheduled");
  assert.match(repair.appointment.code, /^\d{6}$/);
});

test("改约：旧码失效并留痕，新码可登记", () => {
  const repair = makeTodo();
  arrangeVisit(repair, { date: DATE, slot: "morning" }, [repair]);
  const oldCode = repair.appointment.code;
  arrangeVisit(repair, { date: DATE, slot: "afternoon" }, [repair]);
  assert.notEqual(repair.appointment.code, oldCode);
  assert.deepEqual(repair.appointment.previousCodes, [oldCode]);
  // 旧码不再能登记
  assert.equal(checkIn(repair, oldCode, at("10:00")).reason, "old");
  // 新码下午时段内可登记
  const result = checkIn(repair, repair.appointment.code, at("15:00"));
  assert.equal(result.ok, true);
  assert.equal(repair.status, "doing");
  assert.ok(repair.appointment.checkedInAt);
});

test("取消预约：码失效、事项回到待安排", () => {
  const repair = makeTodo();
  arrangeVisit(repair, { date: DATE, slot: "morning" }, [repair]);
  const oldCode = repair.appointment.code;
  cancelAppointment(repair);
  assert.equal(repair.status, "todo");
  assert.equal(repair.appointment.code, "");
  assert.deepEqual(repair.appointment.previousCodes, [oldCode]);
  assert.equal(checkIn(repair, oldCode, at("10:00")).reason, "inactive");
});

test("输错码不改变任何状态", () => {
  const repair = makeTodo();
  arrangeVisit(repair, { date: DATE, slot: "morning" }, [repair]);
  const snapshot = JSON.stringify(repair);
  const result = checkIn(repair, "000000", at("10:00"));
  assert.equal(result.ok, false);
  assert.equal(repair.status, "scheduled");
  assert.equal(repair.appointment.checkedInAt, "");
  assert.equal(JSON.stringify(repair), snapshot);
});

test("拿别的事项的码不能登记", () => {
  const a = makeTodo();
  const b = makeTodo();
  arrangeVisit(a, { date: DATE, slot: "morning" }, [a, b]);
  arrangeVisit(b, { date: DATE, slot: "morning" }, [a, b]);
  // 极小概率撞码：撞了重排
  if (a.appointment.code === b.appointment.code) arrangeVisit(b, { date: DATE, slot: "afternoon" }, [a, b]);
  const result = checkIn(a, b.appointment.code, at("10:00"));
  assert.equal(result.reason, "foreign");
  assert.equal(a.status, "scheduled");
});

test("开工 → 完工 → 存档", () => {
  const repair = makeTodo();
  arrangeVisit(repair, { date: DATE, slot: "morning" }, [repair]);
  checkIn(repair, repair.appointment.code, at("10:00"));
  completeRepair(repair);
  assert.equal(repair.status, "done");
  const archived = [];
  archiveRepair(archived, repair);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].id, repair.id);
  assert.ok(archived[0].archivedAt);
  assert.equal(removeFromArchive(archived, repair.id).length, 0);
});

test("非等上门状态不能取消，非处理中不能完工", () => {
  const todo = makeTodo();
  assert.throws(() => cancelAppointment(todo));
  assert.throws(() => completeRepair(todo));
});

test("费用统计只算开工和完工的单", () => {
  const a = makeTodo(); // todo，100 元，不计
  const b = normalizeRepair({ ...makeTodo(), cost: 200, status: "doing" }); // 200 计入
  const c = normalizeRepair({ ...makeTodo(), cost: 300, status: "scheduled" }); // 300 不计
  const d = normalizeRepair({ ...makeTodo(), cost: 400, status: "done" }); // 400 计入
  assert.equal(billableCost([a, b, c, d]), 600);
});

// ---- 旧数据兼容 ----
test("旧版状态迁移映射", () => {
  assert.equal(normalizeRepair({ status: "todo" }).status, "todo");
  assert.equal(normalizeRepair({ status: "doing" }).status, "doing");
  assert.equal(normalizeRepair({ status: "done" }).status, "done");
  const migrated = normalizeRepair({});
  assert.equal(migrated.status, "todo");
  assert.equal(migrated.cost, 0);
});

// ---- 存储迁移 ----
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key)
};

const { loadState, saveState } = await import("./src/services/storage.js");

test("旧版数据打开后照常使用：已完成归入存档，其余留在新看板", () => {
  memory.clear();
  memory.set(
    "zfl-14-repairs",
    JSON.stringify({
      filter: "all",
      repairs: [
        { id: "old-1", location: "卫生间", title: "漏水", priority: "low", cost: 50, status: "todo" },
        { id: "old-2", location: "卧室", title: "灯具", priority: "medium", cost: 80, status: "doing" },
        { id: "old-3", location: "客厅", title: "门锁", priority: "high", cost: 90, status: "done" }
      ]
    })
  );
  const state = loadState();
  assert.equal(state.repairs.length, 2);
  assert.equal(state.archived.length, 1);
  assert.deepEqual(
    state.repairs.map((r) => r.status).sort(),
    ["doing", "todo"]
  );
  assert.equal(state.archived[0].id, "old-3");
  // 存档独立键保存
  saveState(state);
  assert.ok(memory.has("zfl-14-repairs-archive"));
  const saved = JSON.parse(memory.get("zfl-14-repairs"));
  assert.equal(saved.version, 2);
});

test("无数据时给初始示例", () => {
  memory.clear();
  const state = loadState();
  assert.equal(state.repairs.length, 1);
  assert.equal(state.repairs[0].status, "todo");
});

console.log(`\n全部通过：${passed} 项`);
