import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, still } from './support'

/*
 * Connect a home, a first one, set up over SSH, in the real window with main's own setup: a fake OpenSSH plays the
 * server (ALTHAR_SSH_TOOLS), seen for the first time, downloading althar-host and starting it, from a release signed
 * here with a key the app is given (ALTHAR_HOST_RELEASE_KEY). What it "installs" is homes.spec.ts's fixture host,
 * which serves the app's own profile with the production stdio bridge: so the identity the setup reports, the check
 * that reads it, Connect and the home's window are all the app's real ones, over that ssh, with no SSH daemon.
 * The pictures are this change's evidence (test-results/home-setup-*.png), light and dark.
 */

const MB = 1_048_576
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const fakeSsh = `#!/bin/sh
state="$HOME/fake-server"
program="$HOME/.local/share/althar-host-program"
mkdir -p "$state"
case "$(basename "$0")" in
  ssh-keyscan) echo "vps.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"; exit 0 ;;
  ssh-add) exit 1 ;;
  sftp) cat > /dev/null; exit 0 ;;
esac
if [ "$1" = -G ]; then printf 'hostname vps.example.com\\nport 22\\nuserknownhostsfile %s\\n' "$state/known_hosts"; exit 0; fi
for last; do :; done
# The home's own commands, as the app runs them to check and connect: on "the server", here.
case "$last" in
  *althar-host-program/launcher*) exec env -u XDG_DATA_HOME sh -c "$last" ;;
esac
cat > /dev/null
ev() { printf '{"protocol":1,"step":"%s","state":"%s"%s}\\n' "$1" "$2" "\${3:-}"; }
looked() {
  ev reach started; ev reach done; ev look started
  ev look done ',"os":"linux","arch":"x64","systemdUserManager":true,"freeKiB":22020096,"git":true,"login":"deploy","root":false,"linger":false,"action":{"code":"LingerOff","command":"loginctl enable-linger -- deploy"}'
}
field() { grep -o "\\"$1\\":\\"[^\\"]*\\"" | head -n 1 | cut -d '"' -f 4; }
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
    info=$("$program/launcher" status --json) || exit 1
    home=$(printf '%s' "$info" | field homeId)
    device=$(printf '%s' "$info" | field hostDeviceId)
    early="{\\"protocol\\":1,\\"step\\":\\"setup\\",\\"state\\":\\"started\\"},{\\"protocol\\":1,\\"step\\":\\"setup\\",\\"state\\":\\"done\\",\\"homeId\\":\\"$home\\"},{\\"protocol\\":1,\\"step\\":\\"start\\",\\"state\\":\\"started\\"}"
    if [ -f "$state/hold-start" ]; then
      printf '{"protocol":1,"state":"running","events":[%s],"rawOutput":""}\\n' "$early"
    else
      printf '{"protocol":1,"state":"done","events":[%s,{"protocol":1,"step":"start","state":"done"},{"protocol":1,"step":"identity","state":"done","homeId":"%s","hostDeviceId":"%s","version":"0.14.2","apiVersion":1}],"rawOutput":""}\\n' "$early" "$home" "$device"
    fi ;;
  *"'install'"*)
    looked
    ev get started ',"bytes":0,"totalBytes":${40 * MB}'
    if [ -f "$state/no-download" ]; then ev get failed ',"code":"CannotDownload"'; exit 1; fi
    bytes=0
    while [ "$bytes" -lt ${40 * MB} ]; do
      if [ -f "$state/hold-get" ] && [ "$bytes" -ge ${17 * MB} ]; then sleep 0.2; continue; fi
      bytes=$((bytes + ${MB}))
      ev get progress ",\\"bytes\\":$bytes,\\"totalBytes\\":${40 * MB}"
      sleep 0.05
    done
    ev get done ',"bytes":${40 * MB},"totalBytes":${40 * MB}'
    mkdir -p "$program"
    cp "$state/launcher" "$program/launcher"
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

const fixture = resolve('test-results/home-host.mjs')
test.beforeAll(() => {
  execFileSync('bun', ['build', 'e2e/homeHost.ts', '--target=node', `--outfile=${fixture}`], { stdio: 'pipe' })
})

/** The app, with the fake OpenSSH and the signed release, its window big enough for the dialog, and the fake server's folder. */
const start = async (env: Readonly<Record<string, string>> = {}) => {
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
    ALTHAR_API_SOCKET: '1',
    ALTHAR_SSH_TOOLS: tools,
    ALTHAR_HOST_RELEASE_KEY: join(home, 'release.pub'),
    ALTHAR_HOST_RELEASE_MANIFEST: signed.manifest,
    ...env,
  })
  await openFirstProject(electronApp, page, repository(projects))
  // Room for the whole dialog as its steps come, as a window of the person's has.
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 960))
  const state = join(await electronApp.evaluate(() => process.env.HOME ?? ''), 'fake-server')
  mkdirSync(state, { recursive: true })
  // What setup installs there: the fixture host, serving this app's own profile as the home.
  const profile = join(home, 'profile')
  writeFileSync(
    join(state, 'launcher'),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@" --profile ${quote(profile)}\n`,
    {
      mode: 0o700,
    },
  )
  await expect.poll(() => existsSync(join(profile, 'api/endpoint.json'))).toBe(true)
  const endpoint: { homeId: string } = JSON.parse(readFileSync(join(profile, 'api/endpoint.json'), 'utf8'))
  return { home, electronApp, page, state, homeId: endpoint.homeId }
}

const openSetup = async (page: Page) => {
  await page.getByRole('button', { name: 'Homes', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Connect a home…', exact: true }).click()
}

const closing = async (electronApp: ElectronApplication, home: string) => {
  await electronApp.close()
  rmSync(home, { recursive: true, force: true })
}

test('sets a first home up over SSH, as steps, from what a home is to its own window, light and dark', async () => {
  const { home, electronApp, page, state, homeId } = await start()
  try {
    writeFileSync(join(state, 'hold-get'), '')
    writeFileSync(join(state, 'hold-start'), '')
    await openSetup(page)
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

    // Set up: the home it made is read by the app's own check, over the same ssh, and is the one the setup reported.
    rmSync(join(state, 'hold-start'))
    await expect(dialog.getByText(/althar-host 0\.14\.2 is running on vps\.example\.com/)).toBeVisible()
    await expect(dialog.getByLabel(homeId, { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('vps')
    await dialog.getByLabel('Name', { exact: true }).fill('My VPS')
    await shoot(page, '8-done')
    expect(existsSync(join(home, 'profile', 'home-setup.json'))).toBe(true)

    // Connect saves it and opens its window, over the connection the app makes to it; the setup is done with.
    const opened = electronApp.waitForEvent('window', { predicate: (candidate) => candidate !== page })
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
    const remote = await opened
    await expect(remote.getByRole('button', { name: 'My VPS, over SSH. Homes', exact: true })).toBeVisible()
    expect(await remote.evaluate(async () => (await window.althar.homes!.state()).connection)).toBe('connected')
    await expect.poll(() => existsSync(join(home, 'profile', 'home-setup.json'))).toBe(false)
    for (const scheme of ['light', 'dark'] as const) {
      await remote.emulateMedia({ colorScheme: scheme })
      await still(remote)
      await remote.screenshot({ path: `test-results/home-setup-9-home-${scheme}.png`, scale: 'css' })
    }
  } finally {
    await closing(electronApp, home)
  }
})

test('on the home’s window, a new project finds a repository only on GitHub, and clones several there at once', async () => {
  // GitHub's meridian/api and meridian/web, its token said to reach only some of the account's: the home's own connection.
  const remotes = mkdtempSync(join(tmpdir(), 'althar-e2e-remotes-'))
  const source = repository(remotes, 'meridian')
  const api = join(remotes, 'api.git')
  const web = join(remotes, 'web.git')
  execFileSync('git', ['clone', '--quiet', '--bare', source, api])
  execFileSync('git', ['clone', '--quiet', '--bare', source, web])
  const { home, electronApp, page } = await start({ ALTHAR_FAKE_REMOTE_API: api, ALTHAR_FAKE_REMOTE_WEB: web, ALTHAR_FAKE_LIMITED: '1' })
  try {
    await openSetup(page)
    await page.getByRole('button', { name: 'Set one up', exact: true }).click()
    await page.getByRole('radio', { name: /^Over SSH/ }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect a home' })
    await dialog.getByLabel('SSH host', { exact: true }).fill('deploy@vps.example.com')
    await dialog.getByRole('button', { name: 'Set it up', exact: true }).click()
    await dialog.getByRole('button', { name: 'Trust and continue', exact: true }).click()
    await dialog.getByLabel('Name', { exact: true }).fill('My VPS')
    const opened = electronApp.waitForEvent('window', { predicate: (candidate) => candidate !== page })
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
    const remote = await opened
    await expect(remote.getByRole('button', { name: 'My VPS, over SSH. Homes', exact: true })).toBeVisible()

    // A new project there: GitHub connected on the home, from the clone list, with a token.
    await remote.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'New project' }).click()
    await remote.getByRole('textbox', { name: 'Name' }).fill('Meridian')
    await remote.getByRole('button', { name: 'Connect GitHub' }).click()
    await remote
      .getByRole('group', { name: 'Ways to connect GitHub' })
      .getByRole('button', { name: /Make a token/ })
      .click()
    await remote.getByRole('button', { name: 'Paste it myself' }).click()
    await remote.getByLabel('Paste it').fill('github_pat_e2e')
    await remote.getByRole('button', { name: 'Check' }).click()
    await remote.getByRole('button', { name: 'Done' }).click()
    // meridian/web is on GitHub alone, on no computer: found by searching for it.
    const find = remote.getByRole('searchbox', { name: 'Find a repository, or paste its URL' })
    await find.fill('web')
    await remote.getByRole('button', { name: 'Clone meridian/web' }).click()
    await find.fill('')
    await remote.getByRole('button', { name: 'Clone meridian/api' }).click()
    await expect(remote.getByRole('button', { name: 'Chosen meridian/web' })).toBeVisible()
    await expect(remote.getByText('Create clones meridian/web and meridian/api.')).toBeVisible()
    await expect(remote.getByText('Only the repositories your GitHub token was given are listed.')).toBeVisible()
    await still(remote)
    await remote.screenshot({ path: 'test-results/home-clone-several.png', scale: 'css' })
    await remote.getByRole('button', { name: /^Create Meridian/ }).click()
    await expect(remote.getByRole('heading', { name: 'Meridian', level: 1 })).toBeVisible()
    await still(remote)
    await remote.screenshot({ path: 'test-results/home-clone-several-made.png', scale: 'css' })
  } finally {
    await closing(electronApp, home)
    rmSync(remotes, { recursive: true, force: true })
  }
})

test('stops on a trouble with what to do, stops when asked, and picks up again, light and dark', async () => {
  const { home, electronApp, page, state, homeId } = await start()
  try {
    // Trusted already, and the server can't download althar-host at first.
    writeFileSync(join(state, 'known_hosts'), '')
    writeFileSync(join(state, 'no-download'), '')
    writeFileSync(join(state, 'hold-get'), '')
    await openSetup(page)
    await page.getByRole('button', { name: 'Set one up', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect a home' })
    await dialog.getByLabel('SSH host', { exact: true }).fill('deploy@vps.example.com')
    await dialog.getByRole('button', { name: 'Set it up', exact: true }).click()

    // A trouble says what happened and what to do, with its ways out.
    await expect(dialog.getByText('vps.example.com can’t download althar-host.', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Send it from here', exact: true })).toBeVisible()
    await expect(dialog.getByText('Get althar-host', { exact: true }).locator('xpath=ancestor::li')).toHaveAttribute('data-state', 'failed')
    await shoot(page, '10-trouble')
    rmSync(join(state, 'no-download'))
    await dialog.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(dialog.getByText(/^Downloading · 17 of 40 MB$/)).toBeVisible()

    // Stopped when asked: what it did stays, and it picks up from there.
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(dialog.getByText('Setting up vps.example.com stopped partway', { exact: false })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
    await shoot(page, '11-stopped')
    rmSync(join(state, 'hold-get'))
    await dialog.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(dialog.getByText(/althar-host 0\.14\.2 is running on vps\.example\.com/)).toBeVisible()
    await expect(dialog.getByLabel(homeId, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(() => existsSync(join(home, 'profile', 'home-setup.json'))).toBe(false)
  } finally {
    await closing(electronApp, home)
  }
})
