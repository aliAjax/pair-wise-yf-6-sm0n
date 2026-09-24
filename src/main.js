import "./styles.css";
import {
  SLOTS,
  CHECK_IN_GRACE_MINUTES,
  slotLabel,
  isAppointmentStale,
  CHECK_IN_REASON_TEXT
} from "./services/codes.js";
import {
  STATUSES,
  BOARD_COLUMNS,
  normalizeRepair,
  createRepair,
  arrangeVisit,
  cancelAppointment,
  checkIn,
  completeRepair,
  billableCost
} from "./services/workflow.js";
import { archiveRepair, removeFromArchive } from "./services/archive.js";
import { loadState, saveState, saveActive, saveArchive } from "./services/storage.js";

const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

let state = loadState();

// 仅界面临时状态，不持久化
const ui = {
  schedulingId: null,
  notice: null
};

const app = document.querySelector("#app");

function todayValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return `${month}月${day}日 周${WEEKDAYS[date.getDay()]}`;
}

function formatDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hour}:${minute}`;
}

function render() {
  const counts = {
    todo: state.repairs.filter((repair) => repair.status === "todo").length,
    scheduled: state.repairs.filter((repair) => repair.status === "scheduled").length,
    doing: state.repairs.filter((repair) => repair.status === "doing").length,
    done: state.archived.length
  };
  const cost = billableCost(state.repairs) + billableCost(state.archived);

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>家庭维修事项</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>${STATUSES.todo}</span><strong>${counts.todo}</strong></div>
          <div class="stat"><span>${STATUSES.scheduled}</span><strong>${counts.scheduled}</strong></div>
          <div class="stat"><span>${STATUSES.doing}</span><strong>${counts.doing}</strong></div>
          <div class="stat"><span>${STATUSES.done}</span><strong>${counts.done}</strong></div>
          <div class="stat cost"><span>已发生费用（开工/完工）</span><strong>¥${cost}</strong></div>
        </section>
      </header>

      ${ui.notice ? `<div class="notice ${ui.notice.type}">${escapeHtml(ui.notice.text)}</div>` : ""}

      <section class="layout">
        <aside class="panel">
          <h2>新增维修事项</h2>
          <form class="form" id="repair-form">
            <label>位置<input name="location" required placeholder="例如卫生间"></label>
            <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
            <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
            <label>预计费用<input name="cost" type="number" min="0" step="1" value="0"></label>
            <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
            <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
            <button class="primary" type="submit">保存事项</button>
            <p class="form-hint">新事项进入「待安排」，确认上门日期和时段后生成临时上门码。</p>
          </form>
        </aside>

        <section class="board">
          ${BOARD_COLUMNS.map(renderColumn).join("")}
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function renderColumn(status) {
  const items =
    status === "done"
      ? state.archived
      : state.repairs.filter((repair) => repair.status === status);
  return `
    <section class="column">
      <div class="column-head">
        <h2>${STATUSES[status]}</h2>
        <span class="count">${items.length}</span>
      </div>
      <div class="cards">
        ${items.length ? items.map(renderCard).join("") : `<div class="empty">暂无事项</div>`}
      </div>
    </section>
  `;
}

function renderCard(repair) {
  if (repair.status === "done") return renderArchivedCard(repair);
  return `
    <article class="repair ${repair.status}">
      <div class="card-head">
        <h3>${escapeHtml(repair.location)}</h3>
        <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
      </div>
      <p class="title">${escapeHtml(repair.title)}</p>
      ${renderAppointment(repair)}
      ${renderMetaChips(repair)}
      ${renderActions(repair)}
    </article>
  `;
}

function renderAppointment(repair) {
  if (repair.status === "todo") {
    if (ui.schedulingId === repair.id) return renderScheduleForm(repair);
    return `<button class="primary block" data-schedule="${repair.id}">安排上门</button>`;
  }

  const appointment = repair.appointment;
  if (!appointment?.code) return "";
  const stale = isAppointmentStale(appointment);

  if (repair.status === "scheduled") {
    if (ui.schedulingId === repair.id) return renderScheduleForm(repair);
    return `
      <div class="appointment">
        <div class="appt-date">📅 ${escapeHtml(formatDate(appointment.date))} · ${escapeHtml(slotLabel(appointment.slot))}</div>
        ${
          stale
            ? `<div class="appt-warn">预约时段已过，该码登记将无效，可改约或取消</div>`
            : `<p class="code-hint">六位临时上门码，时段开始至结束后${CHECK_IN_GRACE_MINUTES}分钟有效，改约或取消即失效</p>`
        }
        <div class="code-box ${stale ? "stale" : ""}">
          <span class="code-digits">${escapeHtml(appointment.code)}</span>
          <button class="ghost small" type="button" data-copy-code="${repair.id}">复制</button>
        </div>
        <form class="checkin-form" data-checkin="${repair.id}">
          <label>师傅到场登记
            <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="输入当前预约的六位码" autocomplete="off" required>
          </label>
          <button class="primary small" type="submit">凭码登记</button>
        </form>
        <div class="appt-actions">
          <button class="ghost small" data-reschedule="${repair.id}">改约</button>
          <button class="ghost small danger" data-cancel-appt="${repair.id}">取消预约</button>
        </div>
      </div>
    `;
  }

  // doing
  return `
    <div class="appointment working">
      <div class="appt-date">📅 ${escapeHtml(formatDate(appointment.date))} · ${escapeHtml(slotLabel(appointment.slot))}</div>
      <div class="appt-line">上门码 ${escapeHtml(appointment.code)} · ${escapeHtml(formatDateTime(appointment.checkedInAt))} 登记开工</div>
    </div>
  `;
}

function renderScheduleForm(repair) {
  const current = repair.appointment;
  return `
    <form class="schedule-form" data-arrange="${repair.id}">
      <label>上门日期
        <input name="date" type="date" min="${todayValue()}" value="${escapeHtml(current?.date || todayValue())}" required>
      </label>
      <label>时段
        <select name="slot">
          ${SLOTS.map((slot) => `<option value="${slot.id}" ${current?.slot === slot.id ? "selected" : ""}>${slot.label}</option>`).join("")}
        </select>
      </label>
      <div class="appt-actions">
        <button class="primary small" type="submit">确认并生成码</button>
        <button class="ghost small" type="button" data-close-schedule="${repair.id}">返回</button>
      </div>
    </form>
  `;
}

function renderMetaChips(repair) {
  const chips = [`<span class="chip">预计 ¥${Number(repair.cost || 0)}</span>`];
  if (repair.photo) {
    chips.push(
      `<a class="chip link" href="${escapeHtml(repair.photo)}" target="_blank" rel="noopener noreferrer">现场照片 ↗</a>`
    );
  }
  if (repair.note) chips.push(`<span class="chip">${escapeHtml(repair.note)}</span>`);
  return `<div class="chips">${chips.join("")}</div>`;
}

function renderActions(repair) {
  const buttons = [];
  if (repair.status === "doing") {
    buttons.push(`<button class="primary small" data-complete="${repair.id}">完工并存档</button>`);
  }
  buttons.push(`<button class="ghost small danger" data-delete-active="${repair.id}">删除事项</button>`);
  return `<div class="appt-actions">${buttons.join("")}</div>`;
}

function renderArchivedCard(repair) {
  const appointment = repair.appointment;
  return `
    <article class="repair done">
      <div class="card-head">
        <h3>${escapeHtml(repair.location)}</h3>
        <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
      </div>
      <p class="title">${escapeHtml(repair.title)}</p>
      ${
        appointment?.checkedInAt
          ? `<div class="appt-line">📅 ${escapeHtml(formatDate(appointment.date))} · ${escapeHtml(slotLabel(appointment.slot))} · ${escapeHtml(formatDateTime(appointment.checkedInAt))} 开工</div>`
          : ""
      }
      <div class="chips">
        <span class="chip">费用 ¥${Number(repair.cost || 0)}</span>
        ${
          repair.photo
            ? `<a class="chip link" href="${escapeHtml(repair.photo)}" target="_blank" rel="noopener noreferrer">现场照片 ↗</a>`
            : ""
        }
        ${repair.note ? `<span class="chip">${escapeHtml(repair.note)}</span>` : ""}
      </div>
      <div class="appt-actions">
        <button class="ghost small danger" data-delete-archived="${repair.id}">删除存档</button>
      </div>
    </article>
  `;
}

function renderPriorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function setNotice(type, text) {
  ui.notice = { type, text };
}

function bindEvents() {
  document.querySelector("#repair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const repair = createRepair({
      location: data.location.trim(),
      title: data.title.trim(),
      priority: data.priority,
      cost: Number(data.cost || 0),
      photo: data.photo.trim(),
      note: data.note.trim()
    });
    state.repairs.unshift(repair);
    saveActive(state.repairs);
    ui.schedulingId = null;
    setNotice("success", `已新增「${repair.location} · ${repair.title}」，可安排上门时间`);
    render();
  });

  document.querySelectorAll("[data-schedule], [data-reschedule]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.schedulingId = button.dataset.schedule || button.dataset.reschedule;
      ui.notice = null;
      render();
    });
  });

  document.querySelectorAll("[data-close-schedule]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.schedulingId = null;
      render();
    });
  });

  document.querySelectorAll("[data-arrange]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const repair = state.repairs.find((item) => item.id === form.dataset.arrange);
      if (!repair) return;
      const data = Object.fromEntries(new FormData(form));
      const date = String(data.date || "");
      const slot = String(data.slot || "");

      if (date < todayValue()) {
        setNotice("error", "上门日期不能早于今天，请重新选择");
        render();
        return;
      }
      try {
        const isReschedule = Boolean(repair.appointment?.code);
        arrangeVisit(repair, { date, slot }, state.repairs);
        saveActive(state.repairs);
        ui.schedulingId = null;
        setNotice(
          "success",
          `${isReschedule ? "已改约，旧码失效。" : ""}新上门码 ${repair.appointment.code}（${formatDate(date)} ${slotLabel(slot)}），请转告师傅`
        );
        render();
      } catch (error) {
        setNotice("error", error.message);
        render();
      }
    });
  });

  document.querySelectorAll("[data-cancel-appt]").forEach((button) => {
    button.addEventListener("click", () => {
      const repair = state.repairs.find((item) => item.id === button.dataset.cancelAppt);
      if (!repair) return;
      try {
        cancelAppointment(repair);
        saveActive(state.repairs);
        ui.schedulingId = null;
        setNotice("success", `已取消「${repair.location}」的预约，上门码失效，事项回到待安排`);
        render();
      } catch (error) {
        setNotice("error", error.message);
        render();
      }
    });
  });

  document.querySelectorAll("[data-checkin]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const repair = state.repairs.find((item) => item.id === form.dataset.checkin);
      if (!repair) return;
      const input = new FormData(form).get("code");
      const result = checkIn(repair, input, new Date());
      if (!result.ok) {
        // 输错 / 过期 / 别的事项的码：只提示，不保存、不改任何状态
        setNotice("error", CHECK_IN_REASON_TEXT[result.reason] || "登记无效");
        render();
        return;
      }
      saveActive(state.repairs);
      setNotice("success", `登记成功，「${repair.location}」已开工`);
      render();
    });
  });

  document.querySelectorAll("[data-complete]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = state.repairs.findIndex((item) => item.id === button.dataset.complete);
      if (index < 0) return;
      const repair = state.repairs[index];
      try {
        completeRepair(repair);
        state.repairs.splice(index, 1);
        archiveRepair(state.archived, repair);
        saveState({ repairs: state.repairs, archived: state.archived });
        ui.schedulingId = null;
        setNotice("success", `「${repair.location}」已完工并存档`);
        render();
      } catch (error) {
        setNotice("error", error.message);
        render();
      }
    });
  });

  document.querySelectorAll("[data-delete-active]").forEach((button) => {
    button.addEventListener("click", () => {
      state.repairs = state.repairs.filter((repair) => repair.id !== button.dataset.deleteActive);
      saveActive(state.repairs);
      if (ui.schedulingId === button.dataset.deleteActive) ui.schedulingId = null;
      setNotice("success", "事项已删除");
      render();
    });
  });

  document.querySelectorAll("[data-delete-archived]").forEach((button) => {
    button.addEventListener("click", () => {
      state.archived = removeFromArchive(state.archived, button.dataset.deleteArchived);
      saveArchive(state.archived);
      setNotice("success", "存档已删除");
      render();
    });
  });

  document.querySelectorAll("[data-copy-code]").forEach((button) => {
    button.addEventListener("click", async () => {
      const repair = state.repairs.find((item) => item.id === button.dataset.copyCode);
      const code = repair?.appointment?.code;
      if (!code) return;
      const ok = await copyText(code);
      setNotice(ok ? "success" : "error", ok ? `上门码 ${code} 已复制` : "复制失败，请手动记录");
      render();
    });
  });
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到旧接口
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

// 旧数据或异常结构兜底归一化（loadState 已处理，此处防御外部脚本写入）
state.repairs = state.repairs.map(normalizeRepair);
state.archived = state.archived.map(normalizeRepair);

render();
