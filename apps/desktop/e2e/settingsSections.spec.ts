import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { seedClaude, seedCodex, seedHealth, seedOpenCode, seedSkill } from './agentHome'
import { launch, openFirstProject, projectSettings, sizeWindow, still } from './support'

/*
 * Every section of Althar's Settings and of a project's, as a person finds them with their agents set up: tiles of MCP
 * servers (one failing, two waiting on a sign-in, a repository's own), their skills, what Tasks and Pull requests make,
 * the project's own quick cards. Each is drawn light and dark, and the servers again at an 800 px window, each shot
 * kept in test-results/sections. What each says is also checked, so the spec stands as a smoke test of the new structure.
 */

const FAKE_SERVER = join(import.meta.dirname, '..', '..', '..', 'packages', 'runtime', 'tests', 'fixtures', 'mcp', 'server.mjs')

const SERVERS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['github', { type: 'stdio', command: 'node', args: [FAKE_SERVER, 'pages'] }],
  ['linear', { type: 'http', url: 'https://mcp.linear.app/mcp' }],
  ['figma', { type: 'http', url: 'https://mcp.figma.com/mcp' }],
  ['notion', { type: 'http', url: 'https://mcp.notion.com/mcp' }],
  ['context7', { type: 'stdio', command: 'node', args: [FAKE_SERVER, 'pages'] }],
  ['playwright', { type: 'stdio', command: 'node', args: [FAKE_SERVER, 'pages'] }],
  ['akiflow', { type: 'http', url: 'https://mcp.akiflow.com/mcp' }],
  ...[
    'sentry',
    'stripe',
    'vercel',
    'cloudflare',
    'postgres',
    'supabase',
    'slack',
    'datadog',
    'kubernetes',
    'docker',
    'aws-docs',
    'jira',
    'confluence',
    'gitlab',
    'drive',
  ].map((name): readonly [string, Record<string, unknown>] => [name, { type: 'stdio', command: 'node', args: [FAKE_SERVER, 'pages'] }]),
]

const GROUPS = [
  ['Agents', 'agents'],
  ['MCP servers', 'mcp-servers'],
  ['Skills', 'skills'],
  ['Code hosts and trackers', 'code-hosts'],
  ['Tasks', 'tasks'],
  ['Pull requests', 'pull-requests'],
  ['Work on this Mac', 'this-mac'],
  ['Notifications', 'notifications'],
  ['Appearance', 'appearance'],
  ['Editor and browser', 'editor-and-browser'],
  ['About Althar', 'about'],
] as const

const PROJECT = [
  ['General', 'general'],
  ['Code and issues', 'code'],
  ['Tasks', 'tasks'],
  ['Rules', 'rules'],
  ['Running', 'running'],
  ['Notes', 'notes'],
] as const

const shoot = async (page: Page, name: string) => {
  await still(page)
  await page.screenshot({ path: `test-results/sections/${name}.png`, scale: 'css', animations: 'disabled' })
}

test('draws each section of Althar’s Settings and of a project’s, light and dark, with the agents set up', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  // The person's agents: their servers and skills in their own files, and how each server stood when last asked.
  seedClaude(home, Object.fromEntries(SERVERS))
  seedCodex(home, { github: { command: 'node', args: [FAKE_SERVER, 'pages'] }, linear: { url: 'https://mcp.linear.app/mcp' } })
  seedOpenCode(home, { playwright: { type: 'local', command: ['node', FAKE_SERVER, 'pages'] } })
  seedSkill(home, '.claude/skills', 'impeccable', 'Design that holds up: a direction, a comp, then the build, reviewed against both.')
  seedSkill(
    home,
    '.claude/skills',
    'improve',
    'Survey a codebase as a senior advisor and write prioritised plans for other agents to carry out.',
  )
  seedSkill(home, '.claude/skills', 'dataviz', 'Charts, dashboards and stat tiles that read as one system, light and dark.')
  seedSkill(home, '.agents/skills', 'release-notes', 'Write the notes for a release from the pull requests merged since the last tag.')
  seedHealth(home, {
    notion: { claude: { status: 'failed', why: 'Notion refused its sign-in (401): it was signed out on notion.so' } },
    linear: { claude: { status: 'connected' }, codex: { status: 'needs-auth' } },
    akiflow: { claude: { status: 'needs-auth' }, codex: { status: 'needs-auth' }, opencode: { status: 'needs-auth' } },
    slack: { claude: { status: 'failed', why: 'Slack refused its token: the app was removed from the workspace' } },
  })
  // A repository's own server and skill.
  writeFileSync(
    join(repo, '.mcp.json'),
    JSON.stringify({ mcpServers: { 'site-browser': { command: 'node', args: [FAKE_SERVER, 'pages'] } } }, null, 2),
  )
  mkdirSync(join(repo, '.claude', 'skills', 'run'), { recursive: true })
  writeFileSync(
    join(repo, '.claude', 'skills', 'run', 'SKILL.md'),
    '---\nname: run\ndescription: Launch and drive the app to see a change working.\n---\n',
  )

  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.keyboard.press('ControlOrMeta+Shift+Comma')
      const nav = page.getByRole('navigation', { name: 'Settings' })
      for (const [title, id] of GROUPS) {
        await nav.getByRole('button', { name: new RegExp(`^${title}`) }).click()
        await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
        if (id === 'mcp-servers') {
          await expect(page.getByRole('main').getByText('Failed to start').first()).toBeVisible()
          await expect(page.getByRole('main').getByRole('button', { name: /^site-browser/ })).toBeVisible()
        }
        if (id === 'skills') await expect(page.getByRole('main').getByRole('button', { name: /^impeccable/ })).toBeVisible()
        await shoot(page, `althar-${String(GROUPS.findIndex(([, one]) => one === id) + 1).padStart(2, '0')}-${id}-${scheme}`)
      }
      // A server opened: each agent's own file, and its tools counted by Althar's own check.
      await nav.getByRole('button', { name: /^MCP servers/ }).click()
      await page
        .getByRole('main')
        .getByRole('button', { name: /^github/ })
        .click()
      await expect(page.getByRole('main').getByText(/\d+ tools/)).toBeVisible()
      await shoot(page, `althar-02-mcp-opened-${scheme}`)
      await page.getByRole('main').getByRole('button', { name: 'Back' }).click()
      // A skill opened.
      await nav.getByRole('button', { name: /^Skills/ }).click()
      await page
        .getByRole('main')
        .getByRole('button', { name: /^impeccable/ })
        .click()
      await shoot(page, `althar-03-skill-opened-${scheme}`)
      await page.getByRole('main').getByRole('button', { name: 'Back' }).click()

      // The project's own: back to its tab, then its settings.
      await page
        .getByRole('navigation', { name: 'Projects' })
        .getByRole('button', { name: /^meridian/ })
        .click()
      for (const [title, id] of PROJECT) {
        await projectSettings(page, title)
        await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible()
        await shoot(page, `project-${String(PROJECT.findIndex(([, one]) => one === id) + 1).padStart(2, '0')}-${id}-${scheme}`)
      }
      await page
        .getByRole('radiogroup', { name: 'View' })
        .getByRole('radio', { name: /^Conversation/ })
        .click()
    }

    // The servers again at a narrow window, nothing running past its edge.
    await page.emulateMedia({ colorScheme: 'light' })
    await sizeWindow(electronApp, page, 800, 700)
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^MCP servers/ })
      .click()
    await expect(page.getByRole('main').getByRole('button', { name: /^github/ })).toBeVisible()
    await shoot(page, 'althar-02-mcp-servers-800')
  } finally {
    await electronApp.close()
  }
})
