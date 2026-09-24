import test from "node:test";
import assert from "node:assert/strict";
import { loadState, saveState, migrate, STORAGE_KEY } from "../src/lib/storage.js";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    data: map
  };
}

test("无存档时给出默认数据（待安排 + 空预约）", () => {
  const state = loadState(fakeStorage());
  assert.equal(state.version, 2);
  assert.equal(state.repairs.length, 1);
  assert.equal(state.repairs[0].status, "pending");
  assert.deepEqual(state.repairs[0].appointments, []);
});

test("v1 旧数据打开后照常使用：todo 升级为待安排并补齐预约字段", () => {
  const v1 = {
    filter: "todo",
    repairs: [
      {
        id: "legacy-1",
        location: "卫生间",
        title: "花洒漏水",
        priority: "medium",
        cost: 80,
        status: "todo",
        photo: "",
        note: "旧备注"
      },
      { id: "legacy-2", location: "阳台", title: "晾衣架", priority: "low", cost: 0, status: "doing" },
      { id: "legacy-3", location: "客厅", title: "灯具", priority: "high", cost: 50, status: "done" }
    ]
  };
  const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify(v1) });
  const state = loadState(storage);

  assert.equal(state.version, 2);
  assert.equal(state.filter, "pending");
  assert.equal(state.repairs[0].status, "pending");
  assert.equal(state.repairs[1].status, "doing");
  assert.equal(state.repairs[2].status, "done");
  assert.deepEqual(state.repairs[0].appointments, []);
  assert.equal(state.repairs[0].note, "旧备注");

  // 升级后回写，下次读到的就是 v2
  saveState(state, storage);
  const reloaded = loadState(storage);
  assert.equal(reloaded.version, 2);
  assert.equal(reloaded.repairs.length, 3);
});

test("损坏的 JSON 不崩溃，回退默认数据", () => {
  const state = loadState(fakeStorage({ [STORAGE_KEY]: "{not json" }));
  assert.equal(state.version, 2);
  assert.ok(Array.isArray(state.repairs));
});

test("v1 缺失字段得到安全默认值", () => {
  const migrated = migrate({ repairs: [{ id: "x" }] });
  assert.equal(migrated.repairs[0].location, "");
  assert.equal(migrated.repairs[0].cost, 0);
  assert.equal(migrated.repairs[0].priority, "medium");
  assert.equal(migrated.repairs[0].status, "pending");
});

test("v2 数据原样保留", () => {
  const v2 = {
    version: 2,
    filter: "scheduled",
    repairs: [
      {
        id: "v2-1",
        location: "厨房",
        title: "水管",
        priority: "high",
        cost: 200,
        status: "scheduled",
        photo: "",
        note: "",
        appointments: [{ code: "042100", date: "2026-09-25", slot: "morning", invalid: false }],
        createdAt: "2026-09-24T08:00:00.000Z"
      }
    ]
  };
  const migrated = migrate(v2);
  assert.equal(migrated, v2);
});
