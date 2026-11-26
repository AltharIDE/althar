import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer as createHttp } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'

import { artifactPath } from '@althar/runtime/artifacts'
import { expect, test, type Page } from '@playwright/test'
import { launch, openFirstProject, say, still, toConversation } from './support'
import { repository } from '../tests/repository'

/*
 * A task's work seen from a window paired with a home over SSH, as on a
 * Linux home: the pictures its lead shows, which the home keeps, drawn
 * through the home's own connection; and the code host refusing the home's
 * sign-in a push, said where the host is connected, on the new project's
 * card, and on the pull request's card, in plain words with the way out,
 * never git's own line. The host here takes git's sign-in but not a push, as
 * GitHub answers a token kept to reading: 403 to git's first question.
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

/** A host that answers every request 403, as GitHub answers git's first question of a push for a token that may only read. */
const refusingHost = async () => {
  const server = createHttp((_request, response) => {
    response.statusCode = 403
    response.end('Write access to repository not granted.')
  })
  const port = await new Promise<number>((done) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done(typeof address === 'object' && address !== null ? address.port : 0)
    }),
  )
  return { url: `http://127.0.0.1:${port}/meridian/api.git`, close: () => new Promise((done) => server.close(done)) }
}

const shoot = async (page: Page, name: string) => {
  await page.mouse.move(1400, 880)
  await still(page)
  await page.screenshot({ path: `test-results/${name}.png`, scale: 'css' })
}

test('a home’s window shows its lead’s pictures, and says why its host refused a push and what to do', async () => {
  test.skip(
    process.platform === 'win32' || !existsSync('/usr/sbin/sshd') || !existsSync('/usr/bin/ssh-keygen'),
    'Needs an OpenSSH daemon to stand in for the home.',
  )
  const root = mkdtempSync(join(tmpdir(), 'althar-desktop-home-work-'))
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
  const host = await refusingHost()
  const repo = repository(root)
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  const { electronApp, page } = await launch(root, { ALTHAR_API_SOCKET: '1', ALTHAR_FAKE_REMOTE: host.url }).catch(
    async (error: unknown) => {
      daemon.kill('SIGTERM')
      await ended
      await host.close()
      throw error
    },
  )
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
    await page.getByRole('button', { name: 'Homes', exact: true }).click()
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
    await remote.setViewportSize({ width: 1440, height: 900 })
    await expect(remote.getByRole('button', { name: 'runner-1, over SSH. Homes', exact: true })).toBeVisible()
    await remote
      .getByRole('complementary', { name: 'Projects' })
      .getByRole('button', { name: /^meridian/ })
      .click()
    await expect(remote.getByRole('heading', { name: 'meridian', exact: true })).toBeVisible()

    // The home connects its code host: the check says at once that the token can't push to the project's repository.
    const card = remote.getByRole('region', { name: 'Before the first pull request' })
    await card.getByRole('button', { name: 'Connect', exact: true }).first().click()
    await card
      .getByRole('group', { name: 'Ways to connect GitHub' })
      .getByRole('button', { name: /Make a token/ })
      .click()
    await card.getByRole('button', { name: 'Paste it myself' }).click()
    await card.getByLabel('Paste it').fill('github_pat_e2e')
    await card.getByRole('button', { name: 'Check' }).click()
    await expect(card.getByRole('heading', { name: 'This token can’t push' })).toBeVisible()
    await expect(card.getByText('It can read meridian/api but not push there.')).toBeVisible()
    await card.screenshot({ path: 'test-results/home-work-connect-cant-push.png', scale: 'css' })
    await card.getByRole('button', { name: 'Connect as it is' }).click()
    // And the project's card says so, as the project stands, with Connect again in place.
    await expect(card.getByText('Can’t push to meridian/api')).toBeVisible()
    await card.screenshot({ path: 'test-results/home-work-project-cant-push.png', scale: 'css' })

    // A task on the home whose lead shows a screenshot, and ends in a pull request the host won't take.
    await say(remote, 'Add a retry to checkout. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:evidence]')
    await remote.getByRole('button', { name: 'Start now' }).click()
    await expect(remote.getByText(/Couldn't open the pull request/).first()).toBeVisible()
    await remote
      .getByRole('button', { name: /Add a retry to checkout/ })
      .first()
      .click()
    await toConversation(remote)
    const stuck = remote.getByRole('region', { name: 'Thread' }).getByText(/^Couldn't open the pull request\./)
    await expect(stuck).toBeVisible()
    await expect(stuck).toContainText('GitHub refused a push to meridian/api with you’s token.')
    await expect(remote.getByText(/git push|unable to access/)).toHaveCount(0)
    await expect(remote.getByRole('button', { name: 'Open code hosts' })).toBeVisible()

    // The lead's screenshot, kept on the home, drawn through its connection.
    const shot = remote
      .getByRole('button', { name: /View The retry button after a failed checkout full size/ })
      .last()
      .getByRole('img')
    await shot.scrollIntoViewIfNeeded()
    await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
    await expect(remote.getByText('Couldn’t show this image')).toHaveCount(0)
    // Drawn from the window's own store of the home's pictures, fetched there through the home's connection: not this
    // computer's artifact store, which a window on a home never reads.
    const digest = /^althar-picture:\/\/shot\/([0-9a-f]{64})/.exec((await shot.getAttribute('src')) ?? '')?.[1] ?? ''
    expect(existsSync(artifactPath(join(profile, 'home-pictures', endpoint.homeId), digest))).toBe(true)
    await shoot(remote, 'home-work-thread')
    await remote
      .getByRole('button', { name: /View The retry button after a failed checkout full size/ })
      .last()
      .click()
    const lightbox = remote.getByRole('dialog')
    await expect.poll(() => lightbox.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
    await shoot(remote, 'home-work-lightbox')
    await remote.keyboard.press('Escape')
    await stuck.scrollIntoViewIfNeeded()
    await shoot(remote, 'home-work-stuck')
  } finally {
    await electronApp.close()
    daemon.kill('SIGTERM')
    await ended
    await host.close()
  }
})
