/* Writes the pack to export/. Run after changing anything that draws it:
     bun run export                         everything but the screenshots
     bun run export:banners [name ...]      just the banners, or just those named
   The banners and screenshots need a browser; the rest is drawn from the code in src/. */

import { copyFile, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { catalog } from '../src/catalog'
import { ico } from '../src/ico'
import { EXPORT, png, rasterise, write, writeAll } from '../src/files'

const only = process.argv[2]
const repo = resolve(import.meta.dirname, '../..')

/* What each run writes it clears first, so a file that is renamed or dropped doesn't stay behind. Screenshots are never cleared here. */
const clear = (...folders: string[]): Promise<void[]> =>
  Promise.all(folders.map((f) => rm(resolve(EXPORT, f), { recursive: true, force: true })))

if (only === undefined || only === 'drawings') {
  await clear('mark', 'lockup', 'avatar', 'emoji', 'web', 'palette', 'app-icon')
  const { files, rasters } = await catalog()
  await writeAll(files)
  await rasterise(rasters, files)

  /* favicon.ico wraps the 32px favicon */
  const favicon = files.find((f) => f.file === 'web/favicon.svg')
  if (!favicon) throw new Error('no favicon drawn')
  await write('web/favicon.ico', ico(await png(favicon.content, 32), 32))

  /* The app icons are the desktop app's: copied, never redrawn, so the pack can't differ from the Dock. */
  const icons = resolve(repo, 'apps/desktop/resources')
  for (const name of ['cobalt', 'cobalt-dark', 'paper', 'ink', 'solid', 'solid-dark']) {
    const svg = await readFile(resolve(icons, `icons/${name}.svg`), 'utf8')
    await write(`app-icon/${name}.svg`, svg)
    await write(`app-icon/${name}-1024.png`, await png(svg, 1024))
  }
  await copyFile(resolve(icons, 'icon.icns'), resolve(EXPORT, 'app-icon/althar.icns'))
}

if (only === undefined || only === 'banners') {
  const names = process.argv.slice(3)
  if (names.length === 0)
    await clear('banner', 'avatar/avatar-printed-1024.png', 'avatar/avatar-printed-400.png', 'avatar/avatar-printed-128.png')
  const { exportBanners } = await import('./banners')
  await exportBanners(names)
}

console.warn('export: done')
