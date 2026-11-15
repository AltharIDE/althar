import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { foldersToDrop, partsOf } from '../src/lib/shortPath'
import { FileChanges } from '../src/primitives/FileChanges/FileChanges'
import { Path, visiblePath } from '../src/primitives/Path/Path'
import { PartLines } from '../src/chrome/TaskParts/TaskParts'

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

  it('parts a Windows path at its backslashes, and a mixed one at both', () => {
    expect(partsOf('C:\\Users\\alice\\project')).toEqual({ folders: ['C:\\', 'Users\\', 'alice\\'], end: 'project' })
    expect(partsOf('C:\\Users/alice\\src\\')).toEqual({ folders: ['C:\\', 'Users/', 'alice\\'], end: 'src\\' })
    expect(partsOf('\\\\server\\share\\a.ts').end).toBe('a.ts')
    expect(partsOf('packages\\ui\\a.ts')).toEqual({ folders: ['packages\\', 'ui\\'], end: 'a.ts' })
  })

  it('leaves a backslash in a name where the path is not a Windows one', () => {
    expect(partsOf('src/we\\ird.ts')).toEqual({ folders: ['src/'], end: 'we\\ird.ts' })
    expect(partsOf('we\\ird')).toEqual({ folders: ['we\\'], end: 'ird' })
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

  const shown = (container: HTMLElement) => visiblePath(container.querySelector('[title]')!)

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

  it('drops the leading folders of a Windows path, keeping the last folder, with its own mark', () => {
    const path = 'C:\\Users\\alice\\project\\packages\\ui'
    draw({ width: widthOf('…\\packages\\ui') })
    const { container } = render(<Path path={path} />)
    expect(shown(container)).toBe('…\\packages\\ui')
  })

  it('has the whole path as text, though folders gave way, so two files that shorten alike are told apart', () => {
    draw({ width: widthOf('…/Foo.ts') })
    const { getByRole } = render(
      <>
        <button type="button">
          <Path path="packages/a/Foo.ts" />
        </button>
        <button type="button">
          <Path path="packages/b/Foo.ts" />
        </button>
      </>,
    )
    expect(getByRole('button', { name: 'packages/a/Foo.ts' })).toBeTruthy()
    expect(getByRole('button', { name: 'packages/b/Foo.ts' })).toBeTruthy()
    expect(visiblePath(getByRole('button', { name: 'packages/a/Foo.ts' }).firstElementChild!)).toBe('…/Foo.ts')
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

  it('shortens a part’s file line, a binary file with nothing beside it too, and leaves its other lines as they come', () => {
    draw({ width: widthOf('…/logo.png') })
    const { container } = render(
      <PartLines
        lines={[
          ['assets/images/brand/logo.png', '', 'path'],
          ['assets/images/brand/logo.png', '+1 −0'],
          ['2 more', ''],
        ]}
      />,
    )
    // Both files, one with nothing beside it, are paths; the "2 more" is text, with no path in it to shorten.
    expect([...container.querySelectorAll('[title]')].map(visiblePath)).toEqual(['…/logo.png', '…/logo.png'])
    expect(container.textContent).toContain('2 more')
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
    expect([...container.querySelectorAll('[title]')].map(visiblePath)).toEqual([
      '…/runtime/src/Coordinator.ts',
      '…/tests/coordinatorTools.test.ts',
    ])
  })
})
