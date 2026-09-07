import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => { window: { document: Document; close(): void } };
};

export type SanitizedHtmlBlock = Readonly<{
  label: "heading" | "paragraph" | "list-item" | "table-heading" | "table-cell";
  text: string;
}>;

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,th,td";
const EXCLUDED_ANCESTOR = "script,style,iframe,form,noscript,template,svg,math";
const BLOCK_TAGS = new Set(BLOCK_SELECTOR.split(",").map((tag) => tag.toUpperCase()));
const EXCLUDED_TAGS = new Set(EXCLUDED_ANCESTOR.split(",").map((tag) => tag.toUpperCase()));
const DISALLOWED_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufffd]/gu;
const ALLOWED_WHITESPACE_CONTROLS = /[\u0009\u000a\u000d]/gu;
const UNSAFE_TOKEN = /\b(?:https?:\/\/|javascript:)[^\s<>"']*/giu;
const EVENT_HANDLER_TOKEN = /\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s<>"']*)/giu;

export function normalizePlainText(value: string): string {
  return value
    .replace(ALLOWED_WHITESPACE_CONTROLS, " ")
    .replace(DISALLOWED_CONTROLS, "")
    .replace(UNSAFE_TOKEN, " ")
    .replace(EVENT_HANDLER_TOKEN, " ")
    .replace(/[<>]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function labelFor(tagName: string): SanitizedHtmlBlock["label"] {
  if (/^H[1-6]$/u.test(tagName)) return "heading";
  if (tagName === "P") return "paragraph";
  if (tagName === "LI") return "list-item";
  if (tagName === "TH") return "table-heading";
  return "table-cell";
}

export function sanitizeSavedHtml(html: string): SanitizedHtmlBlock[] {
  const dom = new JSDOM(html);
  try {
    const { document } = dom.window;
    for (const blocked of document.querySelectorAll(EXCLUDED_ANCESTOR)) blocked.remove();
    const blocks: SanitizedHtmlBlock[] = [];
    type Context = { label: SanitizedHtmlBlock["label"]; text: string };
    const flush = (context: Context): void => {
      const text = normalizePlainText(context.text);
      if (text.length > 0) blocks.push({ label: context.label, text });
      context.text = "";
    };
    const walk = (node: Node, context: Context | null): void => {
      if (node.nodeType === 3) {
        if (context) context.text += node.nodeValue ?? "";
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      if (EXCLUDED_TAGS.has(element.tagName)) return;
      if (BLOCK_TAGS.has(element.tagName)) {
        if (context) flush(context);
        const nested = { label: labelFor(element.tagName), text: "" };
        for (const child of element.childNodes) walk(child, nested);
        flush(nested);
        return;
      }
      for (const child of element.childNodes) walk(child, context);
    };
    for (const child of document.body.childNodes) walk(child, null);
    return blocks;
  } finally {
    dom.window.close();
  }
}
