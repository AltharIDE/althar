import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { holdRuntime, launch, openFirstProject, say, shown, startTask, still } from './support'

/*
 * Asides (docs/decisions/tasks.md, "Asides"), in a real window with the fake
 * agent: pills over the coordinator's conversation, the coordinator first and
 * its turns signed so. One is started from the coordinator's composer, opens
 * in its place with a composer and moves of its own, and leaves for the board
 * made a task, by the person's word or once its agent changes the
 * repository, the coordinator's conversation keeping a line of each; words
 * the coordinator said, selected, start one about them. The screenshots are
 * this change's evidence (test-results/asides-*.png).
 */

/** The conversation's column, from the bar over it down, at 1×. */
const shoot = async (page: Page, pills: Locator, name: string) => {
  const box = await pills.locator('xpath=ancestor::*[@data-conversation-bar][1]').boundingBox()
  const height = page.viewportSize()?.height ?? 800
  if (box === null) return
  await still(page)
  await page.screenshot({
    path: `test-results/asides-${name}.png`,
    clip: { x: 0, y: box.y - 8, width: box.x + box.width + 12, height: height - box.y + 8 },
    scale: 'css',
  })
}

/**
 * Watches the pills over the conversation from now on, every frame the window draws of them: the most asides it showed at
 * once, and how many elements were ever an aside's pill. One pill all along is one at most, and one element.
 */
const watchPills = (page: Page) =>
  page.evaluate(() => {
    const seen = { most: 0, pills: new Set<Element>(), loading: false }
    const look = () => {
      if (
        [...document.querySelectorAll<HTMLElement>('output[aria-label="Reading the conversation"]')].some(
          (one) => one.offsetParent !== null,
        )
      )
        seen.loading = true
      for (const bar of document.querySelectorAll<HTMLElement>('[role="tablist"][aria-label="Conversations"]')) {
        if (bar.offsetParent === null) continue
        const asides = [...bar.querySelectorAll('[role="tab"]')].filter((tab) => tab.textContent?.trim() !== 'Coordinator')
        seen.most = Math.max(seen.most, asides.length)
        for (const pill of asides) seen.pills.add(pill)
      }
    }
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
    look()
    Object.assign(window, { pillsSeen: () => ({ most: seen.most, elements: seen.pills.size, loading: seen.loading }) })
  })

/** Starts an aside from the coordinator's composer, as the person does with +. */
const startAside = async (page: Page, words: string) => {
  await page.getByRole('button', { name: 'New aside' }).click()
  const box = page.getByRole('textbox', { name: /^Ask on the side/ })
  await box.click()
  await box.fill(words)
  await box.press('Enter')
}

test('asides: started beside the coordinator, opened in its place with a composer of their own, made a task and noted', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    const pills = page.getByRole('tablist', { name: 'Conversations' }).filter({ visible: true })
    const coordinator = pills.getByRole('tab', { name: 'Coordinator' })
    await expect(coordinator).toHaveAttribute('aria-selected', 'true')

    // The coordinator answers, its turn signed Coordinator rather than with its model.
    await say(page, 'What does the checkout retry do?')
    const answer = page.getByRole('article', { name: 'Coordinator' }).filter({ visible: true }).last()
    await expect(answer).toBeVisible()
    await expect(answer.getByRole('button', { name: 'Copy' })).toBeAttached()

    // A new aside, from +: the coordinator's composer starts it, and it opens in the coordinator's place.
    await startAside(page, 'Which file holds the retry?\n[lead:finish] [lead:answered]')
    const aside = pills.getByRole('tab', { name: 'Which file holds the retry?' })
    await expect(aside).toHaveAttribute('aria-selected', 'true')
    await expect(shown(page, 'Which file holds the retry?').first()).toBeVisible()
    // Its moves over its composer, which is a task's own.
    const makeTask = page.getByRole('button', { name: 'Make it a task' })
    await expect(makeTask).toBeVisible()
    await expect(page.getByRole('article', { name: 'Coordinator' }).filter({ visible: true }).first()).toBeVisible()
    await shoot(page, pills, 'open')

    // Made a task: it leaves the pills for the board, and the coordinator's conversation keeps a line of it.
    await makeTask.click()
    await expect(aside).toHaveCount(0)
    await expect(coordinator).toHaveAttribute('aria-selected', 'true')
    const line = shown(page, 'An aside became a task: Which file holds the retry?')
    await expect(line).toBeVisible()
    await expect(page.getByRole('region', { name: 'The project’s work' }).getByText('Which file holds the retry?')).toBeVisible()
    await line.scrollIntoViewIfNeeded()
    await shoot(page, pills, 'made-a-task')

    // ⌘J, from anywhere in the window, opens the search over every conversation; Escape shuts it.
    await page.keyboard.press('ControlOrMeta+j')
    const search = page.getByRole('combobox', { name: 'Search conversations' })
    await expect(search).toBeFocused()
    await shoot(page, pills, 'search')
    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)

    // One whose agent changes the repository goes to the board by itself.
    await startAside(page, 'Shorten the retry wait\n[lead:finish] [lead:edit]')
    await expect(shown(page, 'An aside became a task: Shorten the retry wait')).toBeVisible()
    await expect(pills.getByRole('tab', { name: 'Shorten the retry wait' })).toHaveCount(0)

    // Words the coordinator said, selected, start an aside about them, quoted over the composer.
    await still(page)
    await answer.locator('p').first().click({ clickCount: 3 })
    const askInAside = page.getByRole('button', { name: 'Ask in an aside' })
    await expect(askInAside).toBeVisible()
    // A pointer move can scroll the selected text and dismiss the floating button before the click.
    await askInAside.evaluate((button: HTMLButtonElement) => button.click())
    await expect(page.getByRole('button', { name: 'Drop the quote' })).toBeVisible()
    await expect(pills.getByRole('tab', { name: 'New aside' })).toHaveAttribute('aria-selected', 'true')
    await shoot(page, pills, 'quote')
  } finally {
    await electronApp.close()
  }
})

test('a new aside is one pill from + on, named by its first words, and a plain reply to them shows no error and no Checked block', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    const pills = page.getByRole('tablist', { name: 'Conversations' }).filter({ visible: true })
    await expect(pills.getByRole('tab', { name: 'Coordinator', exact: true })).toHaveAttribute('aria-selected', 'true')
    await watchPills(page)
    const release = await holdRuntime(page)

    // + starts it at once: its one pill, open, says it is new while the person writes.
    await page.getByRole('button', { name: 'New aside' }).click()
    await expect(pills.getByRole('tab', { name: 'New aside' })).toHaveAttribute('aria-selected', 'true')
    const box = page.getByRole('textbox', { name: /^Ask on the side/ })
    await box.click()
    await box.fill('Hi')
    await box.press('Enter')
    // Before the runtime can make even its thread, the first words and title are there in the same pill and conversation.
    await expect(pills.getByRole('tab', { name: 'Hi', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(shown(page, 'Hi', { exact: true }).last()).toBeVisible()
    await shoot(page, pills, 'starting')
    await release()

    // Its first words name the same pill, and its lead's answer comes in its own conversation, the turn over.
    await expect(pills.getByRole('tab', { name: 'Hi', exact: true })).toHaveAttribute('aria-selected', 'true')
    const answer = page.getByRole('article', { name: 'Coordinator' }).filter({ visible: true }).filter({ hasText: 'echo:' })
    await expect(answer).toBeVisible()
    await expect(page.getByRole('button', { name: /^Interrupt/ }).filter({ visible: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Make it a task' })).toBeEnabled()
    await shoot(page, pills, 'hi')

    // One pill, one element, from + to the answer: never a second beside it, nor one that took its place.
    expect(await page.evaluate(() => (window as unknown as { pillsSeen: () => unknown }).pillsSeen())).toEqual({
      most: 1,
      elements: 1,
      loading: false,
    })
    // Nothing the person did wrong, so no error over the composer; and a reply that checked nothing draws no Checked block.
    await expect(page.getByText(/isn.t there any more/)).toHaveCount(0)
    await expect(page.getByRole('alert').filter({ visible: true })).toHaveCount(0)
    await expect(page.getByText('What it checked')).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})

test('an aside answers while the task slot is occupied and another task waits in Up next', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await page.getByRole('button', { name: /^Althar settings/ }).click()
    const slider = page.getByRole('dialog', { name: 'Quick settings' }).getByRole('slider', { name: 'Agents at once' })
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(slider).toHaveAttribute('aria-valuenow', '1')
    await page.keyboard.press('Escape')
    await page
      .getByRole('navigation', { name: 'Projects' })
      .getByRole('button', { name: /^meridian/ })
      .click()
    await startTask(page, 'Keep the one task place', '[lead:wait]')
    await startTask(page, 'Wait for the task place', '[lead:wait]')
    const queued = page.getByText(/^Waiting · 1 agent busy$/)
    await expect(queued).toBeVisible()
    await startAside(page, 'Hi')
    const pills = page.getByRole('tablist', { name: 'Conversations' }).filter({ visible: true })
    await expect(pills.getByRole('tab', { name: 'Hi', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('article', { name: 'Coordinator' }).filter({ visible: true }).filter({ hasText: 'echo:' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Waiting for a place/ })).toHaveCount(0)
    await expect(
      page.getByRole('region', { name: 'Up next', exact: true }).getByRole('button', { name: 'Wait for the task place', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Running', exact: true }).getByRole('button', { name: 'Keep the one task place', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('alert').filter({ visible: true })).toHaveCount(0)
    await shoot(page, pills, 'full-task-queue')
  } finally {
    await electronApp.close()
  }
})

test('an aside’s × clears it in the frame it is pressed, for good, and Make it a task puts its card on the board in that frame', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    const pills = page.getByRole('tablist', { name: 'Conversations' }).filter({ visible: true })
    const coordinator = pills.getByRole('tab', { name: 'Coordinator', exact: true })
    await expect(coordinator).toHaveAttribute('aria-selected', 'true')

    await startAside(page, 'Which file holds the retry?\n[lead:finish] [lead:answered]')
    const aside = pills.getByRole('tab', { name: 'Which file holds the retry?' })
    await expect(aside).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Make it a task' })).toBeVisible()
    // Its moves over its composer are Make it a task alone: its pill's × clears it.
    await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0)
    const clear = page.getByRole('button', { name: 'Clear Which file holds the retry?' })
    await expect(clear).toBeVisible()
    await shoot(page, pills, 'clear')

    // Pressed, it is gone in the same frame, the coordinator's conversation open, and no frame after brings it back.
    const id = (await aside.getAttribute('data-aside')) ?? ''
    expect(id).not.toBe('')
    const gone = await clear.evaluate(async (button: HTMLButtonElement, taskId) => {
      const pill = `[data-aside="${CSS.escape(taskId)}"]`
      const showing = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].find((one) => one.checkVisibility())
      const back = { seen: false, first: null as Record<string, unknown> | null }
      const pressedAt = performance.now()
      button.click()
      // Before the frame after the press is painted: what the person sees next. From then, no frame may draw it again.
      await new Promise((painted) => requestAnimationFrame(painted))
      new MutationObserver(() => {
        const returned = showing(pill)
        if (returned === undefined) return
        back.seen = true
        back.first ??= {
          afterMs: performance.now() - pressedAt,
          node: returned.outerHTML.slice(0, 800),
          parent: returned.parentElement?.outerHTML.slice(0, 1000),
          alerts: [...document.querySelectorAll<HTMLElement>('[role="alert"]')].map((one) => one.innerText),
        }
      }).observe(document.body, { childList: true, subtree: true })
      Object.assign(window, { clearedBack: () => back.seen, clearedBackDetails: () => back.first })
      return {
        pill: showing(pill) === undefined,
        coordinator: showing('[role="tab"][aria-selected="true"]')?.textContent?.trim() === 'Coordinator',
      }
    }, id)
    expect(gone).toEqual({ pill: true, coordinator: true })
    // Althar catches up behind: the board's own read says it settled, and still nothing of it came back.
    const clearedBack = () => page.evaluate(() => (window as unknown as { clearedBack: () => boolean }).clearedBack())
    const details = () =>
      page.evaluate(() => JSON.stringify((window as unknown as { clearedBackDetails: () => unknown }).clearedBackDetails()))
    await expect(page.getByRole('region', { name: 'The project’s work' }).getByText('Which file holds the retry?')).toBeVisible()
    expect(await clearedBack(), await details()).toBe(false)
    await expect(page.getByRole('alert').filter({ visible: true })).toHaveCount(0)

    // Make it a task: its pill goes and its card is on the board in the frame it is pressed.
    await startAside(page, 'Shorten the retry wait\n[lead:finish] [lead:answered]')
    const work = pills.getByRole('tab', { name: 'Shorten the retry wait' })
    await expect(work).toHaveAttribute('aria-selected', 'true')
    const makeTask = page.getByRole('button', { name: 'Make it a task' })
    await expect(makeTask).toBeVisible()
    const workId = (await work.getAttribute('data-aside')) ?? ''
    const moved = await makeTask.evaluate(async (button: HTMLButtonElement, taskId) => {
      button.click()
      await new Promise((painted) => requestAnimationFrame(painted))
      const showing = (selector: string) => [...document.querySelectorAll(selector)].some((one) => one.checkVisibility())
      return {
        pill: !showing(`[data-aside="${CSS.escape(taskId)}"]`),
        card: showing(`[data-move="${CSS.escape(taskId)}"]`),
      }
    }, workId)
    expect(moved).toEqual({ pill: true, card: true })
    await expect(shown(page, 'An aside became a task: Shorten the retry wait')).toBeVisible()
    await expect(work).toHaveCount(0)
    // Through every read of the board since, the cleared one never came back.
    expect(await clearedBack(), await details()).toBe(false)
  } finally {
    await electronApp.close()
  }
})

test('a new aside’s picker is its own: its first words go on what it shows, and the coordinator’s pick stays as it was', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    const pills = page.getByRole('tablist', { name: 'Conversations' }).filter({ visible: true })
    const coordinator = pills.getByRole('tab', { name: 'Coordinator', exact: true })
    // The coordinator has a session of its own, held: what its picker sets goes to it.
    await say(page, 'What does the checkout retry do?')
    await expect(page.getByRole('article', { name: 'Coordinator' }).filter({ visible: true }).last()).toBeVisible()
    const coordinatorPick = page.getByRole('button', { name: /^Coordinator:/ }).filter({ visible: true })
    const before = (await coordinatorPick.getAttribute('aria-label')) ?? ''
    expect(before).not.toMatch(/High$/)

    // + over it: the composer's picker is the new aside's lead's, and the person picks High there.
    await page.getByRole('button', { name: 'New aside' }).click()
    await expect(pills.getByRole('tab', { name: 'New aside' })).toHaveAttribute('aria-selected', 'true')
    const asidePick = page.getByRole('button', { name: /^Lead:/ }).filter({ visible: true })
    await asidePick.click()
    await page.getByRole('radio', { name: 'High' }).click()
    await page.keyboard.press('Escape')
    await expect(asidePick).toHaveAttribute('aria-label', /High$/)
    await shoot(page, pills, 'new-pick')
    const box = page.getByRole('textbox', { name: /^Ask on the side/ })
    await box.click()
    await box.fill('Hi')
    await box.press('Enter')

    // Its first words went on High: its lead says so in its own conversation, and its composer shows it.
    await expect(pills.getByRole('tab', { name: 'Hi', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(shown(page, 'Effort changed to high.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Lead:/ }).filter({ visible: true })).toHaveAttribute('aria-label', /High$/)

    // The coordinator's own pick is as it was, and nothing changed in its conversation.
    await coordinator.click()
    await expect(coordinator).toHaveAttribute('aria-selected', 'true')
    await expect(coordinatorPick).toHaveAttribute('aria-label', before)
    await expect(shown(page, 'Effort changed to high.')).toHaveCount(0)
    await expect(page.getByRole('alert').filter({ visible: true })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
