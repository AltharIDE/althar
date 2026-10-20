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
  branch: 'main',
  host: GITHUB,
  remote: 'northwind-co/app',
}
const OPS: NewProjectFolder = {
  id: 'ops',
  name: 'northwind-ops',
  where: '~/code/northwind/ops',
  branch: 'main',
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
      found: { like: null, first: [], more: [{ id: 'dotfiles', name: 'dotfiles', where: '~/dotfiles', facts: 'main · yesterday' }] },
    })
    expect(screen.getByRole('heading', { name: 'On this Mac' })).toBeInTheDocument()
    expect(screen.queryByText('dotfiles')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 more on this Mac' }))
    expect(screen.getByRole('button', { name: 'Add dotfiles' })).toBeInTheDocument()
  })
})
