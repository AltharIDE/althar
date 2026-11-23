import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, copyFileSync, realpathSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Schema } from 'effect'
import { ClientDeviceId, HomeId } from '@althar/contracts'
import { budget } from '@althar/testing/budget'
import { expect, test, type ElectronApplication } from '@playwright/test'

import { launch, openFirstProject, still } from './support'

const progress = (message: string) => process.stdout.write(`${message}\n`)
/** A blocked native keychain dialog must produce a failed test, rather than leave its Electron worker hanging. */
const closeDesktop = async (app: ElectronApplication, child: ChildProcess) => {
  const deadline = AbortSignal.timeout(budget.medium)
  let forced = false
  const force = () => {
    forced = true
    child.kill('SIGKILL')
  }
  deadline.addEventListener('abort', force, { once: true })
  try {
    await app.close()
    if (forced) throw new Error('The desktop did not close within its shutdown budget.')
  } finally {
    deadline.removeEventListener('abort', force)
  }
}

const repo = (root: string, name: string) => {
  const path = join(root, name)
  execFileSync('git', ['init', '-q', '-b', 'main', path])
  execFileSync(
    'git',
    ['-c', 'user.name=Fixture', '-c', 'user.email=balazs@otakomaiya.com', 'commit', '-q', '--allow-empty', '-m', 'Initial'],
    { cwd: path },
  )
  return path
}
const portNumber = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('No port'))
        return
      }
      server.close((error) => (error == null ? resolve(address.port) : reject(error)))
    })
  })

// On a Mac the native keyring is the person's login keychain; with the test's temporary HOME macOS finds none and pops a
// "Keychain Not Found" dialog. So it runs only where the workflow made a disposable keychain and named it in
// ALTHAR_E2E_ISOLATED_KEYCHAIN (desktop.yml's native pairing job), never on CI=true alone.
const isolatedKeychain = process.env.ALTHAR_E2E_ISOLATED_KEYCHAIN
/**
 * Whether macOS's default keychain and its whole search list are that one disposable file, so the app can reach no other
 * (checked only where the variable is set; `security` here lists settings and opens no keychain).
 */
const keychainIsolated = (path: string): boolean => {
  try {
    const listed = (command: string): string[] =>
      execFileSync('security', [command, '-d', 'user'], { encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim().replace(/^"|"$/g, ''))
        .filter((line) => line !== '')
        .map((line) => realpathSync(line))
    const expected = realpathSync(path)
    const list = listed('list-keychains')
    return listed('default-keychain').every((line) => line === expected) && list.length === 1 && list[0] === expected
  } catch {
    return false
  }
}
test.skip(
  process.platform === 'darwin' && (isolatedKeychain === undefined || isolatedKeychain === '' || !keychainIsolated(isolatedKeychain)),
  "Needs macOS to use only a disposable keychain (ALTHAR_E2E_ISOLATED_KEYCHAIN, set up by the native pairing CI job): it never touches a person's login keychain",
)

test('pairs a desktop with a separate HTTPS home, reconnects after restart and loses access immediately on revocation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-pairing-e2e-'))
  chmodSync(root, 0o700)
  repo(root, 'remote-project')
  const certificate = join(root, 'certificate.pem')
  const key = join(root, 'key.pem')
  copyFileSync(resolve('../../packages/transport-node/tests/fixtures/tls/certificate.pem'), certificate)
  copyFileSync(resolve('../../packages/transport-node/tests/fixtures/tls/key.pem'), key)
  chmodSync(certificate, 0o600)
  chmodSync(key, 0o600)
  const entry = resolve('test-results/network-host/network-host.js')
  execFileSync(process.execPath, [resolve('node_modules/vite-plus/bin/vp'), 'build', '--config', 'e2e/networkHost.config.ts'], {
    stdio: 'pipe',
  })
  let port = await portNumber()
  const readySchema = Schema.Struct({ homeId: HomeId, hostDeviceId: ClientDeviceId, projectId: Schema.String, taskId: Schema.String })
  const start = async () => {
    let output = ''
    const child = spawn(process.execPath, [entry, 'serve', root, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let diagnostics = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-16_384)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString('utf8')).slice(-16_384)
    })
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    try {
      await expect
        .poll(() => {
          if (child.exitCode !== null) throw new Error(diagnostics || 'Host fixture stopped')
          return output.includes('\n')
        })
        .toBe(true)
      return { child, closed, ready: Schema.decodeUnknownSync(readySchema)(JSON.parse(output.trim())) }
    } catch (error) {
      child.kill('SIGTERM')
      await closed
      throw error
    }
  }
  /**
   * The host on `port`, which was only free when it was picked: another process on a busy machine may take it before the
   * host listens, and a host just stopped may not have let go of it yet. The host then says its home refused to listen
   * (ConnectionRefused). Before anything is paired, another port will do; after, the home is known by this one, so the same
   * port is tried again.
   */
  const startListening = async (paired: boolean) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await start()
      } catch (error) {
        if (attempt === 5 || !String(error).includes('ConnectionRefused')) throw error
        progress(`Native pairing: the host could not listen on ${port}, trying again`)
        if (paired) await new Promise((resolve) => setTimeout(resolve, 500))
        else port = await portNumber()
      }
    }
  }
  let host = await startListening(false)
  progress('Native pairing: standalone host ready')
  const clientRoot = mkdtempSync(join(tmpdir(), 'althar-pairing-client-'))
  const clientEnvironment = {
    ALTHAR_API_SOCKET: '1',
    ALTHAR_NATIVE_KEYRING: '1',
    // macOS resolves the logged-in user's keychain through its home. Keep that OS context on the isolated CI runner;
    // launch still supplies this test's own profile, worktrees and provider home.
    ...(process.platform === 'darwin' && isolatedKeychain !== undefined && process.env.HOME !== undefined
      ? { HOME: process.env.HOME }
      : {}),
  }
  let {
    electronApp,
    page,
    child: desktopChild,
  } = await launch(clientRoot, clientEnvironment).catch(async (error: unknown) => {
    host.child.kill('SIGTERM')
    await host.closed
    throw error
  })
  try {
    progress('Native pairing: desktop opened')
    await openFirstProject(electronApp, page, repo(clientRoot, 'local-project'))
    progress('Native pairing: local project opened')
    progress(`Native pairing: keyring application ${await electronApp.evaluate(({ app }) => app.getName())}`)
    const storage = await electronApp.evaluate(({ app, safeStorage }) => ({
      available: safeStorage.isEncryptionAvailable(),
      backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'OS keychain',
      mocked: app.commandLine.hasSwitch('use-mock-keychain'),
      passwordStore: app.commandLine.getSwitchValue('password-store'),
    }))
    expect(storage.available, 'Pairing requires a real OS keyring in this native test').toBe(true)
    expect(storage.backend).not.toBe('basic_text')
    expect(storage.backend).not.toBe('unknown')
    expect(storage.mocked).toBe(false)
    expect(storage.passwordStore).not.toBe('basic')
    progress('Native pairing: real OS keyring available')
    const invitation = Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }))(
      JSON.parse(execFileSync(process.execPath, [entry, 'pair', root], { encoding: 'utf8' })),
    )
    await page.getByRole('button', { name: 'Homes', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Connect a home…', exact: true }).click()
    // A first home opens on what a home is, then how to set one up; one set up already pairs, or is checked over SSH.
    await page.getByRole('dialog', { name: 'Your first home' }).getByRole('button', { name: 'Set one up' }).click()
    await page.getByRole('radio', { name: /^With a pairing code/ }).click()
    await page.getByRole('button', { name: 'Paste its code', exact: true }).click()
    await still(page)
    await page.screenshot({ path: 'test-results/pairing-flow-01-entry.png', scale: 'css' })
    await page.getByLabel('Pairing code', { exact: true }).fill(invitation.code)
    await expect(page.getByText(`https://127.0.0.1:${port}`, { exact: true })).toBeVisible()
    await page.getByLabel('Name', { exact: true }).fill('My VPS')
    await still(page)
    await page.screenshot({ path: 'test-results/pairing-flow-02-confirm.png', scale: 'css' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await still(page)
    await page.screenshot({ path: 'test-results/pairing-flow-02-confirm-dark.png', scale: 'css' })
    await page.emulateMedia({ colorScheme: 'light' })
    await still(page)
    const opened = electronApp.waitForEvent('window', { predicate: (candidate) => candidate !== page })
    await page.getByRole('button', { name: 'Pair and open', exact: true }).click()
    let remote = await Promise.race([
      opened,
      page
        .getByRole('dialog')
        .getByRole('alert')
        .waitFor({ state: 'visible' })
        .then(async () => {
          throw new Error(await page.getByRole('dialog').getByRole('alert').innerText())
        }),
    ])
    await expect(remote.getByRole('button', { name: 'My VPS, connected. Homes', exact: true })).toBeVisible()
    progress('Native pairing: paired remote window connected')
    await remote
      .getByRole('complementary', { name: 'Projects' })
      .getByRole('button', { name: /^remote-project/ })
      .click()
    await expect(remote.getByRole('heading', { name: 'remote-project', exact: true })).toBeVisible()
    expect(await remote.evaluate(async () => (await window.althar.homes!.state()).identity?.role)).toBe('socket')
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
    const local = Schema.decodeUnknownSync(Schema.Struct({ homeId: HomeId }))(
      JSON.parse(readFileSync(join(clientRoot, 'profile/api/endpoint.json'), 'utf8')),
    )
    expect(local.homeId).not.toBe(host.ready.homeId)
    await still(remote)
    await remote.screenshot({ path: 'test-results/pairing-flow-03-remote.png', scale: 'css' })
    host.child.kill('SIGTERM')
    await host.closed
    await expect(remote.getByRole('button', { name: 'My VPS, disconnected. Homes', exact: true })).toBeVisible()
    const before = host.ready
    host = await startListening(true)
    expect(host.ready).toEqual(before)
    await remote.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect(remote.getByRole('button', { name: 'My VPS, connected. Homes', exact: true })).toBeVisible()
    progress('Native pairing: connected after host restart')
    await expect(remote.getByRole('heading', { name: 'remote-project', exact: true })).toBeVisible()
    const saved = await page.evaluate(async () => (await window.althar.homes!.list())[0])
    if (saved?.https === undefined) throw new Error('No saved paired home')
    await closeDesktop(electronApp, desktopChild)
    progress('Native pairing: desktop closed for relaunch')
    ;({ electronApp, page, child: desktopChild } = await launch(clientRoot, clientEnvironment))
    progress('Native pairing: desktop relaunched')
    await expect(page.getByRole('button', { name: 'Homes', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Homes', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Manage homes…', exact: true }).click()
    const manage = page.getByRole('dialog', { name: 'Homes', exact: true })
    await expect(manage.getByText('My VPS', { exact: true })).toBeVisible()
    await manage.getByRole('button', { name: 'My VPS, more', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Forget', exact: true }).click()
    await expect(manage.getByText('My VPS', { exact: true })).toHaveCount(0)
    await expect.poll(() => readFileSync(join(clientRoot, 'profile/connection-keys/devices.json'), 'utf8').includes(saved.id)).toBe(false)
    await manage.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(manage.getByText('My VPS', { exact: true })).toBeVisible()
    // Changing one's mind while Undo is saving must leave the final Forget in force, including its sealed key.
    await manage.getByRole('button', { name: 'My VPS, more', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Forget', exact: true }).click()
    await expect.poll(() => readFileSync(join(clientRoot, 'profile/connection-keys/devices.json'), 'utf8').includes(saved.id)).toBe(false)
    await expect.poll(() => page.evaluate(async () => (await window.althar.homes!.list()).length)).toBe(0)
    await manage.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(manage.getByText('My VPS', { exact: true })).toBeVisible()
    const reopened = electronApp.waitForEvent('window', { predicate: (candidate) => candidate !== page })
    await manage.getByRole('button', { name: /^remote-project/ }).click()
    remote = await reopened
    await expect(remote.getByRole('heading', { name: 'remote-project', exact: true })).toBeVisible()
    expect(await remote.evaluate(async () => (await window.althar.homes!.state()).identity?.deviceId)).toBe(saved.https.deviceId)
    progress('Native pairing: restored home connected with its saved device')
    const deviceId = saved.https.deviceId
    if (deviceId === undefined) throw new Error('No saved paired device')
    execFileSync(process.execPath, [entry, 'revoke', root, deviceId])
    await expect(remote.getByRole('button', { name: 'My VPS, disconnected. Homes', exact: true })).toBeVisible()
    progress('Native pairing: revocation disconnected the client')
    expect(readFileSync(join(clientRoot, 'profile/homes.json'), 'utf8')).not.toContain(invitation.code)
  } finally {
    if (!page.isClosed()) await page.screenshot({ path: 'test-results/pairing-flow-outcome.png', scale: 'css' }).catch(() => undefined)
    await closeDesktop(electronApp, desktopChild)
    host.child.kill('SIGTERM')
    await host.closed
    rmSync(root, { recursive: true, force: true })
    rmSync(clientRoot, { recursive: true, force: true })
  }
})
