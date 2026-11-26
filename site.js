import { closeDialog, copyText, listenToMedia, openModal } from "./site-ui.js?v=6";

const page = document.documentElement;
const byId = (id) => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const desktopNavigation = matchMedia("(min-width: 72rem)");
const portrait = matchMedia("(orientation: portrait)");
const nav = byId("navbar");
const menu = byId("mobileMenu");
const menuToggle = byId("navToggle");
const themeToggle = byId("themeToggle");
const floatingLink = byId("floatTg");

function bindModal(dialog) {
  const close = () => closeDialog(dialog);
  dialog.querySelector("[data-close]").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const { top, right, bottom, left } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) close();
  });
}

function initNavigation() {
  const links = [...document.querySelectorAll(".nav-link, .mobile-menu-link")];
  const sections = [...document.querySelectorAll(".nav-link")].map((link) => byId(link.hash.slice(1)));
  const bottomUp = sections.slice().reverse();
  let renderedSection;
  let scrollFrame = 0;

  function updateNavigation() {
    scrollFrame = 0;
    let section = sections[0];
    if (scrollY > 24) {
      const boundary = nav.getBoundingClientRect().bottom + 48;
      section = bottomUp.find((section) => section.getBoundingClientRect().top <= boundary) ?? section;
    }
    if (section !== renderedSection) {
      renderedSection = section;
      for (const link of links) {
        if (link.hash === "#" + section.id) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    }
    nav.classList.toggle("scrolled", scrollY > 24);
    floatingLink.classList.toggle("show", scrollY > innerHeight * .6);
  }

  function scheduleNavigation() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateNavigation);
  }

  if (typeof menu.showModal === "function") {
    bindModal(menu);
    page.classList.add("has-navigation");
    menuToggle.hidden = false;
    menuToggle.addEventListener("click", () => {
      if (!openModal(menu)) return;
      menuToggle.setAttribute("aria-expanded", "true");
      menu.querySelector("[data-close]").focus({ preventScroll: true });
    });
    menu.addEventListener("close", () => {
      if (!menu.open) menuToggle.setAttribute("aria-expanded", "false");
    });
    for (const link of menu.querySelectorAll(".mobile-menu-link")) {
      link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        closeDialog(menu);
        const target = byId(link.hash.slice(1));
        target?.setAttribute("tabindex", "-1");
        target?.focus({ preventScroll: true });
      });
    }
    listenToMedia(desktopNavigation, (event) => {
      if (!menu.open || !event.matches) return;
      closeDialog(menu);
      nav.querySelector(".nav-link[aria-current]")?.focus({ preventScroll: true });
    });
    listenToMedia(portrait, () => closeDialog(menu));
  }
  updateNavigation();
  window.addEventListener("scroll", scheduleNavigation, { passive: true });
  window.addEventListener("resize", scheduleNavigation);
  window.addEventListener("hashchange", scheduleNavigation);
  window.addEventListener("pageshow", scheduleNavigation);
}

function initResourceTabs() {
  const tabList = byId("resTabs");
  const tabs = [...tabList.querySelectorAll("button")];
  const panels = tabs.map((tab) => byId(tab.getAttribute("aria-controls")));

  function select(index, focus = false) {
    for (const [i, tab] of tabs.entries()) {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      tab.classList.toggle("active", i === index);
      panels[i].hidden = i !== index;
    }
    if (focus) tabs[index].focus();
  }

  tabList.setAttribute("role", "tablist");
  for (const [i, tab] of tabs.entries()) {
    tab.setAttribute("role", "tab");
    panels[i].setAttribute("role", "tabpanel");
    panels[i].setAttribute("aria-labelledby", tab.id);
    tab.addEventListener("click", () => select(i));
    tab.addEventListener("keydown", (event) => {
      const offsets = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 1, ArrowUp: -1 };
      let next;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else if (Object.prototype.hasOwnProperty.call(offsets, event.key)) next = (i + offsets[event.key] + tabs.length) % tabs.length;
      else return;
      event.preventDefault();
      select(next, true);
    });
  }
  select(0);
  tabList.hidden = false;
  byId("resources").classList.add("has-resource-tabs");

  if (typeof IntersectionObserver !== "function") return;
  const thumbnails = new IntersectionObserver((entries, observer) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      const image = document.createElement("img");
      image.alt = "";
      image.width = 320;
      image.height = 180;
      image.referrerPolicy = "no-referrer";
      image.decoding = "async";
      image.addEventListener("error", () => { image.hidden = true; }, { once: true });
      image.src = target.dataset.thumbnail;
      target.append(image);
    }
  }, { rootMargin: "120px 0px" });
  byId("resList").querySelectorAll("[data-thumbnail]").forEach((thumbnail) => thumbnails.observe(thumbnail));
}

function initFaq() {
  const buttons = [...byId("faqList").querySelectorAll(".faq-q")];
  function setExpanded(button, expanded) {
    button.setAttribute("aria-expanded", String(expanded));
    byId(button.getAttribute("aria-controls")).hidden = !expanded;
  }
  for (const [i, button] of buttons.entries()) {
    setExpanded(button, i === 0);
    button.addEventListener("click", () => {
      const wasOpen = button.getAttribute("aria-expanded") === "true";
      for (const candidate of buttons) setExpanded(candidate, candidate === button && !wasOpen);
    });
  }
}

function initImageFallbacks() {
  for (const image of document.querySelectorAll("[data-portrait], .nav-logo-icon img, .cert-thumb img, .video-poster")) {
    function showFallback() {
      image.hidden = true;
      const parent = image.parentElement;
      if (image.hasAttribute("data-portrait")) parent.classList.add("image-unavailable");
      if (parent.classList.contains("cert-thumb")) {
        parent.classList.add("image-unavailable");
        const placeholder = document.createElement("span");
        placeholder.textContent = "تصویر کوچک در دسترس نیست";
        parent.replaceChildren(placeholder);
      }
    }
    image.addEventListener("error", showFallback, { once: true });
    if (image.complete && !image.naturalWidth) showFallback();
  }
}

function initGallery() {
  const dialog = byId("lightbox");
  if (typeof dialog.showModal !== "function") return;
  const cards = [...document.querySelectorAll(".cert-card")];
  const caption = byId("lbCap");
  const status = byId("lbStatus");
  const full = byId("lbFull");
  const number = new Intl.NumberFormat("fa-IR");
  let image;
  let current = 0;
  let swipeStart;

  const loaded = ({ currentTarget }) => {
    if (currentTarget === image && dialog.open) status.textContent = "";
  };
  const failed = ({ currentTarget }) => {
    if (currentTarget !== image || !dialog.open) return;
    image.hidden = true;
    status.textContent = "نمایش تصویر ممکن نشد. پیوند تصویر اصلی را امتحان کنید.";
  };

  function show(index) {
    current = (index + cards.length) % cards.length;
    const card = cards[current];
    const title = card.querySelector(".cert-cap").textContent.trim();
    caption.textContent = `${number.format(current + 1)} از ${number.format(cards.length)} — ${title}`;
    status.textContent = "در حال بارگیری تصویر…";
    image?.remove();
    image = document.createElement("img");
    image.id = "lbImg";
    image.className = "lb-img";
    image.alt = title;
    image.addEventListener("load", loaded, { once: true });
    image.addEventListener("error", failed, { once: true });
    full.href = card.href;
    image.src = card.href;
    status.before(image);
  }
  bindModal(dialog);
  for (const [index, card] of cards.entries()) {
    card.setAttribute("aria-haspopup", "dialog");
    card.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !openModal(dialog)) return;
      event.preventDefault();
      show(index);
      dialog.querySelector("[data-close]").focus({ preventScroll: true });
    });
  }
  dialog.addEventListener("close", () => {
    if (!dialog.open && image) {
      image.remove();
      image.removeAttribute("src");
      image = undefined;
    }
  });
  dialog.querySelector(".lb-prev").addEventListener("click", () => show(current - 1));
  dialog.querySelector(".lb-next").addEventListener("click", () => show(current + 1));
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    show(current + (event.key === "ArrowLeft" ? 1 : -1));
  });
  const imageRegion = dialog.querySelector(".lb-inner");
  imageRegion.addEventListener("touchstart", ({ touches }) => {
    swipeStart = touches.length === 1 ? [touches[0].clientX, touches[0].clientY] : null;
  }, { passive: true });
  imageRegion.addEventListener("touchend", ({ changedTouches, touches }) => {
    if (!swipeStart || touches.length || !changedTouches.length) return;
    const dx = changedTouches[0].clientX - swipeStart[0];
    const dy = changedTouches[0].clientY - swipeStart[1];
    swipeStart = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) show(current + (dx < 0 ? 1 : -1));
  }, { passive: true });
  imageRegion.addEventListener("touchcancel", () => { swipeStart = null; });
}

function initVideo() {
  const trigger = byId("videoCard");
  const dialog = byId("videoModal");
  if (typeof dialog.showModal !== "function") return;
  let player = byId("vmVideo");
  const recovery = byId("vmRecovery");
  const status = byId("vmStatus");
  const retry = byId("vmRetry");
  let playback = 0;

  function unload(video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  const playing = ({ currentTarget }) => {
    if (currentTarget === player && dialog.open) recovery.hidden = true;
  };
  const failed = ({ currentTarget }) => {
    if (currentTarget === player && player.hasAttribute("src")) report("پخش ویدیو ممکن نشد. دوباره تلاش کنید یا فایل ویدیو را باز کنید.");
  };

  function report(message) {
    if (!dialog.open) return;
    status.textContent = message;
    recovery.hidden = false;
  }

  function play({ focus = false } = {}) {
    const attempt = ++playback;
    recovery.hidden = true;
    const previous = player;
    unload(previous);
    player = previous.cloneNode(false);
    previous.replaceWith(player);
    player.addEventListener("playing", playing);
    player.addEventListener("error", failed);
    if (focus) player.focus({ preventScroll: true });
    player.poster = player.dataset.poster;
    player.src = trigger.href;
    player.play()?.catch((error) => {
      if (attempt !== playback || error.name === "AbortError") return;
      report(error.name === "NotAllowedError" ? "برای شروع، دکمهٔ پخش ویدیو را بزنید." :
        "پخش ویدیو ممکن نشد. دوباره تلاش کنید یا فایل ویدیو را باز کنید.");
    });
  }
  bindModal(dialog);
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !openModal(dialog)) return;
    event.preventDefault();
    dialog.querySelector("[data-close]").focus({ preventScroll: true });
    play();
  });
  retry.addEventListener("click", () => play({ focus: true }));
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    playback++;
    unload(player);
    recovery.hidden = true;
  });
}

function initCanvas(canvas) {
  let ctx;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return () => {};
  }
  if (!ctx) return () => {};

  let width = 0;
  let height = 0;
  let ratio = 0;
  let points = [];
  let edges = [];
  let dotColor;
  let pulseColor;
  let frame = 0;
  let nextFrame = 0;
  let visible = false;
  const canObserve = typeof IntersectionObserver === "function";
  const frameInterval = navigator.connection?.saveData || matchMedia("(pointer: coarse)").matches ? 67 : 42;
  const pixelBudget = 1200000;

  function geometry() {
    const { clientWidth, clientHeight } = canvas;
    if (!clientWidth || !clientHeight) return;
    const nextRatio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(pixelBudget / (clientWidth * clientHeight)));
    if (width === clientWidth && height === clientHeight && ratio === nextRatio) return;
    width = clientWidth;
    height = clientHeight;
    ratio = nextRatio;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);

    const columns = Math.max(5, Math.min(12, Math.floor(width / 125)));
    const rows = Math.max(3, Math.min(7, Math.floor(height / 105)));
    points = [];
    edges = [];
    for (let x = 0; x < columns; x++) {
      for (let y = 0; y < rows; y++) {
        points.push({
          x: ((x + .35 + Math.random() * .3) / columns) * width,
          y: ((y + .35 + Math.random() * .3) / rows) * height,
        });
        const index = points.length - 1;
        if (x > 0) edges.push([index - rows, index]);
        if (x > 0 && y > 0 && (x + y) % 2 === 0) edges.push([index - rows - 1, index]);
        if (y > 0 && x % 2 === 0) edges.push([index - 1, index]);
      }
    }
  }

  function readColors() {
    const colors = getComputedStyle(page);
    dotColor = `rgba(${colors.getPropertyValue("--nn-node")},.66)`;
    pulseColor = `rgba(${colors.getPropertyValue("--nn-node2")},.7)`;
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    for (const [i, j] of edges) {
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[j].x, points[j].y);
    }
    ctx.globalAlpha = .34;
    ctx.strokeStyle = pulseColor;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    for (const point of points) {
      ctx.moveTo(point.x + 2, point.y);
      ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
    }
    ctx.fill();
    if (!time) return;

    ctx.fillStyle = pulseColor;
    ctx.beginPath();
    for (let i = 1; i < edges.length; i += 11) {
      const [a, b] = edges[i];
      const progress = (time / 2600 + i * .089) % 1;
      const x = points[a].x + (points[b].x - points[a].x) * progress;
      const y = points[a].y + (points[b].y - points[a].y) * progress;
      ctx.moveTo(x + 2.5, y);
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function tick(time) {
    frame = 0;
    draw(time);
    nextFrame = setTimeout(() => {
      nextFrame = 0;
      frame = requestAnimationFrame(tick);
    }, Math.max(0, frameInterval - (performance.now() - time)));
  }

  function reconcile() {
    const drawable = visible && !document.hidden && !page.classList.contains("dialog-open");
    if (drawable) geometry();
    if (!drawable || reducedMotion.matches || !canObserve) {
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(nextFrame);
      frame = 0;
      nextFrame = 0;
      if (drawable) draw(0);
    } else if (!frame && !nextFrame) {
      draw(0);
      frame = requestAnimationFrame(tick);
    }
  }

  readColors();
  if (canObserve) {
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; reconcile(); });
    observer.observe(canvas);
  } else {
    visible = true;
    reconcile();
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(reconcile).observe(canvas);
  else window.addEventListener("resize", reconcile, { passive: true });
  document.addEventListener("visibilitychange", reconcile);
  document.addEventListener("site-modal-change", reconcile);
  listenToMedia(reducedMotion, reconcile);
  return () => {
    readColors();
    if (visible && !document.hidden) draw(0);
  };
}

initNavigation();
initResourceTabs();
initFaq();
initGallery();
initVideo();
initImageFallbacks();

const redraw = [];
function initCanvases() {
  redraw.push(initCanvas(byId("heroCanvas")), initCanvas(byId("finalCanvas")));
}
if (typeof requestIdleCallback === "function") requestIdleCallback(initCanvases, { timeout: 1000 });
else requestAnimationFrame(initCanvases);
function setTheme(theme) {
  page.dataset.theme = theme;
  byId("metaTheme").content = theme === "light" ? "#f8fafc" : "#080b14";
  themeToggle.setAttribute("aria-pressed", String(theme === "light"));
  for (const paint of redraw) paint();
}
setTheme(page.dataset.theme);
themeToggle.hidden = false;
themeToggle.addEventListener("click", () => {
  const theme = page.dataset.theme === "light" ? "dark" : "light";
  try { localStorage.setItem("theme", theme); } catch {}
  setTheme(theme);
});

byId("year").textContent = new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(new Date().getFullYear());
const copyButton = byId("copyBtn");
const preparedMessage = byId("copyMsg");
copyButton.hidden = false;
copyButton.addEventListener("click", async () => {
  copyButton.disabled = true;
  const copied = await copyText(preparedMessage.textContent.slice(1, -1));
  copyButton.disabled = false;
  copyButton.focus({ preventScroll: true });
  byId("copyStatus").textContent = copied ? "پیام کپی شد." : "کپی خودکار ممکن نشد. می‌توانید متن زیر را انتخاب و کپی کنید.";
  preparedMessage.hidden = false;
});

const chatBanner = byId("courseChatLaunch");
const bannerLogo = chatBanner.querySelector("img");
const refreshBannerLogo = () => {
  bannerLogo.hidden = !bannerLogo.naturalWidth;
  bannerLogo.parentElement.classList.toggle("has-image", !bannerLogo.hidden);
};
for (const event of ["load", "error"]) bannerLogo.addEventListener(event, refreshBannerLogo);
if (bannerLogo.complete) refreshBannerLogo();
if (new URLSearchParams(location.search).get("legacy-chat") === "1") {
  void import("./course-chat.js?v=6");
}
