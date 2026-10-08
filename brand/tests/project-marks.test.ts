import { ProjectInk, composition } from '@althar/ui/project-mark'
import { describe, expect, it } from 'vitest'

import { INKS, INK_HEX, SAMPLES, mix, projectMarkBody, projectMarkSvg, sampleMarks, sampleSheet } from '../src/project-marks'

describe('colour mixing', () => {
  it('mixes as CSS does in sRGB', () => {
    expect(mix('#ffffff', 0.5, '#000000')).toBe('#808080')
    expect(mix('#ff0000', 1, '#0000ff')).toBe('#ff0000')
    expect(mix('#ff0000', 0, '#0000ff')).toBe('#0000ff')
    expect(mix('#000000', 0.22, '#ffffff')).toBe('#c7c7c7')
  })
})

describe('project marks', () => {
  it('draw the same mark for the same name, as the app does', () => {
    expect(projectMarkSvg('althar', ProjectInk.Teal)).toBe(projectMarkSvg('althar', ProjectInk.Teal))
    expect(projectMarkSvg('althar', ProjectInk.Teal)).not.toBe(projectMarkSvg('ledger', ProjectInk.Teal))
  })

  it('draw four cells, whatever shapes they are', () => {
    for (const seed of SAMPLES) {
      const body = projectMarkBody(seed, ProjectInk.Clay, 'x')
      const cells = composition(seed)
      expect(cells).toHaveLength(4)
      expect(body.match(/<g fill=/g)).toHaveLength(4)
    }
  })

  it('give every ink a colour', () => {
    expect(Object.keys(INK_HEX).sort()).toEqual([...INKS].sort())
  })

  it("choose the app's own ink for a name with no say", () => {
    expect(projectMarkSvg('althar')).toContain('aria-label="althar"')
  })

  it('use all eight inks before any repeats, in a sheet of samples', () => {
    const first = sampleMarks().slice(0, INKS.length)
    expect(new Set(first.map((m) => m.ink)).size).toBe(INKS.length)
    expect(sampleMarks()).toHaveLength(SAMPLES.length)
  })

  it('gather the samples on one sheet, each clipped on its own', () => {
    const sheet = sampleSheet()
    expect(sheet.match(/<clipPath/g)).toHaveLength(SAMPLES.length)
    expect(new Set(sheet.match(/clipPath id="m\d+"/g)).size).toBe(SAMPLES.length)
  })
})
