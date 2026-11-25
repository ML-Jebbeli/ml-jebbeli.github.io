import { renderAnswer } from "./course-chat-render.js";
import { closeDialog, copyText, openModal } from "./site-ui.js";

const approvedHosts = new Set(["ml-jebbeli.github.io", "jebbeli-ai-preview.pages.dev"]);
const endpoint = "https://jebbeli-ai-quota-lab-01.sedamir77.workers.dev/";
const visibleExchangeLimit = 60;
const historyMessageLimit = 6;
const requestTimeout = 60000;
const slowResponseDelay = 12000;
const requestBodyLimit = 32 * 1024;
const encoder = new TextEncoder();
const fa = new Intl.NumberFormat("fa-IR");

function retryAfterSeconds(header) {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/u.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toUTCString() !== value) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
}

function withWait(message, header) {
  let seconds = retryAfterSeconds(header);
  if (seconds === null) return message + " کمی بعد دوباره تلاش کن.";
  if (!seconds) return message + " حالا می‌توانی دوباره تلاش کنی.";
  const duration = [];
  for (const [size, unit] of [[86400, "روز"], [3600, "ساعت"], [60, "دقیقه"], [1, "ثانیه"]]) {
    const whole = Math.floor(seconds / size);
    if (whole) duration.push(`${fa.format(whole)} ${unit}`);
    seconds %= size;
  }
  return message + " " + duration.join(" و ") + " صبر کن و دوباره تلاش کن.";
}

function responseError(response, code) {
  const wait = response.headers.get("Retry-After");
  if (response.status === 429) {
    return withWait(["DAILY_AI_LIMIT_REACHED", "AI_QUOTA_EXHAUSTED"].includes(code)
      ? "سهمیهٔ روزانهٔ دستیار به پایان رسیده."
      : "تعداد درخواست‌ها زیاد شده.", wait);
  }
  if (response.status === 503) return withWait("سرویس دستیار موقتاً در دسترس نیست.", wait);
  if (response.status === 400) return "دستیار نتوانست درخواست را بخواند. متن سؤال را بررسی کن.";
  if (response.status === 413) return "حجم درخواست زیاد است. سؤال کوتاه‌تری بفرست.";
  return "دریافت پاسخ ممکن نشد. دوباره تلاش کن یا از پشتیبانی کمک بگیر.";
}

const invalidAnswer = "پاسخ دریافتی قابل خواندن نبود. دوباره تلاش کن.";
const offline = "اتصال اینترنت قطع است. پس از اتصال می‌توانی دوباره ارسال کنی.";
const cancelled = "انتظار در مرورگر متوقف شد. پردازش یا مصرف سهمیه در سرور ممکن است ادامه داشته باشد.";

function init() {
  const byId = (name) => document.getElementById("courseChat" + name);
  const launch = byId("Launch");
  const panel = byId("Panel");
  if (!launch || typeof panel?.show !== "function") return;
  const close = byId("Close");
  const reset = byId("New");
  const expand = byId("Expand");
  const stop = byId("Stop");
  const jump = byId("Jump");
  const log = byId("Log");
  const welcome = byId("Welcome");
  const status = byId("Status");
  const form = byId("Form");
  const input = byId("Input");
  const count = byId("Count");
  const send = byId("Send");
  const widget = launch.parentElement;
  const avatarTemplate = panel.querySelector(".course-chat-brand");
  const viewport = window.visualViewport;
  const compact = matchMedia("(max-width: 639px), (max-width: 940px) and (max-height: 540px)");
  const exchanges = [];
  let pending;
  let restored;
  let followLatest = true;
  let modal = false;

  function nearLatest() {
    return log.scrollHeight - log.scrollTop - log.clientHeight <= 52;
  }

  function updateJump() {
    jump.hidden = log.hidden || followLatest || nearLatest();
  }

  function scrollToLatest() {
    followLatest = true;
    log.scrollTop = log.scrollHeight;
    updateJump();
  }

  function fitInput() {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
  }

  function fitViewport() {
    if (!panel.open) return;
    const keyboard = viewport && viewport.scale === 1;
    if (keyboard) {
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      widget.style.setProperty("--chat-keyboard-offset", `${offset}px`);
      widget.style.setProperty("--chat-viewport-height", `${viewport.height}px`);
    } else {
      widget.style.removeProperty("--chat-keyboard-offset");
      widget.style.removeProperty("--chat-viewport-height");
    }
    fitInput();
    if (followLatest) scrollToLatest();
  }

  function togglePanel(open, { restore = true, focus } = {}) {
    if (open === panel.open) return;
    if (open) {
      launch.hidden = true;
      modal = compact.matches;
      if (modal && !openModal(panel)) {
        launch.hidden = false;
        return;
      }
      if (!modal) panel.show();
      launch.setAttribute("aria-expanded", "true");
      fitViewport();
      const initial = focus ?? (modal || matchMedia("(pointer: coarse)").matches ? close : input);
      initial.focus({ preventScroll: true });
      updateJump();
    } else {
      launch.hidden = false;
      launch.setAttribute("aria-expanded", "false");
      closeDialog(panel);
      widget.style.removeProperty("--chat-keyboard-offset");
      widget.style.removeProperty("--chat-viewport-height");
      if (restore) launch.focus({ preventScroll: true });
    }
  }

  function controls() {
    const length = input.value.length;
    count.textContent = `${fa.format(length)} از ${fa.format(input.maxLength)} نویسه`;
    count.classList.toggle("at-limit", length >= input.maxLength);
    send.disabled = Boolean(pending) || !navigator.onLine || !input.value.trim() || length > input.maxLength;
    stop.hidden = !pending;
    for (const exchange of exchanges) {
      if (exchange.retry) exchange.retry.disabled = Boolean(pending) || !navigator.onLine;
    }
    if (panel.open) fitInput();
  }

  function setStatus(text, state) {
    status.textContent = text;
    status.dataset.state = state ?? "";
  }

  function createExchange(question) {
    const element = document.createElement("div");
    element.className = "course-chat-exchange";
    const prompt = document.createElement("p");
    prompt.className = "course-chat-message course-chat-message-user";
    prompt.dir = "auto";
    prompt.textContent = question;
    const response = document.createElement("div");
    response.className = "course-chat-result";
    element.append(prompt, response);
    const exchange = { question, element, response };
    welcome.hidden = true;
    log.hidden = false;
    exchanges.push(exchange);
    log.append(element);
    if (exchanges.length > visibleExchangeLimit) exchanges.shift().element.remove();
    scrollToLatest();
    return exchange;
  }

  function copyControl(label, text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "course-chat-text-button";
    button.textContent = label;
    let feedback;
    button.addEventListener("click", async () => {
      const success = await copyText(text, panel);
      if (!button.isConnected || !panel.open) return;
      const result = success ? "کپی شد" : "کپی نشد؛ متن را انتخاب کن.";
      button.textContent = result;
      clearTimeout(feedback);
      feedback = setTimeout(() => { button.textContent = label; }, 2600);
    });
    return button;
  }

  function showAnswer(exchange, text) {
    const answer = document.createElement("div");
    answer.className = "course-chat-answer";
    const bubble = document.createElement("div");
    bubble.className = "course-chat-message";
    bubble.dir = "auto";
    renderAnswer(bubble, text, copyControl);
    const avatar = avatarTemplate.cloneNode(true);
    avatar.classList.add("course-chat-avatar");
    const copy = copyControl("کپی پاسخ", text);
    copy.classList.add("course-chat-copy");
    answer.append(bubble, avatar);
    exchange.response.replaceChildren(answer, copy);
    exchange.answer = text;
  }

  function showFailure(exchange, text) {
    const state = document.createElement("div");
    state.className = "course-chat-failure";
    const note = document.createElement("p");
    note.textContent = text;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "course-chat-text-button";
    retry.textContent = "تلاش دوباره";
    retry.addEventListener("click", () => start(exchange));
    exchange.retry = retry;
    state.append(note, retry);
    exchange.response.replaceChildren(state);
    if (!input.value) {
      restored = exchange;
      input.value = exchange.question;
    }
  }

  function requestBody(exchange) {
    // Retry in place using only completed exchanges preceding this question.
    const history = exchanges.slice(0, exchanges.indexOf(exchange)).filter(turn => turn.answer)
      .slice(-(historyMessageLimit / 2)).flatMap(turn => [
        { role: "user", content: turn.question }, { role: "assistant", content: turn.answer },
      ]);
    for (let start = 0; start <= history.length; start += 2) {
      const body = JSON.stringify({ message: exchange.question, history: history.slice(start) });
      if (encoder.encode(body).byteLength <= requestBodyLimit) return body;
    }
    return null;
  }

  function clearRequest(request) {
    clearTimeout(request.timeout);
    clearTimeout(request.slow);
    pending = undefined;
  }

  function finish(request, { answer, error, abort = false, stopped = false }) {
    if (pending !== request) return;
    const stick = followLatest;
    const focusStop = document.activeElement === stop;
    clearRequest(request);
    if (abort) request.controller.abort();
    if (answer) {
      showAnswer(request.exchange, answer);
      setStatus("", "success");
    } else {
      showFailure(request.exchange, error);
      setStatus(stopped ? "انتظار متوقف شد." : "پاسخی دریافت نشد. جزئیات زیر سؤال آمده است.", stopped ? "cancelled" : "error");
    }
    controls();
    if (focusStop && panel.open) input.focus({ preventScroll: true });
    if (stick) scrollToLatest();
    else updateJump();
  }

  async function execute(request, body) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body,
        signal: request.controller.signal,
      });
    } catch {
      const error = navigator.onLine ? "ارتباط با دستیار برقرار نشد. اینترنتت را بررسی کن و دوباره تلاش کن." : offline;
      finish(request, { error });
      return;
    }
    if (pending !== request) return;
    const data = await response.json().catch(() => null);
    if (pending !== request) return;
    if (!response.ok) {
      finish(request, { error: responseError(response, data?.error?.code) });
    } else if (typeof data?.answer === "string" && data.answer.trim()) {
      finish(request, { answer: data.answer });
    } else {
      finish(request, { error: invalidAnswer });
    }
  }

  function start(exchange) {
    if (pending || !navigator.onLine || !exchanges.includes(exchange) || exchange.answer) return;
    const body = requestBody(exchange);
    if (!body) {
      showFailure(exchange, "حجم درخواست بیش از حد مجاز است.");
      controls();
      return;
    }
    const focusRetry = document.activeElement === exchange.retry;
    exchange.response.replaceChildren();
    exchange.retry = undefined;
    if (restored === exchange && input.value === exchange.question) input.value = "";
    restored = undefined;
    const request = { exchange, controller: new AbortController() };
    pending = request;
    request.timeout = setTimeout(() => finish(request, {
      error: "پاسخ در زمان انتظار نرسید. می‌توانی خودت دوباره تلاش کنی.", abort: true,
    }), requestTimeout);
    request.slow = setTimeout(() => {
      if (pending === request) setStatus("پاسخ هنوز آماده نشده؛ منتظریم.", "pending");
    }, slowResponseDelay);
    if (focusRetry || document.activeElement === send) input.focus({ preventScroll: true });
    setStatus("در حال آماده‌سازی پاسخ…", "pending");
    controls();
    if (followLatest) scrollToLatest();
    void execute(request, body);
  }

  launch.addEventListener("click", () => togglePanel(true));
  close.addEventListener("click", () => togglePanel(false));
  panel.addEventListener("cancel", (event) => {
    event.preventDefault();
    togglePanel(false);
  });
  panel.addEventListener("keydown", (event) => {
    if (!modal && event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      togglePanel(false);
    }
  });
  compact.addEventListener("change", () => {
    if (panel.open) {
      const previous = panel.contains(document.activeElement) ? document.activeElement : undefined;
      togglePanel(false, { restore: false });
      togglePanel(true, { focus: previous === expand && compact.matches ? close : previous });
    }
  });
  document.addEventListener("focusin", (event) => {
    if (!panel.open || modal || widget.contains(event.target) || !(event.target instanceof HTMLElement)) return;
    const area = panel.getBoundingClientRect();
    const target = event.target.getBoundingClientRect();
    if (target.width > 0 && target.height > 0 && target.left < area.right && target.right > area.left &&
        target.top < area.bottom && target.bottom > area.top) {
      togglePanel(false, { restore: false });
      if (document.activeElement !== event.target) event.target.focus({ preventScroll: true });
    }
  });
  reset.addEventListener("click", () => {
    if (pending) {
      const request = pending;
      clearRequest(request);
      request.controller.abort();
    }
    exchanges.length = 0;
    log.replaceChildren();
    log.hidden = true;
    welcome.hidden = false;
    welcome.scrollTop = 0;
    followLatest = true;
    restored = undefined;
    input.value = "";
    setStatus(navigator.onLine ? "گفتگوی تازه شروع شد." : offline, "reset");
    controls();
    updateJump();
  });
  expand.addEventListener("click", () => {
    const expanded = panel.classList.toggle("expanded");
    expand.setAttribute("aria-pressed", String(expanded));
    expand.setAttribute("aria-label", expanded ? "بازگشت به اندازهٔ عادی" : "باز کردن نمای بزرگ");
    fitViewport();
  });
  stop.addEventListener("click", () => {
    if (pending) finish(pending, { error: cancelled, abort: true, stopped: true });
  });
  jump.addEventListener("click", () => {
    log.focus({ preventScroll: true });
    scrollToLatest();
  });
  log.addEventListener("scroll", () => {
    if (!panel.open) return;
    followLatest = nearLatest();
    updateJump();
  }, { passive: true });
  widget.addEventListener("error", (event) => {
    if (event.target.matches(".course-chat-brand img")) event.target.hidden = true;
  }, true);
  for (const image of widget.querySelectorAll(".course-chat-brand img")) {
    if (image.complete && !image.naturalWidth) image.hidden = true;
  }
  for (const button of welcome.querySelectorAll(".course-chat-suggestions button")) {
    button.addEventListener("click", () => {
      input.value = button.textContent.trim();
      restored = undefined;
      controls();
      input.focus({ preventScroll: true });
    });
  }
  for (const event of ["online", "offline"]) {
    window.addEventListener(event, () => {
      controls();
      if (!pending) setStatus(navigator.onLine ? "دوباره آنلاین شدی. ارسال با خودت است." : offline, event);
    });
  }
  viewport?.addEventListener("resize", fitViewport);
  viewport?.addEventListener("scroll", fitViewport);
  window.addEventListener("resize", fitViewport);
  input.addEventListener("input", () => {
    if (restored?.question !== input.value) restored = undefined;
    controls();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (!send.disabled) form.requestSubmit();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (pending || !navigator.onLine || !question || input.value.length > input.maxLength) return;
    if (restored?.question === question) {
      start(restored);
      return;
    }
    input.value = "";
    start(createExchange(question));
  });
  if (!navigator.onLine) setStatus(offline, "offline");
  controls();
  launch.hidden = false;
}

if (approvedHosts.has(window.location.hostname)) init();
