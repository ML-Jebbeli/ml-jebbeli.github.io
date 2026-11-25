import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, firefox, webkit } from "playwright";
import axe from "axe-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = "https://ml-jebbeli.github.io";
const preview = "https://jebbeli-ai-preview.pages.dev";
const worker = "https://jebbeli-ai-quota-lab-01.sedamir77.workers.dev/";
const support = "https://t.me/Iustech_support";
const matrix = [
  [320, 568], [360, 640], [360, 800], [375, 667], [390, 844], [412, 915], [430, 932],
  [540, 720], [600, 900], [639, 800], [640, 800], [768, 1024], [820, 1180], [844, 390],
  [1024, 600], [1024, 768], [1151, 800], [1152, 800], [1280, 720], [1366, 768],
  [1440, 900], [1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160],
];
const engine = process.env.JEBBELI_BROWSER ?? "chromium";
assert.ok(Object.hasOwn({ chromium, firefox, webkit }, engine), "Unknown Playwright engine");
const defaultAnswer = "دوره از مبانی ریاضی و پایتون تا پیاده‌سازی با PyTorch پیش می‌رود.";
let browser;

before(async () => {
  browser = await { chromium, firefox, webkit }[engine].launch({
    ...(engine === "chromium" && process.env.CHROMIUM_EXECUTABLE && { executablePath: process.env.CHROMIUM_EXECUTABLE }),
  });
});
after(() => browser?.close());

async function pageFor(t, {
  width = 1366, height = 768, theme = "dark", origin = site, path = "/", script = true, motion = "reduce",
  response = async () => ({ json: { answer: defaultAnswer } }), missing = () => false, initialize, beforeOpen,
} = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, reducedMotion: motion, javaScriptEnabled: script,
    hasTouch: width < 640, serviceWorkers: "block",
  });
  t.after(() => context.close());
  await context.addInitScript((theme) => localStorage.setItem("theme", theme), theme);
  if (initialize) await context.addInitScript(initialize);
  const errors = [];
  const missingFiles = [];
  const calls = [];
  const localPaths = [];
  const releaseAssets = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.url() === worker) {
      const headers = {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-expose-headers": "Retry-After",
      };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      assert.equal(request.method(), "POST");
      calls.push(request.postDataJSON());
      const mock = await response(calls.at(-1), calls.length);
      if (mock?.abort) return route.abort("failed");
      return route.fulfill({ ...mock, headers: { ...headers, ...mock?.headers } }).catch(() => {});
    }
    if (url.origin !== origin) return route.abort("failed");
    const name = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = join(root, name);
    assert.ok(file.startsWith(root));
    localPaths.push(name);
    if (name.endsWith(".js") || name.endsWith(".css")) releaseAssets.push(name + url.search);
    if (missing(name)) return route.fulfill({ status: 404 });
    try {
      await route.fulfill({ path: file });
    } catch {
      missingFiles.push(name);
      await route.fulfill({ status: 404 }).catch(() => {});
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  if (beforeOpen) await beforeOpen(page);
  await page.goto(origin + path, { waitUntil: "load" });
  if (script) await page.locator("#themeToggle").waitFor();
  return { context, page, errors, calls, localPaths, missingFiles, releaseAssets };
}

const visible = (locator) => locator.waitFor({ state: "visible" });
const hidden = (locator) => locator.waitFor({ state: "hidden" });
const inputFor = (page) => page.locator("#courseChatInput");
const textOf = (page, selector) => page.locator(selector).textContent();

async function openChat(page) {
  await page.locator("#courseChatLaunch").click();
  await visible(page.locator("#courseChatPanel[open]"));
}

async function ask(page, question, expectedAnswers) {
  const input = inputFor(page);
  await input.fill(question);
  await input.press("Enter");
  if (expectedAnswers !== undefined) await visible(page.locator(".course-chat-answer").nth(expectedAnswers - 1));
}

for (const [width, height] of engine === "chromium" ? matrix : [[390, 844], [844, 390], [1366, 768]]) {
  for (const theme of ["dark", "light"]) {
    test(`layout ${width}x${height} ${theme}`, async (t) => {
      const { page, errors, missingFiles, localPaths } = await pageFor(t, { width, height, theme });
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const line = [...document.querySelectorAll(".journey-line")].find(el => getComputedStyle(el).display !== "none").getBoundingClientRect();
        const nodes = [...document.querySelectorAll(".stage-node")];
        return {
          theme: document.documentElement.dataset.theme,
          reflows: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          bodyOverflow: getComputedStyle(document.body).overflowX,
          navFits: document.querySelector(".nav-inner").scrollWidth <= rect(".nav-inner").width + 1,
          desktopNav: getComputedStyle(document.querySelector(".nav-links")).display !== "none",
          noTinyTargets: [".hero-ctas .btn-primary", ".theme-toggle", ".course-chat-launch"].every(s => rect(s).height >= 44),
          heroAction: rect(".hero-ctas .btn-primary").bottom < innerHeight,
          heroActionsClear: rect(".hero-ctas").bottom <= rect(".course-chat-launch").top,
          aligned: nodes.every(el => Math.abs(el.getBoundingClientRect().left + el.offsetWidth / 2 - line.left - line.width / 2) <= 1),
          lineHeight: Number.parseFloat(getComputedStyle(document.querySelector(".hero-sub")).lineHeight),
          overflowAssets: [...document.querySelectorAll(".hero, .container, .stage-card, .course-body, .faq-q")]
            .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className),
          courseMaxWidth: rect("#course .container").width,
        };
      });
      assert.equal(layout.theme, theme);
      assert.equal(layout.bodyOverflow, "visible");
      assert.ok(layout.reflows && layout.navFits && layout.noTinyTargets && layout.heroAction && layout.aligned, JSON.stringify(layout));
      if (width === 320) assert.ok(layout.heroActionsClear, JSON.stringify(layout));
      assert.equal(layout.desktopNav, width >= 1152);
      assert.ok(layout.lineHeight >= 24 && layout.courseMaxWidth <= 1216);
      assert.deepEqual(layout.overflowAssets, []);
      assert.deepEqual(errors, []);
      assert.deepEqual(missingFiles, []);
      assert.ok(!localPaths.some(path => path === "ax.png" || path.endsWith(".mp4") || /^0[1-8]-.*\.png$/u.test(path)));
    });
  }
}

test("mobile menu locks the background, reaches all links in landscape, and reconciles with desktop", async (t) => {
  const { page } = await pageFor(t, { width: 844, height: 390 });
  const toggle = page.locator("#navToggle");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("href")), "#mainContent");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await visible(page.locator("#mobileMenu[aria-modal='true']"));
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY), "hidden");
  const menu = page.locator("#mobileMenu");
  assert.ok(await menu.evaluate(el => el.scrollHeight > el.clientHeight));
  await visible(menu.getByRole("link", { name: /اعلام علاقه/ }));
  await page.keyboard.press("Escape");
  await hidden(menu);
  assert.equal(await page.evaluate(() => document.activeElement.id), "navToggle");
  await toggle.click();
  await page.setViewportSize({ width: 1366, height: 768 });
  await hidden(menu);
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await toggle.click();
  await page.locator("#mobileMenu [href='#faq']").click();
  await hidden(menu);
  await page.waitForURL(/#faq$/);
  await page.waitForFunction(() => document.querySelector(".mobile-menu-link[href='#faq']").getAttribute("aria-current") === "location");
  const offsets = await page.evaluate(() => ({
    top: document.querySelector("#faq").getBoundingClientRect().top,
    lowerNav: document.querySelector("#navbar").getBoundingClientRect().bottom,
  }));
  assert.ok(offsets.top >= offsets.lowerNav);
});

test("direct hash, headings, links and FAQ survive decorative script or external resource failure", async (t) => {
  const { page } = await pageFor(t, { width: 320, height: 568, path: "/#faq", script: false });
  assert.equal(await page.locator("h1").count(), 1);
  assert.equal(await page.locator("#stages .stage").count(), 6);
  assert.equal(await page.locator("#galleryGrid .cert-card").count(), 7);
  await visible(page.locator("#faq-answer-6"));
  await visible(page.locator(".nav-link[href='#course']"));
  assert.equal(await page.locator("#resList a").count(), 11);
  await page.locator(".nav-link[href='#course']").click();
  await page.waitForURL(/#course$/);
  assert.equal(await page.locator(".hero-ctas .btn-primary").getAttribute("href"), support);
  assert.equal(await page.locator(".final-ctas .btn-primary").getAttribute("href"), support);
});

test("theme, accordion expansion and resource keyboard controls", async (t) => {
  const { page, errors } = await pageFor(t, { width: 320, height: 568, path: "/#faq" });
  await page.locator("#themeToggle").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.reload({ waitUntil: "load" });
  await visible(page.locator("#faq-answer-1"));
  const final = page.locator("#faq-question-6");
  await final.press("Enter");
  assert.equal(await final.getAttribute("aria-expanded"), "true");
  await hidden(page.locator("#faq-answer-1"));
  const answer = page.locator("#faq-answer-6");
  await visible(answer);
  assert.ok(await answer.evaluate(el => el.scrollHeight <= el.clientHeight + 1));
  const first = page.getByRole("tab", { name: "PyTorch" });
  await first.focus();
  await first.press("ArrowLeft");
  const selected = page.getByRole("tab", { selected: true });
  assert.match(await selected.textContent(), /جبر خطی/u);
  const resources = page.getByRole("tabpanel");
  assert.equal(await resources.getByRole("link").count(), 4);
  await resources.locator(".res-thumb").first().scrollIntoViewIfNeeded();
  await resources.locator("img[hidden]").first().waitFor({ state: "attached" });
  assert.ok(await resources.locator(".res-thumb > svg").first().isVisible());
  assert.deepEqual(errors, []);
});

test("gallery and video load on demand, restore focus and recover from media errors", async (t) => {
  let failVideo = true;
  const { page, localPaths, errors } = await pageFor(t, {
    width: 844, height: 390, path: "/#instructor",
    missing: name => name.endsWith(".mp4") && failVideo,
  });
  const gallery = page.locator(".cert-card").first();
  await gallery.scrollIntoViewIfNeeded();
  await page.locator(".cert-thumb img").first().evaluate(img => img.decode());
  assert.ok(!localPaths.some(name => /^0[1-8]-.*\.png$/u.test(name)));
  await gallery.press("Enter");
  await visible(page.locator("#lightbox[aria-modal='true']"));
  assert.match(await textOf(page, "#lbCap"), /۱ از ۷/u);
  await page.keyboard.press("ArrowLeft");
  assert.match(await textOf(page, "#lbCap"), /۲ از ۷/u);
  const closeButton = page.locator(".lb-close");
  assert.equal(await closeButton.evaluate(el => document.activeElement === el), true);
  const outside = await page.locator("#themeToggle").evaluate(el => {
    el.focus();
    return document.activeElement === el;
  });
  assert.equal(outside, false);
  await page.keyboard.press("Escape");
  await hidden(page.locator("#lightbox"));
  assert.equal(await gallery.evaluate(el => document.activeElement === el), true);
  assert.ok(!localPaths.some(name => name.endsWith(".mp4")));
  const videoCard = page.locator("#videoCard");
  await videoCard.press("Enter");
  await visible(page.locator("#vmRecovery"));
  assert.match(await textOf(page, "#vmStatus"), /پخش ویدیو ممکن نشد/u);
  failVideo = false;
  await page.locator("#vmRetry").click();
  const canPlay = await page.locator("#vmVideo").evaluate(el => el.canPlayType("video/mp4; codecs=avc1.64001f"));
  if (canPlay) await page.waitForFunction(() => document.querySelector("#vmVideo").readyState >= 1);
  await page.locator(".vm-close").click();
  await hidden(page.locator("#videoModal"));
  await page.waitForFunction(() => !document.querySelector("video").hasAttribute("src"));
  assert.deepEqual(errors, []);
});

test("asset fallbacks preserve controls when the portrait, gallery thumbnail and logo fail", async (t) => {
  const { page, calls } = await pageFor(t, { width: 390, height: 844,
    missing: name => name.startsWith("assets/iustech-") || name.startsWith("assets/instructor-") || name.startsWith("assets/01-"),
  });
  await visible(page.locator(".photo-box .photo-fallback"));
  await page.locator(".cert-card").first().scrollIntoViewIfNeeded();
  await visible(page.locator(".cert-thumb.image-unavailable").first());
  await openChat(page);
  await hidden(page.locator(".course-chat-header .course-chat-brand img"));
  assert.equal(calls.length, 0);
});

test("clipboard fallback distinguishes success from failure", async (t) => {
  const { page } = await pageFor(t, { initialize: () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("Denied")) } });
    document.execCommand = () => Boolean(window.copyPermitted);
  } });
  const button = page.locator("#copyBtn");
  await button.click();
  await page.waitForFunction(() => document.querySelector("#copyStatus").textContent.includes("ممکن نشد"));
  await visible(page.locator("#copyMsg"));
  await page.evaluate(() => { window.copyPermitted = true; });
  await button.click();
  await page.waitForFunction(() => document.querySelector("#copyStatus").textContent === "پیام کپی شد.");
});

const formatted = [
  "### توضیح آزمایشی", "",
  "متن فارسی **پررنگ** همراه `torch.nn` و رابطهٔ y = Wx + b.", "",
  "- یک مورد", "- مورد دوم", "", "1. First item", "2. Second item", "",
  "| Model | معیار |", "| --- | --- |", "| Linear | دقت |", "",
  "```python", "value = " + "'x'".repeat(180), "<script>window.injection = true;</script>", "```", "",
  "[ویرایش](https://example.org/reference) https://example.org/" + "x".repeat(180), "",
  "[bad](javascript:alert(1)) [bad](data:text/html,svg) http://example.org [login](https://user@evil.invalid)",
  "<svg onload='window.injection=true'></svg><img src='https://evil.invalid/image' onerror='window.injection=true'>",
].join("\n");

test("chat formats multilingual answers and copies raw text without creating unsafe HTML or destinations", async (t) => {
  const { page, calls, errors } = await pageFor(t, {
    width: 390, height: 844, origin: preview, response: async () => ({ json: { answer: formatted } }),
    initialize: () => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text) => { window.copiedText = text; } } });
    },
  });
  await openChat(page);
  const input = inputFor(page);
  await page.locator(".course-chat-suggestions button").first().click();
  assert.notEqual(await input.inputValue(), "");
  assert.equal(calls.length, 0);
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await input.press("Shift+Enter");
  assert.ok((await input.inputValue()).includes("\n"));
  assert.equal(calls.length, 0);
  await ask(page, "پیش‌نیاز دوره چیست؟", 1);
  assert.deepEqual(calls, [{ message: "پیش‌نیاز دوره چیست؟", history: [] }]);
  const answer = page.locator(".course-chat-answer .course-chat-message");
  assert.equal(await answer.locator("h3").count(), 1);
  assert.equal(await answer.locator("strong").textContent(), "پررنگ");
  assert.equal(await answer.locator("ol li").count(), 2);
  assert.equal(await answer.locator("ul li").count(), 2);
  assert.equal(await answer.locator("table th").count(), 2);
  assert.equal(await answer.locator("pre").getAttribute("dir"), "ltr");
  assert.ok(await answer.locator("pre").evaluate(el => el.scrollWidth > el.clientWidth));
  assert.deepEqual(await answer.locator("a").evaluateAll(links => links.map(link => [link.protocol, link.hostname, link.rel])),
    [["https:", "example.org", "noopener noreferrer"], ["https:", "example.org", "noopener noreferrer"]]);
  assert.equal(await answer.locator("iframe, img, script, svg").count(), 0);
  assert.equal(await page.evaluate(() => window.injection), undefined);
  await answer.getByRole("button", { name: "کپی کد" }).click();
  assert.match(await page.evaluate(() => window.copiedText), /value = /u);
  await page.getByRole("button", { name: "کپی پاسخ" }).click();
  assert.equal(await page.evaluate(() => window.copiedText), formatted);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.deepEqual(errors, []);
});

test("HTTP and network failures are distinct from success and can be retried only by the user", async (t) => {
  const replies = [
    [{ status: 400, json: { error: { code: "INVALID_MESSAGE" } } }, /درخواست را بخواند/u],
    [{ status: 429, json: { error: { code: "DAILY_AI_LIMIT_REACHED" } }, headers: { "Retry-After": "125" } }, /سهمیهٔ روزانه.*۲ دقیقه و ۵ ثانیه/u],
    [{ status: 429, json: { error: { code: "AI_QUOTA_EXHAUSTED" } }, headers: { "Retry-After": "60" } }, /سهمیهٔ روزانه.*۱ دقیقه/u],
    [{ status: 503, json: { error: { code: "AI_AT_CAPACITY" } }, headers: { "Retry-After": "30" } }, /موقتاً.*۳۰ ثانیه/u],
    [{ body: "<bad>" }, /قابل خواندن نبود/u],
    [{ json: { answer: "  " } }, /قابل خواندن نبود/u],
    [{ abort: true }, /ارتباط با دستیار برقرار نشد/u],
  ];
  const { page, calls } = await pageFor(t, {
    beforeOpen: page => page.clock.install(),
    response: async (_, index) => replies[index - 1]?.[0] ?? { json: { answer: defaultAnswer } },
  });
  await openChat(page);
  await ask(page, "دوره چه پیش‌نیازهایی دارد؟");
  for (const [index, [reply, expected]] of replies.entries()) {
    await visible(page.locator(".course-chat-failure"));
    assert.match(await textOf(page, ".course-chat-failure p"), expected);
    assert.equal(calls.length, index + 1);
    assert.equal(await page.locator(".course-chat-exchange").count(), 1);
    const retry = page.getByRole("button", { name: "تلاش دوباره" });
    if (reply.headers?.["Retry-After"]) {
      assert.equal(await retry.isDisabled(), true);
      await page.clock.fastForward(Number(reply.headers["Retry-After"]) * 1000 + 15);
      assert.equal(calls.length, index + 1);
    }
    await retry.click();
  }
  await visible(page.locator(".course-chat-answer"));
  assert.equal(calls.length, replies.length + 1);
  assert.equal(await page.locator(".course-chat-exchange").count(), 1);
  assert.equal(await inputFor(page).inputValue(), "");
  assert.ok(calls.every(call => call.history.length === 0));
});

function gate() {
  let resume;
  const waiting = new Promise(resolve => { resume = resolve; });
  return { resume, waiting };
}

test("stop and new conversation reject late responses, preserve drafts, and prevent double submit", async (t) => {
  const first = gate();
  const second = gate();
  t.after(() => { first.resume(); second.resume(); });
  const { page, calls } = await pageFor(t, {
    response: async (_, i) => {
      if (i <= 2) await [first, second][i - 1].waiting;
      return { json: { answer: i <= 2 ? "پاسخ دیرهنگام" : defaultAnswer } };
    },
    initialize: () => {
      const fetch = window.fetch.bind(window);
      window.abortsObserved = 0;
      window.fetch = (url, opts) => {
        opts.signal?.addEventListener("abort", () => window.abortsObserved++, { once: true });
        return fetch(url, { ...opts, signal: undefined });
      };
    },
  });
  await openChat(page);
  await ask(page, "پرسش نخست");
  await visible(page.locator("#courseChatStop"));
  await inputFor(page).fill("متن تازه در حال تایپ");
  await inputFor(page).press("Enter");
  await page.locator("#courseChatStop").click();
  await visible(page.locator(".course-chat-failure"));
  assert.match(await textOf(page, ".course-chat-failure p"), /پردازش یا مصرف سهمیه/u);
  assert.equal(await inputFor(page).inputValue(), "متن تازه در حال تایپ");
  first.resume();
  await page.getByRole("button", { name: "تلاش دوباره" }).click();
  await visible(page.locator("#courseChatStop"));
  await page.locator("#courseChatNew").click();
  second.resume();
  await visible(page.locator("#courseChatWelcome"));
  await ask(page, "گفتگوی تازه", 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.at(-1), { message: "گفتگوی تازه", history: [] });
  assert.equal(await page.evaluate(() => window.abortsObserved), 2);
  assert.equal(await page.locator(".course-chat-exchange").count(), 1);
  assert.doesNotMatch(await textOf(page, "#courseChatLog"), /پاسخ دیرهنگام/u);
});

test("timeout, offline and reconnect preserve input and issue no automatic retry", async (t) => {
  const held = gate();
  t.after(() => held.resume());
  const { page, calls } = await pageFor(t, {
    beforeOpen: p => p.clock.install(),
    response: async (_, i) => {
      if (i === 1) await held.waiting;
      return { json: { answer: defaultAnswer } };
    },
  });
  await openChat(page);
  await ask(page, "سؤال زمان‌دار");
  await page.clock.fastForward(60_005);
  await visible(page.locator(".course-chat-failure"));
  assert.match(await textOf(page, ".course-chat-failure p"), /زمان انتظار/u);
  assert.equal(await inputFor(page).inputValue(), "سؤال زمان‌دار");
  held.resume();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
  });
  assert.ok(await page.locator("#courseChatSend").isDisabled());
  assert.match(await textOf(page, "#courseChatStatus"), /اتصال اینترنت قطع است/u);
  await page.evaluate(() => {
    delete navigator.onLine;
    window.dispatchEvent(new Event("online"));
  });
  assert.match(await textOf(page, "#courseChatStatus"), /آنلاین/u);
  assert.equal(calls.length, 1);
  await inputFor(page).press("Enter");
  await visible(page.locator(".course-chat-answer"));
  assert.equal(calls.length, 2);
  assert.equal(await page.locator(".course-chat-exchange").count(), 1);
});

test("keeps six history messages, caps the visible transcript, and retains it only in page memory", { skip: engine !== "chromium" }, async (t) => {
  const { page, calls } = await pageFor(t);
  await openChat(page);
  for (let i = 1; i <= 62; i++) {
    await ask(page, `سؤال ${i}`, Math.min(i, 60));
    await page.locator("#courseChatStop").waitFor({ state: "hidden" });
  }
  assert.equal(calls.length, 62);
  assert.deepEqual(calls.at(-1).history.filter(turn => turn.role === "user").map(turn => turn.content), ["سؤال 59", "سؤال 60", "سؤال 61"]);
  assert.equal(calls.at(-1).history.length, 6);
  assert.equal(await page.locator(".course-chat-exchange").count(), 60);
  assert.match(await textOf(page, ".course-chat-exchange:first-child .course-chat-message-user"), /سؤال 3/u);
  await page.locator("#courseChatClose").click();
  await openChat(page);
  assert.equal(await page.locator(".course-chat-exchange").count(), 60);
  assert.deepEqual(await page.evaluate(() => [Object.keys(localStorage), sessionStorage.length, document.cookie]), [["theme"], 0, ""]);
  await page.reload({ waitUntil: "load" });
  await openChat(page);
  assert.equal(await page.locator(".course-chat-exchange").count(), 0);
});

test("request byte and character limits drop whole historical pairs", async (t) => {
  const { page, calls } = await pageFor(t, { response: async (_, index) => ({ json: { answer: index === 1 ? "آ".repeat(18000) : defaultAnswer } }) });
  await openChat(page);
  const input = inputFor(page);
  await ask(page, "آ".repeat(500), 1);
  assert.equal(calls[0].message.length, 500);
  await input.evaluate(el => { el.value = "x".repeat(501); el.dispatchEvent(new Event("input")); });
  assert.ok(await page.locator("#courseChatSend").isDisabled());
  await input.press("Enter");
  assert.equal(calls.length, 1);
  await ask(page, "آزمون حجم بدنه", 2);
  assert.deepEqual(calls[1].history, []);
  assert.ok(calls.every(request => Buffer.byteLength(JSON.stringify(request)) <= 32 * 1024));
});

test("mobile keyboard viewport, expanded panel and scroll anchoring maintain access", async (t) => {
  const held = gate();
  t.after(() => held.resume());
  const { page } = await pageFor(t, {
    width: 390, height: 844,
    response: async (_, i) => {
      if (i === 4) await held.waiting;
      return { json: { answer: defaultAnswer.repeat(25) } };
    },
  });
  await openChat(page);
  const panel = page.locator("#courseChatPanel[open]");
  assert.equal(await panel.getAttribute("aria-modal"), "true");
  await page.evaluate(() => {
    Object.defineProperties(visualViewport, { height: { configurable: true, value: 345 },
      offsetTop: { configurable: true, value: 0 }, scale: { configurable: true, value: 1 } });
    visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction(() => document.querySelector(".course-chat").style.getPropertyValue("--chat-viewport-height") === "345px");
  for (const locator of [panel, inputFor(page), page.locator("#courseChatClose")]) {
    const box = await locator.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 346, JSON.stringify(box));
  }
  await page.evaluate(() => {
    for (const name of ["height", "offsetTop", "scale"]) delete visualViewport[name];
    visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForFunction(() => document.querySelector("#courseChatPanel").getAttribute("aria-modal") === null);
  const original = (await panel.boundingBox()).width;
  await page.locator("#courseChatExpand").click();
  assert.ok((await panel.boundingBox()).width > original && original >= 480);
  const jump = page.locator("#courseChatJump");
  for (let i = 1; i <= 3; i++) await ask(page, `گفتگوی ${i}`, i);
  await ask(page, "پاسخ دیرتر");
  const log = page.locator("#courseChatLog");
  await log.evaluate(el => { el.scrollTop = 0; });
  await visible(jump);
  held.resume();
  await visible(page.locator(".course-chat-answer").nth(3));
  assert.equal(await log.evaluate(el => el.scrollTop), 0);
  await jump.click();
  await hidden(jump);
  assert.ok(await log.evaluate(el => el.scrollTop > 0));
});

test("chat never activates on unrelated hostnames", async (t) => {
  const { page, calls } = await pageFor(t, { origin: "https://ml-jebbeli.github.io.example.invalid" });
  await hidden(page.locator("#courseChatLaunch"));
  assert.equal(calls.length, 0);
});

test("canvas stays static with reduced motion, pauses when hidden, and survives missing optional APIs", { skip: engine !== "chromium" }, async (t) => {
  const { page, errors } = await pageFor(t, { width: 390, height: 844, initialize: () => {
    window.animationTicks = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(time => {
      if (cb.name === "tick") window.animationTicks++;
      cb(time);
    });
  } });
  assert.equal(await page.evaluate(() => window.animationTicks), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(() => window.animationTicks > 1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const snapshot = await page.evaluate(() => window.animationTicks);
  await page.locator(".hero").evaluate(el => el.getBoundingClientRect().width);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.animationTicks), snapshot);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(start => window.animationTicks > start, snapshot);
  await page.evaluate(() => { window.scrollTo({ top: document.querySelector("#projects").offsetTop, behavior: "instant" }); });
  await page.waitForTimeout(150);
  const quiet = await page.evaluate(() => window.animationTicks);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.animationTicks), quiet);
  assert.deepEqual(errors, []);
  const fallback = await pageFor(t, { initialize: () => {
    window.IntersectionObserver = undefined;
    HTMLCanvasElement.prototype.getContext = () => null;
  } });
  await openChat(fallback.page);
  await visible(fallback.page.locator("#courseChatInput"));
  assert.deepEqual(fallback.errors, []);
});

test("axe WCAG AA audits both themes and modal/chat interactions", { skip: engine !== "chromium" }, async (t) => {
  for (const theme of ["dark", "light"]) {
    const { page } = await pageFor(t, { theme, width: 390, height: 844, missing: name => name.endsWith(".mp4") });
    await page.addScriptTag({ content: axe.source });
    const audit = async (label) => {
      const violations = await page.evaluate(async () => {
        const { violations } = await window.axe.run({
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
        });
        return violations.map(({ id, impact, nodes }) => ({
          id, impact, selectors: nodes.map(node => node.target.join(" ")),
        }));
      });
      const critical = violations.filter(v => ["serious", "critical"].includes(v.impact));
      assert.deepEqual(critical, [], JSON.stringify({ theme, label, violations }));
      if (violations.length) t.diagnostic(JSON.stringify({ theme, label, violations }));
    };
    await audit("page");
    await page.locator("#navToggle").click();
    await audit("menu");
    await page.keyboard.press("Escape");
    await openChat(page);
    await audit("chat welcome");
    await ask(page, "آزمون دسترس‌پذیری", 1);
    await audit("chat response");
    await page.locator("#courseChatClose").click();
    await page.locator(".cert-card").first().click();
    await audit("gallery");
    await page.keyboard.press("Escape");
    await page.locator("#videoCard").click();
    await visible(page.locator("#vmRecovery"));
    await audit("video error");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1366, height: 768 });
    await openChat(page);
    assert.equal(await page.locator("#courseChatPanel").getAttribute("aria-modal"), null);
    await audit("desktop chat");
  }
});

test("the previously hidden research ID image is absent from current public files and references", async (t) => {
  const { page } = await pageFor(t);
  const filename = "08-research-assistant-id-card.png";
  await assert.rejects(access(join(root, filename)), { code: "ENOENT" });
  const body = await page.content();
  assert.ok(!body.includes(filename) && !body.includes("SHOW_ID_CARD"));
  assert.ok(!body.includes("user-scalable=no") && !body.includes("maximum-scale="));
});

test("an older failed exchange cannot change the context of a later successful conversation", async (t) => {
  const { page, calls } = await pageFor(t, { response: async ({ message }) => message === "A"
    ? { status: 400, json: {} } : { json: { answer: "Answer " + message } } });
  await openChat(page);
  await ask(page, "A");
  await visible(page.locator(".course-chat-failure"));
  await ask(page, "B", 1);
  const retry = page.getByRole("button", { name: "تلاش دوباره" });
  assert.equal(await retry.isDisabled(), true);
  await retry.dispatchEvent("click");
  await ask(page, "C", 2);
  assert.deepEqual(calls.map(call => call.message), ["A", "B", "C"]);
  assert.deepEqual(calls[2].history, [{ role: "user", content: "B" }, { role: "assistant", content: "Answer B" }]);
  assert.deepEqual(await page.locator(".course-chat-message-user").allTextContents(), ["A", "B", "C"]);
});

test("retry keeps its original context after transcript pruning and preserves an unrelated draft", { skip: engine !== "chromium" }, async (t) => {
  let retry = false;
  const { page, calls } = await pageFor(t, {
    response: async ({ message }) => message === "P" || retry ? { json: { answer: defaultAnswer } } : { status: 400, json: {} },
  });
  await openChat(page);
  await ask(page, "P", 1);
  const stop = page.locator("#courseChatStop");
  for (let i = 0; i < 61; i++) {
    await ask(page, "A" + i);
    await hidden(stop);
  }
  assert.equal(await page.locator(".course-chat-message-user").first().textContent(), "A1");
  await inputFor(page).fill("پیش‌نویس تازه");
  retry = true;
  await page.getByRole("button", { name: "تلاش دوباره" }).first().click();
  await visible(page.locator(".course-chat-answer"));
  assert.deepEqual(calls.at(-1), {
    message: "A1", history: [{ role: "user", content: "P" }, { role: "assistant", content: defaultAnswer }],
  });
  assert.equal(await inputFor(page).inputValue(), "پیش‌نویس تازه");
  assert.equal(await page.locator(".course-chat-exchange").count(), 60);
});

test("an HTTP-date Retry-After survives close, reopen and reset until its exact deadline", async (t) => {
  const initial = Date.parse("2026-11-26T10:00:00Z");
  const { page, calls } = await pageFor(t, {
    beforeOpen: page => page.clock.install({ time: initial }),
    response: async (_, i) => i === 1
      ? { status: 429, headers: { "Retry-After": new Date(initial + 120_000).toUTCString() }, json: { error: { code: "RATE_LIMITED" } } }
      : { json: { answer: defaultAnswer } },
  });
  await openChat(page);
  await ask(page, "A");
  await visible(page.locator(".course-chat-failure"));
  assert.equal(await page.getByRole("button", { name: "تلاش دوباره" }).isDisabled(), true);
  await page.locator("#courseChatClose").click();
  await openChat(page);
  await page.locator("#courseChatNew").click();
  await inputFor(page).fill("B");
  await inputFor(page).press("Enter");
  assert.equal(await page.locator("#courseChatSend").isDisabled(), true);
  const remaining = await page.evaluate(deadline => deadline - Date.now(), initial + 119_000);
  await page.clock.fastForward(remaining);
  assert.equal(await page.locator("#courseChatSend").isDisabled(), true);
  await page.clock.fastForward(1100);
  await page.waitForFunction(() => !document.querySelector("#courseChatSend").disabled);
  assert.equal(calls.length, 1);
  await inputFor(page).press("Enter");
  await visible(page.locator(".course-chat-answer"));
  assert.deepEqual(calls[1], { message: "B", history: [] });
});

test("resize keeps the pending request, input selection and scroll position through dialog mode changes", async (t) => {
  const held = gate();
  t.after(() => held.resume());
  const { page, calls } = await pageFor(t, {
    response: async (_, i) => {
      if (i === 3) await held.waiting;
      return { json: { answer: defaultAnswer.repeat(32) } };
    },
  });
  await openChat(page);
  await ask(page, "one", 1);
  await ask(page, "two", 2);
  await ask(page, "pending");
  await visible(page.locator("#courseChatStop"));
  await inputFor(page).fill("متن آزمایشی در حال نوشتن");
  await inputFor(page).evaluate(input => input.setSelectionRange(3, 7));
  const log = page.locator("#courseChatLog");
  const initialScroll = await log.evaluate(el => { el.scrollTop = 38; return el.scrollTop; });
  await visible(page.locator("#courseChatJump"));
  await page.setViewportSize({ width: 390, height: 844 });
  await visible(page.locator("#courseChatPanel[aria-modal='true']"));
  await page.evaluate(() => {
    Object.defineProperties(visualViewport, {
      width: { configurable: true, value: 375 }, height: { configurable: true, value: 245 },
      offsetLeft: { configurable: true, value: 8 }, offsetTop: { configurable: true, value: 10 },
      scale: { configurable: true, value: 1.2 },
    });
    visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction(() => document.querySelector(".course-chat").style.getPropertyValue("--chat-viewport-height") === "245px");
  for (const locator of [inputFor(page), page.locator("#courseChatClose"), page.locator("#courseChatStop")]) {
    const box = await locator.boundingBox();
    assert.ok(box && box.y >= 10 && box.y + box.height <= 255 && box.x >= 8 && box.x + box.width <= 383, JSON.stringify(box));
  }
  assert.equal(await inputFor(page).evaluate(el => document.activeElement === el), true);
  assert.deepEqual(await inputFor(page).evaluate(el => [el.selectionStart, el.selectionEnd]), [3, 7]);
  assert.ok(Math.abs(await log.evaluate(el => el.scrollTop) - initialScroll) <= 3);
  await page.evaluate(() => {
    for (const property of ["width", "height", "offsetLeft", "offsetTop", "scale"]) delete visualViewport[property];
    visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await visible(page.locator("#courseChatPanel[aria-modal='true']"));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForFunction(() => document.querySelector("#courseChatPanel").getAttribute("aria-modal") === null);
  held.resume();
  await visible(page.locator(".course-chat-answer").nth(2));
  assert.equal(await inputFor(page).inputValue(), "متن آزمایشی در حال نوشتن");
  assert.equal(calls.length, 3);
});

test("a gallery modal owns focus during rotation and ignores stale image events", async (t) => {
  const { page } = await pageFor(t, { missing: name => /^0[1-7]-.*\.png$/u.test(name) });
  await openChat(page);
  const previouslyFocused = await page.evaluate(() => document.activeElement.id);
  await page.locator(".cert-card").first().evaluate(link => link.click());
  await visible(page.locator("#lightbox[aria-modal='true']"));
  const old = await page.locator("#lbImg").elementHandle();
  await page.locator(".lb-next").click();
  await page.locator("#lbImg[hidden]").waitFor({ state: "attached" });
  await old.dispatchEvent("load");
  await visible(page.locator("#lbStatus"));
  assert.match(await page.locator("#lbStatus").textContent(), /نمایش تصویر ممکن نشد/u);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator("#courseChatPanel").getAttribute("aria-modal"), null);
  await page.keyboard.press("Escape");
  await visible(page.locator("#courseChatPanel[aria-modal='true']"));
  assert.equal(await page.evaluate(() => document.activeElement.id), previouslyFocused);
});

test("a closed video cannot report errors into a newly opened player", async (t) => {
  const { page } = await pageFor(t, { initialize: () => {
    window.pendingPlayback = [];
    HTMLMediaElement.prototype.play = function () {
      return new Promise((resolve, reject) => window.pendingPlayback.push({ resolve, reject }));
    };
  } });
  const video = page.locator("#videoCard");
  await video.click();
  const prior = await page.locator("#vmVideo").elementHandle();
  await page.locator(".vm-close").click();
  await video.click();
  await page.waitForFunction(() => window.pendingPlayback.length === 2);
  await prior.dispatchEvent("error");
  await page.evaluate(() => window.pendingPlayback[0].reject(new Error("Old playback")));
  await hidden(page.locator("#vmRecovery"));
  assert.equal(await page.locator("#videoModal").evaluate(el => el.open), true);
});

test("advanced Markdown preserves numbering, nesting, math, escaped pipes and malformed text", async (t) => {
  const text = [
    "## عنوان", "#### زیرعنوان", "", "7. نخست", "   - درون‌گذاری", "   - دادهٔ دوم", "12. English",
    "", "| Type | Value |", "| --- | --- |", "| Math | `a|b` |", "| Escaped | x\\|y |",
    "", "\\*literal\\* و `P(A|B)` و \\(a^2 + b^2\\)", "",
    "[invalid](javascript:alert(1)) <svg onload='window.attack=true'>", "",
    "```python", "<img src='https://attacker.invalid/track'>",
  ].join("\n");
  const { page } = await pageFor(t, {
    response: async () => ({ json: { answer: text } }),
    initialize: () => Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => { window.rawCopy = text; } } }),
  });
  await openChat(page);
  await ask(page, "آزمون ریاضی", 1);
  const answer = page.locator(".course-chat-answer .course-chat-message");
  assert.equal(await answer.locator("h3").textContent(), "عنوان");
  assert.equal(await answer.locator("h4").textContent(), "زیرعنوان");
  assert.deepEqual(await answer.locator("ol > li").evaluateAll(items => items.map(item => item.value)), [7, 12]);
  assert.equal(await answer.locator("ol > li > ul > li").count(), 2);
  assert.equal(await answer.locator("tbody code").textContent(), "a|b");
  assert.match(await answer.locator("tbody").textContent(), /x\|y/u);
  assert.ok((await answer.textContent()).includes("\\(a^2 + b^2\\)"));
  assert.ok((await answer.textContent()).includes("```python"));
  assert.equal(await answer.locator("a, img, svg, iframe, script").count(), 0);
  await page.locator(".course-chat-copy").click();
  assert.equal(await page.evaluate(() => window.rawCopy), text);
});

test("legacy optional APIs and a narrow high-DPI forced-color layout keep controls reachable", { skip: engine !== "chromium" }, async (t) => {
  const { page, errors } = await pageFor(t, {
    width: 320, height: 580,
    initialize: () => {
      Array.prototype.findLast = undefined;
      Object.hasOwn = undefined;
      window.IntersectionObserver = undefined;
      window.ResizeObserver = undefined;
      window.visualViewport = undefined;
      const match = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const list = match(query);
        return { get matches() { return list.matches; }, addListener: fn => list.addListener(fn) };
      };
    },
  });
  await page.emulateMedia({ forcedColors: "active" });
  await page.addStyleTag({ content: "main p, main h2, main h3 { line-height: 1.6 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }" });
  await openChat(page);
  await ask(page, "آزمون", 1);
  assert.ok(await page.locator("#courseChatClose").isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  assert.deepEqual(errors, []);
});

test("a 4K high-DPI canvas fits in its backing-store budget and pauses behind a modal", { skip: engine !== "chromium" }, async (t) => {
  const { page, context } = await pageFor(t, {
    width: 3840, height: 2160, motion: "no-preference",
    initialize: () => {
      window.canvasFrames = 0;
      const frame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => frame(time => {
        if (cb.name === "tick") window.canvasFrames++;
        cb(time);
      });
    },
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 3840, height: 2160, deviceScaleFactor: 2, mobile: false });
  await page.waitForFunction(() => document.querySelector("#heroCanvas").width > 300);
  assert.ok(await page.locator("#heroCanvas").evaluate(canvas => canvas.width * canvas.height <= 1_200_000));
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page);
  assert.ok(await page.locator("html").evaluate(el => el.classList.contains("dialog-open")));
  const frame = await page.evaluate(() => window.canvasFrames);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.canvasFrames), frame);
});

test("fresh and repeat loads use one version across all local entry points and module dependencies", async (t) => {
  const { page, releaseAssets, errors, missingFiles } = await pageFor(t);
  const entry = new Set([
    "site.css", "course-chat.css", "site.js", "course-chat.js", "site-ui.js", "course-chat-render.js",
  ]);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(new Set(releaseAssets.map(asset => asset.split("?")[0])), entry);
    assert.equal(new Set(releaseAssets.map(asset => asset.split("?")[1])).size, 1);
    assert.ok(releaseAssets.every(asset => /\?v=\d+$/u.test(asset)));
    await openChat(page);
    releaseAssets.length = 0;
    await page.reload();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(missingFiles, []);
});
