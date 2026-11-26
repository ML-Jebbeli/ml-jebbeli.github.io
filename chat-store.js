const storageKey = "iustech-conversations";
export const exchangeLimit = 60;
export const questionLimit = 500;
export const historyLimit = 6;
const version = 1;
const conversationLimit = 30;
const validId = value => typeof value === "string" && /^[a-f0-9-]{36}$/u.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
const string = (value, limit) => typeof value === "string" && value.length <= limit;
const message = (value, role) => value?.role === role && time(value.timestamp) &&
  string(value.content, role === "user" ? questionLimit : 5_000_000) && Boolean(value.content.trim());

function restore(raw) {
  try {
    const data = JSON.parse(raw);
    if (data?.version > version) return null;
    if (data?.version !== version || !Array.isArray(data.conversations)) return [];
    const ids = new Set();
    return data.conversations.slice(0, conversationLimit).flatMap(record => {
      if (!validId(record?.id) || ids.has(record.id) || !time(record.createdAt) || !time(record.updatedAt) ||
          !time(record.revision) || !string(record.title, questionLimit) || !Array.isArray(record.turns)) return [];
      ids.add(record.id);
      const turnIds = new Set();
      const turns = record.turns.slice(-exchangeLimit).filter(turn => {
        if (!validId(turn?.id) || turnIds.has(turn.id) || !time(turn.revision) || !message(turn.user, "user") ||
            (turn.assistant && !message(turn.assistant, "assistant")) ||
            (turn.error && !string(turn.error, 500)) ||
            (turn.attempt && (!validId(turn.attempt) || !time(turn.expires)))) return false;
        turnIds.add(turn.id);
        return true;
      });
      const context = Array.isArray(record.context) ? record.context.slice(-historyLimit) : [];
      const completeContext = context.length % 2 === 0 &&
        context.every((entry, index) => message(entry, index % 2 ? "assistant" : "user"));
      return [{
        ...record, turns, context: completeContext ? context : [],
        draft: string(record.draft, questionLimit) ? record.draft : "",
        restoredTurn: validId(record.restoredTurn) ? record.restoredTurn : null,
        cooldownUntil: time(record.cooldownUntil) ? record.cooldownUntil : 0,
      }];
    });
  } catch {
    return [];
  }
}

export function createStore(changed) {
  let records = [];
  let previousRaw;
  let volatile = false;

  function refresh() {
    if (volatile) return records;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== previousRaw) {
        previousRaw = raw;
        const restored = restore(raw);
        // Leave a newer schema alone if tabs load different releases.
        if (restored === null) volatile = true;
        else records = restored;
      }
    } catch {
      volatile = true;
    }
    return records;
  }

  function update(mutate) {
    const commit = () => {
      const next = structuredClone(refresh());
      const result = mutate(next);
      if (result == null) return result;
      records = next;
      try {
        if (!volatile) {
          const raw = JSON.stringify({ version, conversations: next });
          localStorage.setItem(storageKey, raw);
          previousRaw = raw;
        }
      } catch {
        // Keep affected conversations usable and surface that writes are in memory.
        volatile = true;
      }
      changed();
      return result;
    };
    // Serialize read/modify/write across same-origin tabs where Web Locks are available.
    return navigator.locks ? navigator.locks.request(storageKey, commit) : Promise.resolve(commit());
  }

  window.addEventListener("storage", event => {
    if (!volatile && (event.key === storageKey || event.key === null)) {
      refresh();
      changed();
    }
  });
  refresh();

  return { read: () => records, update, get volatile() { return volatile; } };
}

export function addConversation(records, id) {
  if (records.length >= conversationLimit) return null;
  const now = Date.now();
  const record = {
    id, title: "", createdAt: now, updatedAt: now, draft: "", restoredTurn: null,
    revision: 0, context: [], turns: [],
  };
  records.unshift(record);
  return record;
}

export function titleFrom(question) {
  const title = question.replace(/\s+/gu, " ").trim();
  const characters = Array.from(title);
  return characters.length > 60 ? characters.slice(0, 59).join("") + "…" : title;
}
