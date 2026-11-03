import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ElectronApplication, expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, sizeWindow, still } from './support'

/*
 * The first run, as someone new to Althar has it: the welcome's tour, a
 * page for each of what Althar does (projects, the coordinator, agents from
 * different makers, the review), then the agents, the first project of a
 * repository found where people keep code, where its code is and a tracker,
 * and the project opened, its empty conversation asking for the code host
 * and a tracker not connected. Opened again, the window goes to the home.
 * The agents are as a person's own might be: Claude Code signed in, Codex
 * signed out, and the rest of the registry not on this computer. Each step
 * is shot at 1×, light and dark, at the window's smallest size and a large
 * one, into the repository's test-results.
 */

/** Every service Althar connects, as a person's own install offers them, and every agent, one of them signed out. */
const ENV = { ALTHAR_FAKE_CONNECTORS: 'demo', ALTHAR_FAKE_EVERY_AGENT: '1', ALTHAR_FAKE_SIGNED_OUT: 'codex' }

const SHOTS = '../../test-results/welcome'

/** The window's smallest size (main.ts), and a large one. */
const SIZES = [
  ['small', 880, 600],
  ['large', 1440, 900],
] as const

/** The welcome's card, shot at 1× once it is still. */
const shootCard = async (page: Page, name: string) => {
  await still(page)
  await page
    .getByRole('region')
    .filter({ has: page.getByRole('heading', { level: 1 }) })
    .first()
    .screenshot({ path: `${SHOTS}/${name}.png`, scale: 'css' })
}

/** Nothing of the card is drawn outside it, or outside what holds it: no scene, row or mark hangs past an edge. */
const fitsItsCard = async (page: Page) =>
  expect(
    await page.evaluate(() => {
      const card = document.querySelector('h1')?.closest('section')
      if (!card) return ['no card']
      const box = card.getBoundingClientRect()
      const out: string[] = []
      for (const el of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue
        // What a scroller or the scene's frame clips is inside: only what would show past the card counts.
        let clip: DOMRect = box
        for (let up = el.parentElement; up && up !== card; up = up.parentElement)
          if (getComputedStyle(up).overflow !== 'visible') {
            clip = up.getBoundingClientRect()
            break
          }
        const shown = {
          left: Math.max(r.left, clip.left),
          right: Math.min(r.right, clip.right),
          top: Math.max(r.top, clip.top),
          bottom: Math.min(r.bottom, clip.bottom),
        }
        if (shown.right <= shown.left || shown.bottom <= shown.top) continue
        if (shown.left < box.left - 0.5 || shown.right > box.right + 0.5 || shown.top < box.top - 0.5 || shown.bottom > box.bottom + 0.5)
          out.push(`${el.tagName.toLowerCase()}.${el.className}`)
      }
      return out
    }),
  ).toEqual([])

/** The card at each size, light and dark, each shot at 1×, and nothing drawn outside it; then back to the large window, light. */
const shoot = async (electronApp: ElectronApplication, page: Page, name: string) => {
  for (const [size, width, height] of SIZES) {
    await sizeWindow(electronApp, page, width, height)
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((one) => {
        document.documentElement.dataset.theme = one
      }, theme)
      await fitsItsCard(page)
      await shootCard(page, `${name}-${size}-${theme}`)
    }
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
}

test('walks a first run from the tour to the project, which asks for its code host and a tracker, and goes to the home after', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  repository(projects)
  mkdirSync(SHOTS, { recursive: true })
  let { electronApp, page } = await launch(home, ENV)
  try {
    // The tour: four pages, each a scene of the real components, walked with Next. With reduced motion each arrives as it
    // ends, as the kit's scenes do, so each is shot played out.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const pages = [
      ['projects', 'Work happens in projects'],
      ['coordinator', 'Meet the coordinator'],
      ['makers', 'Agents from different makers'],
      ['review', 'Reviewed before you see it'],
    ] as const
    let makers: string[] = []
    for (const [name, title] of pages) {
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
      // Every agent Althar runs, a mark each, named.
      if (name === 'makers')
        makers = await page
          .getByRole('list', { name: 'The agents Althar runs' })
          .getByRole('img')
          .evaluateAll((marks) => marks.map((mark) => mark.getAttribute('aria-label') ?? ''))
      await shoot(electronApp, page, `1-tour-${name}`)
      await page.getByRole('button', { name: name === 'review' ? 'Set up Althar' : 'Next' }).click()
    }

    await page.emulateMedia({ reducedMotion: null })

    // The agents on this computer, and those Althar can fetch; one ready is enough.
    await expect(page.getByRole('heading', { name: 'Your agents', level: 1 })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Crash reports' })).toBeVisible()
    const rows = page.getByRole('list', { name: /^Agents on / })
    const away = page.getByRole('list', { name: /^Agents not on / })
    await expect(rows.getByRole('listitem').filter({ hasText: 'Claude Code' }).getByText('Signed in')).toBeVisible()
    const codex = rows.getByRole('listitem').filter({ hasText: 'Codex' }).first()
    await expect(codex.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(away.getByRole('listitem').first()).toContainText('OpenCode')
    // The makers' page named every agent here, on this computer or not, and none else.
    const listed = [...(await rows.locator(':scope > li').allInnerTexts()), ...(await away.getByRole('listitem').allInnerTexts())]
    expect(makers.length).toBeGreaterThan(4)
    expect(makers).toHaveLength(listed.length)
    for (const name of makers) expect(listed.some((one) => one.includes(name))).toBe(true)
    await shoot(electronApp, page, '2-agents')
    // Codex's own account signs in again, in its row, named.
    await codex.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('group', { name: 'Signing main in' })).toBeVisible()
    await shootCard(page, '2-agents-signing-in')
    await page.getByRole('group', { name: 'Signing main in' }).getByRole('button', { name: 'Cancel signing in' }).click()
    await expect(page.getByRole('group', { name: 'Signing main in' })).toHaveCount(0)
    await page.getByRole('button', { name: /^Continue/ }).click()

    // The first project, of the repository found: the field that finds one has the focus, and Return ticks what it found.
    const found = page.getByRole('list', { name: 'Repositories for the project' })
    await expect(page.getByRole('searchbox')).toBeFocused()
    await shoot(electronApp, page, '3-project')
    await page.keyboard.type('meri')
    await expect(found.getByRole('checkbox')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(found.getByRole('checkbox', { name: /meridian/ })).toBeChecked()
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('meridian')
    await shoot(electronApp, page, '3-project-found')
    await page.getByRole('button', { name: /Make the project/ }).click()

    // Made, the welcome stays: where its code is, then a tracker, each can wait.
    await expect(page.getByRole('heading', { name: 'Pull requests', level: 1 })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Code hosts' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)
    await shoot(electronApp, page, '4-code')
    // A host's walk in, in the welcome's card, from the same left edge as the way back to the hosts.
    await page
      .getByRole('list', { name: 'Code hosts' })
      .getByRole('listitem')
      .filter({ hasText: 'GitHub' })
      .getByRole('button', { name: /^Connect/ })
      .click()
    await expect(page.getByRole('heading', { name: 'Connect GitHub' })).toBeVisible()
    await shoot(electronApp, page, '4-code-github')
    await page.getByRole('button', { name: 'Back to code hosts' }).click()
    await expect(page.getByRole('list', { name: 'Code hosts' })).toBeVisible()
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(page.getByRole('list', { name: 'Trackers' })).toBeVisible()
    await shoot(electronApp, page, '5-issues')
    await page.getByRole('button', { name: 'Open meridian' }).click()

    // The project, ready for its first message, its conversation asking for what the welcome didn't connect.
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    const card = page.getByRole('region', { name: 'Before the first pull request' })
    await expect(card).toBeVisible()
    await still(page)
    await card.screenshot({ path: `${SHOTS}/6-project-card.png`, scale: 'css' })
    await page.screenshot({ path: `${SHOTS}/6-project.png`, scale: 'css' })

    // The card's walk in, in place of its rows: GitHub's ways in, a token's step, a company's own server, and back to its
    // rows. Each state shot at the window's smallest size and a large one, light and dark.
    const shootTheCard = async (name: string) => {
      for (const [size, width, height] of SIZES) {
        await sizeWindow(electronApp, page, width, height)
        for (const theme of ['light', 'dark'] as const) {
          await page.evaluate((one) => {
            document.documentElement.dataset.theme = one
          }, theme)
          await still(page)
          await card.screenshot({ path: `${SHOTS}/7-card-${name}-${size}-${theme}.png`, scale: 'css' })
        }
      }
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'light'
      })
    }
    const back = card.getByRole('button', { name: 'Back', exact: true })
    await shootTheCard('rows')
    await card.getByRole('button', { name: 'Connect' }).first().click()
    await page.getByRole('menuitem', { name: 'GitHub' }).click()
    await expect(card.getByRole('heading', { name: 'Connect GitHub' })).toBeVisible()
    await shootTheCard('github')
    await card.getByRole('button', { name: /^Make a token/ }).click()
    await expect(card.getByRole('heading', { name: 'Connect GitHub' })).toHaveCount(0)
    await shootTheCard('token')
    await back.click()
    await card.getByRole('button', { name: 'On a company’s own server' }).click()
    await expect(card.getByRole('heading', { name: 'Connect GitHub' })).toHaveCount(0)
    await shootTheCard('server')
    await back.click()
    await expect(card.getByRole('heading', { name: 'Connect GitHub' })).toBeVisible()
    await back.click()
    await expect(card.getByRole('button', { name: 'Connect' }).first()).toBeVisible()
  } finally {
    await electronApp.close()
  }

  // Opened again: the home, and no welcome.
  ;({ electronApp, page } = await launch(home, ENV))
  try {
    await expect(page.getByRole('complementary', { name: 'Projects' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your agents', level: 1 })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
