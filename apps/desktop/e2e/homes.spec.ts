import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'
import { launch, openFirstProject, say, startTask, still } from './support'
import { repository } from '../tests/repository'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const portNumber = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('No fixture port'))
        return
      }
      server.close((error) => (error == null ? resolve(address.port) : reject(error)))
    })
  })

test('checks an SSH home, isolates its window and local services, and reconnects without reopening its store', async () => {
  test.skip(process.platform !== 'linux', 'The isolated OpenSSH daemon runs on Linux; native lifecycle and UI tests cover each platform.')
  const root = mkdtempSync(join(tmpdir(), 'althar-desktop-ssh-'))
  chmodSync(root, 0o700)
  const fixture = resolve('test-results/home-host.mjs')
  execFileSync('bun', ['build', 'e2e/homeHost.ts', '--target=node', `--outfile=${fixture}`], { stdio: 'pipe' })
  for (const key of ['host', 'client'])
    execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(root, key)], { stdio: 'pipe' })
  const port = await portNumber()
  const config = join(root, 'sshd.conf')
  // Fixture keys only; anonymized container root ownership requires this isolated daemon's StrictModes exception.
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
  const ended = new Promise<void>((resolve) => {
    daemon.once('close', () => resolve())
    daemon.once('error', () => resolve())
  })
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
    await openFirstProject(electronApp, page, repository(root))
    await startTask(page, 'Work over SSH', '[lead:wait]')
    await expect(
      page.getByRole('region', { name: 'Running', exact: true }).getByRole('button', { name: 'Work over SSH', exact: true }),
    ).toBeVisible()
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
    const launcher = join(root, "launcher '$literal")
    writeFileSync(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`, { mode: 0o700 })
    await page.evaluate(() => localStorage.setItem('home-isolation', 'local-only'))
    await still(page)
    await page.screenshot({ path: 'test-results/homes-flow-01-local.png', scale: 'css' })
    // No home is saved yet, so this computer's window has no chip: File › Homes… opens Connect a home.
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('homes')?.click())
    const connect = page.getByRole('dialog', { name: 'Connect a home' })
    await expect(connect).toBeVisible()
    await page.getByRole('radio', { name: 'SSH', exact: true }).click()
    await page.getByLabel('SSH host', { exact: true }).fill('fixture')
    await page.getByRole('button', { name: 'Connection options' }).click()
    await page.getByLabel('Home’s profile on the host', { exact: true }).fill(profile)
    await page.getByLabel('althar-host on the host', { exact: true }).fill(launcher)
    await page.getByLabel('SSH config file', { exact: true }).fill(sshConfig)
    await still(page)
    await page.screenshot({ path: 'test-results/homes-flow-02-connect.png', scale: 'css' })
    await page.getByRole('button', { name: 'Check host', exact: true }).click()
    await expect(page.getByText(endpoint.homeId, { exact: true })).toBeVisible()
    await page.getByLabel('Name', { exact: true }).fill('My VPS')
    await still(page)
    await page.screenshot({ path: 'test-results/homes-flow-03-confirm.png', scale: 'css' })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await still(page)
      await connect.screenshot({ path: `test-results/homes-check-${scheme}.png`, scale: 'css' })
    }
    const opened = electronApp.waitForEvent('window', { predicate: (candidate) => candidate !== page })
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    const remote = await opened
    await expect(remote.getByRole('button', { name: 'My VPS, over SSH. Homes', exact: true })).toBeVisible()
    await remote
      .getByRole('complementary', { name: 'Projects' })
      .getByRole('button', { name: /^meridian/ })
      .click()
    await expect(remote.getByRole('heading', { name: 'meridian', exact: true })).toBeVisible()
    await still(remote)
    await remote.screenshot({ path: 'test-results/homes-flow-05-remote.png', scale: 'css' })
    expect(await remote.evaluate(() => localStorage.getItem('home-isolation'))).toBeNull()
    expect(
      await remote.evaluate(async () => {
        try {
          await window.althar.pickFolder()
          return 'allowed'
        } catch {
          return 'refused'
        }
      }),
    ).toBe('refused')
    expect(await remote.evaluate(async () => (await window.althar.homes!.state()).identity?.role)).toBe('socket')
    await expect(
      remote.getByRole('region', { name: 'Running', exact: true }).getByRole('button', { name: 'Work over SSH', exact: true }),
    ).toBeVisible()
    await say(remote, 'Status check over SSH')
    await expect(remote.getByText('Status check over SSH', { exact: true })).toBeVisible()
    await remote.evaluate(() => localStorage.setItem('home-isolation', 'remote-only'))
    await electronApp.evaluate(({ app }) => {
      const connection = app.getAppMetrics().find((metric) => metric.name === 'Althar home connection')
      if (connection === undefined) throw new Error('No dedicated home connection process')
      process.kill(connection.pid, 'SIGTERM')
    })
    await expect(remote.getByRole('button', { name: 'My VPS, disconnected. Homes', exact: true })).toBeVisible()
    await expect(remote.getByRole('heading', { name: 'meridian', exact: true })).toBeVisible()
    await remote.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect(remote.getByRole('heading', { name: 'meridian', exact: true })).toBeVisible()
    await remote.reload()
    await expect(remote.getByRole('heading', { name: 'meridian', exact: true })).toBeVisible()
    expect(await remote.evaluate(() => localStorage.getItem('home-isolation'))).toBe('remote-only')
    expect(await page.evaluate(() => localStorage.getItem('home-isolation'))).toBe('local-only')
    // Manage homes, from the chip: each home by its projects, this computer's and the VPS's, live while their windows connect.
    await remote.getByRole('button', { name: 'My VPS, over SSH. Homes', exact: true }).click()
    await remote.getByRole('menuitem', { name: 'Manage homes…' }).click()
    const manage = remote.getByRole('dialog', { name: 'Homes' })
    await expect(manage.getByRole('button', { name: /^meridian/ })).toHaveCount(2)
    await expect(manage.getByText('This window', { exact: true })).toBeVisible()
    await still(remote)
    await manage.screenshot({ path: 'test-results/homes-manage.png', scale: 'css' })
    await manage.getByRole('button', { name: 'My VPS, more' }).click()
    await remote.getByRole('menuitem', { name: 'Rename' }).click()
    await manage.getByLabel('Name', { exact: true }).fill('Fixture VPS')
    await manage.getByLabel('Name', { exact: true }).press('Enter')
    await manage.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(remote.getByRole('button', { name: 'Fixture VPS, over SSH. Homes', exact: true })).toBeVisible()
    await remote.close()
    await expect(
      page.getByRole('region', { name: 'Running', exact: true }).getByRole('button', { name: 'Work over SSH', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'meridian', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.althar.homes!.list())).toHaveLength(1)
  } finally {
    await electronApp.close()
    daemon.kill('SIGTERM')
    await ended
  }
})
