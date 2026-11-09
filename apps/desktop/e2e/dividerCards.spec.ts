import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow, startTask, still } from './support'

/*
 * The board's cards stay in their lanes while the divider beside the
 * conversation moves (DEV-222). The board draws itself again on its own while
 * a drag goes on: its clock ticks each second, its tasks change, a lane turns
 * to a rail. React draws that in the same commit as the divider's next width,
 * so in that commit the whole board moves, and its cards with it. They used to
 * slide from where the board had been, each such commit setting them off again
 * from where they showed, until they stood off their lanes, cut off by them,
 * behind the lane beside. Here the board draws itself again with each step of
 * the drag, as the pointer going from lane to lane has it do (which lane it is
 * in is the board's state), so every step is such a commit: a slow drag, three
 * pixels a frame, narrowing the board until lanes turn to rails, then widening
 * it until the conversation is at its narrowest. Without the fix, a card stood
 * some 90 px off its lane.
 */

test('the board’s cards stay in their lanes while the divider moves', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await sizeWindow(electronApp, page, 1440, 860)
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // A card running, and one that needs the person: a lane each.
    await startTask(page, 'Keep the session alive', '[lead:wait]')
    await startTask(page, 'Cache the rates', '[lead:finish]')
    await page.getByRole('radio', { name: 'Home' }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const running = work.locator('[data-lane="running"] [data-move]')
    const yours = work.locator('[data-lane="you"] [data-move]')
    await expect(running).toHaveCount(1)
    await expect(yours).toHaveCount(1)
    await still(page)
    await work.screenshot({ path: 'test-results/divider-cards-before.png', scale: 'css' })

    const divider = page.getByRole('separator', { name: 'Width of the conversation' })
    const box = (await divider.boundingBox())!
    const x = box.x + box.width / 2
    await page.mouse.move(x, box.y + box.height / 2)
    await page.mouse.down()

    /**
     * Moves the divider `by` px a frame for `frames` frames from `from`: how far a card was drawn outside its lane at most,
     * in px, and where it ended. What moves on the page is held where it is at the last frame, for a shot of it.
     */
    const drag = (by: number, frames: number, from: number) =>
      page.evaluate(
        async ({ by, frames, from }) => {
          const handle = document.querySelector<HTMLElement>('[role="separator"][aria-label="Width of the conversation"]')!
          const board = document.querySelector<HTMLElement>('[aria-label="The project’s work"]')!
          const card = (lane: string) => board.querySelector<HTMLElement>(`[data-lane="${lane}"] [data-move]`)!
          const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))
          /** How far each card is drawn outside its lane, at most. */
          const outside = () =>
            Math.max(
              0,
              ...[...board.querySelectorAll<HTMLElement>('[data-move]')].map((one) => {
                const lane = one.closest('[data-lane]')!.getBoundingClientRect()
                const at = one.getBoundingClientRect()
                return Math.max(lane.left - at.left, at.right - lane.right)
              }),
            )
          let worst = 0
          let at = from
          for (let i = 0; i < frames; i += 1) {
            at += by
            // In one task, so in one commit: the divider's next width, and the board drawn again, the pointer in another lane.
            handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: at }))
            card(i % 2 === 0 ? 'running' : 'you').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
            await frame()
            worst = Math.max(worst, outside())
          }
          for (const one of document.getAnimations()) one.pause()
          return { worst, at }
        },
        { by, frames, from },
      )

    // Narrowing the board, slowly, until lanes turn to rails; then widening it, past where it was, to the conversation's narrowest.
    const narrowed = await drag(3, 80, x)
    await page.evaluate(() => document.getAnimations().forEach((one) => one.play()))
    const widened = await drag(-3, 150, narrowed.at)
    await work.screenshot({ path: 'test-results/divider-cards-mid-drag.png', scale: 'css' })
    await page.evaluate(() => document.getAnimations().forEach((one) => one.play()))
    await page.mouse.up()
    expect(narrowed.worst).toBeLessThanOrEqual(1)
    expect(widened.worst).toBeLessThanOrEqual(1)
    await still(page)
    await work.screenshot({ path: 'test-results/divider-cards-after.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
