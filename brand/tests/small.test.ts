import { describe, expect, it } from 'vitest'

import { BANNERS } from '../src/banners'
import { NEEDS_YOU, RUNNING, dotSvg, tileSvg } from '../src/emoji'
import { ico } from '../src/ico'
import { COBALT, VIOLET } from '../src/palette'
import { SCREENSHOTS, storyUrl } from '../src/screenshots'

describe('the emoji', () => {
  it('draw cobalt for running and violet for needs you, as the interface does', () => {
    expect(RUNNING).toContain(COBALT)
    expect(NEEDS_YOU).toContain(VIOLET)
    expect(dotSvg('#123456', 'Name')).toContain('aria-label="Name"')
  })

  it('draws the mark on its cobalt tile with the bore open', () => {
    const tile = tileSvg()
    expect(tile).toContain(`fill="${COBALT}"`)
    expect(tile).not.toContain('<circle')
  })
})

describe('the favicon', () => {
  it('is an icon file around one PNG', () => {
    const png = Buffer.from([1, 2, 3, 4])
    const out = Buffer.from(ico(png, 32))
    expect(out.readUInt16LE(2)).toBe(1)
    expect(out.readUInt16LE(4)).toBe(1)
    expect(out.readUInt8(6)).toBe(32)
    expect(out.readUInt32LE(14)).toBe(4)
    expect(out.readUInt32LE(18)).toBe(22)
    expect(out.subarray(22)).toEqual(png)
  })

  it('writes 256 as 0, as the format says', () => {
    expect(Buffer.from(ico(Buffer.alloc(1), 256)).readUInt8(6)).toBe(0)
  })
})

describe('the banner and screenshot lists', () => {
  it('name each once', () => {
    expect(new Set(BANNERS.map((b) => b.file)).size).toBe(BANNERS.length)
    expect(new Set(SCREENSHOTS.map((s) => s.file)).size).toBe(SCREENSHOTS.length)
  })

  it('keep the README banner at the size the README shows', () => {
    const readme = BANNERS.find((b) => b.file === 'readme-header')
    expect([readme?.width, readme?.height, readme?.layout]).toEqual([1280, 400, 'wide'])
  })

  it('point a story at a Storybook', () => {
    expect(storyUrl('http://localhost:1', 'a--b')).toBe('http://localhost:1/iframe.html?id=a--b&viewMode=story')
  })
})
