import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, type Page, test } from '@playwright/test'

import { author, repository } from '../tests/repository'
import { connectGitHub, mainWindow, openFirstProject, say } from './support'

/*
 * What a real agent does through Althar's tools rather than around its
 * sandbox (ADR-055), in the app, against the fake GitHub: the coordinator
 * runs the project and takes a screenshot of it; a task's lead installs
 * again, runs the project in its worktree, takes a screenshot, stops it,
 * and, once its pull request's checks fail, runs them again, told which it
 * can't. It uses the agent's own sign-in on this machine, so it runs only
 * when asked: ALTHAR_REAL_AGENT=claude-code (or codex), and
 * ALTHAR_REAL_MODEL to pick a model by words in its name, else the first.
 */

const agent = process.env.ALTHAR_REAL_AGENT
const names: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

test.skip(agent === undefined, 'Set ALTHAR_REAL_AGENT to run it against a real agent')

/** A server on a free port, with a page whose heading the agents read back, that says where it answers as Vite does. */
const SERVER = `require('node:http').createServer((_, res) => {
  res.setHeader('content-type', 'text/html')
  res.end('<!doctype html><title>Meridian</title><h1>Checkout retries</h1><p id="note">Three tries, a second apart.</p>')
}).listen(0, function () {
  console.log('  Local:   http://localhost:' + this.address().port + '/')
})
`

/** The repository: the server as its dev script, and a package its lockfile installs from inside it, with no network. */
const project = (home: string) => {
  const repo = repository(home)
  mkdirSync(join(repo, 'vendor', 'greet'), { recursive: true })
  writeFileSync(join(repo, 'vendor', 'greet', 'package.json'), JSON.stringify({ name: 'greet', version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(repo, 'vendor', 'greet', 'index.js'), "module.exports = 'hello'\n")
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'meridian', private: true, scripts: { dev: 'node serve.js' }, dependencies: { greet: 'file:./vendor/greet' } }),
  )
  writeFileSync(
    join(repo, 'bun.lock'),
    `${JSON.stringify(
      {
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { '': { name: 'meridian', dependencies: { greet: 'file:./vendor/greet' } } },
        packages: { greet: ['greet@file:vendor/greet', {}] },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(repo, 'serve.js'), SERVER)
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
  const git = (...args: Array<string>) => execFileSync('git', args, { cwd: repo, env: { ...process.env, ...author } })
  git('add', '.')
  git('commit', '-q', '-m', 'Serve')
  git('remote', 'add', 'origin', 'https://github.test/meridian/api.git')
  return repo
}

/** The agent's model, by words in its name where ALTHAR_REAL_MODEL says, else its first, in the picker whose button `picker` names. */
const modelOf = async (page: Page, picker: RegExp, name: string) => {
  await page.getByRole('button', { name: picker }).click()
  await page.getByRole('button', { name: /All models/ }).click()
  const models = page.getByRole('dialog')
  await models.getByRole('radio', { name: new RegExp(`^${name}`) }).click()
  const wanted = process.env.ALTHAR_REAL_MODEL
  const choices = models.getByRole('button', { name: /^Use / })
  await (wanted === undefined ? choices.first() : choices.filter({ hasText: new RegExp(wanted, 'i') }).first()).click()
}

test('a real coordinator and lead install, run, screenshot, stop, and run checks again through Althar', async () => {
  test.setTimeout(900_000)
  const name = names[agent ?? ''] ?? agent ?? ''
  const home = mkdtempSync(join(tmpdir(), 'althar-real-tools-'))
  const repo = project(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', remote])
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ALTHAR_FAKE_AGENTS' && !key.startsWith('GIT_'),
    ),
  )
  const app = await electron.launch({
    args: [join(import.meta.dirname, '..')],
    env: {
      ...inherited,
      ALTHAR_PROFILE: join(home, 'profile'),
      ALTHAR_WORKTREES: join(home, 'worktrees'),
      ALTHAR_CODE_HOME: home,
      ALTHAR_FAKE_CONNECTORS: 'github',
      ALTHAR_FAKE_REMOTE: remote,
      // A flaky test GitHub runs again, and a build another service reported, which it can't.
      ALTHAR_FAKE_CHECKS: JSON.stringify([
        { name: 'test', state: 'failed', log: 'FAIL retry.test.ts: timed out after 5000 ms' },
        { name: 'Workers Builds: meridian', state: 'failed', url: 'https://dash.cloudflare.com/builds/7', rerun: false },
      ]),
    },
  })
  try {
    const page = await mainWindow(app)
    await (await app.browserWindow(page)).evaluate((window) => window.setSize(1440, 960))
    await openFirstProject(app, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    // The coordinator runs the project, and sees it.
    await modelOf(page, /^Coordinator:/, name)
    await say(
      page,
      'Run the project with run_project, then take a screenshot of the address it gives with your screenshot tool, and tell me in one sentence what the page’s heading says.',
    )
    await expect(page.getByText(/Checkout retries/).last()).toBeVisible({ timeout: 240_000 })
    await page.screenshot({ path: 'test-results/real-tools-coordinator.png', scale: 'css' })

    // A task whose lead does the same in its worktree, then runs its pull request's checks again.
    await say(
      page,
      [
        'Plan a task titled "Try the lead tools", with no review, whose lead does exactly this and nothing else:',
        '1. Call install_dependencies.',
        '2. Call run_project.',
        '3. Take a screenshot of the address run_project gave, with the screenshot tool, and say what the heading says.',
        '4. Call stop_project.',
        '5. Add the line "Tried." to README.md, commit it, and call finish_step.',
        '6. Later, when Althar says checks failed on the pull request, call rerun_check once with no arguments, then reply with what it said, word for word, and change no files.',
      ].join('\n'),
    )
    await page.getByRole('button', { name: 'Hold' }).click({ timeout: 240_000 })
    await modelOf(page, /^Lead for this task:/, name)
    const skip = page.getByRole('button', { name: 'Skip', exact: true })
    if ((await skip.count()) > 0) await skip.first().click()
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByRole('heading', { name: 'Try the lead tools', level: 1 })).toBeVisible()

    await expect(page.getByText('PR #1').first()).toBeVisible({ timeout: 480_000 })
    await page.screenshot({ path: 'test-results/real-tools-lead.png', scale: 'css', fullPage: true })
    await expect(page.getByText(/can.t be run again here/).last()).toBeVisible({ timeout: 480_000 })
    await page.screenshot({ path: 'test-results/real-tools-rerun.png', scale: 'css', fullPage: true })
  } finally {
    await app.close()
  }
})
