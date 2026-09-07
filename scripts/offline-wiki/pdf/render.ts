import { chromium, type Page } from "@playwright/test";
import { countPdfPages } from "./inspect";
import { validatePdfHtml } from "./security";

export type PdfRenderInput = { html: string; title: string };
export type PdfRenderOutput = { bytes: Uint8Array; pageCount: number };
export type PdfRenderer = (input: PdfRenderInput) => Promise<PdfRenderOutput>;

async function assertRequestsSettled(page: Page, blockedUrls: readonly string[]): Promise<void> {
  let previousCount = -1;
  let stableRounds = 0;
  while (stableRounds < 2) {
    await page.waitForTimeout(25);
    if (blockedUrls.length > 0) {
      throw new Error(`PDF HTML attempted to load blocked resources: ${blockedUrls.join(", ")}`);
    }
    stableRounds = blockedUrls.length === previousCount ? stableRounds + 1 : 0;
    previousCount = blockedUrls.length;
  }
}

const renderHtmlWithPlaywright: PdfRenderer = async ({ html }) => {
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
    const blockedUrls: string[] = [];
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      blockedUrls.push(url);
      await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await assertRequestsSettled(page, blockedUrls);
    await page.emulateMedia({ media: "print" });
    await assertRequestsSettled(page, blockedUrls);
    await page.evaluate(() => document.fonts.ready);
    await assertRequestsSettled(page, blockedUrls);
    const bytes = await page.pdf({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
      outline: true,
    });
    await assertRequestsSettled(page, blockedUrls);
    return { bytes, pageCount: countPdfPages(bytes) };
  } finally {
    await browser.close();
  }
};

export const renderPdfWithPlaywright: PdfRenderer = async (input) => {
  validatePdfHtml(input.html);
  return renderHtmlWithPlaywright(input);
};

export function createPdfRendererWithPostValidationInjectionForTest(
  injectAfterValidation: (html: string) => string,
): PdfRenderer {
  return async (input) => {
    validatePdfHtml(input.html);
    return renderHtmlWithPlaywright({ ...input, html: injectAfterValidation(input.html) });
  };
}
