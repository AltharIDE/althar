// Run against the site: node tests/download-browser.mjs http://localhost:5424
// Real mounted links, with the browser's system and GitHub's answer controlled.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://localhost:5424'
const releases = 'https://github.com/AltharIDE/althar/releases'
const installer = `${releases}/download/v0.2.0/Althar-0.2.0-arm64.dmg`
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15'
const assets = [{ name: 'Althar-0.2.0-arm64.dmg', browser_download_url: installer }]
const selectors = [
  'header a[href*="releases"]',
  'a[class*="primary"][href*="releases"]',
  'footer nav[aria-label="Footer"] a[href*="releases"]',
]
mkdirSync('test-results', { recursive: true })
const browser = await chromium.launch()
try {
  for (const scenario of [
    { name: 'apple-silicon', arch: 'arm', expected: installer },
    { name: 'intel-mac', arch: 'x86' },
    { name: 'ipad-desktop', touches: 5, requests: 0 },
    { name: 'offline', offline: true },
    { name: 'rate-limited', status: 403 },
    { name: 'no-published-release', status: 404 },
    { name: 'architecture-rejected', rejectArch: true, expected: installer },
    { name: 'windows-no-installer', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', arch: 'x86' },
    { name: 'unknown', ua: 'odd browser', requests: 0 },
  ]) {
    const page = await browser.newPage({ userAgent: scenario.ua ?? mac, viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' })
    let requests = 0
    await page.addInitScript((s) => {
      Object.defineProperty(navigator, 'maxTouchPoints', { value: s.touches ?? 0 })
      Object.defineProperty(navigator, 'userAgentData', {
        value:
          s.arch || s.rejectArch
            ? {
                getHighEntropyValues: () =>
                  s.rejectArch ? Promise.reject(new Error('denied')) : Promise.resolve({ architecture: s.arch }),
              }
            : undefined,
      })
    }, scenario)
    await page.route('https://api.github.com/repos/AltharIDE/althar/releases/latest', async (route) => {
      requests++
      if (scenario.offline) await route.abort()
      else await route.fulfill({ status: scenario.status ?? 200, contentType: 'application/json', body: JSON.stringify({ assets }) })
    })
    await page.goto(base)
    const expected = scenario.expected ?? releases
    await page.waitForFunction(
      ({ selectors, expected }) =>
        selectors.every((s) => document.querySelector(s)?.getAttribute('href') === expected) &&
        (expected !== 'https://github.com/AltharIDE/althar/releases' ||
          document.querySelector(selectors[1])?.textContent?.trim() === 'Download'),
      { selectors, expected },
    )
    // A settled hook must keep the same answer and share the lookup across links.
    await page.waitForTimeout(200)
    for (const selector of selectors) assert.equal(await page.locator(selector).first().getAttribute('href'), expected)
    assert.equal(requests, scenario.requests ?? 1)
    process.stdout.write(`${scenario.name}: all three links -> ${expected}; API requests=${requests}\n`)
    if (scenario.name === 'ipad-desktop' || scenario.name === 'apple-silicon') {
      await page
        .locator(selectors[1])
        .first()
        .screenshot({ path: `test-results/download-${scenario.name}.png` })
    }
    await page.close()
  }
} finally {
  await browser.close()
}
