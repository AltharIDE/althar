const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const file = process.env.ALTHAR_FIXTURE_FILE
const kind = process.env.ALTHAR_FIXTURE_KIND
const title = `Computer ${kind} fixture`
const path = kind === 'Writer' ? 'writer.html' : 'reader.html'

const profile = join(dirname(file), kind)
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.commandLine.appendSwitch('force-renderer-accessibility')
ipcMain.handle('fixture:export', (_event, note) => writeFileSync(file, note, 'utf8'))
ipcMain.handle('fixture:import', () => readFileSync(file, 'utf8'))

void app.whenReady().then(() => {
  app.setAccessibilitySupportEnabled(true)
  const window = new BrowserWindow({
    title,
    width: 450,
    height: 190,
    frame: false,
    x: 20,
    y: kind === 'Writer' ? 30 : 260,
    webPreferences: { preload: join(__dirname, 'preload.cjs') },
  })
  void window.loadFile(join(__dirname, path))
})

app.on('window-all-closed', () => app.quit())
