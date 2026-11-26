const storageKey = "iustech-conversations";
export const exchangeLimit = 60;
export const questionLimit = 500;
export const historyLimit = 6;
const version = 1;
const conversationLimit = 30;
const storageLimit = 2_000_000; // UTF-16 code units, leaving room below common origin quotas.
export const renderLimit = 32_768;
const validId = value => typeof value === "string" && /^[a-f0-9-]{36}$/u.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
const string = (value, limit) => typeof value === "string" && value.length <= limit;
const message = (value, role) => value?.role === role && time(value.timestamp) &&
  string(value.content, role === "user" ? questionLimit : 5_000_000) && Boolean(value.content.trim());

const pickMessage = ({ role, content, timestamp }) => ({ role, content, timestamp });

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
      const turns = record.turns.slice(-exchangeLimit).flatMap(turn => {
        if (!validId(turn?.id) || turnIds.has(turn.id) || !time(turn.revision) || turn.revision > record.revision ||
            !message(turn.user, "user")) return [];
        turnIds.add(turn.id);
        const projected = { id: turn.id, revision: turn.revision, user: pickMessage(turn.user) };
        if (message(turn.assistant, "assistant")) projected.assistant = pickMessage(turn.assistant);
        else if (validId(turn.attempt) && time(turn.expires) && turn.expires <= Date.now() + 60_000) {
          projected.attempt = turn.attempt;
          projected.expires = turn.expires;
        } else if (string(turn.error, 500)) projected.error = turn.error;
        return [projected];
      });
      const completed = turns.filter(turn => turn.assistant).slice(-historyLimit / 2);
      const visibleContext = completed.flatMap(turn => [turn.user, turn.assistant]);
      const storedContext = Array.isArray(record.context) ? record.context.slice(-historyLimit) : [];
      // Old successful pairs may have aged out of the visible transcript after
      // many failed sends. Only use archived pairs if the retained suffix agrees.
      const archive = storedContext.slice(0, Math.max(0, storedContext.length - visibleContext.length));
      const paired = storedContext.length % 2 === 0 &&
        storedContext.every((entry, index) => message(entry, index % 2 ? "assistant" : "user"));
      const matches = visibleContext.every((entry, index) => {
        const saved = storedContext[archive.length + index];
        return saved?.content === entry.content && saved.timestamp === entry.timestamp;
      });
      const mayHavePruned = record.turns.length >= exchangeLimit && record.revision >= storedContext.length / 2;
      const context = paired && matches && mayHavePruned ? [...archive.map(pickMessage), ...visibleContext] : visibleContext;
      return [{
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        revision: record.revision,
        turns, context,
        draft: string(record.draft, questionLimit) ? record.draft : "",
        restoredTurn: validId(record.restoredTurn) ? record.restoredTurn : null,
        cooldownUntil: time(record.cooldownUntil) ? record.cooldownUntil : 0,
      }];
    });
  } catch {
    return [];
  }
}

// Every writable browser context uses the same IndexedDB transaction lock,
// including contexts without navigator.locks. No chat data is put in IndexedDB.
function openMutex() {
  return new Promise(resolve => {
    try {
      const request = indexedDB.open("iustech-chat-coordination", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("mutex");
      request.onerror = request.onblocked = () => resolve(null);
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    } catch {
      resolve(null);
    }
  });
}

export function createStore(changed) {
  let records = [];
  let previousRaw;
  let persistedIds = new Set();
  let dirty = false;
  let atCapacity = false;
  let memoryOnly = false;
  let mutex;

  function refresh(reset = false) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === previousRaw && !(reset && raw === null)) return;
      const restored = restore(raw);
      if (restored === null) {
        memoryOnly = true;
      } else if (raw === null || (!dirty && !memoryOnly)) {
        records = restored;
        dirty = false;
        atCapacity = (raw?.length ?? 0) >= storageLimit;
      } else {
        // An unsaved snapshot cannot safely replace another tab's writes.
        // Honor deletions even while the rest of this page is memory-only.
        const retained = new Set(restored.map(record => record.id));
        records = records.filter(record => !persistedIds.has(record.id) || retained.has(record.id));
        memoryOnly = true;
      }
      if (restored !== null) persistedIds = new Set(restored.map(record => record.id));
      previousRaw = raw;
    } catch {
      memoryOnly = true;
    }
  }

  async function update(mutate) {
    const commit = () => {
      refresh();
      const next = structuredClone(records);
      const result = mutate(next);
      if (result != null) {
        records = next;
        const raw = JSON.stringify({ version, conversations: next });
        atCapacity = raw.length >= storageLimit;
        if (!memoryOnly) {
          if (raw === previousRaw) dirty = false;
          else if (atCapacity) dirty = true;
          else {
            try {
              localStorage.setItem(storageKey, raw);
              previousRaw = raw;
              persistedIds = new Set(next.map(record => record.id));
              dirty = false;
            } catch {
              dirty = true;
            }
          }
        }
      }
      changed();
      return result;
    };
    if (memoryOnly) return commit();
    const db = await (mutex ??= openMutex());
    let transaction;
    try {
      transaction = db?.transaction("mutex", "readwrite");
    } catch {
      // A browser can revoke or close IndexedDB during the page lifetime.
    }
    if (!transaction) {
      memoryOnly = true;
      return commit();
    }
    return new Promise((resolve, reject) => {
      let committed = false;
      transaction.onabort = () => {
        if (committed) return;
        memoryOnly = true;
        resolve(commit());
      };
      const turn = transaction.objectStore("mutex").get(0);
      turn.onsuccess = () => {
        committed = true;
        try { resolve(commit()); } catch (error) { reject(error); }
      };
    });
  }

  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) {
      refresh(true);
      changed();
    }
  });
  refresh();

  return { read: () => records, update, get atCapacity() { return atCapacity; }, get volatile() { return dirty || memoryOnly || atCapacity; } };
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
