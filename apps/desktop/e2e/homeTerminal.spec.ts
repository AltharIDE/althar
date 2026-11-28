import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { budget } from '@althar/testing/budget'

import { repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow, still } from './support'

/*
 * A terminal in a home's window, as on a Linux home reached over SSH: the
 * home lets its window open one, so Ctrl+` brings the status line up with a
 * shell on the home, in the project's repository there, that runs what is
 * typed. The home's connection is a socket's, which once had none of the
 * status line's calls, so the line never showed there.
 */

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const portNumber = () =>
  new Promise<number>((done, fail) => {
    const server = createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        fail(new Error('No fixture port'))
        return
      }
      server.close((error) => (error == null ? done(address.port) : fail(error)))
    })
  })

const line = (page: Page) => page.getByLabel('Runs and terminals', { exact: true })
const drawer = (page: Page) => page.getByRole('region', { name: 'Runs and terminals drawer' })

test('a home’s window opens a terminal on the home, which runs what is typed', async () => {
  test.skip(
    process.platform === 'win32' || !existsSync('/usr/sbin/sshd') || !existsSync('/usr/bin/ssh-keygen'),
    'Needs an OpenSSH daemon to stand in for the home.',
  )
  const root = mkdtempSync(join(tmpdir(), 'althar-desktop-home-terminal-'))
  chmodSync(root, 0o700)
  const fixture = resolve('test-results/home-host.mjs')
  execFileSync('bun', ['build', 'e2e/homeHost.ts', '--target=node', `--outfile=${fixture}`], { stdio: 'pipe' })
  for (const key of ['host', 'client'])
    execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(root, key)], { stdio: 'pipe' })
  const port = await portNumber()
  const config = join(root, 'sshd.conf')
  // Fixture keys only, on loopback, for this user alone.
  writeFileSync(
    config,
    `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${join(root, 'host')}\nPidFile ${join(root, 'sshd.pid')}\nAuthorizedKeysFile ${join(root, 'client.pub')}\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nStrictModes no\nAllowUsers ${userInfo().username}\nLogLevel VERBOSE\n`,
    { mode: 0o600 },
  )
  const daemon = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', config], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { PATH: '/usr/bin:/bin' },
  })
  let log = ''
  daemon.stderr.on('data', (chunk: Buffer) => {
    log = (log + chunk.toString('utf8')).slice(-16_384)
  })
  const ended = new Promise<void>((done) => {
    daemon.once('close', () => done())
    daemon.once('error', () => done())
  })
  const repo = repository(root)
  const { electronApp, page } = await launch(root, { ALTHAR_API_SOCKET: '1' }).catch(async (error: unknown) => {
    daemon.kill('SIGTERM')
    await ended
    throw error
  })
  try {
    await expect
      .poll(() => {
        if (daemon.exitCode !== null) throw new Error(log)
        return log
      })
      .toContain('Server listening')
    await openFirstProject(electronApp, page, repo)
    const profile = join(root, 'profile')
    await expect.poll(() => existsSync(join(profile, 'api/endpoint.json'))).toBe(true)
    const endpoint: { homeId: string } = JSON.parse(readFileSync(join(profile, 'api/endpoint.json'), 'utf8'))
    const known = join(root, 'known_hosts')
    writeFileSync(known, `[127.0.0.1]:${port} ${readFileSync(join(root, 'host.pub'), 'utf8')}`, { mode: 0o600 })
    const sshConfig = join(root, 'ssh.conf')
    writeFileSync(
      sshConfig,
      `Host fixture\n HostName 127.0.0.1\n Port ${port}\n User ${userInfo().username}\n IdentityFile ${join(root, 'client')}\n IdentitiesOnly yes\n UserKnownHostsFile ${known}\n GlobalKnownHostsFile /dev/null\n`,
      { mode: 0o600 },
    )
    const launcher = join(root, 'launcher')
    writeFileSync(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`, { mode: 0o700 })

    // The home, over SSH, in a window of its own.
    await page.getByRole('button', { name: 'Computers', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Connect a home…', exact: true }).click()
    await page.getByRole('dialog', { name: 'Your first home' }).getByRole('button', { name: 'Set one up' }).click()
    await page.getByRole('radio', { name: /^With a pairing code/ }).click()
    await page.getByRole('button', { name: 'Paste its code', exact: true }).click()
    await page.getByRole('radio', { name: 'SSH', exact: true }).click()
    await page.getByLabel('SSH host', { exact: true }).fill('fixture')
    await page.getByRole('button', { name: 'Connection options' }).click()
    await page.getByLabel('Home’s profile on the host', { exact: true }).fill(profile)
    await page.getByLabel('althar-host on the host', { exact: true }).fill(launcher)
    await page.getByLabel('SSH config file', { exact: true }).fill(sshConfig)
    await page.getByRole('button', { name: 'Check host', exact: true }).click()
    await expect(page.getByLabel(endpoint.homeId, { exact: true })).toBeVisible()
    await page.getByLabel('Name', { exact: true }).fill('runner-1')
    const opened = electronApp.waitForEvent('window', { predicate: (candidate) => candidate !== page })
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    const remote = await opened
    await sizeWindow(electronApp, remote, 1280, 820)
    await expect(remote.getByRole('button', { name: 'runner-1, over SSH. Computers', exact: true })).toBeVisible()
    await remote
      .getByRole('complementary', { name: 'Projects' })
      .getByRole('button', { name: /^meridian/ })
      .click()
    await expect(remote.getByRole('heading', { name: 'meridian', exact: true })).toBeVisible()

    // Ctrl+`: the status line, with a terminal on the home in its drawer, the keys its.
    await expect(async () => {
      if ((await line(remote).count()) === 0) await remote.keyboard.press('Control+Backquote')
      await expect(line(remote).getByRole('button', { name: 'meridian', exact: true })).toBeVisible({ timeout: budget.small })
    }).toPass()
    await expect(drawer(remote)).toBeVisible()
    await expect(drawer(remote).locator('.xterm-helper-textarea')).toBeFocused()
    // What is typed runs in a shell on the home, in the project's repository there.
    await remote.keyboard.type('echo "typed on runner-1" > from-the-home.txt; cat from-the-home.txt\n', { delay: 10 })
    await expect
      .poll(() => (existsSync(join(repo, 'from-the-home.txt')) ? readFileSync(join(repo, 'from-the-home.txt'), 'utf8') : null))
      .toBe('typed on runner-1\n')
    await remote.mouse.move(1200, 120)
    await still(remote)
    await remote.screenshot({ path: 'test-results/home-terminal.png', scale: 'css' })
  } finally {
    await electronApp.close()
    daemon.kill('SIGTERM')
    await ended
  }
})
