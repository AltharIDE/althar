import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { foldersToDrop, partsOf } from '../src/lib/shortPath'
import { FileChanges } from '../src/primitives/FileChanges/FileChanges'
import { Path } from '../src/primitives/Path/Path'

/*
 * A path shortens by whole folders from its start. jsdom has no layout, so
 * each character is drawn 7px wide, as a monospace font would, the room is
 * said by hand, and the observer is driven by hand.
 */

const CHAR = 7
const widthOf = (text: string) => text.length * CHAR

describe('partsOf', () => {
  it('splits a path in its folders and its end', () => {
    expect(partsOf('packages/runtime/src/Coordinator.ts')).toEqual({ folders: ['packages/', 'runtime/', 'src/'], end: 'Coordinator.ts' })
    expect(partsOf('README.md')).toEqual({ folders: [], end: 'README.md' })
  })

  it('ends a folder with its last folder, with its slash or not', () => {
    expect(partsOf('packages/runtime/')).toEqual({ folders: ['packages/'], end: 'runtime/' })
    expect(partsOf('packages/runtime')).toEqual({ folders: ['packages/'], end: 'runtime' })
  })
})

describe('foldersToDrop', () => {
  const folders = [9, 8, 4]
  it('drops none where it all fits', () => {
    expect(foldersToDrop(folders, 10, 2, 31)).toBe(0)
  })
  it('drops the fewest folders from the start that make room for the "…/"', () => {
    expect(foldersToDrop(folders, 10, 2, 30)).toBe(1)
    expect(foldersToDrop(folders, 10, 2, 16)).toBe(2)
    expect(foldersToDrop(folders, 10, 2, 12)).toBe(3)
  })
  it('keeps the end whole, with its "…/", however narrow the room', () => {
    expect(foldersToDrop(folders, 10, 2, 3)).toBe(3)
    expect(foldersToDrop([], 10, 2, 3)).toBe(0)
  })
})

describe('Path', () => {
  let notify: () => void = () => {}
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /** Draws every folder, the "…/" and the end as monospace text, in a room of the given width. */
  const draw = (room: { width: number }) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(fn: () => void) {
          notify = fn
        }
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isRoom = this.hasAttribute('title')
      return { width: isRoom ? room.width : widthOf(this.dataset.text ?? '') } as DOMRect
    })
  }

  const shown = (container: HTMLElement) => container.querySelector('[class*="shown"]')!.textContent

  it('shows the whole path where it fits', () => {
    draw({ width: 400 })
    const { container } = render(<Path path="packages/runtime/tests/coordinatorTools.test.ts" />)
    expect(shown(container)).toBe('packages/runtime/tests/coordinatorTools.test.ts')
  })

  it('drops whole leading folders, never part of a name', () => {
    const path = 'packages/runtime/tests/coordinatorTools.test.ts'
    const room = { width: widthOf(path) - 1 }
    draw(room)
    const { container } = render(<Path path={path} />)
    // The 2 folders "packages/runtime/" make room for the "…/", where the mid-name cut was "…ts/coordinatorTools.test.ts".
    expect(shown(container)).toBe('…/runtime/tests/coordinatorTools.test.ts')
    room.width = widthOf('…/tests/coordinatorTools.test.ts')
    act(() => notify())
    expect(shown(container)).toBe('…/tests/coordinatorTools.test.ts')
    room.width = widthOf('…/tests/coordinatorTools.test.ts') - 1
    act(() => notify())
    expect(shown(container)).toBe('…/coordinatorTools.test.ts')
  })

  it('takes folders back as the room grows', () => {
    const room = { width: 60 }
    draw(room)
    const { container } = render(<Path path="packages/runtime/src/Coordinator.ts" />)
    expect(shown(container)).toBe('…/Coordinator.ts')
    room.width = 400
    act(() => notify())
    expect(shown(container)).toBe('packages/runtime/src/Coordinator.ts')
  })

  it('keeps the end, with its "…/", where the room is narrower than it', () => {
    draw({ width: 20 })
    const { container } = render(<Path path="packages/runtime/src/Coordinator.ts" />)
    expect(shown(container)).toBe('…/Coordinator.ts')
  })

  it('shortens a folder at its folders, the last kept', () => {
    draw({ width: widthOf('…/runtime/src') })
    const { container } = render(<Path path="packages/runtime/src" />)
    expect(shown(container)).toBe('…/runtime/src')
  })

  it('has nothing to give way where it has no folders', () => {
    draw({ width: 20 })
    const { container } = render(<Path path="README.md" />)
    expect(shown(container)).toBe('README.md')
  })

  it('says the whole path on hover', () => {
    draw({ width: 20 })
    const { container } = render(<Path path="packages/runtime/src/Coordinator.ts" />)
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe('packages/runtime/src/Coordinator.ts')
  })

  it('is what a changed file shows, as on a narrow task card', () => {
    draw({ width: widthOf('…/tests/coordinatorTools.test.ts') })
    const { container } = render(
      <FileChanges
        files={[
          { path: 'packages/runtime/src/Coordinator.ts', add: 25, del: 7 },
          { path: 'packages/runtime/tests/coordinatorTools.test.ts', add: 45, del: 0 },
        ]}
      />,
    )
    expect([...container.querySelectorAll('[class*="shown"]')].map((one) => one.textContent)).toEqual([
      '…/runtime/src/Coordinator.ts',
      '…/tests/coordinatorTools.test.ts',
    ])
  })
})
