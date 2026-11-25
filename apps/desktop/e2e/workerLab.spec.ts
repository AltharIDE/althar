import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, sizeWindow, still, toConversation } from './support'

/*
 * Adding a worker to This Mac from Settings › Computers, against a real Linux machine reached over SSH: a lab, not CI.
 * It runs only where ALTHAR_WORKER_LAB names a folder holding the lab: `sshtools` (OpenSSH wrappers for the lab's key,
 * known hosts and an SSH alias, `build-box`), `release.pub` (the key the lab's release is signed with), and in
 * ALTHAR_WORKER_LAB_MANIFEST the address of its manifest. The machine starts fresh: root over SSH, no Althar on it.
 * Each state is kept in test-results/worker-lab, light and dark. Where ALTHAR_WORKER_LAB_AGENTS names a command, it runs
 * once the worker is added, in place of a person signing its agents in with an account of their own (the lab puts a
 * test agent there); then a task runs on the worker.
 */

const lab = process.env.ALTHAR_WORKER_LAB
const THIS = 'This Mac'

const shoot = async (page: Page, name: string, what?: ReturnType<Page['getByRole']>) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await still(page)
    if (what === undefined)
      await page.screenshot({ path: `test-results/worker-lab/${name}-${scheme}.png`, scale: 'css', animations: 'disabled' })
    else await what.screenshot({ path: `test-results/worker-lab/${name}-${scheme}.png`, scale: 'css', animations: 'disabled' })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

test.skip(lab === undefined, 'A lab with a Linux machine over SSH: ALTHAR_WORKER_LAB')

test('adds a fresh Linux machine as a worker over SSH, picks its project and signs its agent in', async () => {
  test.setTimeout(40 * 60_000)
  mkdirSync('test-results/worker-lab', { recursive: true })
  const home = mkdtempSync(join(tmpdir(), 'althar-lab-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home, {
    ALTHAR_SSH_TOOLS: join(lab!, 'sshtools'),
    ALTHAR_HOST_RELEASE_KEY: join(lab!, 'release.pub'),
    ALTHAR_HOST_RELEASE_MANIFEST: process.env.ALTHAR_WORKER_LAB_MANIFEST ?? '',
    NODE_EXTRA_CA_CERTS: join(lab!, 'labca.pem'),
    ...(process.env.ALTHAR_WORKER_LAB_REAL === '1' ? { ALTHAR_FAKE_AGENTS: '0' } : {}),
  })
  const main = page.getByRole('main')
  try {
    await sizeWindow(electronApp, page, 1180, 800)
    await openFirstProject(electronApp, page, repository(projects))
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Computers' }).click()
    await expect(main.getByRole('heading', { name: 'Computers', level: 1 })).toBeVisible()

    // Add a worker: its SSH address, as for a home.
    await main.getByRole('button', { name: /^Add a worker/ }).click()
    const dialog = page.getByRole('dialog', { name: `Add a worker to ${THIS}` })
    await dialog.getByLabel('SSH address').fill('build-box')
    await shoot(page, '1-address', dialog)
    await dialog.getByRole('button', { name: 'Add worker' }).click()

    // First time on it: its key, to trust.
    await expect(dialog.getByText('Is this build-box’s key?')).toBeVisible({ timeout: 60_000 })
    await shoot(page, '2-trust', dialog)
    await dialog.getByRole('button', { name: 'Trust and go on' }).click()

    // Installing, from the signed release.
    await expect(dialog.getByText(/Downloading|Sending from this computer/)).toBeVisible({ timeout: 120_000 })
    await shoot(page, '3-installing', dialog)

    // Started and connected: the dialog gives way to its sheet.
    await expect(dialog).toHaveCount(0, { timeout: 15 * 60_000 })
    await expect(main.getByRole('heading', { name: 'build-box' })).toBeVisible()
    await expect(main.getByText('Pick the projects it works on')).toBeVisible()
    await shoot(page, '4-added')

    // Its project, picked here.
    await main.getByRole('checkbox').first().click()
    await expect(main.getByText('Pick the projects it works on')).toHaveCount(0)

    // Codex signs in with a one-time code from its provider, said here: entered on another device, it signs the worker in.
    const row = (name: string) => main.locator('[class*="agentRow_"]').filter({ hasText: name })
    await row('Codex').getByRole('button', { name: 'Sign in' }).click()
    const code = main.locator('[class*="signInCode"]')
    await expect(code).toBeVisible({ timeout: 120_000 })
    writeFileSync('test-results/worker-lab/code.txt', `${await code.textContent()}\n`)
    await shoot(page, '5-signing-in')
    const agents = process.env.ALTHAR_WORKER_LAB_AGENTS
    if (agents === undefined) {
      await expect(row('Codex').getByText('Signed in', { exact: true })).toBeVisible({ timeout: 15 * 60_000 })
      return
    }
    await main.getByRole('button', { name: 'Cancel' }).click()
    execFileSync(agents, { stdio: 'inherit' })
    await expect(row('Codex').getByText('Signed in', { exact: true })).toBeVisible({ timeout: 120_000 })
    await expect(row('Claude Code').getByText('Signed in', { exact: true })).toBeVisible()
    await shoot(page, '6-ready')

    // A task on it: planned, set to run on build-box, started; its lead answers from the worker.
    const tabs = page.getByRole('navigation', { name: 'Projects' })
    await tabs.getByRole('button', { name: 'Close Settings' }).click()
    await tabs.getByRole('button', { name: /^meridian/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await planTask(page, 'Say hello from the worker')
    const plan = page
      .locator('[data-rhythm="card"]')
      .filter({ has: page.getByText('Say hello from the worker', { exact: true }), visible: true })
    // Held, so where it runs can be chosen before it starts.
    await plan.getByRole('button', { name: 'Hold', exact: true }).click({ timeout: 120_000 })
    await plan.getByRole('button', { name: /^Runs on: / }).click()
    await page.getByRole('menuitemradio', { name: /build-box/ }).click()
    await expect(plan.getByRole('button', { name: 'Runs on: build-box' })).toBeVisible()
    await shoot(page, '7-runs-on')
    await plan.getByRole('button', { name: /^Start( now)?$/ }).click()
    // Its card, then its thread: the lead's answer comes from the worker.
    const task = page.getByRole('article', { name: 'Say hello from the worker' }).last()
    await task.getByRole('button', { name: /Open task/ }).click({ timeout: 120_000 })
    await toConversation(page)
    await expect(
      page
        .getByText(/Hello from build-box/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible({ timeout: 5 * 60_000 })
    await shoot(page, '8-ran-on-worker')

    // A machine without SSH from here: a one-time code, and the line its person runs there.
    const withCode = process.env.ALTHAR_WORKER_LAB_CODE
    if (withCode === undefined) return
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Computers' }).click()
    const back = main.getByRole('button', { name: 'Computers', exact: true })
    if ((await back.count()) > 0) await back.click()
    await main.getByRole('button', { name: 'Add a worker', exact: true }).click()
    const codeDialog = page.getByRole('dialog', { name: `Add a worker to ${THIS}` })
    await codeDialog.getByRole('radio', { name: 'With a code' }).click()
    const line = codeDialog.getByText(/althar-worker\.sh \| sh -s -- join/)
    await expect(line).toBeVisible({ timeout: 60_000 })
    await shoot(page, '9-with-a-code', codeDialog)
    execFileSync(withCode, [(await line.textContent()) ?? ''], { stdio: 'inherit', timeout: 10 * 60_000 })
    await codeDialog.getByRole('button', { name: 'Close' }).click()
    await expect(main.getByRole('button', { name: /^laptop-box/ })).toBeVisible({ timeout: 120_000 })
    await expect(main.getByRole('button', { name: /^laptop-box/ })).toContainText('Ready for a task')
    await shoot(page, '10-two-workers')
  } finally {
    await electronApp.close()
  }
})
