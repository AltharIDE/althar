import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'

import { budget } from '@althar/testing/budget'
import { type ElementHandle, expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * The full model picker, in a real window with every core kept busy: a model's default effort, and a model switched off,
 * show in the frame after the press. Each is timed in the page, from the press to the change on screen, and said on the
 * console. Here the runtime answers quickly, its store empty; that the press never waits on it, however long it takes, is
 * modelsBrowser.test.tsx's to show, with a runtime that answers only when told.
 */

/**
 * Keeps every core busy, as the person's tasks' builds and tests do, until stopped: each started once it resolves. Where
 * one can't start, those that did are stopped before it says so, as the caller never has them to stop.
 */
const busy = async (): Promise<ReadonlyArray<ChildProcess>> => {
  const load = Array.from({ length: availableParallelism() }, () => spawn('yes', [], { stdio: 'ignore' }))
  try {
    await Promise.all(load.map((one) => new Promise((started, failed) => one.once('spawn', started).once('error', failed))))
  } catch (error) {
    load.forEach((one) => one.kill())
    throw error
  }
  return load
}

/** Opens the full model picker from a preset's lead, in Settings › Tasks › Presets. */
const openBrowser = async (page: Page) => {
  await page.keyboard.press('ControlOrMeta+Shift+Comma')
  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: /^Tasks/ })
    .click()
  const presets = page.getByRole('main').getByRole('region', { name: 'Presets' })
  await presets.getByRole('button', { name: 'Tune' }).nth(4).click()
  await presets.getByRole('button', { name: 'Choose a model' }).click()
  await presets.getByRole('button', { name: /^Lead: / }).click()
  await page.getByRole('button', { name: /^All models/ }).click()
  return page.getByRole('dialog', { name: 'Models' })
}

/** Starts timing `target`: from the next press on what `pressed` finds to the moment what `shown` reads of it first changes. */
const arm = (target: ElementHandle, shown: 'text' | 'pressed', pressed: string) =>
  target.evaluate(
    (element, { how, on }) => {
      const read = () => (how === 'text' ? element.textContent : (element as Element).getAttribute('aria-pressed'))
      const before = read()
      const state = window as unknown as { pressedAt?: number; shownAt?: number }
      state.pressedAt = undefined
      state.shownAt = undefined
      const press = (event: Event) => {
        if (!(event.target instanceof Element) || event.target.closest(on) === null) return
        state.pressedAt = performance.now()
        document.removeEventListener('pointerup', press, { capture: true })
      }
      document.addEventListener('pointerup', press, { capture: true })
      const watch = new MutationObserver(() => {
        if (read() === before) return
        state.shownAt = performance.now()
        watch.disconnect()
      })
      watch.observe(element, { subtree: true, childList: true, characterData: true, attributes: true })
    },
    { how: shown, on: pressed },
  )

/** How long, in ms, from the press to the change on screen, once both have happened. */
const took = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => (window as unknown as { shownAt?: number }).shownAt)).toBeDefined()
  return page.evaluate(() => {
    const state = window as unknown as { pressedAt: number; shownAt: number }
    return Math.round(state.shownAt - state.pressedAt)
  })
}

test('the full model picker shows a default effort and a model switched off at once, with every core busy', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  mkdirSync(join(home, 'profile'), { recursive: true })
  writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance: 'light' }))
  const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
  let load: ReadonlyArray<ChildProcess> = []
  try {
    await page.setViewportSize({ width: 1180, height: 900 })
    await openFirstProject(electronApp, page, repository(home))
    const browser = await openBrowser(page)
    const first = browser.getByRole('combobox', { name: /^Default effort for / }).first()
    await expect(first).toBeVisible()
    const name = ((await first.getAttribute('aria-label')) ?? '').replace('Default effort for ', '')
    // By its name: switched off, its row moves below the ones in use.
    const effort = browser.getByRole('combobox', { name: `Default effort for ${name}`, exact: true })
    const was = (await effort.textContent()) ?? ''

    load = await busy()

    await arm(await effort.elementHandle().then((one) => one!), 'text', '[role="option"]')
    await effort.click()
    const other = page.getByRole('option').filter({ hasNotText: was }).first()
    const chosen = ((await other.textContent()) ?? '').trim()
    await other.click()
    const effortMs = await took(page)
    await expect(effort).toHaveText(chosen)

    const off = browser.getByRole('button', { name: `Don’t use ${name}` })
    await arm(await off.elementHandle().then((one) => one!), 'pressed', 'button')
    await off.click()
    const offMs = await took(page)
    await expect(off).toHaveAttribute('aria-pressed', 'true')
    await browser.screenshot({ path: 'test-results/model-browser-under-load.png', scale: 'css', animations: 'disabled' })

    // One frame is at most about 16 ms at 60 Hz.
    process.stdout.write(
      `Under load (${load.length} cores busy): default effort shown ${effortMs} ms after the press, switched off ${offMs} ms after\n`,
    )
    expect(effortMs).toBeLessThan(100)
    expect(offMs).toBeLessThan(100)

    // And the runtime took both: a fresh window, holding no change of its own, reads them back. Each try is a window of its
    // own, as one that read before a write was in never reads again once no agent is probing.
    await expect(async () => {
      await page.reload()
      const again = await openBrowser(page)
      await expect(again.getByRole('combobox', { name: `Default effort for ${name}`, exact: true })).toHaveText(chosen, {
        timeout: budget.small,
      })
      await expect(again.getByRole('button', { name: `Don’t use ${name}` })).toHaveAttribute('aria-pressed', 'true', {
        timeout: budget.small,
      })
    }).toPass({ timeout: budget.medium })
  } finally {
    load.forEach((one) => one.kill())
    await electronApp.close()
  }
})
