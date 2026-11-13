import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask, still } from './support'

/*
 * A lead that says it is waiting on the person's answers, as the person
 * meets it: the task waits in Needs you with its question, not ready and not
 * reviewed, and the card takes their answer. The lead is the fake agent,
 * which asks with `[lead:wait-for-person]` and reports once told.
 */

test('waits on the home and in its thread with the lead’s question, not as done or reviewed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Compact the ADRs', '[lead:wait-for-person]')

    // On the home, it waits on the person with the lead's question, and no Ready to accept.
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
    const needs = page.getByRole('region', { name: /needs? you/ })
    const card = needs.getByRole('article').filter({ hasText: 'Compact the ADRs' })
    await expect(card).toBeVisible()
    await expect(card.getByText('Waiting on you', { exact: true })).toBeVisible()
    await expect(card.getByText('Which ADRs should the compaction keep?')).toBeVisible()
    await expect(card.getByText('Ready to accept', { exact: true })).toHaveCount(0)
    await still(page)
    await card.screenshot({ path: 'test-results/waiting-for-person-card.png', scale: 'css' })

    // Opened, the card is in the thread with the question and the box for the answer.
    await card.getByRole('button', { name: 'Open' }).click()
    await expect(page.getByRole('heading', { name: /Compact the ADRs/, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Answer the lead' })).toBeVisible()
    await expect(page.getByText('Waiting on you', { exact: true }).locator('visible=true').first()).toBeVisible()
    await page.getByRole('button', { name: 'Answer the lead' }).click()
    const box = page.getByRole('textbox', { name: 'What should it do?' })
    await expect(box).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send the answer' })).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/waiting-for-person-thread-full.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})

test('closes the lead’s Waiting on you card when the person answers in the composer instead of on the card', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    await startTask(page, 'Compact the ADRs', '[lead:wait-for-person]')
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
    const needs = page.getByRole('region', { name: /needs? you/ })
    const card = needs.getByRole('article').filter({ hasText: 'Compact the ADRs' })
    await expect(card.getByText('Waiting on you', { exact: true })).toBeVisible()
    await card.getByRole('button', { name: 'Open' }).click()
    await expect(page.getByRole('button', { name: 'Answer the lead' })).toBeVisible()

    // The person answers in the task's composer, not with the card's button.
    await say(page, 'Keep the dozen current-state decisions.')
    await expect(page.getByRole('button', { name: 'Answer the lead' })).toHaveCount(0)
    await expect(page.getByText('Waiting on you', { exact: true }).locator('visible=true')).toHaveCount(0)

    // And on the home, Needs you no longer lists it as waiting on them.
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
    await expect(card.getByText('Waiting on you', { exact: true })).toHaveCount(0)
    await still(page)
  } finally {
    await electronApp.close()
  }
})
