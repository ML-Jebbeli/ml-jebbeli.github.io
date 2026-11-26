import { renderLimit } from "./chat-store.js?v=6";

// Parse supported Markdown into DOM nodes. HTML-looking tokens stay text,
// including attributes that contain an otherwise linkable address.
const tokens = /<[^<>]*>|\[(?<label>(?:\\[^\r\n]|[^\\\[\]\r\n])+)\]\((?<destination>(?:[^()\r\n]|\([^()\r\n]*\))*)\)|(?<ticks>`+)|\*\*(?<bold>[^\r\n]+?)\*\*|(?<bare>https:\/\/(?:[^\s<>()\[\]{}*`،؛؟…]|\([^()\s<>]*\)|\[[^\[\]\s<>]*\])+)/giu;
const heading = /^ {0,3}(#{1,6})[ \t]+(.+)/u;
const listItem = /^( {0,24})([-+*]|\d{1,9}[.)])[ \t]+(.+)/u;
const fence = /^ {0,3}(`{3,}|~{3,})[ \t]*([a-z0-9_+-]*?)[ \t]*$/iu;
const alignment = /^:?-{3,}:?$/u;

function httpsUrl(destination) {
  if (!/^https:\/\/[^/?#@]+(?:[/?#]|$)/iu.test(destination) ||
      /[\s\p{Cc}\p{Cf}<>"'`\\]/u.test(destination)) return null;
  try {
    const url = new URL(destination);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function isEscaped(text, index) {
  let count = 0;
  while (text[--index] === "\\") count++;
  return count % 2 === 1;
}

function closingTicks(text, from, ticks) {
  const runs = /`+/gu;
  runs.lastIndex = from;
  for (const match of text.matchAll(runs)) {
    if (match[0] === ticks) return match.index;
  }
  return -1;
}

function appendInline(parent, text, inTable = false, allowBold = true) {
  const unescape = (value) => value.replace(inTable ? /\\([\\`*#\[\]|])/gu : /\\([\\`*#\[\]])/gu, "$1");
  const scan = new RegExp(tokens);
  let end = 0;
  for (let match; (match = scan.exec(text));) {
    const { 0: token, index, groups: { label, destination, ticks, bold, bare } } = match;
    if (isEscaped(text, index) || (bare && index > 0 && !/[\s([«“‘،؛؟]/u.test(text[index - 1]))) continue;
    if (ticks !== undefined) {
      const start = index + ticks.length;
      const close = closingTicks(text, start, ticks);
      if (close < 0 || /[\r\n]/u.test(text.slice(start, close))) continue;
      parent.append(unescape(text.slice(end, index)));
      const code = document.createElement("code");
      code.dir = "ltr";
      code.textContent = text.slice(start, close);
      parent.append(code);
      end = close + ticks.length;
      scan.lastIndex = end;
      continue;
    }
    parent.append(unescape(text.slice(end, index)));
    end = index + token.length;
    if (bold !== undefined && allowBold && !isEscaped(text, end - 2)) {
      const strong = document.createElement("strong");
      appendInline(strong, bold, inTable, false);
      parent.append(strong);
      continue;
    }

    const bareUrl = bare?.replace(/[.,!?;:»”’]+$/u, "");
    const url = httpsUrl(destination ?? bareUrl ?? "");
    if (!url) {
      parent.append(token);
      continue;
    }
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.dir = bare ? "ltr" : "auto";
    link.textContent = unescape(label ?? bareUrl);
    parent.append(link);
    if (bare) parent.append(bare.slice(bareUrl.length));
  }
  parent.append(unescape(text.slice(end)));
}

function appendText(parent, tag, text, inTable = false) {
  const element = document.createElement(tag);
  element.dir = "auto";
  appendInline(element, text, inTable);
  parent.append(element);
  return element;
}

function appendCode(parent, lines, language, copyButton) {
  const wrapper = document.createElement("div");
  wrapper.className = "course-chat-code";
  const controls = document.createElement("div");
  controls.className = "course-chat-code-controls";
  const label = document.createElement("bdi");
  label.textContent = language || "کد";
  const code = document.createElement("code");
  code.textContent = lines.join("\n");
  controls.append(label, copyButton("کپی کد", code.textContent));
  const block = document.createElement("pre");
  block.dir = "ltr";
  block.tabIndex = 0;
  block.setAttribute("aria-label", "نمونهٔ کد");
  block.append(code);
  wrapper.append(controls, block);
  parent.append(wrapper);
}

function cells(line) {
  const value = line.trim();
  const parts = [];
  let start = value.startsWith("|") ? 1 : 0;
  for (let i = start; i < value.length; i++) {
    if (value[i] === "`" && !isEscaped(value, i)) {
      const ticks = /^`+/u.exec(value.slice(i))[0];
      const close = closingTicks(value, i + ticks.length, ticks);
      if (close < 0) return null;
      i = close + ticks.length - 1;
    } else if (value[i] === "|" && !isEscaped(value, i)) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (start < value.length) parts.push(value.slice(start).trim());
  return parts;
}

function tableStarts(lines, index) {
  if (!lines[index + 1]?.includes("|") || !lines[index].includes("|")) return false;
  const widths = cells(lines[index + 1]);
  return widths?.length > 1 && widths.length === cells(lines[index])?.length && widths.every((value) => alignment.test(value));
}

function appendTable(parent, lines, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "course-chat-table";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", "جدول پاسخ");
  const table = document.createElement("table");
  const headers = cells(lines[index]);
  const headerRow = table.createTHead().insertRow();
  for (const label of headers) appendText(headerRow, "th", label, true).scope = "col";

  const body = table.createTBody();
  index += 2;
  while (index < lines.length && lines[index].includes("|")) {
    const row = cells(lines[index]);
    if (row?.length !== headers.length) break;
    const tr = body.insertRow();
    for (const value of row) appendText(tr, "td", value, true);
    index++;
  }
  wrapper.append(table);
  parent.append(wrapper);
  return index;
}

function ordered(item) {
  return /^\d/u.test(item[2]);
}

function appendList(parent, lines, index, depth = 0) {
  let item = lines[index].match(listItem);
  const indent = item[1].length;
  const numbered = ordered(item);
  const list = document.createElement(numbered ? "ol" : "ul");
  if (numbered) list.start = Number.parseInt(item[2], 10);
  while (item && item[1].length === indent && ordered(item) === numbered) {
    const li = appendText(list, "li", item[3]);
    if (numbered) li.value = Number.parseInt(item[2], 10);
    item = lines[++index]?.match(listItem);
    while (item && item[1].length > indent && depth < 6) {
      index = appendList(li, lines, index, depth + 1);
      item = lines[index]?.match(listItem);
    }
  }
  parent.append(list);
  return index;
}

export function renderAnswer(parent, text, copyButton) {
  // Older browser records may contain answers larger than today's limits.
  // Display exceptionally large answers as inert, bounded text. The original
  // remains available through the existing copy action.
  if (text.length > renderLimit) {
    const preview = document.createElement("p");
    preview.dir = "auto";
    preview.textContent = text.slice(0, renderLimit) + "…";
    parent.append(preview);
    return;
  }
  const lines = text.split(/\r?\n/u);
  const headingLevels = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const opening = line.match(fence);
    if (opening) {
      let end = index + 1;
      while (end < lines.length) {
        const closing = lines[end].match(fence);
        if (closing && !closing[2] && closing[1].startsWith(opening[1])) break;
        end++;
      }
      if (end === lines.length) {
        const literal = document.createElement("p");
        literal.dir = "auto";
        const raw = lines.slice(index).join("\n");
        literal.textContent = raw;
        parent.append(literal);
        break;
      }
      appendCode(parent, lines.slice(index + 1, end), opening[2], copyButton);
      index = end + 1;
      continue;
    }

    const title = line.match(heading);
    if (title) {
      const level = title[1].length;
      while (headingLevels[headingLevels.length - 1] >= level) headingLevels.pop();
      headingLevels.push(level);
      appendText(parent, "h" + Math.min(6, 2 + headingLevels.length), title[2]);
      index++;
      continue;
    }

    if (tableStarts(lines, index)) {
      index = appendTable(parent, lines, index);
      continue;
    }

    if (listItem.test(line)) {
      index = appendList(parent, lines, index);
      continue;
    }

    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !heading.test(lines[index]) &&
        !fence.test(lines[index]) && !listItem.test(lines[index]) && !tableStarts(lines, index)) {
      paragraph.push(lines[index++]);
    }
    appendText(parent, "p", paragraph.join("\n"));
  }
}
