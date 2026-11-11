/* Folds the standalone build (../../../dist/proto) into one page: its stylesheet and its script inline, as an artifact takes them. */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const out = resolve(import.meta.dirname, '../../../dist/proto')
const assets = resolve(out, 'assets')
const files = await readdir(assets)
const wallpapers = resolve(import.meta.dirname, '../../../../../brand/export/wallpaper')
let css = await readFile(
  resolve(
    assets,
    files.find((f) => f.endsWith('.css'))!,
  ),
  'utf8',
)
// The Mac's desktop asks for the brand pack's wallpaper by its path on the site: carry it in.
for (const name of new Set(css.match(/aurora-[a-z-]+\.jpg/g) ?? [])) {
  const data = (await readFile(resolve(wallpapers, name))).toString('base64')
  css = css.replaceAll(`/wallpaper/${name}`, `data:image/jpeg;base64,${data}`)
}
const js = (
  await readFile(
    resolve(
      assets,
      files.find((f) => f.endsWith('.js'))!,
    ),
    'utf8',
  )
)
  // Nothing in the script may end it early, or open an HTML comment inside it.
  .replace(/<\/script/gi, '<\\/script')
  .replace(/<!--/g, '<\\!--')
  // A literal replacement character reads as a lost one: written as its escape, in the strings it sits in.
  .replace(/\uFFFD/g, '\\uFFFD')
const page = [
  '<title>Homepage Directions</title>',
  '<style>:root { color-scheme: dark; } body { background: #070605; }</style>',
  `<style>${css}</style>`,
  '<div id="app"></div>',
  `<script type="module">${js}</script>`,
].join('\n')
await writeFile(resolve(out, 'homepage-directions.html'), page)
console.warn(`proto: ${(page.length / 1024 / 1024).toFixed(1)} MB in ${resolve(out, 'homepage-directions.html')}`)
