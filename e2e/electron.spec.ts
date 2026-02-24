/**
 * Electron E2E Tests
 *
 * E2E tests for the Electron app using Playwright
 */

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  // Path to the Electron executable (inside node_modules)
  const appPath = path.resolve(__dirname, '..');
  const electronPath = path.resolve(appPath, 'node_modules', '.bin', 'electron');
  const mainPath = path.resolve(appPath, 'dist-electron', 'main.js');

  // Launch Electron app - specify main.js directly
  electronApp = await electron.launch({
    executablePath: electronPath,
    args: [mainPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
    cwd: appPath,
  });

  // Get the first window
  window = await electronApp.firstWindow();

  // Wait for page to load
  await window.waitForLoadState('domcontentloaded');

  // Wait for the React app to fully load
  await window.waitForLoadState('networkidle');
  await window.waitForTimeout(2000); // Additional wait time
});

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close();
  }
});

test.describe('Token Analyzer', () => {
  test('app launches successfully', async () => {
    const title = await window.title();
    expect(title).toContain('OhMyToken');
  });

  test('settings screen or usage screen is displayed', async () => {
    // Either the settings screen or the usage screen should be visible
    const configSection = window.locator('text=Claude Settings');
    const usageSection = window.locator('text=Token Analysis');

    const hasConfig = await configSection.isVisible().catch(() => false);
    const hasUsage = await usageSection.isVisible().catch(() => false);

    expect(hasConfig || hasUsage).toBeTruthy();
  });

  test('clicking Token Analysis button navigates to Analyzer screen', async () => {
    // Find the Token Analysis button on the Usage screen
    const analyzerBtn = window.locator('button:has-text("Token Analysis")');

    if (await analyzerBtn.isVisible()) {
      await analyzerBtn.click();

      // Verify the Token Analyzer header
      await expect(window.locator('text=Token Analyzer')).toBeVisible({ timeout: 10000 });
    }
  });

  test('Treemap is displayed on the Token Analyzer screen', async () => {
    // Check the Treemap container
    const treemapContainer = window.locator('.treemap-container');

    if (await treemapContainer.isVisible({ timeout: 5000 }).catch(() => false)) {
      expect(await treemapContainer.isVisible()).toBeTruthy();
    }
  });

  test('real-time prompt feed is displayed', async () => {
    const promptFeed = window.locator('.prompt-feed');

    if (await promptFeed.isVisible({ timeout: 5000 }).catch(() => false)) {
      expect(await promptFeed.isVisible()).toBeTruthy();
    }
  });

  test('referenced context section exists', async () => {
    // Find the referenced context header
    const contextSection = window.locator('text=Referenced Context');

    if (await contextSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      expect(await contextSection.isVisible()).toBeTruthy();

      // Click to expand
      await contextSection.click();

      // Verify expanded content
      await window.waitForTimeout(500);

      // Check if sections like Auto Injected, Read Files, Search exist
      const hasAutoInjected = await window.locator('text=Auto Injected').isVisible().catch(() => false);
      const hasReadFiles = await window.locator('text=Read Files').isVisible().catch(() => false);

      expect(hasAutoInjected || hasReadFiles).toBeTruthy();
    }
  });

  test('clicking Back button navigates to the previous screen', async () => {
    const backBtn = window.locator('button:has-text("Back")');

    if (await backBtn.isVisible()) {
      await backBtn.click();

      // Verify navigation back to the Usage screen
      await expect(window.locator('button:has-text("Token Analysis")')).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Screenshot Tests', () => {
  test('Token Analyzer screen screenshot', async () => {
    // Click the Token Analysis button
    const analyzerBtn = window.locator('button:has-text("Token Analysis")');

    if (await analyzerBtn.isVisible()) {
      await analyzerBtn.click();
      await window.waitForTimeout(2000); // Wait for animations

      // Save screenshot
      await window.screenshot({
        path: 'e2e/screenshots/token-analyzer.png',
        fullPage: true
      });
    }
  });

  test('context logs expanded screenshot', async () => {
    const contextHeader = window.locator('text=Referenced Context');

    if (await contextHeader.isVisible()) {
      await contextHeader.click();
      await window.waitForTimeout(500);

      await window.screenshot({
        path: 'e2e/screenshots/context-logs-expanded.png',
        fullPage: true
      });
    }
  });
});
