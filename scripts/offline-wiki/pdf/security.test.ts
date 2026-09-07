import { describe, expect, it } from "vitest";
import { printStyles } from "../render/styles";
import { PDF_HTML_LIMITS, validatePdfHtml, validatePdfHtmlWithLimitsForTest } from "./security";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n3cAAAAASUVORK5CYII=";

function pngWithDimensions(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
}

describe("PDF HTML resource policy", () => {
  it("accepts only self-contained generated links and a valid raster data image", () => {
    expect(() => validatePdfHtml(`<!doctype html><style>${printStyles}</style>
      <a href="#entry">local</a><a href="04-差分宇宙-索引.html#entry">volume</a>
      <a href="https://wiki.hoyolab.com/entry/1">source</a>
      <img src="data:image/png;base64,${ONE_PIXEL_PNG}">`)).not.toThrow();
  });

  it.each([
    ["style attribute", '<p style="color:black">bad</p>'],
    ["untrusted style text", "<style>body { color: black }</style>"],
    ["trusted style with whitespace drift", `<style>${printStyles} </style>`],
    ["CSS line continuation", "<style>.x{background:u\\\nrl(https://blocked.invalid/a.png)}</style>"],
    ["image-set", '<style>.x{background:image-set("https://blocked.invalid/a.png" 1x)}</style>'],
    ["webkit image-set", '<style>.x{background:-webkit-image-set("https://blocked.invalid/a.png" 1x)}</style>'],
  ])("rejects %s instead of parsing arbitrary CSS", (_name, html) => {
    expect(() => validatePdfHtml(`<!doctype html>${html}`)).toThrow(/style|CSS/i);
  });

  it.each([
    ["script", '<script src="https://blocked.invalid/a.js"></script>'],
    ["iframe", '<iframe src="https://blocked.invalid/"></iframe>'],
    ["frame", '<frameset><frame src="https://blocked.invalid/"></frameset>'],
    ["object", '<object data="https://blocked.invalid/a.pdf"></object>'],
    ["embed", '<embed src="https://blocked.invalid/a.pdf">'],
    ["base", '<base href="https://blocked.invalid/">'],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://blocked.invalid/">'],
    ["stylesheet", '<link rel="stylesheet" href="https://blocked.invalid/a.css">'],
    ["legacy background", '<body background="https://blocked.invalid/a.png"></body>'],
    ["appcache manifest", '<html manifest="https://blocked.invalid/a.appcache"></html>'],
    ["media", '<video poster="https://blocked.invalid/a.png"></video>'],
    ["source", '<picture><source srcset="https://blocked.invalid/a.png"></picture>'],
    ["srcset", `<img src="data:image/png;base64,${ONE_PIXEL_PNG}" srcset="https://blocked.invalid/a.png 2x">`],
    ["SVG", "<svg><image href=\"data:image/png;base64,AAAA\"></image></svg>"],
    ["MathML", "<math><mi>x</mi></math>"],
  ])("rejects forbidden %s resource surfaces", (_name, html) => {
    expect(() => validatePdfHtml(`<!doctype html>${html}`)).toThrow();
  });

  it.each([
    ['<img src=" &#x64;ata:text/html,unsafe">', /data:text\/html/],
    ['<img src="file&#x3a;///tmp/secret.png">', /file:\/\/\//],
    ['<a href="javascript&#x3a;alert(1)">bad</a>', /javascript:/],
    ['<style>.x { background: url(d\\61ta:text/html,unsafe) }</style>', /style|CSS/i],
    ['<style>@import "https://blocked.invalid/a.css";</style>', /style|CSS/i],
    ['<p style="background:url(https://blocked.invalid/a.png)">bad</p>', /style|CSS/i],
  ])("decodes and rejects obfuscated resource input", (html, message) => {
    expect(() => validatePdfHtml(`<!doctype html>${html}`)).toThrow(message);
  });

  it("rejects non-base64, SVG, MIME/signature mismatch, and oversized raster dimensions", () => {
    expect(() => validatePdfHtml('<img src="data:image/png,AAAA">')).toThrow(/base64/i);
    expect(() => validatePdfHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">')).toThrow(/image|MIME/i);
    expect(() => validatePdfHtml(`<img src="data:image/jpeg;base64,${ONE_PIXEL_PNG}">`)).toThrow(/signature|MIME/i);
    expect(() => validatePdfHtml(`<img src="data:image/png;base64,${pngWithDimensions(9000, 1)}">`)).toThrow(/dimension|pixel/i);
  });

  it("enforces inclusive HTML, image-count, encoded, decoded, and pixel budget boundaries", () => {
    const image = `<img src="data:image/png;base64,${ONE_PIXEL_PNG}">`;
    const html = `<!doctype html>${image}`;
    const htmlBytes = Buffer.byteLength(html, "utf8");
    const decodedBytes = Buffer.from(ONE_PIXEL_PNG, "base64").length;
    const exact = {
      ...PDF_HTML_LIMITS,
      maxHtmlBytes: htmlBytes,
      maxImages: 1,
      maxEncodedImageBytes: ONE_PIXEL_PNG.length,
      maxDecodedImageBytes: decodedBytes,
      maxImageDimension: 1,
      maxImagePixels: 1,
      maxTotalEncodedBytes: ONE_PIXEL_PNG.length,
      maxTotalDecodedBytes: decodedBytes,
      maxTotalPixels: 1,
    };
    expect(() => validatePdfHtmlWithLimitsForTest(html, exact)).not.toThrow();
    expect(() => validatePdfHtmlWithLimitsForTest(html, { ...exact, maxHtmlBytes: htmlBytes - 1 })).toThrow(/HTML.*size/i);
    expect(() => validatePdfHtmlWithLimitsForTest(html, { ...exact, maxEncodedImageBytes: ONE_PIXEL_PNG.length - 1 })).toThrow(/encoded size/i);
    expect(() => validatePdfHtmlWithLimitsForTest(html, { ...exact, maxDecodedImageBytes: decodedBytes - 1 })).toThrow(/decoded size/i);
    expect(() => validatePdfHtmlWithLimitsForTest(html, { ...exact, maxImageDimension: 0 })).toThrow(/dimension|pixel/i);
    expect(() => validatePdfHtmlWithLimitsForTest(html, { ...exact, maxImagePixels: 0 })).toThrow(/dimension|pixel/i);
    expect(() => validatePdfHtmlWithLimitsForTest(`${html}${image}`, {
      ...exact,
      maxHtmlBytes: htmlBytes + Buffer.byteLength(image, "utf8"),
      maxTotalEncodedBytes: ONE_PIXEL_PNG.length * 2,
      maxTotalDecodedBytes: decodedBytes * 2,
      maxTotalPixels: 2,
    })).toThrow(/image count/i);
    expect(() => validatePdfHtmlWithLimitsForTest(html, { ...exact, maxTotalEncodedBytes: ONE_PIXEL_PNG.length - 1 })).toThrow(/encoded.*budget/i);
    expect(() => validatePdfHtmlWithLimitsForTest(html, { ...exact, maxTotalDecodedBytes: decodedBytes - 1 })).toThrow(/decoded.*budget/i);
    expect(() => validatePdfHtmlWithLimitsForTest(html, { ...exact, maxTotalPixels: 0 })).toThrow(/pixel.*budget/i);
  });
});
