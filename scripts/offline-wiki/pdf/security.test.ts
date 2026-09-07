import { describe, expect, it } from "vitest";
import { validatePdfHtml } from "./security";

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
    expect(() => validatePdfHtml(`<!doctype html><style>body { color: black }</style>
      <a href="#entry">local</a><a href="04-差分宇宙-索引.html#entry">volume</a>
      <a href="https://wiki.hoyolab.com/entry/1">source</a>
      <img src="data:image/png;base64,${ONE_PIXEL_PNG}">`)).not.toThrow();
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
    ['<style>.x { background: url(d\\61ta:text/html,unsafe) }</style>', /CSS.*url/i],
    ['<style>@import "https://blocked.invalid/a.css";</style>', /CSS.*import/i],
    ['<p style="background:url(https://blocked.invalid/a.png)">bad</p>', /CSS.*url/i],
  ])("decodes and rejects obfuscated resource input", (html, message) => {
    expect(() => validatePdfHtml(`<!doctype html>${html}`)).toThrow(message);
  });

  it("rejects non-base64, SVG, MIME/signature mismatch, and oversized raster dimensions", () => {
    expect(() => validatePdfHtml('<img src="data:image/png,AAAA">')).toThrow(/base64/i);
    expect(() => validatePdfHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">')).toThrow(/image|MIME/i);
    expect(() => validatePdfHtml(`<img src="data:image/jpeg;base64,${ONE_PIXEL_PNG}">`)).toThrow(/signature|MIME/i);
    expect(() => validatePdfHtml(`<img src="data:image/png;base64,${pngWithDimensions(9000, 1)}">`)).toThrow(/dimension|pixel/i);
  });
});
