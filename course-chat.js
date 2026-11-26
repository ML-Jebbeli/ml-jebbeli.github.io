import { closeDialog, hasOtherModal, listenToMedia, openModal } from "./site-ui.js?v=6";
import { approvedHosts } from "./chat-request.js?v=6";
import { createChatSession } from "./chat-session.js?v=6";
import { createTranscript } from "./chat-transcript.js?v=6";

const variantPreference = "course-chat-layout";
const fa = new Intl.NumberFormat("fa-IR");

function init() {
  const byId = (name) => document.getElementById("courseChat" + name);
  const banner = byId("Launch");
  const panel = byId("Panel");
  if (!banner || typeof panel?.show !== "function") return;
  const launch = document.createElement("button");
  launch.id = banner.id;
  launch.className = banner.className;
  launch.type = "button";
  launch.setAttribute("aria-expanded", "false");
  launch.setAttribute("aria-controls", panel.id);
  launch.append(...banner.childNodes);
  banner.replaceWith(launch);
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
  const variantToggle = byId("Variant");
  const rail = byId("Rail");
  const recent = byId("Recent");
  const recentList = recent.querySelector("ul");
  const widget = launch.parentElement;
  const avatarTemplate = panel.querySelector(".course-chat-brand");
  const viewport = window.visualViewport;
  const compact = matchMedia("(max-width: 639px), (max-width: 940px) and (max-height: 540px)");
  const transcript = createTranscript({
    container: log, avatarTemplate, copyRoot: panel, canCopy: () => panel.open,
    retryTurn: turn => start(turn.user.content, turn.id),
  });
  const { exchanges } = transcript;
  const positions = new Map();
  const picker = byId("History");
  const warning = byId("Storage");
  const session = createChatSession("embedded", render);
  let displayed;
  let currentDraft;
  let historyOptions;
  const viewportProperties = ["--chat-viewport-height", "--chat-viewport-width", "--chat-viewport-left", "--chat-viewport-right", "--chat-keyboard-offset"];
  let followLatest = true;
  let modal = false;
  let changingMode = false;
  let viewportFrame = 0;

  function nearLatest() {
    return log.scrollHeight - log.scrollTop - log.clientHeight <= 52;
  }

  function updateJump() {
    jump.hidden = log.hidden || followLatest || nearLatest();
  }

  function updateRecent() {
    if (rail.hidden) return;
    const turns = exchanges.slice(-3).reverse();
    const items = turns.map(({ question, element }) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dir = "auto";
      button.textContent = question;
      button.addEventListener("click", () => {
        log.focus({ preventScroll: true });
        log.scrollTop += element.getBoundingClientRect().top - log.getBoundingClientRect().top;
        followLatest = nearLatest();
        updateJump();
      });
      item.append(button);
      return item;
    });
    recentList.replaceChildren(...items);
    recent.hidden = turns.length === 0;
  }

  function selectVariant(focused, remember = false) {
    // Keep the reading position when longer lines rewrap in the other layout.
    const keepPosition = panel.open && !log.hidden && !followLatest;
    const logTop = keepPosition ? log.getBoundingClientRect().top : 0;
    const anchor = keepPosition
      ? exchanges.find(({ element }) => element.getBoundingClientRect().bottom > logTop)?.element : null;
    const offset = anchor ? anchor.getBoundingClientRect().top - logTop : 0;
    const layout = focused ? "focused" : "classic";
    widget.dataset.variant = layout;
    variantToggle.setAttribute("aria-pressed", String(focused));
    rail.hidden = !focused;
    updateRecent();
    if (remember) {
      try { localStorage.setItem(variantPreference, layout); } catch {}
    }
    if (panel.open) {
      fitViewport();
      if (anchor) log.scrollTop += anchor.getBoundingClientRect().top - log.getBoundingClientRect().top - offset;
      updateJump();
    }
  }

  function scrollToLatest() {
    followLatest = true;
    log.scrollTop = log.scrollHeight;
    updateJump();
  }

  function fitInput() {
    const limit = panel.clientHeight < 330 ? 44 : Math.min(120, Math.floor(panel.clientHeight / 4));
    input.style.height = "auto";
    const height = input.scrollHeight + input.offsetHeight - input.clientHeight;
    input.style.height = `${Math.min(limit, height)}px`;
  }

  function fitViewport() {
    if (!panel.open) return;
    const scroll = log.scrollTop;
    const height = viewport?.height || window.innerHeight;
    widget.toggleAttribute("data-short-viewport", height < 420);
    const width = viewport?.width || window.innerWidth;
    const top = viewport?.offsetTop || 0;
    const left = viewport?.offsetLeft || 0;
    const right = Math.max(0, window.innerWidth - width - left);
    const bottom = Math.max(0, window.innerHeight - height - top);
    for (const [index, value] of [height, width, left, right, bottom].entries()) {
      widget.style.setProperty(viewportProperties[index], `${value}px`);
    }
    fitInput();
    if (followLatest) scrollToLatest();
    else log.scrollTop = scroll;
  }

  function scheduleViewport() {
    if (!panel.open || viewportFrame) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      fitViewport();
    });
  }

  function showPanel() {
    modal = compact.matches && typeof panel.showModal === "function";
    if (modal) return openModal(panel);
    panel.show();
    return true;
  }

  function togglePanel(open, { restore = true } = {}) {
    if (open === panel.open) return;
    if (open) {
      launch.hidden = true;
      if (!showPanel()) {
        launch.hidden = false;
        return;
      }
      launch.setAttribute("aria-expanded", "true");
      fitViewport();
      const initial = modal || matchMedia("(pointer: coarse)").matches ? close : input;
      initial.focus({ preventScroll: true });
      updateJump();
    } else {
      launch.hidden = false;
      launch.setAttribute("aria-expanded", "false");
      closeDialog(panel);
      cancelAnimationFrame(viewportFrame);
      viewportFrame = 0;
      for (const property of viewportProperties) widget.style.removeProperty(property);
      if (restore) launch.focus({ preventScroll: true });
    }
  }

  function syncDialogMode() {
    if (changingMode || !panel.open || modal === compact.matches || hasOtherModal(panel) ||
        typeof panel.showModal !== "function") return;
    const active = panel.contains(document.activeElement) ? document.activeElement : close;
    const selection = active === input ? [input.selectionStart, input.selectionEnd, input.selectionDirection] : null;
    const scroll = log.scrollTop;
    const welcomeScroll = welcome.scrollTop;
    changingMode = true;
    closeDialog(panel);
    showPanel();
    fitViewport();
    const focus = active.getClientRects().length ? active : close;
    focus.focus({ preventScroll: true });
    if (selection) input.setSelectionRange(...selection);
    if (!followLatest) log.scrollTop = scroll;
    welcome.scrollTop = welcomeScroll;
    updateJump();
    changingMode = false;
  }

  function controls() {
    const length = input.value.length;
    count.textContent = `${fa.format(length)} از ${fa.format(input.maxLength)} نویسه`;
    count.classList.toggle("at-limit", length >= input.maxLength);
    const unavailable = session.blocked();
    send.disabled = unavailable || !input.value.trim() || length > input.maxLength;
    stop.hidden = !session.waiting;
    for (const exchange of exchanges) {
      if (exchange.retry) exchange.retry.disabled = !session.canRetry(exchange.turn);
    }
    if (panel.open) fitInput();
  }

  function setStatus(text, state) {
    if (status.textContent !== text) status.textContent = text;
    status.dataset.state = state ?? "";
    status.parentElement.classList.toggle("has-status", text !== "");
    status.parentElement.classList.toggle("is-pending", state === "pending");
  }

  function render() {
    const { active, draft, waiting } = session;
    const switched = active !== displayed;
    const valueChanged = draft !== currentDraft;
    const focusStop = document.activeElement === stop;
    const oldScroll = log.scrollTop;
    if (switched) {
      if (displayed) positions.set(displayed, { scroll: oldScroll, follow: followLatest, welcome: welcome.scrollTop });
      displayed = active;
      transcript.clear();
      followLatest = positions.get(active)?.follow ?? true;
    }
    if (switched || valueChanged) input.value = draft;
    currentDraft = draft;

    const options = session.list().map(record => [record.id, session.title(record)]);
    if (!options.some(([id]) => id === active)) options.unshift([active, "گفتگوی جدید"]);
    const serialized = JSON.stringify(options);
    if (historyOptions !== serialized) {
      picker.replaceChildren(...options.map(([id, title]) => new Option(title, id)));
      historyOptions = serialized;
    }
    picker.value = active;
    warning.textContent = session.warning;
    warning.hidden = !session.warning;

    const turns = session.current()?.turns ?? [];
    const changed = transcript.update(turns, session);
    log.hidden = !turns.length;
    welcome.hidden = !log.hidden;
    if (switched) welcome.scrollTop = positions.get(active)?.welcome ?? 0;
    if (changed || switched) updateRecent();
    const { text, state } = session.status;
    setStatus(text, state);
    controls();
    if (focusStop && !waiting && panel.open) input.focus({ preventScroll: true });
    if (switched || changed) {
      if (followLatest) scrollToLatest();
      else log.scrollTop = switched ? positions.get(active)?.scroll ?? 0 : oldScroll;
    }
    updateJump();
  }

  function saveDraft() {
    currentDraft = input.value;
    void session.saveDraft(input.value);
    controls();
  }

  function start(question, retryId) {
    if (input.readOnly || session.blocked()) return;
    if (!retryId && question) followLatest = true;
    if (document.activeElement === send || document.activeElement?.closest(".course-chat-failure")) {
      input.focus({ preventScroll: true });
    }
    void session.send(question, retryId);
    controls();
  }

  launch.addEventListener("click", () => togglePanel(true));
  close.addEventListener("click", () => togglePanel(false));
  variantToggle.addEventListener("click", () => selectVariant(widget.dataset.variant !== "focused", true));
  for (const link of rail.querySelectorAll('a[href^="#"]')) {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const section = document.getElementById(link.hash.slice(1));
      togglePanel(false, { restore: !section });
      if (section) {
        if (!section.hasAttribute("tabindex")) section.tabIndex = -1;
        section.focus({ preventScroll: true });
      }
    });
  }
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
  listenToMedia(compact, syncDialogMode);
  document.addEventListener("site-modal-change", syncDialogMode);
  document.addEventListener("focusin", (event) => {
    if (changingMode || !panel.open || modal || hasOtherModal(panel) ||
        widget.contains(event.target) || !(event.target instanceof HTMLElement)) return;
    const area = panel.getBoundingClientRect();
    const target = event.target.getBoundingClientRect();
    if (target.width > 0 && target.height > 0 && target.left < area.right && target.right > area.left &&
        target.top < area.bottom && target.bottom > area.top) {
      togglePanel(false, { restore: false });
      if (document.activeElement !== event.target) event.target.focus({ preventScroll: true });
    }
  });
  reset.addEventListener("click", async () => {
    reset.disabled = true;
    input.readOnly = true;
    try {
      await session.create();
    } finally {
      input.readOnly = false;
      reset.disabled = false;
    }
  });
  picker.addEventListener("change", () => session.select(picker.value));
  expand.addEventListener("click", () => {
    const expanded = panel.classList.toggle("expanded");
    expand.setAttribute("aria-pressed", String(expanded));
    expand.setAttribute("aria-label", expanded ? "بازگشت به اندازهٔ عادی" : "باز کردن نمای بزرگ");
    fitViewport();
  });
  stop.addEventListener("click", () => session.stop());
  jump.addEventListener("click", () => {
    log.focus({ preventScroll: true });
    scrollToLatest();
  });
  log.addEventListener("scroll", () => {
    if (!panel.open) return;
    followLatest = nearLatest();
    updateJump();
  }, { passive: true });
  function syncBrandImage(image) {
    const available = Boolean(image.naturalWidth);
    image.hidden = !available;
    image.parentElement.classList.toggle("has-image", available);
  }
  for (const event of ["load", "error"]) {
    widget.addEventListener(event, ({ target }) => {
      if (target.matches(".course-chat-brand img")) syncBrandImage(target);
    }, true);
  }
  for (const image of widget.querySelectorAll(".course-chat-brand img")) {
    if (image.complete) syncBrandImage(image);
  }
  for (const button of welcome.querySelectorAll(".course-chat-suggestions button")) {
    button.addEventListener("click", () => {
      input.value = button.textContent.trim();
      saveDraft();
      input.focus({ preventScroll: true });
    });
  }
  viewport?.addEventListener("resize", scheduleViewport);
  viewport?.addEventListener("scroll", scheduleViewport);
  window.addEventListener("resize", scheduleViewport);
  input.addEventListener("input", saveDraft);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (!send.disabled) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else send.click();
      }
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = input.value.trim();
    const restored = session.current()?.restoredTurn;
    const retry = exchanges.find(exchange => exchange.turn.id === restored && exchange.question === question);
    start(question, retry?.turn.id);
  });
  render();
  let savedVariant;
  try { savedVariant = localStorage.getItem(variantPreference); } catch {}
  if (savedVariant === "focused") selectVariant(true);
  launch.hidden = false;
}

if (approvedHosts.has(location.hostname) && new URLSearchParams(location.search).get("legacy-chat") === "1") init();
