import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseJs } from "acorn";
import { parse as parseHtml } from "parse5";

const scripts = ["site.js", "site-ui.js", "course-chat.js", "course-chat-render.js"];
const attrs = new Set(["id", "lang", "dir", "title", "alt", "placeholder", "aria-label", "aria-description",
  "aria-labelledby", "aria-describedby", "data-target", "data-thumbnail", "data-poster", "data-knowledge-source"]);
const textualSink = /^(?:textContent|innerText|innerHTML|ariaLabel|alt|title|placeholder)$/u;
const publicString = /[^\u0000-\u007f]|^(?:https?:\/\/|(?:[\w-]+\.)+(?:github\.io|pages\.dev)$)/u;

export function collect(root) {
  const read = (name) => readFileSync(resolve(root, name), "utf8");
  const entries = {};
  const slots = new Map();
  const styles = [];
  const add = (key, value) => {
    const slot = (slots.get(key) ?? 0) + 1;
    slots.set(key, slot);
    entries[`${key}[${slot}]`] = value;
  };

  function fromScript(text, name) {
    const ast = parseJs(text, { ecmaVersion: "latest", sourceType: "module" });
    function visit(node, scope = name, displayed = false) {
      if (!node?.type) return;
      const nested = node.type === "FunctionDeclaration" && node.id ? scope + "/" + node.id.name : scope;
      if (node.type === "Literal" && typeof node.value === "string" && (displayed || publicString.test(node.value))) {
        add("script:" + nested, node.value);
      }
      if (node.type === "TemplateLiteral") {
        const quasis = node.quasis.map(part => part.value.cooked);
        if (displayed || quasis.some(value => typeof value === "string" && publicString.test(value))) {
          add("script:" + nested + ":template", quasis);
        }
      }
      for (const [key, value] of Object.entries(node)) {
        let sink = displayed;
        if (node.type === "AssignmentExpression" && key === "right") {
          const property = node.left.property;
          sink ||= textualSink.test(property?.name ?? property?.value ?? "");
        }
        if (node.type === "CallExpression" && key === "arguments" && node.callee.property?.name === "setAttribute" &&
            ["aria-label", "aria-description", "title", "alt", "placeholder"].includes(node.arguments[0]?.value)) {
          visit(value[0], nested);
          visit(value[1], nested, true);
          continue;
        }
        if (node.type === "LogicalExpression" && key === "left" && node.operator === "||" && displayed) sink = true;
        if (Array.isArray(value)) value.forEach(part => visit(part, nested, sink));
        else if (value?.type) visit(value, nested, sink);
      }
    }
    visit(ast);
  }

  function walk(node, context) {
    if (node.nodeName === "#text") {
      // Strip indentation-only line edges. Keep spaces between inline text
      // nodes, all internal whitespace, punctuation and every Unicode code point.
      const value = node.value.replace(/^(?:[ \t]*\n)+[ \t]*|(?:\n[ \t]*)+$/gu, "");
      if (value !== "") add("text:" + context, value);
      return;
    }
    const a = Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
    const tag = node.tagName;
    const place = a.id ? "#" + a.id
      : tag === "a" && a.href ? context + "/a:" + a.href
      : tag === "meta" ? context + "/meta:" + (a.name ?? a.property ?? a.charset)
      : ["header", "nav", "main", "footer", "dialog", "section", "title"].includes(tag) ? context + "/" + tag
      : context;
    for (const [name, value] of Object.entries(a)) {
      if (attrs.has(name) || tag === "meta" && name === "content" ||
          name === "href" && (tag === "a" || /^(?:https?:\/\/|#)/u.test(value)) ||
          name === "action") add(`attribute:${place}:${tag}:${name}`, value);
    }

    if (tag === "style") {
      styles.push((node.childNodes ?? []).map(child => child.value).join(""));
    } else if (tag === "script") {
      const text = (node.childNodes ?? []).map(child => child.value).join("");
      if (a.type === "application/ld+json") {
        function record(value, path) {
          if (value && typeof value === "object") {
            for (const [key, nested] of Object.entries(value)) record(nested, path + "/" + key);
          } else add("structured:" + path, value);
        }
        record(JSON.parse(text), "$");
      } else if (!a.src && text.trim()) fromScript(text, "index:" + place);
    } else {
      for (const child of node.childNodes ?? []) walk(child, place);
      if (node.content) walk(node.content, place);
    }
  }

  walk(parseHtml(read("index.html"), { scriptingEnabled: false }), "page");
  scripts.forEach(name => fromScript(read(name), name));
  for (const name of ["site.css", "course-chat.css"]) styles.push(read(name));
  for (const style of styles) {
    for (const match of style.matchAll(/(?:[;{])\s*content\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gu)) {
      if (match[1].length > 2) add("css:content", match[1]);
    }
  }
  for (const name of ["robots.txt", "sitemap.xml"]) add("source:" + name, read(name));

  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export function hashed(entries) {
  return Object.fromEntries(Object.entries(entries).map(([id, value]) => [
    id, createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  ]));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [action, root = ".", filename = "test/fixtures/content-baseline.json", base, raw] = process.argv.slice(2);
  const current = collect(root);
  if (action === "--capture" && /^[a-f0-9]{40}$/u.test(base ?? "")) {
    writeFileSync(filename, JSON.stringify({ base, entries: hashed(current) }, null, 2) + "\n");
    if (raw) writeFileSync(raw, JSON.stringify(current, null, 2) + "\n");
    console.log(JSON.stringify({ base, entries: Object.keys(current).length, manifest: filename }));
  } else if (action === "--check") {
    const before = JSON.parse(readFileSync(filename, "utf8"));
    const additions = base ? JSON.parse(readFileSync(base, "utf8")) : {};
    for (const id of Object.keys(additions)) {
      if (Object.hasOwn(before.entries, id)) throw new Error(`An addition cannot override a baseline entry: ${id}`);
    }
    const expected = { ...before.entries, ...additions };
    const updated = hashed(current);
    const differences = [...new Set([...Object.keys(expected), ...Object.keys(updated)])]
      .filter(id => expected[id] !== updated[id]);
    console.log(JSON.stringify({ base: before.base, entries: Object.keys(before.entries).length,
      approvedAdditions: Object.keys(additions).length, differences: differences.length }));
    if (differences.length) {
      console.error(differences.join("\n"));
      process.exitCode = 1;
    }
  } else {
    throw new Error("Use --capture <root> <manifest> <base SHA> [raw file] or --check <root> <manifest> [additions file]");
  }
}
