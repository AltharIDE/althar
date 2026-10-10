import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { _electron as electron, expect, test } from '@playwright/test'

import { mainWindow } from './support'

test('finds the main renderer when a hidden menu opens first', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-windows-'))
  const renderer = join(home, 'renderer')
  mkdirSync(renderer)
  writeFileSync(join(renderer, 'edge.html'), '<h1>Menu</h1>')
  writeFileSync(join(renderer, 'index.html'), '<h1>Main window</h1>')
  const entry = join(home, 'main.cjs')
  writeFileSync(
    entry,
    `const { app, BrowserWindow } = require('electron')
app.setPath('userData', ${JSON.stringify(join(home, 'profile'))})
app.whenReady().then(() => {
  const menu = new BrowserWindow({ show: false })
  menu.loadFile(${JSON.stringify(join(renderer, 'edge.html'))})
})`,
  )
  const electronApp = await electron.launch({ args: [entry] })
  try {
    const first = await electronApp.firstWindow()
    await expect(first).toHaveURL(pathToFileURL(join(renderer, 'edge.html')).href)
    // Start waiting with only the auxiliary window present, then open the main window.
    const pending = mainWindow(electronApp)
    await electronApp.evaluate(
      ({ BrowserWindow }, path) => {
        const main = new BrowserWindow({ show: false })
        void main.loadFile(path, { hash: '/home' })
      },
      join(renderer, 'index.html'),
    )
    const page = await pending
    await expect(page.getByRole('heading', { name: 'Main window' })).toHaveCount(1)
    expect(await mainWindow(electronApp)).toBe(page)
  } finally {
    await electronApp.close()
    rmSync(home, { recursive: true, force: true })
  }
})
