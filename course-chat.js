(() => {
  const isQuotaPreview = window.location.hostname === "jebbeli-ai-preview.pages.dev";
  const endpoint = isQuotaPreview
    ? "https://jebbeli-ai-quota-lab-01.sedamir77.workers.dev"
    : "https://jebbeli-ai-assistant.sedamir77.workers.dev";
  const visibleExchangeLimit = 6;
  const historyMessageLimit = 6;
  const requestTimeout = 30000;
  const launch = document.getElementById("courseChatLaunch");
  const panel = document.getElementById("courseChatPanel");
  const close = document.getElementById("courseChatClose");
  const log = document.getElementById("courseChatLog");
  const status = document.getElementById("courseChatStatus");
  const form = document.getElementById("courseChatForm");
  const input = document.getElementById("courseChatInput");
  const send = document.getElementById("courseChatSend");
  const widget = launch.parentElement;
  const viewport = window.visualViewport;
  const history = [];

  // Match HTML-looking text and invalid Markdown destinations as whole tokens,
  // so their contents are not picked up as standalone links.
  const answerTokens = /<[^<>]*>|\[(?<label>[^\[\]\r\n]+)\]\((?<destination>(?:[^()\r\n]|\([^()\r\n]*\))*)\)|\*\*(?<bold>[^\r\n]+?)\*\*|(?<=^|[\s([«“‘،؛؟])(?<bare>https:\/\/(?:[^\s<>()\[\]{}*`،؛؟…]|\([^()\s<>]*\)|\[[^\[\]\s<>]*\])+)/giu;

  function parseHttpsUrl(destination) {
    if (!/^https:\/\/[^/?#@]+(?:[/?#]|$)/i.test(destination) || /[\s\p{Cc}\p{Cf}<>"'`\\]/u.test(destination)) {
      return null;
    }
    try {
      const url = new URL(destination);
      return url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }

  function renderAnswer(parent, text) {
    let position = 0;
    for (const match of text.matchAll(answerTokens)) {
      const [token] = match;
      const { label, destination, bold, bare } = match.groups;
      parent.append(text.slice(position, match.index));
      position = match.index + token.length;

      if (bold !== undefined) {
        const strong = document.createElement("strong");
        renderAnswer(strong, bold);
        parent.append(strong);
        continue;
      }

      const bareUrl = bare?.replace(/[.,!?;:»”’]+$/u, "");
      const url = parseHttpsUrl(destination ?? bareUrl ?? "");
      if (!url) {
        parent.append(token);
        continue;
      }

      const link = document.createElement("a");
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.dir = bare ? "ltr" : "auto";
      link.textContent = label ?? bareUrl;
      parent.append(link);
      if (bare) parent.append(bare.slice(bareUrl.length));
    }
    parent.append(text.slice(position));
  }

  function scrollToLatest() {
    log.scrollTop = log.scrollHeight;
  }

  function fitViewport() {
    if (!viewport || panel.hidden || viewport.scale !== 1) {
      widget.style.removeProperty("--chat-keyboard-offset");
      widget.style.removeProperty("--chat-viewport-height");
      return;
    }
    const bottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    widget.style.setProperty("--chat-keyboard-offset", `${bottom}px`);
    widget.style.setProperty("--chat-viewport-height", `${viewport.height}px`);
  }

  function setOpen(open) {
    panel.hidden = !open;
    launch.hidden = open;
    launch.setAttribute("aria-expanded", String(open));
    fitViewport();
    if (open) {
      const focusTarget = matchMedia("(pointer: coarse)").matches ? close : input;
      focusTarget.focus({ preventScroll: true });
      scrollToLatest();
    } else {
      launch.focus({ preventScroll: true });
    }
  }

  function appendMessage(exchange, text, fromUser = false) {
    const message = document.createElement("p");
    message.className = fromUser ? "course-chat-message course-chat-message-user" : "course-chat-message";
    message.dir = "auto";
    if (fromUser) message.textContent = text;
    else renderAnswer(message, text);
    exchange.appendChild(message);
    scrollToLatest();
  }

  function retryAfterSeconds(header) {
    const value = header?.trim();
    if (!value) return null;

    if (/^\d+$/.test(value)) {
      const seconds = Number(value);
      return Number.isSafeInteger(seconds) ? seconds : null;
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toUTCString() !== value) return null;
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
  }

  function rateLimitMessage(header, code) {
    const dailyLimitReached = code === "DAILY_AI_LIMIT_REACHED";
    const message = dailyLimitReached
      ? "سهمیهٔ روزانهٔ دستیار به پایان رسیده."
      : "تعداد درخواست‌ها زیاد شده.";
    let seconds = retryAfterSeconds(header);
    if (seconds === null) {
      return `${message} ${dailyLimitReached ? "بعداً" : "کمی صبر کن و"} دوباره تلاش کن.`;
    }
    if (seconds === 0) return `${message} می‌تونی دوباره تلاش کنی.`;

    const duration = [];
    for (const [size, unit] of [[86400, "روز"], [3600, "ساعت"], [60, "دقیقه"], [1, "ثانیه"]]) {
      const count = Math.floor(seconds / size);
      if (count) duration.push(`${count.toLocaleString("fa-IR")} ${unit}`);
      seconds %= size;
    }
    return `${message} لطفاً ${duration.join(" و ")} صبر کن و دوباره تلاش کن.`;
  }

  launch.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing) {
      event.stopPropagation();
      setOpen(false);
    }
  });
  viewport?.addEventListener("resize", fitViewport);
  viewport?.addEventListener("scroll", fitViewport);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (!send.disabled) form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || question.length > input.maxLength || send.disabled) return;

    const exchange = document.createElement("div");
    exchange.className = "course-chat-exchange";
    log.appendChild(exchange);
    // Keep the greeting and the latest exchanges, including after closing the panel.
    if (log.children.length > visibleExchangeLimit + 1) log.children[1].remove();
    appendMessage(exchange, question, true);
    input.value = "";
    if (document.activeElement === send) input.focus({ preventScroll: true });
    send.disabled = true;
    status.textContent = "در حال دریافت پاسخ…";
    scrollToLatest();

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), requestTimeout);
    const payload = { message: question };
    if (history.length) payload.history = history;
    let errorMessage = "دریافت پاسخ ممکن نشد. دوباره تلاش کن یا با پشتیبانی در تماس باش.";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (response.status === 429) {
        const data = isQuotaPreview ? await response.json().catch(() => null) : null;
        const code = data?.error?.code ?? data?.code;
        errorMessage = rateLimitMessage(response.headers.get("Retry-After"), code);
      } else if (response.status === 503) {
        errorMessage = "سرویس دستیار موقتاً در دسترس نیست. کمی بعد دوباره تلاش کن.";
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (typeof data?.answer !== "string" || !data.answer.trim()) {
        throw new Error("Missing answer");
      }
      status.textContent = "";
      const answer = data.answer.trim();
      appendMessage(exchange, answer);
      // Drop a dangling high surrogate if the history limit cuts an emoji in half.
      const historyAnswer = answer.slice(0, input.maxLength).replace(/[\uD800-\uDBFF]$/u, "");
      history.push(
        { role: "user", content: question },
        { role: "assistant", content: historyAnswer },
      );
      if (history.length > historyMessageLimit) history.splice(0, 2);
    } catch (error) {
      if (controller.signal.aborted) {
        errorMessage = "زمان انتظار برای پاسخ به پایان رسید. لطفاً دوباره تلاش کن.";
      } else if (error instanceof TypeError) {
        errorMessage = "ارتباط با دستیار برقرار نشد. اینترنتت رو بررسی کن و دوباره تلاش کن.";
      }
      status.textContent = errorMessage;
      if (!input.value) input.value = question;
    } finally {
      clearTimeout(deadline);
      send.disabled = false;
    }
  });

  launch.hidden = false;
})();
