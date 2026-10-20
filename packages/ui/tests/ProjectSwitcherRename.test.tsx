import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type ProjectSummary, ProjectSwitcher } from '../src/chrome/ProjectSwitcher/ProjectSwitcher'

const project = (id: string, name: string, more: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id,
  name,
  yours: 0,
  running: 0,
  ...more,
})
const MERIDIAN = project('meridian', 'Meridian', { where: '~/work/meridian' })
const PROJECTS = [
  MERIDIAN,
  project('halyard', 'Halyard', { yours: 1 }),
  project('tessera', 'Tessera', { yours: 3, running: 2 }),
  project('ferrous', 'Ferrous'),
]

const switcher = (props: Partial<Parameters<typeof ProjectSwitcher>[0]> = {}) =>
  render(<ProjectSwitcher current={MERIDIAN} projects={PROJECTS} onPick={vi.fn()} onRename={vi.fn()} defaultOpen {...props} />)
const panel = () => screen.getByRole('dialog', { name: 'Projects' })
const field = () => screen.getByRole('textbox', { name: 'The project’s name' })

describe('the project switcher', () => {
  it('puts the projects where calls wait first, saying how many in each', () => {
    switcher()
    const waiting = within(within(panel()).getByRole('region', { name: 'Needs you' }))
    expect(waiting.getAllByRole('button').map((row) => row.textContent)).toEqual([
      'Halyard1, 1 call waits on you',
      'Tessera3, 3 calls wait on you, running',
    ])
  })

  it('says it is empty where nothing it holds matches what is looked for', () => {
    switcher()
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a project' }), { target: { value: 'zz' } })
    expect(within(panel()).getByText('No project by that name')).toBeInTheDocument()
  })
})

describe('renaming the project from its switcher', () => {
  it('says a name is needed where Save is pressed with none, until one is typed', () => {
    const onRename = vi.fn()
    switcher({ onRename })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(field(), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onRename).not.toHaveBeenCalled()
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(field()).toHaveAccessibleDescription('Give it a name')
    expect(field()).toHaveFocus()
    fireEvent.change(field(), { target: { value: 'Meridian two' } })
    expect(field()).not.toHaveAttribute('aria-invalid', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onRename).toHaveBeenCalledExactlyOnceWith('Meridian two')
  })

  it('keeps nothing where the name is the same, and goes back to Rename', async () => {
    const onRename = vi.fn()
    switcher({ onRename })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(field(), { target: { value: ' Meridian ' } })
    fireEvent.submit(field())
    expect(onRename).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename' })).toHaveFocus())
  })

  it('leaves renaming on Escape, putting the name back, the panel still open', async () => {
    const onRename = vi.fn()
    switcher({ onRename })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(field(), { target: { value: 'Something else' } })
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'The project’s name' })).toBeNull()
    expect(panel()).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(field()).toHaveValue('Meridian')
    expect(onRename).not.toHaveBeenCalled()
  })
})
