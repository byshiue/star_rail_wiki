import { chromium } from "@playwright/test";
import { countPdfPages } from "./inspect";

export type PdfRenderInput = { html: string; title: string };
export type PdfRenderOutput = { bytes: Uint8Array; pageCount: number };
export type PdfRenderer = (input: PdfRenderInput) => Promise<PdfRenderOutput>;

const ALLOWED_DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

function blockedEmbeddedUrls(html: string): string[] {
  const urls: string[] = [];
  const attribute = /\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1/giu;
  for (const match of html.matchAll(attribute)) {
    const url = match[2]!;
    if (/^(?:file|data):/iu.test(url) && !ALLOWED_DATA_IMAGE.test(url)) urls.push(url);
  }
  const styleUrl = /\burl\(\s*(["']?)(.*?)\1\s*\)/giu;
  for (const match of html.matchAll(styleUrl)) {
    const url = match[2]!;
    if (/^(?:file|data):/iu.test(url) && !ALLOWED_DATA_IMAGE.test(url)) urls.push(url);
  }
  return urls;
}

export const renderPdfWithPlaywright: PdfRenderer = async ({ html }) => {
  const unsafeEmbeddedUrls = blockedEmbeddedUrls(html);
  if (unsafeEmbeddedUrls.length > 0) {
    throw new Error(`PDF HTML attempted to load non-allowlisted resources: ${unsafeEmbeddedUrls.join(", ")}`);
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(
      "Playwright Chromium is unavailable. Install it locally with: npx playwright install chromium",
      { cause: error },
    );
  }
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const blockedUrls: string[] = [];
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (ALLOWED_DATA_IMAGE.test(url)) {
        await route.continue();
        return;
      }
      blockedUrls.push(url);
      await route.abort("blockedbyclient");
    });
    await page.setContent(html, { waitUntil: "load" });
    if (blockedUrls.length > 0) {
      throw new Error(`PDF HTML attempted to load remote resources: ${blockedUrls.join(", ")}`);
    }
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    const bytes = await page.pdf({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
      outline: true,
    });
    return { bytes, pageCount: countPdfPages(bytes) };
  } finally {
    await browser.close();
  }
};
