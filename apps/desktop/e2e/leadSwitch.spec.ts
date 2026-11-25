import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask, still } from './support'

/*
 * A lead switched to another agent, and its effort picked while the new one starts, in a real window with the fake agents:
 * the composer's picker says the pick at once, on the agent taking over, and keeps it; the turn the new lead takes is headed by
 * the model picked. An effort picked after what was said is sent is for the turn after, as any pick made after a send is, so
 * that turn's own effort is not read here. The thread says the switch once, by the agents' names, never one agent to itself. Its screenshot (test-results/lead-switch.png) is this
 * change's own evidence.
 */

test('a lead switched, with its effort picked while the new one starts, shows and runs on the pick', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800))
    await openFirstProject(electronApp, page, repository(home))
    // A lead that never ends its turn, as one at work when the person switches it.
    await startTask(page, 'Add a retry to checkout', '[lead:wait]')
    await page.getByRole('button', { name: /Open task/ }).click()
    const lead = page.getByRole('button', { name: /^Lead:/ })
    await expect(lead).toHaveAttribute('aria-label', 'Lead: Claude Small Medium')

    // Codex takes over with what is said next; its effort picked at once, while it starts.
    await lead.click()
    await page.getByRole('radio', { name: /, via Codex\b/ }).click()
    await page.keyboard.press('Escape')
    await say(page, 'Keep working on the retry.')
    await lead.click()
    await page.getByRole('radio', { name: 'High', exact: true }).click()
    await page.keyboard.press('Escape')
    // The picker says the pick at once, and on Codex: its models are named as it names them, "Small", where Claude Code's
    // carry their family ("Claude Small", as above). A label with "Claude" in it is the lead going out, not the one taking over.
    await expect(lead).toHaveAttribute('aria-label', 'Lead: Small High')

    // Codex took the thread: the thread says so once, and the turn it takes is headed by the model picked.
    const conversation = page.getByRole('region', { name: 'Thread' })
    await expect(conversation.getByText('Switched from Claude Code to Codex.')).toBeVisible()
    await expect(conversation.getByRole('article', { name: 'Small', exact: true })).toContainText('via Codex')
    await expect(conversation.getByText(/^Switched from (\w+) to \1\.$/)).toHaveCount(0)
    await expect(conversation.getByText(/stays on its (model|effort)/)).toHaveCount(0)
    await expect(lead).toHaveAttribute('aria-label', 'Lead: Small High')
    await lead.click()
    await expect(page.getByRole('radio', { name: /, via Codex\b/ })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'High', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await page.mouse.move(1180, 780)
    await still(page)
    await page.screenshot({ path: 'test-results/lead-switch.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
