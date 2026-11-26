import { mkdirSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { configureWorkers, withWorkerStore, workerCertificate } from '@althar/runtime/workerHome'
import { apiClient, openLocalConnection, readLocalEndpoint } from '@althar/transport-node'
import { expect, type Page, test } from '@playwright/test'
import { Effect } from 'effect'

import { testAgentWorker } from '../../../packages/worker-protocol/integration/worker-agent-client'
import { workerCertificates } from '../../../packages/worker-protocol/integration/worker-certificates'
import { repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow, still } from './support'

/*
 * Settings › Computers in the built app, on a home that takes no workers yet: the home with its live readings and
 * its agents, opened out to its Agents at once, and Add a worker: an SSH address, or a one-time code and its line.
 * Then a home that takes them, with a worker enrolled and connected as `althar workers` and the protocol do: in the
 * load popover, opened in Computers, offline, and removed for good. Each shot is kept in test-results/computers.
 */

const THIS = process.platform === 'darwin' ? 'This Mac' : process.platform === 'win32' ? 'This PC' : 'This computer'

const RELEASE = 'https://releases.althar.invalid/host-v0.2.0'

const shoot = async (page: Page, name: string) => {
  await still(page)
  await page.screenshot({ path: `test-results/computers/${name}.png`, scale: 'css', animations: 'disabled' })
}

test('lists the home with its readings, opens it to its Agents at once, and says what adding a worker takes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  // A release of its own, so the dialog asks nothing of GitHub: the code's line takes its files from beside its manifest.
  const { electronApp, page } = await launch(home, { ALTHAR_HOST_RELEASE_MANIFEST: `${RELEASE}/althar-host-linux-x64.json` })
  const main = page.getByRole('main')
  try {
    await sizeWindow(electronApp, page, 1180, 760)
    await openFirstProject(electronApp, page, repository(projects))
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Computers' }).click()
    await expect(main.getByRole('heading', { name: 'Computers', level: 1 })).toBeVisible()

    // The home, read as its popover reads it: CPU, memory and its agents, of the number it runs at once.
    const homeModule = main.getByRole('button', { name: new RegExp(`^${THIS}`) })
    await expect(homeModule).toContainText('Keeps your projects')
    await expect(homeModule).toContainText('CPU')
    await expect(homeModule).toContainText(/Agents\s*0 of \d+/)
    // No workers yet: the one way in is adding one.
    const add = main.getByRole('button', { name: /^Add a worker/ })
    await expect(add).toContainText('A Linux computer this home runs tasks on')

    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await shoot(page, `section-${scheme}`)
    }
    await page.emulateMedia({ colorScheme: 'light' })

    // Opened out: its readings beside what it has, and its Agents at once.
    await homeModule.click()
    await expect(main.getByRole('heading', { name: THIS })).toBeVisible()
    await expect(main.getByRole('slider', { name: 'Agents at once' })).toBeVisible()
    await shoot(page, 'home')
    await main.getByRole('button', { name: 'Computers' }).click()

    // Adding one: its SSH address, as for a home, or a one-time code for a machine without SSH.
    await main.getByRole('button', { name: /^Add a worker/ }).click()
    const dialog = page.getByRole('dialog', { name: `Add a worker to ${THIS}` })
    await expect(dialog.getByLabel('SSH address')).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Add worker' })).toBeDisabled()
    await still(page)
    await dialog.screenshot({ path: 'test-results/computers/add.png', scale: 'css', animations: 'disabled' })
    await dialog.getByRole('radio', { name: 'With a code' }).click()
    await expect(
      dialog.getByText(`curl -fsSL ${RELEASE}/althar-worker.sh | ALTHAR_RELEASE_BASE=${RELEASE} sh -s -- join 'althar-worker1.`, {
        exact: false,
      }),
    ).toBeVisible()
    await still(page)
    await dialog.screenshot({ path: 'test-results/computers/add-with-a-code.png', scale: 'css', animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})

/** A port free on this computer for the home's worker listener. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('No port'))))
    })
  })

test('shows an enrolled worker in the popover and Computers as it connects and drops, and removes it for good', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const paths = { profile: join(home, 'profile'), worktrees: join(home, 'worktrees') }
  mkdirSync(paths.profile, { mode: 0o700 })
  const tls = join(home, 'tls')
  mkdirSync(tls, { mode: 0o700 })
  const certificate = workerCertificates(tls)
  // Let the home take workers before it starts, as `althar workers configure` does.
  const port = await freePort()
  await Effect.runPromise(
    configureWorkers(paths, {
      version: 1,
      address: '127.0.0.1',
      port,
      ca: certificate('home-ca.pem'),
      certificate: certificate('home.pem'),
      key: certificate('home.key'),
    }),
  )
  // Its private API socket on, as `althar workers enroll` reaches it.
  const { electronApp, page } = await launch(home, { ALTHAR_API_SOCKET: '1' })
  const main = page.getByRole('main')
  const workers: Array<{ close: () => void }> = []
  try {
    await sizeWindow(electronApp, page, 1180, 760)
    await openFirstProject(electronApp, page, repository(projects))

    // Enroll its certificate for the project, as `althar workers enroll` does, on the running home.
    const { homeId, projectId } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const endpoint = yield* readLocalEndpoint(paths.profile)
          const { api } = yield* apiClient(yield* openLocalConnection(paths.profile, endpoint.homeId))
          const [project] = (yield* api.ListProjects()).projects
          if (project === undefined) return yield* Effect.die('The project should be made')
          return { homeId: endpoint.homeId, projectId: project.id }
        }),
      ),
    )
    const workerId = await Effect.runPromise(
      withWorkerStore(paths.profile, homeId, async (store) =>
        store.enroll(await workerCertificate(certificate('enrolled.pem')), projectId),
      ),
    )
    const name = `Linux worker ${workerId.slice(-6)}`
    const hello: Parameters<ReturnType<typeof testAgentWorker>['hello']>[0] = {
      $typeName: 'althar.worker.v1.AgentWorkerHello',
      anyProject: false,
      reportsSignIn: false,
      signedIn: [],
      release: '',
      reserveBeforeTransfer: false,
      version: 1,
      workerId,
      journalId: `wjn_${'3'.repeat(32)}`,
      capabilities: [
        {
          $typeName: 'althar.worker.v1.AgentWorkerCapability',
          projectId,
          providerId: 'codex',
          workspaceSetup: false,
          managedCommands: false,
          managedPreview: false,
          workspaceSets: false,
          helperAgents: false,
          skillFiles: false,
          helperSkillFiles: false,
          helperCheckouts: false,
          fileReads: false,
          workspaceIndex: false,
        },
      ],
    }
    const connect = () => {
      const worker = testAgentWorker(port, certificate, 'enrolled', 120_000)
      workers.push(worker)
      return worker
    }

    // It connects: the load popover lists it among what runs on this home, free.
    const worker = connect()
    expect((await worker.hello(hello))?.case).toBe('hello')
    const meter = page.getByRole('button', { name: /^CPU \d+%, MEM \d+%$/ })
    await meter.click()
    const load = page.getByRole('dialog', { name: /’s load$/ })
    const row = load.getByRole('button', { name: new RegExp(`^${name}`) })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Free')
    await shoot(page, 'worker-popover')

    // Its row opens it in Settings › Computers: free, with the agent it said it has.
    await row.click()
    await expect(main.getByRole('heading', { name })).toBeVisible()
    await expect(main).toContainText('Free')
    await expect(main).toContainText('Codex')
    await shoot(page, 'worker')

    // It drops: Offline, on the next reading.
    worker.close()
    await expect(main).toContainText('Offline')
    await expect(main).toContainText('Not connected to this home')

    // Removed: off the list, after a reload too, and its certificate refused.
    await main.getByRole('button', { name: `Remove ${name}` }).click()
    const confirm = page.getByRole('dialog', { name: `Remove ${name}?` })
    await confirm.getByRole('button', { name: 'Remove' }).click()
    await expect(main.getByRole('heading', { name: 'Computers', level: 1 })).toBeVisible()
    await expect(main.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveCount(0)
    await page.reload()
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Computers' }).click()
    await expect(main.getByRole('heading', { name: 'Computers', level: 1 })).toBeVisible()
    await expect(main.getByRole('button', { name: /^Add a worker/ })).toBeVisible()
    await expect(main.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveCount(0)
    const refused = await connect()
      .hello(hello)
      .then(
        (frame) => frame?.case,
        () => 'refused',
      )
    expect(refused).not.toBe('hello')
  } finally {
    for (const worker of workers) worker.close()
    await electronApp.close()
  }
})
