// Parse supported Markdown into DOM nodes. HTML-looking tokens stay text,
// including attributes that contain an otherwise linkable address.
const tokens = /<[^<>]*>|\[(?<label>[^\[\]\r\n]+)\]\((?<destination>(?:[^()\r\n]|\([^()\r\n]*\))*)\)|`(?<inlineCode>[^`\r\n]+)`|(?<!\\)\*\*(?<bold>[^\r\n]+?)\*\*|(?<=^|[\s([«“‘،؛؟])(?<bare>https:\/\/(?:[^\s<>()\[\]{}*`،؛؟…]|\([^()\s<>]*\)|\[[^\[\]\s<>]*\])+)/giu;
const heading = /^ {0,3}#{1,6}[ \t]+(.+)/u;
const listItem = /^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+(.+)/u;
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

function appendInline(parent, text) {
  const unescape = (value) => value.replace(/\\([*#])/gu, "$1");
  let end = 0;
  for (const { 0: token, index, groups: { label, destination, inlineCode, bold, bare } } of text.matchAll(tokens)) {
    parent.append(unescape(text.slice(end, index)));
    end = index + token.length;

    if (inlineCode !== undefined) {
      const code = document.createElement("code");
      code.dir = "ltr";
      code.textContent = inlineCode;
      parent.append(code);
      continue;
    }
    if (bold !== undefined) {
      const strong = document.createElement("strong");
      appendInline(strong, bold);
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
    link.textContent = label ?? bareUrl;
    parent.append(link);
    if (bare) parent.append(bare.slice(bareUrl.length));
  }
  parent.append(unescape(text.slice(end)));
}

function appendText(parent, tag, text) {
  const element = document.createElement(tag);
  element.dir = "auto";
  appendInline(element, text);
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
  return line.trim().replace(/^\||\|$/gu, "").split(/(?<!\\)\|/u)
    .map((cell) => cell.trim().replace(/\\\|/gu, "|"));
}

function tableStarts(lines, index) {
  if (!lines[index + 1]?.includes("|") || !lines[index].includes("|")) return false;
  const widths = cells(lines[index + 1]);
  return widths.length > 1 && widths.length === cells(lines[index]).length && widths.every((value) => alignment.test(value));
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
  for (const label of headers) appendText(headerRow, "th", label).scope = "col";

  const body = table.createTBody();
  index += 2;
  while (index < lines.length && lines[index].includes("|")) {
    const row = cells(lines[index]);
    if (row.length !== headers.length) break;
    const tr = body.insertRow();
    for (const value of row) appendText(tr, "td", value);
    index++;
  }
  wrapper.append(table);
  parent.append(wrapper);
  return index;
}

export function renderAnswer(parent, text, copyButton) {
  const lines = text.split(/\r?\n/u);
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
      appendCode(parent, lines.slice(index + 1, end), opening[2], copyButton);
      index = end + 1;
      continue;
    }

    const title = line.match(heading);
    if (title) {
      appendText(parent, "h3", title[1]);
      index++;
      continue;
    }

    if (tableStarts(lines, index)) {
      index = appendTable(parent, lines, index);
      continue;
    }

    const firstItem = line.match(listItem);
    if (firstItem) {
      const ordered = /^\d/u.test(firstItem[1]);
      const list = document.createElement(ordered ? "ol" : "ul");
      if (ordered) list.start = Number.parseInt(firstItem[1], 10);
      let item = firstItem;
      while (item && /^\d/u.test(item[1]) === ordered) {
        appendText(list, "li", item[2]);
        item = lines[++index]?.match(listItem);
      }
      parent.append(list);
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
