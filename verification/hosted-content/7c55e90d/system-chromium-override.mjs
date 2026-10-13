/* global process */
import { createRequire } from 'node:module';
const req = createRequire(process.cwd() + '/package.json');
let playwright;
try { playwright = req('@playwright/test'); } catch { try { playwright = req('playwright'); } catch { playwright = null; } }
if (playwright?.chromium) {
  for (const name of ['launch', 'launchPersistentContext']) {
    const original = playwright.chromium[name].bind(playwright.chromium);
    playwright.chromium[name] = name === 'launch'
      ? options => original({ ...options, executablePath: '/usr/bin/chromium' })
      : (directory, options) => original(directory, { ...options, executablePath: '/usr/bin/chromium' });
  }
}
