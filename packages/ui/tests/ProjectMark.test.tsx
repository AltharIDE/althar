import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { composition, ProjectInk, projectInk } from '../src/foundations/ProjectMark/drawing'
import { ProjectMark } from '../src/foundations/ProjectMark/ProjectMark'

const seeds = Array.from({ length: 400 }, (_, i) => `project-${i}`)

describe('composition', () => {
  it('draws the same four cells for the same seed', () => {
    expect(composition('meridian')).toEqual(composition('meridian'))
    expect(composition('meridian')).toHaveLength(4)
  })

  it('draws different marks for different seeds', () => {
    const drawn = new Set(seeds.map((seed) => JSON.stringify(composition(seed))))
    expect(drawn.size).toBeGreaterThan(seeds.length * 0.95)
  })

  it('never draws more than one square or more than one paper cell', () => {
    for (const seed of seeds) {
      const cells = composition(seed)
      expect(cells.filter((c) => c.shape === 'square').length).toBeLessThanOrEqual(1)
      expect(cells.filter((c) => c.fill === 'paper').length).toBeLessThanOrEqual(1)
    }
  })

  it('turns each cell a whole number of quarters', () => {
    for (const seed of seeds) for (const cell of composition(seed)) expect([0, 1, 2, 3]).toContain(cell.turn)
  })
})

describe('projectInk', () => {
  it('gives the same seed the same ink', () => {
    expect(projectInk('meridian')).toBe(projectInk('meridian'))
  })

  it('spreads seeds evenly over the inks', () => {
    const inks = Object.values(ProjectInk)
    const counts = new Map(inks.map((ink) => [ink, 0]))
    for (const seed of seeds) counts.set(projectInk(seed), (counts.get(projectInk(seed)) ?? 0) + 1)
    const even = seeds.length / inks.length
    for (const ink of inks) expect(counts.get(ink)).toBeGreaterThan(even * 0.6)
    for (const ink of inks) expect(counts.get(ink)).toBeLessThan(even * 1.4)
  })

  it('passes over inks already taken while one is free, so projects side by side differ', () => {
    const own = projectInk('meridian')
    expect(projectInk('meridian', [own])).not.toBe(own)
    const allBut = Object.values(ProjectInk).filter((ink) => ink !== ProjectInk.Rose)
    expect(projectInk('meridian', allBut)).toBe(ProjectInk.Rose)
    expect(projectInk('meridian', Object.values(ProjectInk))).toBe(own)
  })
})

describe('ProjectMark', () => {
  it('is decoration, at the size it is given, with its four cells', () => {
    const { container } = render(<ProjectMark seed="meridian" ink={ProjectInk.Teal} size={18} data-testid="mark" />)
    const mark = container.firstElementChild
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark).toHaveAttribute('data-testid', 'mark')
    const tile = container.querySelector('svg')
    expect(tile).toHaveAttribute('width', '18')
    expect(tile?.querySelectorAll('g[transform]')).toHaveLength(4)
  })

  it('clips each mark to its own corner, so two on a page do not share one', () => {
    const { container } = render(
      <>
        <ProjectMark seed="a" ink={ProjectInk.Clay} />
        <ProjectMark seed="b" ink={ProjectInk.Moss} />
      </>,
    )
    const ids = [...container.querySelectorAll('clipPath')].map((c) => c.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('draws the arc only while work runs, and the dot only while something waits on you', () => {
    const rest = render(<ProjectMark seed="meridian" ink={ProjectInk.Teal} />)
    expect(rest.container.querySelectorAll('svg')).toHaveLength(1)
    expect(rest.container.querySelectorAll('span span')).toHaveLength(0)

    const both = render(<ProjectMark seed="meridian" ink={ProjectInk.Teal} running yours />)
    expect(both.container.querySelectorAll('svg')).toHaveLength(2)
    expect(both.container.querySelector('rect[pathLength="100"]')).not.toBeNull()
    expect(both.container.querySelectorAll('span span')).toHaveLength(1)
  })

  it('rounds its corners more when it is small', () => {
    const corner = (size: number) =>
      render(<ProjectMark seed="x" ink={ProjectInk.Slate} size={size} />)
        .container.querySelector('clipPath rect')
        ?.getAttribute('rx')
    expect(corner(40)).toBe('10')
    expect(corner(24)).toBe('8.5')
    expect(corner(15)).toBe('7.5')
  })
})
