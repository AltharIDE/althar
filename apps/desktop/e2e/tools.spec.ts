import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { agentHomeIn, seedOpenCode } from './agentHome'
import { launch, openFirstProject, still } from './support'

/*
 * Settings › MCP servers and Settings › Skills, in the real app, with a home of the profile's own for the person's
 * agents: with no server, what will be here and where it comes from; a server added to the one agent its form presses, in
 * that agent's own file; opened in place, with that file's lines and back to its tile; removed after saying so, and the
 * empty state again. Skills with none says where they come from, and what Althar does and doesn't ship.
 */

const toSettings = async (page: Page, section: string) => {
  await page.keyboard.press('ControlOrMeta+Shift+Comma')
  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: new RegExp(`^${section}`) })
    .click()
}

test('shows with none where servers come from, adds one to an agent’s own file, opens it, and removes it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await toSettings(page, 'MCP servers')
    const main = page.getByRole('main')

    // With none: what will be here, each agent's own file, the servers often added, and the switch for the agents outside Althar.
    await expect(main.getByRole('heading', { name: 'No MCP servers yet' })).toBeVisible()
    for (const file of ['~/.claude.json', '~/.codex/config.toml', '~/.config/opencode/opencode.json'])
      await expect(main.getByText(file, { exact: true }).first()).toBeVisible()
    for (const name of ['github', 'linear', 'figma', 'notion', 'playwright'])
      await expect(main.getByRole('button', { name: `Add ${name}` })).toBeVisible()
    await expect(main.getByRole('switch', { name: 'Same servers everywhere' })).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/tools-mcp-empty.png', scale: 'css', animations: 'disabled' })

    // Add one often added, filled in; written into OpenCode's own file alone, the one agent pressed.
    await main.getByRole('button', { name: 'Add playwright' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add an MCP server' })
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('playwright')
    const agents = dialog.getByRole('group', { name: 'Add it to' })
    for (const name of ['Claude Code', 'Codex']) {
      const mark = agents.getByRole('button', { name })
      if ((await mark.getAttribute('aria-pressed')) === 'true') await mark.click()
      await expect(mark).toHaveAttribute('aria-pressed', 'false')
    }
    // A command that ends at once, so opening the server below doesn't start anything the machine has to fetch.
    await dialog.getByRole('textbox', { name: 'Command' }).fill('node -v')
    const opencode = agents.getByRole('button', { name: 'OpenCode' })
    if ((await opencode.getAttribute('aria-pressed')) !== 'true') await opencode.click()
    await still(page)
    await page.screenshot({ path: 'test-results/tools-mcp-add.png', scale: 'css', animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog).toBeHidden()
    const file = join(agentHomeIn(home), '.config', 'opencode', 'opencode.json')
    await expect.poll(() => readFileSync(file, 'utf8')).toContain('"playwright"')

    // A tile now; the empty state is gone.
    await expect(main.getByRole('heading', { name: 'No MCP servers yet' })).toHaveCount(0)
    const tile = main.getByRole('button', { name: /^playwright/ })
    await expect(tile).toBeVisible()

    // Opened in place: OpenCode's own file with the server's lines, and back to its tile.
    await tile.click()
    await expect(main.getByRole('heading', { name: 'playwright' })).toBeVisible()
    await expect(main.getByText('~/.config/opencode/opencode.json').first()).toBeVisible()
    await expect(main.getByText('"node"').first()).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/tools-mcp-opened.png', scale: 'css', animations: 'disabled' })
    await main.getByRole('button', { name: 'Back' }).click()
    await expect(tile).toBeFocused()

    // Removed, after it says which agent it comes out of; the empty state again, and the file without it.
    await tile.click()
    await main.getByRole('button', { name: 'Remove…' }).click()
    const asking = page.getByRole('dialog', { name: 'Remove playwright?' })
    await expect(asking).toContainText('OpenCode')
    await asking.getByRole('button', { name: 'Remove' }).click()
    await expect(asking).toBeHidden()
    await expect(main.getByRole('heading', { name: 'No MCP servers yet' })).toBeVisible()
    await expect.poll(() => readFileSync(file, 'utf8')).not.toContain('"playwright"')
  } finally {
    await electronApp.close()
  }
})

test('shows an agent’s own server as a tile, a round switch giving it to every role or none, and keeps it across a visit elsewhere', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  seedOpenCode(home, { context7: { type: 'local', command: ['npx', '-y', '@upstash/context7-mcp'] } })
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await toSettings(page, 'MCP servers')
    const main = page.getByRole('main')
    const toggle = main.getByRole('switch', { name: 'context7' })
    await expect(toggle).toBeChecked()
    await expect(main.getByRole('button', { name: 'context7' })).toBeVisible()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect(main.getByRole('button', { name: 'context7 Off' })).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^Skills/ })
      .click()
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^MCP servers/ })
      .click()
    await expect(main.getByRole('switch', { name: 'context7' })).not.toBeChecked()
  } finally {
    await electronApp.close()
  }
})

test('says with no skill where skills come from, and offers Add from GitHub and Same skills everywhere', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await toSettings(page, 'Skills')
    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { name: 'No skills yet' })).toBeVisible()
    for (const folder of ['~/.claude/skills', '~/.agents/skills', '~/.config/opencode/skills'])
      await expect(main.getByText(folder, { exact: true }).first()).toBeVisible()
    await expect(main.getByRole('button', { name: 'Add from GitHub' })).toBeVisible()
    await expect(main.getByRole('switch', { name: 'Same skills everywhere' })).toBeVisible()
    // Althar ships none of its own.
    await expect(main.getByText(/superpowers|agent-skills|catalog/i)).toHaveCount(0)
    await still(page)
    await page.screenshot({ path: 'test-results/tools-skills-empty.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
