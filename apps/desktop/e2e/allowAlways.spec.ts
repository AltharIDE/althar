import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, toConversation } from './support'

/*
 * Allow always (ADR-018), as the person meets it: under "Ask me", a lead's
 * `git status` waits as a call; answered with Allow always for commands
 * starting `git status`, the next one runs without asking and the thread
 * says which rule let it through; the rule is on the rules screen, and
 * taken off there, the next one asks again. The lead is the fake agent,
 * which runs what follows `run `.
 */

const openRules = async (page: Page) => {
  await page.getByRole('button', { name: 'More for this project' }).click()
  await page.getByRole('menuitem', { name: 'Project rules' }).click()
}

const shots = process.env.ALTHAR_SHOTS

test('keeps Allow always as a rule, lets the next through by it, and asks again once it is taken off', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await openRules(page)
    await page.getByRole('radio', { name: /Ask me/ }).click()
    await expect(page.getByText(/Nothing yet\. A permission answered/)).toBeVisible()
    await page.getByRole('button', { name: 'Back to meridian' }).click()

    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('What should change').fill('Look at the tree')
    await page.getByLabel('Anything the lead should know').fill('[lead:finish]')
    await page.getByRole('button', { name: /^Review:/ }).click()
    await page.getByRole('button', { name: 'No review' }).click()
    await page.getByRole('button', { name: 'Start the task' }).click()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)

    // The lead's `git status` waits for the person, who allows commands starting so always.
    await say(page, 'run git status')
    await expect(page.getByText('Needs your permission')).toBeVisible()
    await page.getByRole('radio', { name: /Yes, and always allow/ }).click()
    await page.getByRole('combobox', { name: 'What to always allow' }).click()
    await page.getByRole('option', { name: 'commands starting “git status”' }).click()
    if (shots) await page.screenshot({ path: join(shots, 'app-allow-always-card.png') })
    await page.getByRole('button', { name: /^Allow(?! all)/ }).click()
    await expect(page.getByText('ran=allow_once')).toHaveCount(1)

    // The next is let through by the rule, and the thread says so.
    await say(page, 'run git status --short')
    await expect(page.getByText('ran=allow_once')).toHaveCount(2)
    await expect(page.getByText('Needs your permission')).toHaveCount(0)
    const receipt = page.getByRole('button', { name: /Allowed 1 request/ })
    await expect(receipt).toBeVisible()
    await receipt.click()
    await expect(page.getByText('commands starting “git status”')).toBeVisible()
    // Once its fold has opened.
    await page.waitForTimeout(400)
    if (shots) await page.screenshot({ path: join(shots, 'app-allowed-by-rule.png') })

    // The rule is on the rules screen; taken off there, the next asks again.
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await openRules(page)
    const allowed = page.getByRole('list', { name: 'Always allowed' })
    await expect(allowed.getByRole('listitem')).toHaveText(['Commands starting “git status”'])
    await allowed.scrollIntoViewIfNeeded()
    if (shots) await page.screenshot({ path: join(shots, 'app-rules-always-allowed.png') })
    await allowed.getByRole('button', { name: 'Remove Commands starting “git status”' }).click()
    await expect(page.getByText(/Nothing yet\. A permission answered/)).toBeVisible()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await say(page, 'run git status -s')
    await expect(page.getByText('Needs your permission')).toBeVisible()

    // On the home, its card offers the same: always allow, from beside Allow once.
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
    const needs = page.getByRole('region', { name: /Needs you/ })
    await expect(needs.getByText('git status -s', { exact: true })).toBeVisible()
    await needs.getByRole('button', { name: 'More answers' }).click()
    await expect(page.getByRole('menuitem', { name: 'Always allow commands starting “git status”' })).toBeVisible()
    await page.waitForTimeout(400)
    if (shots) await page.screenshot({ path: join(shots, 'app-home-more-answers.png') })
    await page.getByRole('menuitem', { name: 'Always allow commands starting “git status”' }).click()
    await expect(needs.getByText('kept in meridian’s rules')).toBeVisible()
    await page.waitForTimeout(400)
    if (shots) await page.screenshot({ path: join(shots, 'app-home-answered-always.png') })
  } finally {
    await electronApp.close()
  }
})
