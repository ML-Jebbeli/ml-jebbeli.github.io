import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const origin = "https://ml-jebbeli.github.io";
const worker = "https://jebbeli-ai-quota-lab-01.sedamir77.workers.dev/";
const replies = {
  malformed: { body: "{" },
  empty: { json: { answer: "" } },
  invalid: { status: 400, json: {} },
  tooLarge: { status: 413, json: {} },
  unavailable: { status: 503, headers: { "Retry-After": "30" }, json: {} },
  maintenance: { status: 503, json: {} },
  rate: { status: 429, headers: { "Retry-After": "62" }, json: { error: { code: "RATE_LIMITED" } } },
  quota: { status: 429, headers: { "Retry-After": "90061" }, json: { error: { code: "DAILY_AI_LIMIT_REACHED" } } },
  exhausted: { status: 429, headers: { "Retry-After": "Thu, 26 Nov 2026 10:00:00 GMT" }, json: { error: { code: "AI_QUOTA_EXHAUSTED" } } },
  other: { status: 500, json: {} },
};
const browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {});
const [action, root = ".", file = "test/fixtures/content-states.json"] = process.argv.slice(2);
const observed = {};

try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
  });
  const page = await context.newPage();
  let response;
  let unblock;
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.href === worker && route.request().method() === "POST") {
      if (response === "network") return route.abort("failed");
      if (response === "hold") await new Promise(resolve => { unblock = resolve; });
      const reply = replies[response] ?? { json: { answer: "### IUSTech\n\n```\nvalue = 17\n```" } };
      return route.fulfill({ ...reply, headers: { "access-control-allow-origin": origin,
        "access-control-expose-headers": "Retry-After", ...reply.headers } }).catch(() => {});
    }
    if (url.origin !== origin) return route.abort();
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (name.endsWith(".mp4") || /^0[1-7]-.*\.png$/u.test(name)) return route.fulfill({ status: 404 });
    return route.fulfill({ path: join(resolve(root), name) });
  });
  await page.clock.install({ time: new Date("2026-11-26T10:00:00Z") });
  const snapshot = async (key, selector) => { observed[key] = await page.locator(selector).textContent(); };
  const ask = async (word) => {
    await page.locator("#courseChatInput").fill(word);
    await page.locator("#courseChatInput").press("Enter");
  };
  async function load(state = "") {
    response = state;
    await page.clock.setFixedTime(new Date("2026-11-26T10:00:00Z"));
    if (page.url().startsWith(origin)) {
      await page.evaluate(() => {
        localStorage.removeItem("iustech-conversations");
        sessionStorage.removeItem("iustech-selection-embedded");
      });
    }
    await page.goto(origin + "/?" + state);
    await page.locator("#courseChatLaunch").click();
  }
  await load();
  await snapshot("year", "#year");
  await snapshot("count-empty", "#courseChatCount");
  await page.locator(".course-chat-suggestions button").first().click();
  observed.suggestion = await page.locator("#courseChatInput").inputValue();
  await snapshot("count-after-suggestion", "#courseChatCount");
  await page.locator("#courseChatExpand").click();
  observed.expandLabel = await page.locator("#courseChatExpand").getAttribute("aria-label");
  await ask("Example");
  await page.locator(".course-chat-answer").waitFor();
  await snapshot("copy-answer", ".course-chat-copy");
  await snapshot("copy-code", ".course-chat-code-controls button");
  await snapshot("unlabeled-code", ".course-chat-code-controls bdi");
  await page.locator(".course-chat-copy").click();
  await snapshot("copy-feedback", ".course-chat-copy");
  await page.locator("#courseChatNew").click();
  await page.locator("#courseChatWelcome").waitFor();
  await snapshot("reset", "#courseChatStatus");
  for (const state of [...Object.keys(replies), "network"]) {
    await load(state);
    await ask("Example");
    await page.locator(".course-chat-failure").waitFor();
    await snapshot(state, ".course-chat-failure p");
    await snapshot(state + "-status", "#courseChatStatus");
  }
  for (const state of ["cancel", "timeout"]) {
    await load("hold");
    const sent = page.waitForRequest(request => request.url() === worker && request.method() === "POST");
    await ask(state);
    await sent;
    await page.locator("#courseChatStop").waitFor();
    await snapshot("loading", "#courseChatStatus");
    await page.clock.fastForward(12001);
    await snapshot("slow", "#courseChatStatus");
    if (state === "cancel") await page.locator("#courseChatStop").click();
    else await page.clock.fastForward(48001);
    unblock?.();
    await snapshot(state, ".course-chat-failure p");
    await snapshot(state + "-status", "#courseChatStatus");
  }
  await load();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    dispatchEvent(new Event("offline"));
  });
  await snapshot("offline", "#courseChatStatus");
  await page.evaluate(() => { delete navigator.onLine; dispatchEvent(new Event("online")); });
  await snapshot("online", "#courseChatStatus");
  await page.locator("#courseChatClose").click();
  await page.locator(".cert-card").first().click();
  await page.locator("#lbStatus").waitFor();
  await page.waitForFunction(() => document.querySelector("#lbImg").hidden);
  await snapshot("certificate-caption", "#lbCap");
  await snapshot("image-error", "#lbStatus");
  await page.keyboard.press("Escape");
  await page.locator("#videoCard").click();
  await page.locator("#vmStatus").waitFor();
  await snapshot("video-error", "#vmStatus");
  await page.keyboard.press("Escape");
  await page.locator("#copyBtn").click();
  await page.locator("#copyMsg").waitFor();
  await snapshot("telegram-copy", "#copyStatus");
  if (action === "--capture") writeFileSync(file, JSON.stringify(observed, null, 2) + "\n");
  else assert.deepEqual(observed, JSON.parse(readFileSync(file, "utf8")));
  console.log(JSON.stringify({ dynamicEntries: Object.keys(observed).length, differences: 0 }));
} finally {
  await browser.close();
}
