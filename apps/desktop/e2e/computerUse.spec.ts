import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, shown, startTask, toConversation } from './support'

test('a task requests two desktop apps, transfers a note and keeps a screenshot', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-computer-'))
  const repo = repository(home)
  const file = join(home, 'handoff.txt')
  const native = process.env.ALTHAR_TEST_NATIVE_COMPUTER
  const fixtures: Array<ElectronApplication> = []
  const { electronApp, page } = await launch(home, {
    ALTHAR_TEST_COMPUTER: native === '1' || native === 'portable' ? '0' : '1',
  })
  try {
    if (native === 'portable') {
      const app = join(import.meta.dirname, 'fixtures', 'computer-app', 'main.cjs')
      for (const kind of ['Writer', 'Reader']) {
        const fixture = await electron.launch({
          args: [app, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
          env: { ...process.env, ALTHAR_FIXTURE_KIND: kind, ALTHAR_FIXTURE_FILE: file },
        })
        fixtures.push(fixture)
        await expect((await fixture.firstWindow()).getByRole('textbox', { name: 'Note' })).toBeVisible()
      }
    }
    await openFirstProject(electronApp, page, repo)
    await startTask(page, 'Verify the desktop report')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await say(
      page,
      `[lead:computer] ${native === 'portable' ? '[computer:visual-fixture] ' : ''}Verify the report using Writer and Reader.`,
    )

    const computer = page.getByRole('region', { name: 'Computer use' })
    await expect(computer.getByText('Waiting for you to approve computer use.')).toBeVisible()
    await computer.screenshot({ path: 'test-results/computer-use-approval.png' })
    await computer.getByRole('checkbox', { name: /Computer Writer fixture/ }).check()
    await computer.getByRole('checkbox', { name: /Computer Reader fixture/ }).check()
    if (native === 'portable') await computer.getByRole('checkbox', { name: /Allow foreground input/ }).check()
    await computer.getByRole('button', { name: 'Allow for this turn' }).click()

    await expect(shown(page, /Writer and Reader both show Reviewed report|Opened the handoff in Reader/)).toBeVisible()
    await expect(shown(page, /Kept the screenshot in the task conversation/)).toBeVisible()
    await expect(computer.getByText('Computer use stopped.')).toBeVisible()
    if (native === 'portable') {
      expect(readFileSync(file, 'utf8')).toBe('Reviewed report')
      const reader = fixtures[1]
      if (reader === undefined) throw new Error('Reader did not launch.')
      await expect((await reader.firstWindow()).getByRole('textbox', { name: 'Note' })).toHaveValue('Reviewed report')
    }
  } finally {
    await Promise.allSettled(fixtures.map((fixture) => fixture.close()))
    await electronApp.close()
  }
})
