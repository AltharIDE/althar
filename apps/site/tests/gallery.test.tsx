import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { SCREENS } from '../src/home/bodies/desktop/screens/list'
import SIZES from '../src/home/bodies/desktop/screens/sizes.json'
import { Story } from '../src/home/story/Story'

const screens = resolve(import.meta.dirname, '../src/home/bodies/desktop/screens')
const brand = resolve(import.meta.dirname, '../../../brand/export/screenshots')

describe('the gallery', () => {
  it('has each screen’s pictures, made from the brand pack’s screenshot of it (bun run screens)', () => {
    for (const { file } of SCREENS) {
      expect(existsSync(resolve(brand, `framed/${file}.jpg`)), file).toBe(true)
      expect(existsSync(resolve(brand, `${file}.png`)), file).toBe(true)
      for (const made of ['460h', '920h', 'whole-1x', 'whole-2x'])
        expect(existsSync(resolve(screens, `${file}-${made}.webp`)), `${file}-${made}`).toBe(true)
      expect(SIZES).toHaveProperty(file)
    }
    expect(Object.keys(SIZES)).toEqual(SCREENS.map((screen) => screen.file))
  })

  it('shows every screen in the home page’s row, named, with its line and what it shows', () => {
    const html = renderToString(<Story />)
    for (const screen of SCREENS) {
      expect(html).toContain(`<b>${screen.name}</b>`)
      expect(html).toContain(screen.line)
      expect(html).toContain(`alt="${screen.alt}"`)
      expect(html).toMatch(new RegExp(`${screen.file}-920h[^"]*\\.webp`))
    }
  })
})
