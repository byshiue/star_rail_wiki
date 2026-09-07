import { chromium } from "@playwright/test";
import { countPdfPages } from "./inspect";

export type PdfRenderInput = { html: string; title: string };
export type PdfRenderOutput = { bytes: Uint8Array; pageCount: number };
export type PdfRenderer = (input: PdfRenderInput) => Promise<PdfRenderOutput>;

export const renderPdfWithPlaywright: PdfRenderer = async ({ html }) => {
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
    await page.route(/^https?:\/\//, async (route) => {
      blockedUrls.push(route.request().url());
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
