import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, still } from './support'

test('a full coordinator compacts and continues in the same conversation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    const conversation = page.getByRole('region', { name: 'Conversation' })
    const answer = conversation.getByText('Looked into it: the payment call has no retry', { exact: false })
    await say(page, 'What is the project about? [answers-after:1s]')
    await expect(answer).toHaveCount(1)
    await say(page, 'What have we covered? [context:85]')
    const compacted = conversation.getByText(/^Compacted .* context: 170k → 20k tokens\.$/)
    await expect(compacted).toBeVisible()
    await expect(page.getByRole('button', { name: 'Context 10% used' })).toBeVisible()
    await say(page, 'And what needs attention next? [answers-after:1s]')
    await expect(answer).toHaveCount(2)
    await expect(conversation.getByText(/Started .*afresh|Started a fresh session/)).toHaveCount(0)
    await compacted.scrollIntoViewIfNeeded()
    await still(page)
    await page.screenshot({ path: 'test-results/coordinator-compaction.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
