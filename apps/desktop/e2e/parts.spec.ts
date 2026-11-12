import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, shown, still, toConversation } from './support'

/*
 * Every part of a task changes either way, just by the person telling its lead (a task is a conversation plus parts; the
 * person's note of 12 November), in a real window with the fake agent and the fake GitHub. Each direction is driven only by
 * what the person writes in the task's composer: the fake lead does what it is told, `[lead:call <tool> <json>]`, as a lead
 * acts on the person's word, and nothing asks them again. A prototype becomes a change, its reviewer and pull request ending on
 * at once, and Ship reviews it and opens the pull request; a change goes back to a prototype, its review off and its pull
 * request closed; a chat becomes a change and a chat again; the review, the ending, the lead and where it works change. The
 * menu's Make it a change does the first in one press. Its shots are test-results/parts-*.png.
 */

const setup = async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800))
  await openFirstProject(electronApp, page, repo)
  await connectGitHub(page)
  return { electronApp, page }
}

/**
 * A task the coordinator plans and the person starts at once, opened on its conversation once it is done: its pull request
 * open, or, for one that ends with its branch, ready with its branch pushed.
 */
const planned = async (page: Page, words: string, ends: 'pull request' | 'branch') => {
  await say(page, words)
  await page.getByRole('button', { name: 'Start now' }).last().click()
  const title = words.split('.')[0] ?? ''
  const card = page.getByRole('article', { name: title })
  await expect(ends === 'pull request' ? card.getByText('PR #1') : card.getByText('Ready', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: /Open task/ }).click()
  await toConversation(page)
  if (ends === 'branch') await expect(shown(page, /Pushed althar\//).first()).toBeVisible()
}

/** What the person tells the task's lead, from its composer. */
const tell = async (page: Page, words: string) => {
  const box = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })
  await box.click()
  await box.fill(words)
  await box.press('Enter')
}

/** The marker the fake lead takes as the person's word to call a tool, with its arguments. */
const call = (tool: string, args: Record<string, unknown> = {}) =>
  `[lead:call ${tool} ${JSON.stringify({ ...args, why: 'the person asked' })}]`

/** The line the task's thread says a change of its parts in, as Althar writes it. */
const line = (page: Page, words: RegExp) => page.locator('p').filter({ hasText: words }).filter({ visible: true }).first()

/** A line of the thread, at 1×, across the thread's column (as wide as its composer), with what stands above it. */
const shoot = async (page: Page, what: Locator, name: string) => {
  await page.mouse.move(1190, 300)
  await what.scrollIntoViewIfNeeded()
  await still(page)
  const box = await what.boundingBox()
  const column = await page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ }).boundingBox()
  const x = Math.max(0, (column?.x ?? 200) - 40)
  await page.screenshot({
    path: `test-results/parts-${name}.png`,
    scale: 'css',
    animations: 'disabled',
    clip: { x, y: Math.max(0, (box?.y ?? 400) - 220), width: Math.min(1200 - x, (column?.width ?? 700) + 80), height: 300 },
  })
}

test('a prototype becomes a change in one move on the person’s word, and Ship reviews it and opens its pull request', async () => {
  const { electronApp, page } = await setup()
  try {
    // A prototype: no review, ending with its branch, pushed and nothing more.
    await planned(
      page,
      'Prototype the refunds page. [coordinator:plan-no-review] [coordinator:plan-branch] [coordinator:plan] [lead:finish] [lead:edit] [review:pass]',
      'branch',
    )
    await expect(page.getByText('PR #1')).toHaveCount(0)

    // "Yep, make it a real change": its lead does it at once, and says so in a line; nothing is asked of the person.
    await tell(page, `Yep, make it a real change. ${call('change_part', { part: 'preset', preset: 'Change' })}`)
    const made = line(page, /Its lead made it a Change: reviewed by .+, ending in a draft pull request/)
    await expect(made).toBeVisible()
    // No Add / No thanks offer: the person said it already.
    await expect(page.getByRole('button', { name: 'No thanks' })).toHaveCount(0)
    await shoot(page, made, 'prototype-to-change')

    // "Ship it": the review runs over the whole branch, then the pull request opens.
    await tell(page, `Ship it. ${call('ship_task')}`)
    const passed = page.locator('[data-review]').filter({ hasText: 'Passed' })
    await expect(passed).toBeVisible()
    await expect(page.getByText('PR #1').first()).toBeVisible()
    await expect(shown(page, /Opened draft pull request #1/).first()).toBeVisible()
    await shoot(page, shown(page, /Opened draft pull request #1/).first(), 'shipped')
  } finally {
    await electronApp.close()
  }
})

test('a change goes back to a prototype on the person’s word: ready first, another reviewer, then no review and no pull request', async () => {
  const { electronApp, page } = await setup()
  try {
    await planned(page, 'Rate-limit refunds per partner. [coordinator:plan] [lead:finish] [lead:edit] [review:pass]', 'pull request')

    // Its ending: from a draft to ready for review, the open draft marked ready.
    await tell(page, `Make it ready for review. ${call('change_part', { part: 'ending', end: 'ready' })}`)
    await expect(line(page, /Its lead changed its parts: ending in a pull request ready for review, PR #1 marked ready/)).toBeVisible()

    // Its reviewer, once its review ran: another reads what ships next.
    await tell(page, `Have Claude review it from now on. ${call('change_part', { part: 'checked_by', review: { agent: 'claude-code' } })}`)
    await expect(line(page, /Its lead changed its parts: reviewed by .+, reading what ships next/)).toBeVisible()

    // Back to a prototype: no review, ending with its branch, the pull request closed and its branch kept.
    await tell(page, `Actually, keep it as a prototype. ${call('change_part', { part: 'preset', preset: 'Prototype' })}`)
    const back = line(page, /Its lead made it a Prototype: no review, ending with its branch, PR #1 closed, its branch staying/)
    await expect(back).toBeVisible()
    await shoot(page, back, 'change-to-prototype')
  } finally {
    await electronApp.close()
  }
})

test('a chat becomes a change on the person’s word, ships as one, and becomes a chat again', async () => {
  const { electronApp, page } = await setup()
  try {
    await page.getByRole('radio', { name: 'Home' }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    await say(page, 'Sketch the refunds export [coordinator:start] [lead:finish] [lead:edit] [review:pass]')
    await expect(work.getByText('Finished', { exact: true })).toBeVisible()
    await work.getByRole('button', { name: 'Sketch the refunds export' }).click()
    await expect(page.getByRole('radio', { name: /Conversation/ })).toHaveAttribute('aria-checked', 'true')

    await tell(page, `Let's keep this, make it a real change. ${call('change_part', { part: 'preset', preset: 'Change' })}`)
    await expect(line(page, /Its lead made it a Change: reviewed by .+, ending in a draft pull request/)).toBeVisible()
    await tell(page, `Ship it. ${call('ship_task')}`)
    await expect(page.getByText('PR #1').first()).toBeVisible()

    await tell(page, `Make it just a chat again. ${call('change_part', { part: 'preset', preset: 'Chat' })}`)
    const chat = line(page, /Its lead made it a Chat: no review, nothing going up until it ships, PR #1 closed, its branch staying/)
    await expect(chat).toBeVisible()
    await shoot(page, chat, 'change-to-chat')
  } finally {
    await electronApp.close()
  }
})

test('its review, its lead and where it works change both ways on the person’s word, on the lead’s own task', async () => {
  const { electronApp, page } = await setup()
  try {
    await planned(page, 'Retry the checkout call. [coordinator:plan] [lead:finish] [lead:edit] [review:pass]', 'pull request')

    // The review off, and on again: the project's rules pick its reviewer.
    await tell(page, `No review on this one. ${call('change_part', { part: 'checked_by', review: null })}`)
    await expect(line(page, /Its lead changed its parts: no review/)).toBeVisible()
    await tell(page, `On second thought, review it. ${call('add_part', { part: 'checked_by' })}`)
    await expect(line(page, /Its lead changed its parts: reviewed by /)).toBeVisible()

    // Its own lead's model and effort, from its next turn.
    await tell(
      page,
      `Switch to the large model, thinking hard. ${call('change_lead', { lead: { agent: 'claude-code', model: 'large', effort: 'high' } })}`,
    )
    await expect(shown(page, /changed the lead to .+\. It takes over from its next turn/).first()).toBeVisible()

    // Local, in the person's checkout, once its turn ends; and back to a worktree of its own.
    await tell(page, `Work in my checkout. ${call('change_part', { part: 'workspace', to: 'checkout' })}`)
    await expect(shown(page, /works Local|moves once it can/).first()).toBeVisible()
    await tell(page, `Back to a worktree. ${call('change_part', { part: 'workspace', to: 'worktree' })}`)
    await expect(shown(page, /works in a worktree of its own|moves once it can/).last()).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('the menu’s Make it a change makes a prototype a change in one press', async () => {
  const { electronApp, page } = await setup()
  try {
    await planned(
      page,
      'Prototype the payouts page. [coordinator:plan-no-review] [coordinator:plan-branch] [coordinator:plan] [lead:finish] [lead:edit] [review:pass]',
      'branch',
    )
    await page.getByRole('button', { name: 'More for this task' }).click()
    const menu = page.getByRole('menu')
    const item = menu.getByRole('menuitem', { name: 'Make it a change' })
    await expect(item).toBeVisible()
    await item.hover()
    await page.mouse.move(1180, 780)
    await still(page)
    await menu.screenshot({ path: 'test-results/parts-menu.png', scale: 'css', animations: 'disabled' })
    await item.click()
    await expect(line(page, /You made it a Change: reviewed by .+, ending in a draft pull request/)).toBeVisible()
    // Made a change, it isn't offered again.
    await page.getByRole('button', { name: 'More for this task' }).click()
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Make it a change' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  } finally {
    await electronApp.close()
  }
})
