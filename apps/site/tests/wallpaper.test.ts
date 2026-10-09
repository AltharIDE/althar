import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { WALLPAPER, wallpaperFile, wallpaperPreview } from '../src/content/wallpaper'

/*
 * The page links files the brand pack draws (brand/export/wallpaper), and its
 * link preview is the pack's card. Renaming one there, or adding a screen
 * here, breaks a download or the card silently.
 */
const brand = (path: string) => resolve(import.meta.dirname, '../../../brand/export', path)

describe('the wallpaper page', () => {
  it('links only files the brand pack has', () => {
    for (const t of WALLPAPER.themes) {
      const paths = [
        ...WALLPAPER.screens.map((s) => wallpaperFile(t.key, s.key)),
        wallpaperPreview(t.key, 'mac'),
        wallpaperPreview(t.key, 'phone'),
      ]
      for (const path of paths) expect(existsSync(brand(path.slice(1))), path).toBe(true)
    }
  })

  it("has the brand pack's card as its link preview: after drawing the wallpapers, copy aurora-card.png to public/og/wallpaper.png", () => {
    const copy = readFileSync(resolve(import.meta.dirname, '../public/og/wallpaper.png'))
    expect(copy.equals(readFileSync(brand('wallpaper/aurora-card.png')))).toBe(true)
  })
})
