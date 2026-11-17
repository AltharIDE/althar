// Shoots each direction in each state, at 1×, the app's window only, into lab/homes/shots (the lab running on
// 6181), and a contact sheet of them all (shots/sheet.png): node lab/homes/shoot.mjs; with names after it, only
// those. Chromium can't start in an agent's sandbox on a Mac; run it outside.
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const out = join(import.meta.dirname, 'shots')
mkdirSync(out, { recursive: true })
const home = 'w=hetzner&at=project'
// [name, address, keys pressed once it has drawn (or `click:` a selector, `type:` some words), width]
const shots = [
  ['0-1-homes', 'd=pr&at=home', ['Meta+Shift+KeyH']],
  ['0-2-remote', `d=pr&${home}`],
  ['0-3-dropped', `d=pr&${home}&conn=dropped`],
  ['a-1-menu', `d=a&${home}&open=homes`],
  ['a-2-checked', 'd=a&open=checked'],
  ['a-3-dropped', `d=a&${home}&conn=dropped`],
  ['a-4-connecting', 'd=a&w=hetzner&conn=connecting'],
  ['b-1-switcher', `d=b&${home}&open=homes`],
  ['b-2-checked', 'd=b&open=checked'],
  ['b-3-dropped', `d=b&${home}&conn=dropped`],
  ['b-4-connecting', 'd=b&w=hetzner&conn=connecting'],
  ['c-1-home', 'd=c&at=home'],
  ['c-2-checked', 'd=c&at=home&open=checked'],
  ['c-3-remote-home', 'd=c&w=hetzner'],
  ['c-4-dropped', `d=c&${home}&conn=dropped`],
  ['c-5-dropped-home', 'd=c&w=hetzner&conn=dropped'],
  ['d-1-palette', `d=d&${home}&open=homes`],
  ['d-2-checked', 'd=d&open=checked'],
  ['d-3-remote', `d=d&${home}`],
  ['d-4-dropped', `d=d&${home}&conn=dropped`],
  ['c-6-checked-narrow', 'd=c&at=home&open=checked&narrow=1', [], 880],
  // The chip's Manage homes, three ways
  ['m-1-sigils', 'd=a&m=1&w=hetzner&open=manage&many=1'],
  ['m-1-passport', 'd=a&m=1&w=hetzner&open=manage&pick=studio'],
  [
    'm-1-other-home',
    'd=a&m=1&w=hetzner&open=manage&pick=hetzner',
    ['click:[role=dialog] input[spellcheck=false]', 'ControlOrMeta+KeyA', 'type:hetzner-02', 'Enter'],
  ],
  [
    'm-1-same-home',
    'd=a&m=1&w=hetzner&open=manage&pick=hetzner',
    ['click:[role=dialog] input[spellcheck=false]', 'ControlOrMeta+KeyA', 'type:root@hetzner-01.example.com', 'Enter'],
  ],
  ['m-2-orbit', 'd=a&m=2&w=hetzner&open=manage&many=1'],
  ['m-2-picked', 'd=a&m=2&w=hetzner&open=manage&many=1&pick=studio'],
  ['m-2-dropped', 'd=a&m=2&w=hetzner', ['KeyX', 'Digit2']],
  ['m-2-narrow', 'd=a&m=2&w=hetzner&open=manage&many=1&pick=hetzner&narrow=1', [], 880],
  ['m-3-keycards', 'd=a&m=3&w=hetzner&open=manage&many=1'],
  ['m-3-turned', 'd=a&m=3&w=hetzner&open=manage&pick=studio'],
  ['m-3-narrow', 'd=a&m=3&w=hetzner&open=manage&many=1&narrow=1', [], 880],
]
const dark = [
  '0-2-remote',
  'a-1-menu',
  'a-3-dropped',
  'b-1-switcher',
  'b-3-dropped',
  'c-1-home',
  'c-5-dropped-home',
  'd-1-palette',
  'd-3-remote',
  'd-4-dropped',
  'm-1-sigils',
  'm-1-other-home',
  'm-2-picked',
  'm-3-keycards',
  'm-3-turned',
]
const only = process.argv.slice(2)
const all = [
  ...shots,
  ...shots
    .filter(([name]) => dark.includes(name))
    .map(([name, query, keys, width]) => [`${name}-dark`, `${query}&theme=dark`, keys, width]),
].filter(([name]) => only.length === 0 || only.some((one) => name.startsWith(one)))

const browser = await chromium.launch()
for (const [name, query, keys = [], width = 1280] of all) {
  const page = await browser.newPage({ viewport: { width, height: 760 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:6181/?${query}`)
  await page.waitForTimeout(900)
  for (const key of keys) {
    if (key.startsWith('click:')) await page.locator(key.slice(6)).first().click()
    else if (key.startsWith('type:')) await page.keyboard.type(key.slice(5))
    else await page.keyboard.press(key)
    await page.waitForTimeout(150)
  }
  // the check takes 1.5 s; tabs and sheets settle after their motion
  await page.waitForTimeout(2200)
  await page.locator('[data-lab-window]').screenshot({ path: join(out, `${name}.png`) })
  await page.close()
}

// One sheet of every shot, small, to look over at once.
const tiles = all
  .map(
    ([name]) =>
      `<figure><img src="data:image/png;base64,${readFileSync(join(out, `${name}.png`)).toString('base64')}"><figcaption>${name}</figcaption></figure>`,
  )
  .join('')
const sheet = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
await sheet.setContent(
  `<style>body{margin:0;padding:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font:12px system-ui;background:#888}figure{margin:0}img{width:100%;display:block}figcaption{padding:2px 0}</style>${tiles}`,
)
await sheet.screenshot({ path: join(out, 'sheet.png'), fullPage: true })
await browser.close()
