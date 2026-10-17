import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SettingsNav } from '../src/setup/SettingsNav/SettingsNav'

const GROUPS = [
  [
    { id: 'agents', title: 'Agents', icon: 'agents' as const, yours: true },
    { id: 'hosts', title: 'Code hosts and trackers', icon: 'plug' as const },
  ],
  [{ id: 'about', title: 'About Althar', icon: 'down' as const }],
]

describe('SettingsNav', () => {
  it('lists the sections in their groups, the one open said to be the page', () => {
    render(<SettingsNav label="Settings" groups={GROUPS} value="hosts" onChange={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(nav).getAllByRole('list')).toHaveLength(2)
    expect(within(nav).getByRole('button', { name: 'Code hosts and trackers' }).getAttribute('aria-current')).toBe('page')
    expect(
      within(nav)
        .getByRole('button', { name: /^Agents/ })
        .getAttribute('aria-current'),
    ).toBeNull()
  })

  it('says, after its name, that something in a section needs the person', () => {
    render(<SettingsNav label="Settings" groups={GROUPS} value="hosts" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Agents, needs you' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'About Althar' })).toBeTruthy()
  })

  it('hands on the section pressed', () => {
    const onChange = vi.fn()
    render(<SettingsNav label="Settings" groups={GROUPS} value="hosts" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'About Althar' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('about')
  })
})
