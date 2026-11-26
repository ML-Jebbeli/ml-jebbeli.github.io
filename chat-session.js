import { addConversation, createStore, exchangeLimit, historyLimit, questionLimit, titleFrom } from "./chat-store.js?v=6";
import { loading, offline, requestAnswer, requestTimeout, slow, stopWaiting } from "./chat-request.js?v=6";

const untitled = "گفتگوی جدید";
const interrupted = "پاسخ ذخیره نشد. در صورت نیاز دوباره تلاش کن.";
const full = "تاریخچه پر است. برای شروع گفتگوی جدید، یکی از گفتگوها را حذف کنید.";
const saveWarning = "ذخیره در مرورگر در دسترس نیست. تغییرات جدید فقط در همین صفحه می‌مانند.";

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function createChatSession(surface, onChange) {
  const selectionKey = "iustech-selection-" + surface;
  const store = createStore(notify);
  const requests = new Map();
  const statuses = new Map();
  const drafts = new Map();
  let timer;
  let cooldownUntil = 0;
  let remembered;
  try { remembered = sessionStorage.getItem(selectionKey); } catch {}
  let active = store.read().find(record => record.id === remembered)?.id ?? list()[0]?.id;
  let virtual = active ? undefined : uuid();
  active ??= virtual;

  function list() {
    return [...store.read()].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  }

  function current() {
    return store.read().find(record => record.id === active);
  }

  function live(turn) {
    return turn.attempt && turn.expires > Date.now();
  }

  function historyBusy() {
    return current()?.turns.some(live);
  }

  function retryDeadline() {
    return Math.max(cooldownUntil, ...store.read().map(record => record.cooldownUntil ?? 0));
  }

  function schedule() {
    clearTimeout(timer);
    const now = Date.now();
    const expiry = current()?.turns.find(live)?.expires ?? 0;
    const next = Math.min(...[retryDeadline(), expiry].filter(time => time > now));
    if (Number.isFinite(next)) timer = setTimeout(notify, Math.min(next - now, 2147483647));
  }

  function notify() {
    const retained = new Set(store.read().map(record => record.id));
    if (retained.has(virtual)) virtual = undefined;
    for (const [id, request] of requests) {
      if (id !== virtual && !retained.has(id)) stopWaiting(request.controller);
    }
    for (const entries of [drafts, statuses]) {
      for (const id of entries.keys()) {
        if (id !== virtual && !retained.has(id)) entries.delete(id);
      }
    }
    if (active !== virtual && !retained.has(active)) {
      // The selected conversation was deleted, including from another tab.
      active = virtual = uuid();
    }
    schedule();
    onChange();
  }

  function remember(id) {
    if (id !== active) return;
    try { sessionStorage.setItem(selectionKey, id); } catch {}
  }

  function activate(id) {
    active = id;
    remember(id);
    notify();
  }

  function select(id) {
    if (store.read().some(record => record.id === id)) activate(id);
  }

  async function create() {
    const id = uuid();
    if (await store.update(records => addConversation(records, id))) {
      activate(id);
      statuses.set(id, { text: navigator.onLine ? "گفتگوی تازه شروع شد." : offline, state: "reset" });
      notify();
      return true;
    }
    statuses.set(active, { text: full, state: "error" });
    notify();
    return false;
  }

  async function remove(id) {
    await store.update(records => {
      const index = records.findIndex(record => record.id === id);
      if (index === -1) return null;
      records.splice(index, 1);
      return true;
    });
    const request = requests.get(id);
    if (request) stopWaiting(request.controller);
    statuses.delete(id);
  }

  function change(id, mutate, allowCreate = false) {
    return store.update(records => {
      const mayCreate = allowCreate && id === virtual;
      const record = records.find(item => item.id === id) ?? (mayCreate ? addConversation(records, id) : null);
      return record ? mutate(record) : null;
    });
  }

  async function saveDraft(text) {
    const id = active;
    if (!text && id === virtual && !current() && !drafts.has(id)) return;
    drafts.set(id, text);
    const saved = await change(id, record => {
      if (record.draft === text) return true;
      record.draft = text.slice(0, questionLimit);
      record.updatedAt = Date.now();
      if (record.turns.find(turn => turn.id === record.restoredTurn)?.user.content !== record.draft) record.restoredTurn = null;
      return true;
    }, id === virtual && Boolean(text));
    if (saved) remember(id);
    if (saved && drafts.get(id) === text) drafts.delete(id);
    if (!saved && id === active && id === virtual) {
      statuses.set(id, { text: full, state: "error" });
      notify();
    }
  }

  function blocked() {
    return store.atCapacity || requests.has(active) || historyBusy() || !navigator.onLine || Date.now() < retryDeadline();
  }

  function canRetry(turn) {
    return !blocked() && !turn.assistant && !live(turn) && turn.revision === current()?.revision;
  }

  async function send(question, retryId) {
    if (blocked() || !question || question.length > questionLimit) return false;
    const id = active;
    const attempt = uuid();
    const controller = new AbortController();
    requests.set(id, { controller, retryId });
    statuses.set(id, { text: loading, state: "pending" });
    if (retryId) notify();

    const started = await change(id, record => {
      if (controller.signal.aborted || store.atCapacity || record.turns.some(live) || Date.now() < retryDeadline()) return null;
      // Expired attempts lose their claim before a new send can take it.
      for (const expired of record.turns) {
        if (!expired.attempt) continue;
        delete expired.attempt;
        delete expired.expires;
        expired.error = interrupted;
      }
      let turn = retryId ? record.turns.find(item => item.id === retryId) : null;
      if (retryId && (!turn || turn.assistant || turn.revision !== record.revision)) return null;
      if (!turn) {
        turn = { id: uuid(), user: { role: "user", content: question, timestamp: Date.now() }, revision: record.revision };
        record.turns.push(turn);
        record.turns = record.turns.slice(-exchangeLimit);
        record.title ||= titleFrom(question);
      }
      turn.attempt = attempt;
      turn.expires = Date.now() + requestTimeout;
      delete turn.error;
      if ((!retryId || record.restoredTurn === retryId) && record.draft.trim() === question) {
        record.draft = "";
        record.restoredTurn = null;
      }
      record.updatedAt = Date.now();
      return { turnId: turn.id, revision: turn.revision, context: record.context };
    }, id === virtual && !retryId);

    if (!started) {
      requests.delete(id);
      statuses.set(id, { text: id === virtual && !current() ? full : "", state: "error" });
      notify();
      return false;
    }
    remember(id);

    const result = await requestAnswer(question, started.context, controller, () => {
      statuses.set(id, { text: slow, state: "pending" });
      if (id === active) notify();
    });
    cooldownUntil = Math.max(cooldownUntil, result.cooldownUntil ?? 0);

    await change(id, record => {
      const turn = record.turns.find(item => item.id === started.turnId);
      if (turn?.attempt !== attempt || record.revision !== started.revision) return null;
      if (result.cooldownUntil > Date.now()) record.cooldownUntil = result.cooldownUntil;
      delete turn.attempt;
      delete turn.expires;
      if (result.answer) {
        turn.assistant = { role: "assistant", content: result.answer, timestamp: Date.now() };
        record.context = [...record.context, turn.user, turn.assistant].slice(-historyLimit);
        record.revision++;
        statuses.set(id, { text: "", state: "success" });
      } else {
        turn.error = result.error;
        if (!record.draft && surface === "embedded") {
          record.restoredTurn = turn.id;
          record.draft = question;
        }
        statuses.set(id, result.stopped
          ? { text: "انتظار متوقف شد.", state: "cancelled" }
          : { text: "پاسخی دریافت نشد. جزئیات زیر سؤال آمده است.", state: "error" });
      }
      record.updatedAt = Date.now();
      return true;
    });
    requests.delete(id);
    notify();
    return true;
  }

  for (const event of ["online", "offline"]) {
    window.addEventListener(event, () => {
      if (!requests.has(active)) statuses.set(active, {
        text: navigator.onLine ? "دوباره آنلاین شدی. ارسال با خودت است." : offline, state: event,
      });
      notify();
    });
  }

  schedule();
  return {
    list, current, select, create, remove, saveDraft, send, blocked, canRetry,
    stop() { const request = requests.get(active); if (request) stopWaiting(request.controller); },
    title: record => record?.title || untitled,
    failure(turn) {
      if (requests.get(active)?.retryId === turn.id) return "";
      return turn.error || (!turn.assistant && !live(turn) ? interrupted : "");
    },
    get active() { return active; },
    get draft() { return drafts.get(active) ?? current()?.draft ?? ""; },
    get waiting() { return requests.has(active); },
    get warning() { return store.volatile ? saveWarning : ""; },
    get status() {
      if (historyBusy() && !requests.has(active)) return { text: loading, state: "pending" };
      return statuses.get(active) ?? { text: navigator.onLine ? "" : offline, state: "" };
    },
  };
}
