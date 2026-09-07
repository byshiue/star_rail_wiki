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
const UNSAFE_TOKEN = /\b(?:https?:\/\/|javascript:)[^\s<>"']*/giu;

export function normalizePlainText(value: string): string {
  return value
    .replace(UNSAFE_TOKEN, " ")
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
    return [...document.querySelectorAll(BLOCK_SELECTOR)]
      .map((element) => ({ label: labelFor(element.tagName), text: normalizePlainText(element.textContent ?? "") }))
      .filter((block) => block.text.length > 0);
  } finally {
    dom.window.close();
  }
}
