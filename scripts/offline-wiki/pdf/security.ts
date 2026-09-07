import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: { document: Document; close(): void };
  };
};

const FORBIDDEN_ELEMENTS = new Set([
  "base", "embed", "iframe", "link", "object", "script", "source", "track", "video", "audio", "picture",
]);
const RESOURCE_ATTRIBUTES = new Set([
  "action", "background", "data", "formaction", "href", "manifest", "ping", "poster", "src", "srcset",
]);
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_ENCODED_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_DECODED_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 40_000_000;

function decodeCssEscapes(css: string): string {
  return css.replace(
    /\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\n\f\r0-9a-f])/giu,
    (_match, hex: string | undefined, escaped: string | undefined) => (
      hex === undefined ? (escaped ?? "") : String.fromCodePoint(Number.parseInt(hex, 16))
    ),
  );
}

function rejectCssUrls(css: string): void {
  const decoded = decodeCssEscapes(css);
  if (/@import\b/iu.test(decoded)) throw new Error("PDF HTML CSS @import resources are forbidden");
  if (/url\s*\(/iu.test(decoded)) {
    throw new Error("PDF HTML CSS url() resources are forbidden");
  }
}

function hasPrefix(bytes: Buffer, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || !hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("data image MIME/signature mismatch for image/png");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("data image MIME/signature mismatch for image/jpeg");
  }
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (startOfFrame.has(marker)) {
      if (length < 7) break;
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw new Error("data image JPEG dimensions are missing or invalid");
}

function webpDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF"
      || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error("data image MIME/signature mismatch for image/webp");
  }
  const kind = bytes.subarray(12, 16).toString("ascii");
  if (kind === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (kind === "VP8L" && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8),
      height: 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10),
    };
  }
  if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  throw new Error("data image WebP dimensions are missing or invalid");
}

function validateDataImage(url: string): void {
  if (url.length > MAX_ENCODED_IMAGE_BYTES) throw new Error("data image encoded size exceeds the limit");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(url);
  if (!match || !IMAGE_MIMES.has(match[1]!)) {
    throw new Error(`data image must use an allowed raster MIME and strict base64 encoding: ${url.slice(0, 96)}`);
  }
  const payload = match[2]!;
  if (payload.length % 4 !== 0) throw new Error("data image has invalid base64 padding");
  const bytes = Buffer.from(payload, "base64");
  if (bytes.toString("base64") !== payload) throw new Error("data image has non-canonical base64 encoding");
  if (bytes.length > MAX_DECODED_IMAGE_BYTES) throw new Error("data image decoded size exceeds the limit");
  const dimensions = match[1] === "image/png"
    ? pngDimensions(bytes)
    : match[1] === "image/jpeg"
      ? jpegDimensions(bytes)
      : webpDimensions(bytes);
  if (dimensions.width < 1 || dimensions.height < 1
      || dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION
      || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new Error("data image dimensions or pixel count exceed the limit");
  }
}

function validateAnchor(url: string): void {
  if (/^https?:\/\//u.test(url) || /^#[^\s]*$/u.test(url)
      || /^[^/\\?#]+\.(?:html|pdf)(?:#[^\s]*)?$/u.test(url)) return;
  throw new Error(`PDF HTML anchor URL is forbidden: ${url}`);
}

export function validatePdfHtml(html: string): void {
  const dom = new JSDOM(html, { runScripts: undefined, resources: undefined, url: "about:blank" });
  try {
    const { document } = dom.window;
    for (const element of document.querySelectorAll("*")) {
      const tag = element.localName.toLowerCase();
      if (element.namespaceURI !== "http://www.w3.org/1999/xhtml") {
        throw new Error(`PDF HTML foreign namespace is forbidden: ${element.namespaceURI ?? "unknown"}`);
      }
      if (FORBIDDEN_ELEMENTS.has(tag)) throw new Error(`PDF HTML element is forbidden: ${tag}`);
      if (tag === "meta" && element.getAttribute("http-equiv")?.trim().toLowerCase() === "refresh") {
        throw new Error("PDF HTML meta refresh is forbidden");
      }
      for (const attribute of element.getAttributeNames()) {
        const name = attribute.toLowerCase();
        const value = element.getAttribute(attribute)?.trim() ?? "";
        if (name.startsWith("on")) throw new Error(`PDF HTML event handler is forbidden: ${name}`);
        if (name === "style") rejectCssUrls(value);
        if (!RESOURCE_ATTRIBUTES.has(name)) continue;
        if (name === "srcset") throw new Error("PDF HTML srcset resources are forbidden");
        if (tag === "img" && name === "src") {
          validateDataImage(value);
        } else if (tag === "a" && name === "href") {
          validateAnchor(value);
        } else {
          throw new Error(`PDF HTML resource attribute is forbidden: ${tag}[${name}]=${value}`);
        }
      }
    }
    for (const style of document.querySelectorAll("style")) rejectCssUrls(style.textContent ?? "");
  } finally {
    dom.window.close();
  }
}
