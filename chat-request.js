import { renderLimit } from "./chat-store.js?v=6";

export const approvedHosts = new Set(["ml-jebbeli.github.io", "jebbeli-ai-preview.pages.dev"]);
const endpoint = "https://jebbeli-ai-quota-lab-01.sedamir77.workers.dev/";
export const requestTimeout = 60000;
const slowResponseDelay = 12000;
const requestBodyLimit = 32 * 1024;
const encoder = new TextEncoder();
const fa = new Intl.NumberFormat("fa-IR");

function retryAfter(header, now) {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/u.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? { seconds, until: Math.min(Number.MAX_SAFE_INTEGER, now + seconds * 1000) } : null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toUTCString() !== value) return null;
  return { seconds: Math.max(0, Math.ceil((date.getTime() - now) / 1000)), until: date.getTime() };
}

function withWait(message, seconds) {
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

function responseError(response, code, wait) {
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
export const offline = "اتصال اینترنت قطع است. پس از اتصال می‌توانی دوباره ارسال کنی.";
const cancelled = "انتظار در مرورگر متوقف شد. پردازش یا مصرف سهمیه در سرور ممکن است ادامه داشته باشد.";

export const loading = "در حال آماده‌سازی پاسخ…";
export const slow = "پاسخ هنوز آماده نشده؛ منتظریم.";

function requestBody(question, history) {
  for (let start = 0; start <= history.length; start += 2) {
    const body = JSON.stringify({
      message: question,
      history: history.slice(start).map(({ role, content }) => ({ role, content })),
    });
    if (encoder.encode(body).byteLength <= requestBodyLimit) return body;
  }
  return null;
}

async function responseData(response) {
  const limit = 256 * 1024;
  const stream = response.body?.getReader();
  if (!stream) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await stream.read();
      if (done) return JSON.parse(text + decoder.decode());
      size += value.byteLength;
      if (size > limit) {
        void stream.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    stream.releaseLock();
  }
}

export async function requestAnswer(question, history, controller, onSlow) {
  const body = requestBody(question, history);
  if (!body) return { error: "حجم درخواست بیش از حد مجاز است." };

  let resolveAbort;
  const aborted = new Promise(resolve => { resolveAbort = resolve; });
  const stop = () => resolveAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", stop, { once: true });
  if (controller.signal.aborted) stop();
  const deadline = setTimeout(() => controller.abort({
    error: "پاسخ در زمان انتظار نرسید. می‌توانی خودت دوباره تلاش کنی.",
  }), requestTimeout);
  const delay = setTimeout(onSlow, slowResponseDelay);

  async function execute() {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      const wait = [429, 503].includes(response.status) ? retryAfter(response.headers.get("Retry-After"), Date.now()) : null;
      const data = await responseData(response);
      if (!response.ok) return {
        error: responseError(response, data?.error?.code, wait?.seconds ?? null),
        cooldownUntil: wait?.until ?? 0,
      };
      if (typeof data?.answer === "string" && data.answer.length <= renderLimit && data.answer.trim()) return { answer: data.answer };
      return { error: invalidAnswer };
    } catch {
      return controller.signal.aborted ? controller.signal.reason : {
        error: navigator.onLine ? "ارتباط با دستیار برقرار نشد. اینترنتت را بررسی کن و دوباره تلاش کن." : offline,
      };
    }
  }

  try {
    return await Promise.race([aborted, controller.signal.aborted ? aborted : execute()]);
  } finally {
    clearTimeout(deadline);
    clearTimeout(delay);
    controller.signal.removeEventListener("abort", stop);
  }
}

export function stopWaiting(controller) {
  controller.abort({ error: cancelled, stopped: true });
}
