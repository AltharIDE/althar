import { mkdirSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { completeDevicePairing, createDeviceKey, decodePairingCode } from '@althar/transport-node'
import { expect, type Page, test } from '@playwright/test'
import { Effect } from 'effect'

import { repository } from '../tests/repository'
import { launch, openFirstProject, still } from './support'

/*
 * Pairing a phone with This Mac in the built app, as a phone does it over the
 * network: Pair a phone… from the homes menu, Let phones in, and the code it
 * shows, read back from its link (as a phone's camera hands it to the app),
 * pairs a device over HTTPS with This Mac's own certificate. The dialog hears
 * it, lists it, and Remove takes it off. Each step is shot into
 * test-results/phones, light and dark.
 */

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (address === null || typeof address === 'string' ? reject(new Error('No port')) : resolve(address.port)))
    })
  })

const shoot = async (page: Page, name: string) => {
  await still(page)
  await page.screenshot({ path: `test-results/phones/${name}.png`, scale: 'css' })
}

test('pairs a phone with This Mac from the homes menu, over HTTPS, and takes it off', async () => {
  mkdirSync('test-results/phones', { recursive: true })
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const port = await freePort()
  const { electronApp, page } = await launch(home, { ALTHAR_PHONE_HOST: 'localhost', ALTHAR_PHONE_PORT: String(port) })
  try {
    await openFirstProject(electronApp, page, repository(home))
    const openPairing = async () => {
      await page.getByRole('button', { name: 'Homes', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Pair a phone…', exact: true }).click()
      return page.getByRole('dialog', { name: 'Pair a phone with This Mac' })
    }
    let dialog = await openPairing()
    await expect(dialog.getByText('Let phones in to This Mac')).toBeVisible()
    await shoot(page, '1-closed')
    await dialog.getByRole('button', { name: 'Let phones in' }).click()
    await expect(dialog.getByText('Scan it with your phone’s camera')).toBeVisible()
    await expect(dialog.getByText(`Phones reach it at localhost.`)).toBeVisible()
    await shoot(page, '2-code')
    await page.emulateMedia({ colorScheme: 'dark' })
    await shoot(page, '2-code-dark')
    await page.emulateMedia({ colorScheme: 'light' })

    // The phone: the link its camera read, back into the code, then pairing with the Mac's listener, pinned to its certificate.
    const shown = await dialog.getByText(/^althar-pairing1\./).textContent()
    const link = `https://althar.ai/pair#${(shown ?? '').slice('althar-pairing'.length)}`
    const code = decodePairingCode(link)
    expect(code.origin).toBe(`https://localhost:${port}`)
    await Effect.runPromise(Effect.scoped(Effect.flatMap(createDeviceKey, (key) => completeDevicePairing(code, key, 'iPhone'))))

    await expect(dialog.getByText('iPhone is paired')).toBeVisible()
    await expect(dialog.getByText('Paired just now')).toBeVisible()
    await shoot(page, '3-paired')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    // Again: a new code at once, the phone listed under it, and Remove takes it off.
    dialog = await openPairing()
    await expect(dialog.getByText('Scan it with your phone’s camera')).toBeVisible()
    await expect(dialog.getByText('Paired with a code')).toBeVisible()
    await dialog.getByText('iPhone', { exact: true }).hover()
    await dialog.getByRole('button', { name: 'Remove' }).click()
    const asking = page.getByRole('dialog', { name: 'Remove iPhone?' })
    await shoot(page, '4-remove')
    await asking.getByRole('button', { name: 'Remove' }).click()
    await expect(dialog.getByText('Paired with a code')).toBeHidden()
  } finally {
    await electronApp.close()
  }
})
