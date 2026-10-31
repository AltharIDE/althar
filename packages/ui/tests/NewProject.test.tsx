import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Brand } from '../src/foundations/brands/brands'
import { ProjectInk } from '../src/foundations/ProjectMark/drawing'
import { NewProject, type NewProjectFolder, type NewProjectProps } from '../src/screens/NewProject/NewProject'

/*
 * A new project in its tab: named, its folders added, made with ⌘↵ or left
 * with Escape.
 */

const GITHUB = { name: 'GitHub', brand: Brand.GitHub }
const FORGE = { name: 'Forgejo' }
const APP: NewProjectFolder = {
  id: 'app',
  name: 'northwind-app',
  where: '~/code/northwind/app',
  host: GITHUB,
  remote: 'northwind-co/app',
}
const OPS: NewProjectFolder = {
  id: 'ops',
  name: 'northwind-ops',
  where: '~/code/northwind/ops',
  host: FORGE,
  remote: 'northwind/ops',
}

const tab = (more: Partial<NewProjectProps> = {}) => {
  const props: NewProjectProps = {
    seed: 'proj_0199c4d2a1b07c3e9f1a2b3c4d5e6f70',
    name: 'Northwind',
    ink: ProjectInk.Rose,
    folders: [APP],
    found: null,
    onNameChange: vi.fn(),
    onInkChange: vi.fn(),
    onRemove: vi.fn(),
    onChoose: vi.fn(),
    onDrop: vi.fn(),
    onAdd: vi.fn(),
    onCreate: vi.fn(),
    onCancel: vi.fn(),
    ...more,
  }
  const { rerender } = render(<NewProject {...props} />)
  return { ...props, again: (next: Partial<NewProjectProps>) => rerender(<NewProject {...props} {...next} />) }
}

const page = () => screen.getByRole('textbox', { name: 'Name' })

describe('making it, or leaving it', () => {
  it('makes nothing more with ⌘↵ while it is being made', () => {
    const { onCreate } = tab({ creating: true })
    fireEvent.keyDown(page(), { key: 'Enter', metaKey: true })
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('leaves Escape to whoever handled it first', () => {
    const { onCancel } = tab({ onKeyDown: (event) => event.preventDefault() })
    fireEvent.keyDown(page(), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('keeps focus where it is when a folder is left out from elsewhere', () => {
    const { onRemove, again } = tab({ folders: [APP, OPS] })
    expect(page()).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Leave out northwind-app' }))
    expect(onRemove).toHaveBeenCalledWith('app')
    again({ folders: [OPS] })
    expect(page()).toHaveFocus()
  })
})

describe('what it is made of, and what reading it found', () => {
  it('marks a folder on a host Althar has no mark for with a plain folder', () => {
    tab({ folders: [OPS], taken: undefined })
    const made = screen.getByText('Made of').nextElementSibling!
    expect(made).toHaveTextContent('northwind-ops')
    expect(made.querySelector('svg')).not.toBeNull()
  })

  it('lists every owner it found on a connected host, and offers no connecting where it can’t', () => {
    tab({
      findings: [
        { id: 'github', kind: 'connected', host: GITHUB, owners: ['northwind-co', 'northwind-labs'], account: 'balazs' },
        { id: 'forge', kind: 'unconnected', host: FORGE, remote: 'northwind/ops', changes: 'pull requests' },
      ],
    })
    expect(screen.getByText(/Code on GitHub/)).toHaveTextContent('Code on GitHub, northwind-co, northwind-labs. Connected as balazs.')
    expect(screen.getByText(/is on Forgejo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect Forgejo' })).not.toBeInTheDocument()
  })

  it('offers what else is on this Mac a press away when nothing is named like the project', () => {
    tab({
      found: { like: null, first: [], more: [{ id: 'dotfiles', name: 'dotfiles', where: '~/dotfiles' }] },
    })
    expect(screen.getByRole('heading', { name: 'On this Mac' })).toBeInTheDocument()
    expect(screen.queryByText('dotfiles')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 more on this Mac' }))
    expect(screen.getByRole('button', { name: 'Add dotfiles' })).toBeInTheDocument()
  })
})

describe('starting from nothing', () => {
  it('offers a new repository until one is in its folders, counts it as a folder, and lists it with where it will be', () => {
    const onStartFresh = vi.fn()
    const { onCreate, again } = tab({ folders: [], onStartFresh })
    fireEvent.click(screen.getByRole('button', { name: /Create Northwind/ }))
    expect(screen.getByRole('alert').textContent).toBe('Add a folder, or start a new repository.')
    fireEvent.click(screen.getByRole('button', { name: 'New repository…' }))
    expect(onStartFresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()

    again({ folders: [{ id: 'fresh', fresh: true, name: 'northwind', where: '~/code/northwind' }], onStartFresh })
    expect(screen.queryByRole('button', { name: 'New repository…' })).toBeNull()
    expect(screen.getByText('new repository')).toBeTruthy()
    expect(screen.getByText('~/code/northwind')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Create Northwind/ }))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('shows where the folders will be until one is added, saying what a new repository is named', () => {
    const { again } = tab({ name: 'Nördwind Ops!', folders: [], onStartFresh: vi.fn() })
    expect(screen.getByText('Drop a git repository here')).toBeTruthy()
    expect(screen.getByText('New repository makes an empty one named nordwind-ops, in a folder you choose.')).toBeTruthy()
    again({ name: '', folders: [], onStartFresh: vi.fn() })
    expect(screen.getByText('New repository makes an empty one named after the project, in a folder you choose.')).toBeTruthy()
    again({ folders: [APP], onStartFresh: vi.fn() })
    expect(screen.queryByText('Drop a git repository here')).toBeNull()
    expect(screen.getByText('or drop them here')).toBeTruthy()
  })

  it('keeps focus on Choose a folder as the first folder takes the empty state’s place, and as the last gives it back', () => {
    const { again } = tab({ folders: [], onStartFresh: vi.fn() })
    screen.getByRole('button', { name: 'Choose a folder…' }).focus()
    again({ folders: [APP], onStartFresh: vi.fn() })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose a folder…' }))
    expect(screen.queryByText('Drop a git repository here')).toBeNull()
    again({ folders: [], onStartFresh: vi.fn() })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose a folder…' }))
  })

  it('has no way to start one without a way to, and asks for a folder alone', () => {
    tab({ folders: [] })
    expect(screen.queryByRole('button', { name: 'New repository…' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Create Northwind/ }))
    expect(screen.getByRole('alert').textContent).toBe('Add a folder first.')
  })
})
