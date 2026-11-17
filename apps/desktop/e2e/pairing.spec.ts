import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Schema } from 'effect'
import { ClientDeviceId, HomeId } from '@althar/contracts'
import { expect, test } from '@playwright/test'

import { launch, openFirstProject, still } from './support'

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
  const port = await portNumber()
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
  let host = await start()
  const clientRoot = mkdtempSync(join(tmpdir(), 'althar-pairing-client-'))
  const clientEnvironment = { ALTHAR_API_SOCKET: '1', ALTHAR_NATIVE_KEYRING: '1' }
  let { electronApp, page } = await launch(clientRoot, clientEnvironment).catch(async (error: unknown) => {
    host.child.kill('SIGTERM')
    await host.closed
    throw error
  })
  try {
    await openFirstProject(electronApp, page, repo(clientRoot, 'local-project'))
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
    const invitation = Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }))(
      JSON.parse(execFileSync(process.execPath, [entry, 'pair', root], { encoding: 'utf8' })),
    )
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('homes')?.click())
    await page.getByLabel('Name', { exact: true }).fill('My VPS')
    await still(page)
    await page.screenshot({ path: 'test-results/pairing-flow-01-entry.png', scale: 'css' })
    await page.getByLabel('Pairing code', { exact: true }).fill(invitation.code)
    await expect(page.getByText(`https://127.0.0.1:${port}`, { exact: true })).toBeVisible()
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
    host = await start()
    expect(host.ready).toEqual(before)
    await remote.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect(remote.getByRole('button', { name: 'My VPS, connected. Homes', exact: true })).toBeVisible()
    await expect(remote.getByRole('heading', { name: 'remote-project', exact: true })).toBeVisible()
    const saved = await page.evaluate(async () => (await window.althar.homes!.list())[0])
    if (saved?.https === undefined) throw new Error('No saved paired home')
    await electronApp.close()
    ;({ electronApp, page } = await launch(clientRoot, clientEnvironment))
    await expect(page.getByRole('button', { name: 'Homes', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Homes', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Manage homes…', exact: true }).click()
    const manage = page.getByRole('dialog', { name: 'Homes', exact: true })
    await expect(manage.getByText('My VPS', { exact: true })).toBeVisible()
    await manage.getByRole('button', { name: 'My VPS, more', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Forget', exact: true }).click()
    await expect(manage.getByText('My VPS', { exact: true })).toHaveCount(0)
    expect(readFileSync(join(clientRoot, 'profile/connection-keys/devices.json'), 'utf8')).not.toContain(saved.id)
    await manage.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(manage.getByText('My VPS', { exact: true })).toBeVisible()
    const reopened = electronApp.waitForEvent('window', { predicate: (candidate) => candidate !== page })
    await manage.getByRole('button', { name: /^remote-project/ }).click()
    remote = await reopened
    await expect(remote.getByRole('heading', { name: 'remote-project', exact: true })).toBeVisible()
    expect(await remote.evaluate(async () => (await window.althar.homes!.state()).identity?.deviceId)).toBe(saved.https.deviceId)
    const deviceId = saved.https.deviceId
    if (deviceId === undefined) throw new Error('No saved paired device')
    execFileSync(process.execPath, [entry, 'revoke', root, deviceId])
    await expect(remote.getByRole('button', { name: 'My VPS, disconnected. Homes', exact: true })).toBeVisible()
    expect(readFileSync(join(clientRoot, 'profile/homes.json'), 'utf8')).not.toContain(invitation.code)
  } finally {
    if (!page.isClosed()) await page.screenshot({ path: 'test-results/pairing-flow-outcome.png', scale: 'css' }).catch(() => undefined)
    await electronApp.close()
    host.child.kill('SIGTERM')
    await host.closed
    rmSync(root, { recursive: true, force: true })
    rmSync(clientRoot, { recursive: true, force: true })
  }
})
