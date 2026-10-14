/*
 * Screenshots of a prototype, from its live workbench page: every direction
 * at every state, in order (Today first, then A1, A2…, B1…), and each state
 * with the directions side by side. One page, switched from shot to shot as
 * the bar would switch it, so the shots are what the person sees there.
 * Each is captioned, in the list it prints and in shots.md beside them.
 *
 *   node packages/prototype-workbench/scripts/shoot.ts http://localhost:5400 --out test-results/board-card
 *
 * --out      where the shots go (test-results/prototype by default)
 * --size     the window, as 1280x800 (the default)
 * --clean    without the bar, which otherwise says in each shot what it shows
 * --no-side  without the shots side by side
 *
 * Chromium can't start in an agent's sandbox on a Mac: run it outside.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { chromium } from 'playwright'

interface Named {
  key: string
  name: string
}

interface Handle {
  title: string
  directions: Named[]
  states: Named[]
  show(next: { direction?: string; state?: string; side?: string[] | null; bar?: boolean }): Promise<void>
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    out: { type: 'string', default: 'test-results/prototype' },
    size: { type: 'string', default: '1280x800' },
    clean: { type: 'boolean', default: false },
    side: { type: 'boolean', default: true },
  },
})

const address = positionals[0]
const size = /^(\d+)x(\d+)$/.exec(values.size)
if (address === undefined || size === null) {
  process.stderr.write('Usage: shoot.ts <the workbench page’s address> [--out folder] [--size 1280x800] [--clean] [--no-side]\n')
  process.exit(2)
}

/** A name as a file's: pushing-3-commits. */
const filed = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const out = resolve(values.out)
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: Number(size[1]), height: Number(size[2]) }, deviceScaleFactor: 2 })
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  await page.goto(address)
  await page.waitForFunction(() => window.__workbench !== undefined, undefined, { timeout: 20_000 })
  const { title, directions, states } = await page.evaluate(() => {
    const { title, directions, states } = window.__workbench as unknown as Handle
    return { title, directions, states }
  })
  const bar = !values.clean
  const shots: { id: string; file: string; caption: string }[] = []

  const shoot = async (id: string, name: string, view: Parameters<Handle['show']>[0], caption: string) => {
    await page.evaluate((next) => (window.__workbench as unknown as Handle).show(next), view)
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const file = join(out, `${id}-${filed(name)}.png`)
    await page.screenshot({ path: file, animations: 'disabled' })
    shots.push({ id, file, caption })
    process.stdout.write(`${id}\t${relative(process.cwd(), file)}\t${caption}\n`)
  }

  const each = states.length === 0 ? [{ key: '', name: '' }] : states
  for (const direction of directions) {
    // Today has no letter of its own: its shots are Today1, Today2…
    const letter = direction.key === 'today' ? 'Today' : direction.key
    for (const [at, state] of each.entries())
      await shoot(
        `${letter}${at + 1}`,
        [direction.name, state.name].filter(Boolean).join(' '),
        { direction: direction.key, state: state.key, side: null, bar },
        [direction.key === 'today' ? direction.name : `${direction.key}: ${direction.name}`, state.name].filter(Boolean).join(', '),
      )
  }
  if (values.side && directions.length > 1)
    for (const [at, state] of each.entries())
      await shoot(
        `Side${at + 1}`,
        ['side by side', state.name].filter(Boolean).join(' '),
        { state: state.key, side: directions.map((direction) => direction.key), bar },
        ['Side by side', state.name].filter(Boolean).join(', '),
      )

  await writeFile(
    join(out, 'shots.md'),
    [
      `# ${title}`,
      '',
      `From ${address}.`,
      '',
      ...shots.map((shot) => `- **${shot.id}** ${shot.caption}: ${relative(out, shot.file)}`),
      '',
    ].join('\n'),
  )
  if (failures.length > 0) {
    process.stderr.write(`The page failed while it was shot:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`)
    process.exitCode = 1
  }
} finally {
  await browser.close()
}
