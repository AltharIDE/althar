import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say } from './support'

// Real renderer, RPC, SQLite and recorder; scripted providers, without using personal accounts.
test('automatically captures project conversation evidence and exposes revision-safe retirement and source navigation', async () => {
  test.setTimeout(180_000)
  const home = mkdtempSync(join(tmpdir(), 'althar-memory-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await say(page, 'hello')
    await expect(page.getByText(/echo:/).first()).toBeVisible()
    await say(page, 'memory-failure')
    await expect(page.getByText(/checkout/i).first()).toBeVisible()
    await page.getByRole('button', { name: 'More for this project' }).click()
    await page.getByRole('menuitem', { name: 'Project memory' }).click()
    await expect(page.getByRole('heading', { name: 'Project memory' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^meridian/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.getByRole('searchbox').fill('checkout')
    const results = page.getByRole('region', { name: 'Memory results' })
    await results
      .getByRole('button', { name: /checkout/i })
      .first()
      .click()
    const evidence = page.getByRole('region', { name: 'Memory evidence' })
    await expect(evidence.getByRole('heading', { name: 'Recorded evidence' })).toBeVisible()
    await expect(evidence.getByText(/checkout/i).first()).toBeVisible()
    await page.screenshot({ path: '/tmp/althar-memory-ui.png', animations: 'disabled' })
    await evidence.getByRole('button', { name: 'Retire memory' }).click()
    await expect(evidence.getByRole('button', { name: 'Restore memory' })).toBeVisible()
    await page.getByRole('checkbox', { name: 'Include retired' }).check()
    await results
      .getByRole('button', { name: /retired.*checkout|checkout.*retired/i })
      .first()
      .click()
    await evidence.getByRole('button', { name: 'Restore memory' }).click()
    await expect(evidence.getByRole('button', { name: 'Retire memory' })).toBeVisible()
    await evidence.getByRole('button', { name: 'Open source thread' }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /^Tell .* something/ })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
