import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, still } from './support'

/*
 * Connect a home, a first one, set up over SSH, in the real window with main's own setup: a fake OpenSSH plays the
 * server (ALTHAR_SETUP_SSH_TOOLS), seen for the first time, downloading althar-host, starting it, and a release
 * signed here with a key the app is given (ALTHAR_HOST_RELEASE_KEY). The pictures are this change's evidence
 * (test-results/home-setup-*.png), light and dark.
 */

const HOME_ID = `home_01a1c4f39e2b7d5a80c6e1f42b9d3a77`
const MB = 1_048_576
const fakeSsh = `#!/bin/sh
state="$HOME/fake-server"
mkdir -p "$state"
case "$(basename "$0")" in
  ssh-keyscan) echo "vps.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"; exit 0 ;;
  ssh-add) exit 1 ;;
  sftp) cat > /dev/null; exit 0 ;;
esac
if [ "$1" = -G ]; then printf 'hostname vps.example.com\\nport 22\\nuserknownhostsfile %s\\n' "$state/known_hosts"; exit 0; fi
for last; do :; done
cat > /dev/null
ev() { printf '{"protocol":1,"step":"%s","state":"%s"%s}\\n' "$1" "$2" "\${3:-}"; }
looked() {
  ev reach started; ev reach done; ev look started
  ev look done ',"os":"linux","arch":"x64","systemdUserManager":true,"freeKiB":22020096,"git":true,"login":"deploy","root":false,"linger":false,"action":{"code":"LingerOff","command":"loginctl enable-linger -- deploy"}'
}
case "$last" in
  *"'probe'"*)
    if [ ! -f "$state/known_hosts" ]; then
      echo 'No ED25519 host key is known for vps.example.com and you have requested strict checking.' >&2
      echo 'Host key verification failed.' >&2
      exit 255
    fi
    looked ;;
  *"'status'"*)
    if [ ! -f "$state/started" ]; then ev setup failed ',"code":"SetupNotFound"'; exit 1; fi
    early='{"protocol":1,"step":"setup","state":"started"},{"protocol":1,"step":"setup","state":"done","homeId":"${HOME_ID}"},{"protocol":1,"step":"start","state":"started"}'
    if [ -f "$state/hold-start" ]; then
      printf '{"protocol":1,"state":"running","events":[%s],"rawOutput":""}\\n' "$early"
    else
      printf '{"protocol":1,"state":"done","events":[%s,{"protocol":1,"step":"start","state":"done"},{"protocol":1,"step":"identity","state":"done","homeId":"${HOME_ID}","version":"0.14.2","apiVersion":1}],"rawOutput":""}\\n' "$early"
    fi ;;
  *"'install'"*)
    looked
    ev get started ',"bytes":0,"totalBytes":${40 * MB}'
    bytes=0
    while [ "$bytes" -lt ${40 * MB} ]; do
      if [ -f "$state/hold-get" ] && [ "$bytes" -ge ${17 * MB} ]; then sleep 0.2; continue; fi
      bytes=$((bytes + ${MB}))
      ev get progress ",\\"bytes\\":$bytes,\\"totalBytes\\":${40 * MB}"
      sleep 0.05
    done
    ev get done ',"bytes":${40 * MB},"totalBytes":${40 * MB}'
    touch "$state/started"
    ev setup started ',"detached":true' ;;
esac
`

/** A release of althar-host, signed with a key of the spec's own: its public half for the app, its manifest as a data address. */
const release = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const payload = Buffer.from(
    JSON.stringify({
      format: 1,
      version: '0.14.2',
      sequence: 1,
      publishedAt: new Date(Date.now() - 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      platform: 'linux',
      arch: 'x64',
      updaterProtocol: 1,
      apiVersion: 1,
      storage: 'c'.repeat(64),
      archive: { url: 'https://example.test/althar-host-0.14.2-linux-x64.tar.gz', sha256: 'a'.repeat(64), bytes: 40 * MB },
      unpackedBytes: 120 * MB,
      files: 3000,
    }),
  )
  const keyId = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
  const envelope = JSON.stringify({
    format: 1,
    keyId,
    payload: payload.toString('base64url'),
    signature: sign(null, payload, privateKey).toString('base64url'),
  })
  return {
    key: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    manifest: `data:application/json;base64,${Buffer.from(envelope).toString('base64')}`,
  }
}

const shoot = async (page: Page, name: string, schemes: ReadonlyArray<'light' | 'dark'> = ['light', 'dark']) => {
  for (const scheme of schemes) {
    await page.emulateMedia({ colorScheme: scheme })
    await still(page)
    await page.getByRole('dialog').screenshot({ path: `test-results/home-setup-${name}-${scheme}.png`, scale: 'css' })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

test('sets a first home up over SSH, as steps, from what a home is to naming it, light and dark', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const tools = join(home, 'openssh')
  mkdirSync(tools)
  writeFileSync(join(tools, 'ssh'), fakeSsh, { mode: 0o755 })
  for (const name of ['ssh-keyscan', 'ssh-add', 'sftp']) symlinkSync(join(tools, 'ssh'), join(tools, name))
  const signed = release()
  writeFileSync(join(home, 'release.pub'), signed.key)
  const { electronApp, page } = await launch(home, {
    ALTHAR_SETUP_SSH_TOOLS: tools,
    ALTHAR_HOST_RELEASE_KEY: join(home, 'release.pub'),
    ALTHAR_HOST_RELEASE_MANIFEST: signed.manifest,
  })
  try {
    await openFirstProject(electronApp, page, repository(projects))
    // Room for the whole dialog as its steps come, as a window of the person's has.
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 960))
    const fakeHome = await electronApp.evaluate(() => process.env.HOME ?? '')
    const state = join(fakeHome, 'fake-server')
    mkdirSync(state, { recursive: true })
    writeFileSync(join(state, 'hold-get'), '')
    writeFileSync(join(state, 'hold-start'), '')

    await page.getByRole('button', { name: 'Homes', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Connect a home…', exact: true }).click()
    // A first home: what a home is.
    await expect(page.getByRole('dialog', { name: 'Your first home' })).toBeVisible()
    await shoot(page, '1-intro')
    await page.getByRole('button', { name: 'Set one up', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Set up a home' })).toBeVisible()
    await shoot(page, '2-ways')
    await page.getByRole('radio', { name: /^With a pairing code/ }).click()
    await expect(page.getByText('althar-host pair', { exact: true })).toBeVisible()
    await shoot(page, '3-pairing', ['light'])
    await page.getByRole('radio', { name: /^Over SSH/ }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    // Over SSH: Althar sets it up, step by step.
    const dialog = page.getByRole('dialog', { name: 'Connect a home' })
    await dialog.getByLabel('SSH host', { exact: true }).fill('deploy@vps.example.com')
    await shoot(page, '4-host', ['light'])
    await dialog.getByRole('button', { name: 'Set it up', exact: true }).click()
    // The server's key, seen the first time, is the person's to trust.
    await expect(dialog.getByText(/^SHA256:/).first()).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Trust and continue', exact: true })).toBeVisible()
    await shoot(page, '5-trust')
    await dialog.getByRole('button', { name: 'Trust and continue', exact: true }).click()
    await expect(dialog.getByText(/^Downloading · 17 of 40 MB$/)).toBeVisible()
    await shoot(page, '6-getting')

    // Closed, it goes on, on the window's homes chip, which brings it back.
    await page.keyboard.press('Escape')
    const chip = page.getByRole('button', { name: /^Setting up vps\.example\.com: Getting althar-host · 4\d%\. Show it$/ })
    await expect(chip).toBeVisible()
    await still(page)
    await chip.screenshot({ path: 'test-results/home-setup-7-chip.png', scale: 'css' })
    rmSync(join(state, 'hold-get'))
    await chip.click()
    await expect(dialog.getByText('Make it a home', { exact: true }).locator('xpath=ancestor::li')).toHaveAttribute('data-state', 'done')

    // Set up: its identity is read by the form's own check, here a stand-in for main's (it reaches homes through the system's ssh).
    await electronApp.evaluate(({ ipcMain }, homeId) => {
      ipcMain.removeHandler('althar:homes-inspect')
      ipcMain.handle('althar:homes-inspect', () => ({
        checkId: 'fixture',
        homeId,
        hostDeviceId: `dev_${'3'.repeat(32)}`,
        apiVersion: 1,
        version: '0.14.2',
        target: 'deploy@vps.example.com',
      }))
    }, HOME_ID)
    rmSync(join(state, 'hold-start'))
    await expect(dialog.getByText(/althar-host 0\.14\.2 is running on vps\.example\.com/)).toBeVisible()
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('vps')
    await expect(dialog.getByLabel(HOME_ID, { exact: true })).toBeVisible()
    await shoot(page, '8-done')
    expect(existsSync(join(home, 'profile', 'home-setup.json'))).toBe(true)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(() => existsSync(join(home, 'profile', 'home-setup.json'))).toBe(false)
  } finally {
    await electronApp.close()
  }
})
