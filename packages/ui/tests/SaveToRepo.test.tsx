import { fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { isFolderName, SaveToRepo, type SaveToRepoProps } from '../src/thread/Canvas/SaveToRepo'

/*
 * Saving an artifact to a repository (ADR-104): the project's one place, its
 * folder named in place; Althar's pick on the first save, which makes it the
 * place; the tree for somewhere else; and, saved, where it is, to move it,
 * commit its newest version or stop saving it.
 */

const KILN = { repositoryId: 'repo_kiln', repository: 'kiln' }
const FOLDERS = ['apps/', 'apps/web/', 'design/', 'design/calmer-checkout/', 'docs/']

const props = (over: Partial<SaveToRepoProps> = {}): SaveToRepoProps => ({
  title: 'Gift a class',
  name: 'gift-a-class',
  version: 3,
  repositories: [
    { id: 'repo_kiln', name: 'kiln' },
    { id: 'repo_design', name: 'kiln-design' },
  ],
  place: { ...KILN, folder: 'design/', why: null },
  first: false,
  rule: 'A pull request of its own, a commit each version',
  saved: null,
  folders: FOLDERS,
  onRepository: vi.fn(),
  onSave: vi.fn(),
  onStop: vi.fn(),
  onSettings: vi.fn(),
  ...over,
})

describe('Save to repo', () => {
  it('opens on the project’s place with the folder named in place, and saves there', async () => {
    const given = props()
    render(<SaveToRepo {...given} />)
    expect(screen.getByText('Save Gift a class to kiln')).toBeInTheDocument()
    expect(screen.getByText('The project’s place for artifacts')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(given.onSettings).toHaveBeenCalled()
    const name = screen.getByRole('textbox', { name: 'Its folder’s name' })
    fireEvent.change(name, { target: { value: 'gift' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save to kiln' }))
    expect(given.onSave).toHaveBeenCalledWith({ repositoryId: 'repo_kiln', path: 'design/gift/', makeHome: false })
    fireEvent.change(name, { target: { value: '../up' } })
    expect(screen.getByRole('button', { name: 'Save to kiln' })).toBeDisabled()
  })

  it('on the project’s first save, is Althar’s pick with why, and makes it the place', async () => {
    const given = props({ first: true, place: { ...KILN, folder: 'design/', why: 'Where kiln keeps its designs' } })
    render(<SaveToRepo {...given} />)
    expect(screen.getByText('Althar’s pick: where kiln keeps its designs')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Save to kiln' }))
    expect(given.onSave).toHaveBeenCalledWith({ repositoryId: 'repo_kiln', path: 'design/gift-a-class/', makeHome: true })
  })

  it('puts it somewhere else from the tree, the place only where asked, and comes back where it was', async () => {
    const given = props()
    render(<SaveToRepo {...given} />)
    await userEvent.click(screen.getByRole('button', { name: 'Somewhere else' }))
    const tree = screen.getByRole('tree', { name: 'Folders in kiln' })
    await userEvent.click(within(tree).getByRole('treeitem', { name: 'docs' }))
    expect(screen.getByRole('switch')).not.toBeChecked()
    await userEvent.click(screen.getByRole('switch'))
    // A folder found by its words, and nothing for words no folder has.
    await userEvent.type(screen.getByRole('textbox', { name: 'Find a folder' }), 'calmer')
    expect(within(tree).getByRole('treeitem', { name: 'calmer-checkout' })).toBeInTheDocument()
    expect(within(tree).queryByRole('treeitem', { name: 'apps' })).toBeNull()
    await userEvent.clear(screen.getByRole('textbox', { name: 'Find a folder' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find a folder' }), 'zzz')
    expect(within(tree).getByText('No folder has those words.')).toBeInTheDocument()
    await userEvent.clear(screen.getByRole('textbox', { name: 'Find a folder' }))
    // A folder opened and closed by its twist.
    await userEvent.click(within(tree).getByRole('button', { name: 'Open apps' }))
    expect(within(tree).getByRole('treeitem', { name: 'web' })).toBeInTheDocument()
    await userEvent.click(within(tree).getByRole('button', { name: 'Close apps' }))
    expect(within(tree).queryByRole('treeitem', { name: 'web' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save to kiln' }))
    expect(given.onSave).toHaveBeenCalledWith({ repositoryId: 'repo_kiln', path: 'docs/gift-a-class/', makeHome: true })

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('The project’s place for artifacts')).toBeInTheDocument()
  })

  it('reads another repository’s folders in the tree, and says so while it does', async () => {
    const given = props({ folders: null })
    render(<SaveToRepo {...given} />)
    await userEvent.click(screen.getByRole('button', { name: 'Somewhere else' }))
    expect(screen.getByText('Reading its folders…')).toBeInTheDocument()
    expect(screen.getByRole('tree')).toHaveAttribute('aria-busy', 'true')
  })

  it('saved, says where, commits a newer version, moves it, and stops saving it', async () => {
    const saved = {
      ...KILN,
      path: 'design/gift-a-class/',
      version: 2,
      commit: 'abc1234def',
      pullRequest: { number: 12, url: 'https://github.com/kiln/kiln/pull/12' },
      state: 'saved' as const,
      problem: null,
    }
    const given = props({ saved })
    render(<SaveToRepo {...given} />)
    expect(screen.getByText('Gift a class in git')).toBeInTheDocument()
    expect(screen.getByText(/v2 in kiln at abc1234/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '#12' })).toHaveAttribute('href', 'https://github.com/kiln/kiln/pull/12')
    expect(screen.getByText('In git')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Commit v3' }))
    expect(given.onSave).toHaveBeenLastCalledWith({ repositoryId: 'repo_kiln', path: 'design/gift-a-class/', makeHome: false })

    fireEvent.change(screen.getByRole('textbox', { name: 'Its folder’s name' }), { target: { value: 'gift' } })
    expect(screen.getByText('Moves here')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Move it' }))
    expect(given.onSave).toHaveBeenLastCalledWith({ repositoryId: 'repo_kiln', path: 'design/gift/', makeHome: false })

    await userEvent.click(screen.getByRole('button', { name: 'Stop saving' }))
    expect(given.onStop).toHaveBeenCalled()
  })

  it('says what went wrong with the last save, and tries again; while saving, waits', async () => {
    const failed = {
      ...KILN,
      path: 'design/gift-a-class/',
      version: null,
      commit: null,
      pullRequest: null,
      state: 'failed' as const,
      problem: 'Couldn’t push to kiln: sign in to GitHub again.',
    }
    const given = props({ saved: failed })
    const { rerender } = render(<SaveToRepo {...given} />)
    expect(screen.getByText('Couldn’t push to kiln: sign in to GitHub again.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(given.onSave).toHaveBeenCalledWith({ repositoryId: 'repo_kiln', path: 'design/gift-a-class/', makeHome: false })
    rerender(<SaveToRepo {...given} saved={{ ...failed, state: 'saving', problem: null }} />)
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()
  })

  it('takes a folder name every OS can make', () => {
    for (const good of ['gift-a-class', 'v2.1', 'A_b']) expect(isFolderName(good)).toBe(true)
    for (const bad of ['', '..', 'a/b', 'what?', 'x'.repeat(81)]) expect(isFolderName(bad)).toBe(false)
  })
})
