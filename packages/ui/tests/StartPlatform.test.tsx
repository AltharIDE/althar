import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalPlatform = Object.getOwnPropertyDescriptor(window, 'althar')

afterEach(() => {
  if (originalPlatform === undefined) Reflect.deleteProperty(window, 'althar')
  else Object.defineProperty(window, 'althar', originalPlatform)
})

describe('the first screen on Linux', () => {
  it('uses the computer name for agents that are not installed', async () => {
    Object.defineProperty(window, 'althar', { configurable: true, value: { platform: 'linux' } })
    const [{ Start }, { RuntimeState }] = await Promise.all([import('../src/screens/Start/Start'), import('../src/foundations/vocabulary')])

    render(
      <Start
        runtimes={[{ id: 'codex', name: 'Codex', state: RuntimeState.Missing }]}
        repositories={[]}
        picked={[]}
        onPick={vi.fn()}
        onAdd={vi.fn()}
        name=""
        onNameChange={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    expect(screen.getByText('None on this computer yet')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Not on this computer/ })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Agents not on this computer' })).toBeInTheDocument()
  })
})
