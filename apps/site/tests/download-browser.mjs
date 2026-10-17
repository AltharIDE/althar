// Run against the site: node tests/download-browser.mjs http://localhost:5424
// Real mounted links, with the browser's system and GitHub's answer controlled.
// Shoots the page's Download section for each system into test-results/.
// CHROMIUM=/path/to/chrome uses that browser instead of Playwright's own.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://localhost:5424'
const releases = 'https://github.com/AltharIDE/althar/releases'
const latest = `${releases}/latest`
const installer = `${releases}/download/v0.2.0/Althar-0.2.0-arm64.dmg`
const appImage = `${releases}/download/v0.2.0/Althar-0.2.0.AppImage`
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15'
const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const linux = 'Mozilla/5.0 (X11; Linux x86_64)'
// The latest release's files, as v0.2.0 published them: no Windows installer.
const assets = [
  { name: 'Althar-0.2.0-arm64.dmg', browser_download_url: installer },
  { name: 'Althar-0.2.0.AppImage', browser_download_url: appImage },
  { name: 'althar_0.2.0_amd64.deb', browser_download_url: `${releases}/download/v0.2.0/althar_0.2.0_amd64.deb` },
]
const selectors = [
  'header a[href*="releases"]',
  'a[class*="primary"][href*="releases"]',
  'footer nav[aria-label="Footer"] a[href*="releases"]',
]
const SEE = 'See the latest release'
mkdirSync('test-results', { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined })
try {
  for (const scenario of [
    { name: 'apple-silicon', arch: 'arm', expected: installer, label: 'Download for macOS', shoot: true },
    {
      name: 'intel-mac',
      arch: 'x86',
      label: SEE,
      note: 'No build for Intel Macs yet. The macOS build is for Apple silicon.',
      shoot: true,
    },
    { name: 'linux', ua: linux, arch: 'x86', expected: appImage, label: 'Download for Linux', shoot: true },
    {
      name: 'windows-no-installer',
      ua: windows,
      arch: 'x86',
      label: SEE,
      note: 'No Windows build yet. The latest release is for macOS and Linux.',
      shoot: true,
    },
    { name: 'ipad-desktop', touches: 5, requests: 0 },
    { name: 'offline', offline: true },
    { name: 'rate-limited', status: 403 },
    { name: 'no-published-release', status: 404 },
    { name: 'architecture-rejected', rejectArch: true, expected: installer, label: 'Download for macOS' },
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
    const expected = scenario.expected ?? latest
    const label = scenario.label ?? 'Download'
    await page.waitForFunction(
      ({ selectors, expected, label }) =>
        selectors.every((s) => document.querySelector(s)?.getAttribute('href') === expected) &&
        document.querySelector(selectors[1])?.textContent?.trim() === label,
      { selectors, expected, label },
    )
    // A settled hook must keep the same answer and share the lookup across links.
    await page.waitForTimeout(200)
    for (const selector of selectors) assert.equal(await page.locator(selector).first().getAttribute('href'), expected)
    assert.equal(requests, scenario.requests ?? 1)
    // Where the release has no build for this system or chip, both Gets (the first screen's and the end's) say so; elsewhere none does.
    const notes = page.locator('p[class*="missing"]')
    if (scenario.note) assert.deepEqual(await notes.allTextContents(), [scenario.note, scenario.note])
    else assert.equal(await notes.count(), 0)
    process.stdout.write(`${scenario.name}: all three links -> ${expected}; "${label}"; API requests=${requests}\n`)
    if (scenario.shoot) {
      const end = page.locator('section[aria-label="Download Althar"]')
      await end.scrollIntoViewIfNeeded()
      await end.screenshot({ path: `test-results/download-${scenario.name}.png`, scale: 'css' })
      await page
        .locator('div[class*="ctas"]')
        .first()
        .screenshot({ path: `test-results/hero-${scenario.name}.png`, scale: 'css' })
    }
    if (scenario.name === 'apple-silicon')
      await page.locator('section[aria-label^="Runs on"]').screenshot({ path: 'test-results/runs-on.png', scale: 'css' })
    await page.close()
  }
} finally {
  await browser.close()
}
