import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, type ElectronApplication, expect, type Locator, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, shown, startTask, still, toConversation } from './support'

test('a task asks once to use the computer, transfers a note between two apps and keeps a screenshot that opens full size', async () => {
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
    await expect(computer.getByRole('button', { name: 'Allow for this turn' })).toBeVisible()
    await computer.screenshot({ path: 'test-results/computer-use-approval.png' })
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

    // What it kept: in its conversation, where it took it, and as its evidence atop Outputs, opening full size; light and dark.
    // With the native driver, a real capture of Reader (test-results/computer-use-*.png).
    const picture = (button: Locator) => button.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      const named = scheme === 'dark' ? '-dark' : ''
      const inThread = page.getByRole('button', { name: 'View Reader shows the transferred note. full size', exact: true })
      await inThread.scrollIntoViewIfNeeded()
      await expect.poll(() => picture(inThread)).toBeGreaterThan(0)
      await still(page)
      await page.screenshot({ path: `test-results/computer-use-thread${named}.png` })
      await page
        .getByRole('radiogroup', { name: 'Face' })
        .getByRole('radio', { name: /Outputs/ })
        .click()
      const inOutputs = page.getByRole('button', { name: 'View Reader shows the transferred note full size', exact: true })
      await expect.poll(() => picture(inOutputs)).toBeGreaterThan(0)
      await still(page)
      await page.screenshot({ path: `test-results/computer-use-outputs${named}.png` })
      await inOutputs.click()
      const dialog = page.getByRole('dialog')
      await expect.poll(() => dialog.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
      await still(page)
      await page.screenshot({ path: `test-results/computer-use-full-size${named}.png` })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await toConversation(page)
    }
  } finally {
    await Promise.allSettled(fixtures.map((fixture) => fixture.close()))
    await electronApp.close()
  }
})
