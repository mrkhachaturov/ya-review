import type { Config } from '../config.js';
import { LAUNCH_ARGS, USER_AGENT } from './selectors.js';

// We use `any` for Playwright types since the browser package is optional
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwModule = any;

export interface BrowserInstance {
  browser: any;
  pw: any;
  handlesWebdriver: boolean;
  close: () => Promise<void>;
  newContext: (opts?: Record<string, unknown>) => Promise<any>;
}

async function importPatchright(): Promise<PwModule> {
  try {
    const mod = await import('patchright');
    return mod;
  } catch {
    throw new Error(
      'Patchright is not installed. Run: npx patchright install chromium\n' +
      'Or use --backend playwright instead.'
    );
  }
}

async function importPlaywright(): Promise<PwModule> {
  try {
    const mod = await import('playwright');
    return mod;
  } catch {
    throw new Error(
      'Playwright is not installed. Run: npx playwright install chromium\n' +
      'Or use --backend patchright instead.'
    );
  }
}

export async function createBrowser(cfg: Config): Promise<BrowserInstance> {
  const backend = cfg.browserBackend;

  if (backend === 'remote') {
    if (!cfg.browserWsUrl) {
      throw new Error('BROWSER_WS_URL is required for remote backend');
    }
    const pw = await importPlaywright();
    const browser = await pw.chromium.connectOverCDP(cfg.browserWsUrl);
    return {
      browser,
      pw,
      handlesWebdriver: false,
      close: async () => { await browser.close(); },
      newContext: (opts) => browser.newContext({
        locale: cfg.browserLocale,
        viewport: { width: 1280, height: 720 },
        userAgent: USER_AGENT,
        ...opts,
      }),
    };
  }

  if (backend === 'playwright') {
    const pw = await importPlaywright();
    const browser = await pw.chromium.launch({
      headless: cfg.browserHeadless,
      args: LAUNCH_ARGS,
    });
    return {
      browser,
      pw,
      handlesWebdriver: false,
      close: async () => { await browser.close(); },
      newContext: (opts) => browser.newContext({
        locale: cfg.browserLocale,
        viewport: { width: 1280, height: 720 },
        userAgent: USER_AGENT,
        ...opts,
      }),
    };
  }

  // Default: patchright
  const pw = await importPatchright();
  const browser = await pw.chromium.launch({
    headless: cfg.browserHeadless,
    args: LAUNCH_ARGS,
  });
  return {
    browser,
    pw,
    handlesWebdriver: true,
    close: async () => { await browser.close(); },
    newContext: (opts) => browser.newContext({
      locale: cfg.browserLocale,
      viewport: { width: 1280, height: 720 },
      userAgent: USER_AGENT,
      ...opts,
    }),
  };
}
