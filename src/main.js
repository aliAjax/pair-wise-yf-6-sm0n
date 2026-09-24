import "./styles.css";
import { SLOTS, isExpired, VERIFY_RESULT } from "./lib/accessCode.js";
import {
  STATUSES,
  scheduleVisit,
  rescheduleVisit,
  cancelVisit,
  registerArrival,
  completeRepair,
  activeWorkCost
} from "./lib/workflow.js";
import { loadState, saveState } from "./lib/storage.js";

const FILTERS = { all: "全部", ...STATUSES };
const FLOW_ORDER = ["pending", "scheduled", "doing", "done"];

const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

let state = loadState();
// 仅界面瞬态：哪些卡片展开了预约表单、核验提示；不落存档
const uiState = { editors: new Set(), messages: new Map() };

saveState(state); // 旧版本数据读出后按新结构回写一次，后续照常使用

const app = document.querySelector("#app");
app.addEventListener("click", onAppClick);
app.addEventListener("submit", onAppSubmit);

render();

function render() {
  const totalCost = activeWorkCost(state.repairs);
  const count = (status) => state.repairs.filter((repair) => repair.status === status).length;

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>家庭维修事项</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>待安排</span><strong>${count("pending")}</strong></div>
          <div class="stat"><span>等上门</span><strong>${count("scheduled")}</strong></div>
          <div class="stat"><span>处理中</span><strong>${count("doing")}</strong></div>
          <div class="stat"><span>费用合计（开工/完工）</span><strong>¥${totalCost}</strong></div>
        </section>
      </header>

      <section class="layout">
        <aside class="panel">
          <h2>新增维修事项</h2>
          <form class="form" data-form="new">
            <label>位置<input name="location" required placeholder="例如卫生间"></label>
            <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
            <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
            <label>预计费用<input name="cost" type="number" min="0" step="1" value="0"></label>
            <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
            <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
            <button class="primary" type="submit">保存事项</button>
          </form>
          <p class="hint">新事项默认进入「待安排」，确认上门日期与时段后自动生成六位临时上门码。</p>
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(FILTERS)
              .map(
                ([value, label]) =>
                  `<button type="button" class="seg ${state.filter === value ? "active" : ""}" data-action="filter" data-filter="${value}">${label}</button>`
              )
              .join("")}
          </div>
          ${renderLists()}
        </section>
      </section>
    </main>
  `;
}

function renderLists() {
  if (state.filter === "all") {
    return FLOW_ORDER.map((status) => renderGroup(status)).join("");
  }
  return renderGroup(state.filter);
}

function renderGroup(status) {
  const repairs = state.repairs.filter((repair) => repair.status === status);
  return `
    <section class="group">
      <h2 class="group-title">${FILTERS[status]}<span class="group-count">${repairs.length}</span></h2>
      <div class="repairs">
        ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">暂无${FILTERS[status]}的事项</div>`}
      </div>
    </section>
  `;
}

function renderRepair(repair) {
  return `
    <article class="repair">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority] ?? "中优先级"}</span>
          <span class="status ${repair.status}">${STATUSES[repair.status] ?? repair.status}</span>
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">预计 ¥${Number(repair.cost || 0)}</span>
          ${renderHistory(repair)}
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        ${repair.status === "scheduled" ? renderScheduledPanel(repair) : ""}
        ${uiState.editors.has(repair.id) ? renderEditor(repair) : ""}
        <div class="actions">
          ${renderActions(repair)}
          <button type="button" class="ghost" data-action="delete" data-id="${repair.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function currentAppointment(repair) {
  return repair.appointments?.[repair.appointments.length - 1] ?? null;
}

// 只展示已作废（改约/取消）的旧预约存档，当前码不在此列
function renderHistory(repair) {
  const archived = (repair.appointments ?? []).filter((appointment) => appointment.invalid);
  return archived
    .map((appointment) => {
      const text = appointment.invalidReason === "reschedule" ? "已改约" : "已取消";
      return `<span class="chip archive">${escapeHtml(appointment.date)} ${escapeHtml(SLOTS[appointment.slot]?.label ?? appointment.slot)} · ${text} · 旧码 ${formatCode(appointment.code)}</span>`;
    })
    .join("");
}

function renderScheduledPanel(repair) {
  const appointment = currentAppointment(repair);
  if (!appointment) return "";
  const slot = SLOTS[appointment.slot]?.label ?? appointment.slot;
  const expired = isExpired(appointment);
  const message = uiState.messages.get(repair.id);
  return `
    <div class="visit">
      <div class="visit-info">
        <span class="chip strong">上门时间：${escapeHtml(appointment.date)} ${escapeHtml(slot)}</span>
        <span class="codebox ${expired ? "expired" : ""}">
          上门码 <strong>${formatCode(appointment.code)}</strong>
          ${expired ? '<em class="warn">已过期</em>' : '<em>仅限本次预约</em>'}
        </span>
      </div>
      <form class="checkin" data-form="checkin:${repair.id}">
        <input name="code" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="师傅输入六位码登记" aria-label="六位上门码">
        <button class="primary small" type="submit">到场登记</button>
      </form>
      ${message ? `<p class="msg ${message.ok ? "ok" : "bad"}">${escapeHtml(message.text)}</p>` : ""}
    </div>
  `;
}

function renderEditor(repair) {
  const mode = repair.status === "pending" ? "schedule" : "reschedule";
  return `
    <form class="editor" data-form="${mode}:${repair.id}">
      <label>上门日期<input type="date" name="date" required min="${today()}"></label>
      <label>时段
        <select name="slot">
          ${Object.values(SLOTS)
            .map((slot) => `<option value="${slot.value}">${slot.label}</option>`)
            .join("")}
        </select>
      </label>
      <button class="primary small" type="submit">${mode === "schedule" ? "确认并生成码" : "改约并生成新码"}</button>
      <button type="button" class="ghost small" data-action="close-editor" data-id="${repair.id}">收起</button>
    </form>
  `;
}

function renderActions(repair) {
  const { id, status } = repair;
  if (status === "pending") {
    return `<button type="button" class="primary small" data-action="open-editor" data-id="${id}">安排上门</button>`;
  }
  if (status === "scheduled") {
    return `
      <button type="button" class="primary small" data-action="open-editor" data-id="${id}">改约</button>
      <button type="button" class="ghost danger" data-action="cancel-visit" data-id="${id}">取消预约</button>
    `;
  }
  if (status === "doing") {
    return `<button type="button" class="primary small" data-action="complete" data-id="${id}">完工</button>`;
  }
  return "";
}

function onAppClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id, filter } = button.dataset;

  if (action === "filter") {
    state.filter = filter;
    persist();
  } else if (action === "open-editor") {
    uiState.editors.add(id);
    uiState.messages.delete(id);
  } else if (action === "close-editor") {
    uiState.editors.delete(id);
  } else if (action === "cancel-visit") {
    handleCancel(id, button);
  } else if (action === "complete") {
    applyMutation(id, completeRepair(findRepair(id)));
  } else if (action === "delete") {
    state.repairs = state.repairs.filter((repair) => repair.id !== id);
    uiState.editors.delete(id);
    uiState.messages.delete(id);
    persist();
  }
  render();
}

function handleCancel(id, button) {
  const repair = findRepair(id);
  button.disabled = true; // 避免确认期间重复点击
  const confirmed = window.confirm("确认取消该预约？旧码立即失效，事项将回到待安排。");
  if (confirmed) {
    applyMutation(id, cancelVisit(repair));
    uiState.editors.delete(id);
  }
}

function onAppSubmit(event) {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const [kind, id] = form.dataset.form.split(":");

  if (kind === "new") {
    addRepair(new FormData(form));
  } else if (kind === "schedule" || kind === "reschedule") {
    const data = Object.fromEntries(new FormData(form));
    const repair = findRepair(id);
    const payload = { date: data.date, slot: data.slot };
    const result =
      kind === "schedule"
        ? scheduleVisit(repair, payload, state.repairs)
        : rescheduleVisit(repair, payload, state.repairs);
    if (result.ok) {
      applyMutation(id, { ok: true, repair: result.repair });
      uiState.editors.delete(id);
      uiState.messages.delete(id);
    }
  } else if (kind === "checkin") {
    const data = Object.fromEntries(new FormData(form));
    const result = registerArrival(findRepair(id), data.code);
    if (result.ok) {
      applyMutation(id, { ok: true, repair: result.repair });
      uiState.messages.delete(id);
    } else {
      uiState.messages.set(id, { ok: false, text: checkinMessage(result.reason) });
    }
  }
  render();
}

function checkinMessage(reason) {
  if (reason === VERIFY_RESULT.MISMATCH) return "码不正确（输错或属于其他事项），状态未改变。";
  if (reason === VERIFY_RESULT.EXPIRED) return "该上门码已过期，请联系租客改约，状态未改变。";
  if (reason === VERIFY_RESULT.NOT_STARTED) return "还没到预约时段，请在约定时间内到场登记，状态未改变。";
  return "当前没有有效的上门码，状态未改变。";
}

function addRepair(formData) {
  const data = Object.fromEntries(formData);
  state.repairs.unshift({
    id: crypto.randomUUID(),
    location: data.location.trim(),
    title: data.title.trim(),
    priority: data.priority,
    cost: Number(data.cost || 0),
    status: "pending",
    photo: data.photo.trim(),
    note: data.note.trim(),
    appointments: [],
    createdAt: new Date().toISOString()
  });
  persist();
}

// 所有事项变更的唯一落地点：只接受状态机返回的结果，非法流转不会写入
function applyMutation(id, result) {
  if (!result?.ok || result.repair?.id !== id) return;
  state.repairs = state.repairs.map((repair) => (repair.id === id ? result.repair : repair));
  persist();
}

function findRepair(id) {
  return state.repairs.find((repair) => repair.id === id);
}

function persist() {
  saveState(state);
}

function renderPriorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function formatCode(code) {
  return `${String(code).slice(0, 3)} ${String(code).slice(3)}`;
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}
