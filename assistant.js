import { approvedHosts } from "./chat-request.js?v=5";
import { createChatSession } from "./chat-session.js?v=5";
import { createTranscript } from "./chat-transcript.js?v=5";
import { closeDialog, listenToMedia, openModal } from "./site-ui.js?v=5";

const byId = name => document.getElementById(name);
const app = byId("assistantApp");
const main = byId("assistantMain");
const drawer = byId("historyDrawer");
const sidebar = byId("assistantSidebar");
const historyButton = byId("openHistory");
const closeHistory = byId("closeHistory");
const newButton = byId("newConversation");
const conversationList = byId("conversationList");
const theme = byId("assistantTheme");
const welcome = byId("assistantWelcome");
const log = byId("assistantLog");
const form = byId("assistantForm");
const input = byId("assistantInput");
const send = byId("assistantSend");
const stop = byId("assistantStop");
const status = byId("assistantStatus");
const warning = byId("assistantWarning");
const jump = byId("assistantJump");
const count = byId("assistantCount");
const number = new Intl.NumberFormat("fa-IR");
const compact = matchMedia("(max-width: 46rem)");
const viewport = window.visualViewport;
const canSend = approvedHosts.has(location.hostname);
const themeKey = "iustech-assistant-theme";
const positions = new Map();
const rows = new Map();
let displayed;
let displayedDraft;
let following = true;

const transcript = createTranscript({
  container: byId("assistantTranscript"),
  avatarTemplate: byId("assistantAvatar").content.firstElementChild,
  copyRoot: main,
  canCopy: () => true,
  retryTurn: turn => submit(turn.user.content, turn.id),
});
const session = createChatSession("assistant", render);

function createThread(record) {
  const row = document.createElement("li");
  const select = document.createElement("button");
  select.type = "button";
  select.className = "assistant-thread";
  select.dir = "auto";
  select.addEventListener("click", () => {
    session.select(record.id);
    closeDialog(drawer);
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "assistant-icon-button";
  const ns = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(ns, "svg");
  icon.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", "#icon-delete");
  icon.append(use);
  remove.append(icon);
  remove.addEventListener("click", async () => {
    if (window.confirm(`گفتگوی «${select.textContent}» حذف شود؟`)) {
      await session.remove(record.id);
      newButton.focus();
    }
  });
  row.append(select, remove);
  return { row, select, remove };
}

function renderSidebar() {
  const records = session.list();
  const retained = new Set();
  byId("emptyHistory").hidden = records.length !== 0;
  for (const [index, record] of records.entries()) {
    retained.add(record.id);
    const thread = rows.get(record.id) ?? createThread(record);
    rows.set(record.id, thread);
    const title = session.title(record);
    if (thread.select.textContent !== title) {
      thread.select.textContent = title;
      thread.select.title = title;
      thread.remove.setAttribute("aria-label", "حذف گفتگو: " + title);
    }
    if (record.id === session.active) thread.select.setAttribute("aria-current", "true");
    else thread.select.removeAttribute("aria-current");
    if (conversationList.children[index] !== thread.row) {
      const focus = thread.row.contains(document.activeElement) ? document.activeElement : null;
      conversationList.insertBefore(thread.row, conversationList.children[index] ?? null);
      focus?.focus({ preventScroll: true });
    }
  }
  for (const [id, thread] of rows) {
    if (!retained.has(id)) {
      thread.row.remove();
      rows.delete(id);
      positions.delete(id);
    }
  }
}

function atLatest() {
  return log.scrollHeight - log.clientHeight - log.scrollTop <= 52;
}

function updateJump() {
  jump.hidden = log.hidden || following || atLatest();
}

function toLatest() {
  following = true;
  log.scrollTop = log.scrollHeight;
  updateJump();
}

function fitInput() {
  const height = viewport?.height ?? window.innerHeight;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, Math.max(36, Math.min(120, height / 4))) + "px";
}

function controls() {
  count.textContent = `${number.format(input.value.length)} از ${number.format(input.maxLength)} نویسه`;
  send.disabled = !canSend || session.blocked() || !input.value.trim() || input.value.length > input.maxLength;
  stop.hidden = !session.waiting;
  fitInput();
}

function render() {
  const { active, draft, waiting } = session;
  const switched = displayed !== active;
  const oldScroll = log.scrollTop;
  const focusStop = document.activeElement === stop;
  const position = positions.get(active);
  if (switched) {
    if (displayed) positions.set(displayed, { scroll: oldScroll, following, welcome: welcome.scrollTop });
    displayed = active;
    transcript.clear();
    following = position?.following ?? true;
  }
  if (switched || displayedDraft !== draft) input.value = draft;
  displayedDraft = draft;
  const turns = session.current()?.turns ?? [];
  const changed = transcript.update(turns, session);
  log.hidden = turns.length === 0;
  welcome.hidden = !log.hidden;
  if (switched) welcome.scrollTop = position?.welcome ?? 0;
  renderSidebar();
  const message = canSend ? session.status.text : "ارسال سؤال در دامنه‌های رسمی سایت فعال است.";
  if (status.textContent !== message) status.textContent = message;
  if (warning.textContent !== session.warning) warning.textContent = session.warning;
  warning.hidden = !session.warning;
  controls();
  if (focusStop && !waiting) input.focus({ preventScroll: true });
  if (switched || changed) {
    if (following) toLatest();
    else log.scrollTop = switched ? position?.scroll ?? 0 : oldScroll;
  }
  updateJump();
}

function saveDraft() {
  displayedDraft = input.value;
  void session.saveDraft(input.value);
  controls();
}

function submit(question, retryId) {
  if (!canSend || input.readOnly || session.blocked()) return;
  if (!retryId && question) following = true;
  if (document.activeElement === send || document.activeElement?.closest(".course-chat-failure")) {
    input.focus({ preventScroll: true });
  }
  void session.send(question, retryId);
  controls();
}

function updateViewport() {
  const height = viewport?.height ?? window.innerHeight;
  const top = viewport?.offsetTop ?? 0;
  const root = document.documentElement;
  root.style.setProperty("--viewport-height", height + "px");
  root.style.setProperty("--viewport-top", top + "px");
  app.toggleAttribute("data-keyboard", height < window.innerHeight - 80 || height < 430);
  fitInput();
  if (following) toLatest();
}

function placeSidebar() {
  if (compact.matches) drawer.append(sidebar);
  else {
    closeDialog(drawer);
    byId("sidebarSlot").append(sidebar);
  }
}

historyButton.addEventListener("click", () => {
  if (openModal(drawer)) {
    historyButton.setAttribute("aria-expanded", "true");
    closeHistory.focus();
  }
});
closeHistory.addEventListener("click", () => closeDialog(drawer));
drawer.addEventListener("close", () => {
  if (!drawer.open) historyButton.setAttribute("aria-expanded", "false");
});
drawer.addEventListener("click", event => {
  const rect = drawer.getBoundingClientRect();
  if (event.target === drawer && (event.clientX > rect.right || event.clientY > rect.bottom)) closeDialog(drawer);
});
listenToMedia(compact, placeSidebar);
newButton.addEventListener("click", async () => {
  if (input.readOnly) return;
  input.readOnly = true;
  newButton.setAttribute("aria-disabled", "true");
  try {
    if (await session.create()) {
      if (drawer.open) closeDialog(drawer);
      else if (!matchMedia("(pointer: coarse)").matches) input.focus({ preventScroll: true });
    }
  } finally {
    input.readOnly = false;
    newButton.removeAttribute("aria-disabled");
  }
});

function setTheme(value) {
  document.documentElement.dataset.theme = value;
  theme.setAttribute("aria-pressed", String(value === "light"));
}
try { if (localStorage.getItem(themeKey) === "light") setTheme("light"); } catch {}
theme.addEventListener("click", () => {
  const value = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  setTheme(value);
  try { localStorage.setItem(themeKey, value); } catch {}
});
for (const suggestion of welcome.querySelectorAll(".assistant-suggestions button")) {
  suggestion.addEventListener("click", () => {
    input.value = suggestion.querySelector(".suggestion-question").textContent;
    saveDraft();
    input.focus({ preventScroll: true });
  });
}

input.addEventListener("input", saveDraft);
input.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!send.disabled) form.requestSubmit();
});
form.addEventListener("submit", event => {
  event.preventDefault();
  if (!send.disabled) submit(input.value.trim());
});
stop.addEventListener("click", () => session.stop());
jump.addEventListener("click", () => {
  log.focus({ preventScroll: true });
  toLatest();
});
log.addEventListener("scroll", () => {
  if (!log.hidden) {
    following = atLatest();
    updateJump();
  }
}, { passive: true });
viewport?.addEventListener("resize", updateViewport);
viewport?.addEventListener("scroll", updateViewport);
window.addEventListener("resize", updateViewport);
placeSidebar();
updateViewport();
render();
