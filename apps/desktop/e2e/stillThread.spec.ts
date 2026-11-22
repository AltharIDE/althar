import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, shown, startTask, still } from './support'

/*
 * A still thread stays still: with nothing said, nothing streamed and nothing
 * scrolled, nothing in the coordinator's conversation starts an animation and
 * nothing in view moves, for a whole minute, in a window as the person keeps
 * it: a dev server running, so the thread's clocks tick each second, and a
 * task's card above the view that changes and grows as its task finishes
 * halfway through. Every animation started in the thread is heard (Web
 * Animations, CSS animations and transitions), and where each block in view
 * stands is read each frame. Each of the person's messages is an item the
 * window moves (ListMotion), and the thread followed its bottom only after
 * that read where each stood: a card above that grew read as every message
 * under it moving, and each jumped and slid back (VirtualBlocks keeps what is
 * in view in place within the commit now).
 */

/** A dev server on a free port that says where it answers, as Vite does. */
const SERVER = `require('node:http').createServer((_, res) => res.end('meridian')).listen(0, function () {
  console.log('  Local:   http://localhost:' + this.address().port + '/')
})
`

const WATCH = Number.parseInt(process.env.ALTHAR_STILL_FOR ?? '', 10) || 60_000

/**
 * Lets `span` go by on the page's own clock. The span is what the spec watches for, not a guess at how long something
 * takes: nothing is awaited but time itself.
 */
const watchFor = async (page: Page, span: number) => {
  const end = (await page.evaluate(() => performance.now())) + span
  await page.waitForFunction((end) => performance.now() >= end, end)
}

/** Two frames drawn, so what was just styled is laid out and the thread has kept its place. */
const drawn = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))

interface Heard {
  /** Each animation that started in the thread, and on what. */
  readonly animations: string[]
  /** Each time something in view stood elsewhere than a frame before, and by how much. */
  readonly moves: string[]
}

/**
 * From now on, the page keeps a note of every animation started in the coordinator's thread (Web Animations, CSS
 * animations and transitions) and, each frame, of where every block in view stands on screen: one a pixel from where it
 * stood the frame before has moved. What is inside `changing` changes for real, and is left out.
 */
const listen = (page: Page, changing: string) =>
  page.evaluate((changing) => {
    const thread = [...document.querySelectorAll('section[aria-label="Conversation"]')].find((one) => one.checkVisibility())
    if (thread === undefined) throw new Error('No conversation on show')
    let scroller = thread.parentElement
    while (scroller !== null && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    if (scroller === null) throw new Error('The conversation scrolls in nothing')
    const view = scroller
    const name = (el: Element) => {
      const block = [...thread.children].find((one) => one.contains(el)) ?? el
      return `${el.tagName.toLowerCase()} in ${block.tagName.toLowerCase()}[${block.getAttribute('aria-label') ?? ''}] “${(block.textContent ?? '').trim().slice(0, 40)}”`
    }
    const counts = (el: Element) => thread.contains(el) && el.closest(changing) === null
    const heard: Heard = { animations: [], moves: [] }
    ;(window as unknown as { heard: Heard }).heard = heard
    const animate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')?.value as Element['animate']
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if (counts(this)) heard.animations.push(`${JSON.stringify(args[0]).slice(0, 100)} on ${name(this)}`)
      return animate.apply(this, args)
    }
    for (const kind of ['animationstart', 'transitionstart'] as const)
      document.addEventListener(
        kind,
        (event) => {
          if (!(event.target instanceof Element) || !counts(event.target)) return
          const what = event instanceof AnimationEvent ? event.animationName : (event as TransitionEvent).propertyName
          heard.animations.push(`${kind} ${what} on ${name(event.target)}`)
        },
        true,
      )
    let was = new Map<Element, number>()
    const frame = () => {
      const edge = view.getBoundingClientRect()
      const now = new Map<Element, number>()
      for (const block of thread.children) {
        if (block.closest(changing) !== null || block.querySelector(changing) !== null) continue
        const box = block.getBoundingClientRect()
        if (box.height === 0 || box.bottom <= edge.top || box.top >= edge.bottom) continue
        now.set(block, box.top)
        const before = was.get(block)
        if (before !== undefined && Math.abs(box.top - before) >= 0.5)
          heard.moves.push(`${name(block)} ${Math.round(before)} → ${Math.round(box.top)} at ${Math.round(performance.now())}`)
      }
      was = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, changing)

test('a still coordinator thread stays still for a minute', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  // A dev server to run, as the person runs theirs: while it runs, the thread's clocks tick each second.
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'meridian', private: true, scripts: { dev: 'node serve.js' } }, null, 2))
  writeFileSync(join(repo, 'serve.js'), SERVER)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 't@althar.test',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 't@althar.test',
  }
  execFileSync('git', ['add', '.'], { cwd: repo, env })
  execFileSync('git', ['commit', '-q', '-m', 'Serve'], { cwd: repo, env })
  // The lead of a task above the messages in view works until the spec lets it finish, halfway through the minute.
  const done = join(home, 'lead-done')
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_AGENT_HELD: JSON.stringify({ '[lead:slowly]': done }) })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // A thread with some of everything: the person's words, replies, a plan and a task under way.
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByRole('dialog', { name: 'What it runs' }).getByRole('button', { name: 'Run npm run dev' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('article', { name: 'Run of main' }).getByRole('button', { name: /^Open localhost:\d+$/ })).toBeVisible()
    for (let i = 1; i <= 8; i++) {
      await say(page, `Question number ${i} about the project?`)
      await expect(shown(page, `Question number ${i} about the project?`).first()).toBeVisible()
    }
    await startTask(page, 'Tidy the readme')
    await startTask(page, 'Keep working on the docs', '[lead:slowly] [lead:finish]')
    for (let i = 9; i <= 12; i++) {
      await say(page, `Question number ${i} about the project?`)
      await expect(shown(page, `Question number ${i} about the project?`).first()).toBeVisible()
    }
    const lastReply = page.getByRole('article', { name: 'Coordinator' }).filter({ hasText: 'Question number 12' }).last()
    await expect(lastReply).toBeVisible()
    await expect(page.getByRole('region', { name: 'Conversation' })).not.toHaveAttribute('aria-busy')
    // Settled: the replies are in, the first task has finished, and nothing is still moving in.
    await expect(page.locator('article[data-task="tidy-the-readme"]')).toContainText('Did the task.')
    await still(page)
    // A card that grows as its task moves on, as a card does when a line comes under its title: here, once it isn't at work.
    await page.addStyleTag({ content: 'article[data-task]:not([class*="running"]) { padding-bottom: 40px !important; }' })
    await drawn(page)
    await still(page)
    const card = page.locator('article[data-task="keep-working-on-the-docs"]')
    await expect(card).toHaveClass(/running/)
    // Above the view, while what is in view is the person's last questions and their answers.
    await lastReply.evaluate((element) => element.scrollIntoView({ block: 'end', behavior: 'instant' }))
    const above = () =>
      card.evaluate((one) => {
        let scroller = one.parentElement
        while (scroller !== null && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
        return scroller !== null && one.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top
      })
    await expect.poll(above).toBe(true)
    await still(page)
    await listen(page, 'article[data-task="keep-working-on-the-docs"]')
    await watchFor(page, WATCH / 3)
    writeFileSync(done, '')
    await expect(card).not.toHaveClass(/running/)
    await watchFor(page, (2 * WATCH) / 3)
    const heard = await page.evaluate(() => (window as unknown as { heard: Heard }).heard)
    expect(heard).toEqual({ animations: [], moves: [] })
  } finally {
    await electronApp.close()
  }
})
