import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MERIDIAN_MAP, ROLES } from '../src/fixtures/setup'
import { Icon } from '../src/foundations/Icon/Icon'
import { CommandMatch } from '../src/foundations/vocabulary'
import { CommandToken, NewCommandHint } from '../src/setup/Charter/Charter'
import { Connections } from '../src/setup/Connections/Connections'
import { ControlAgents, ControlLink } from '../src/setup/ControlCenter/ControlCenter'
import { NamingRule } from '../src/setup/Conventions/Conventions'
import { ProjectIdentity } from '../src/setup/ProjectIdentity/ProjectIdentity'
import { ProjectInk } from '../src/foundations/ProjectMark/drawing'
import { SettingsLayout } from '../src/setup/SettingsLayout/SettingsLayout'
import { SourceMap } from '../src/setup/SourceMap/SourceMap'

/* Small parts of the settings, each at a case its stories don't reach. */

afterEach(() => {
  for (const name of ['scrollWidth', 'clientWidth']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
})

describe('a command in a rule', () => {
  it('can be read whole on focus where its box cuts it short', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 300 })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 120 })
    render(<CommandToken pattern="pnpm replay --env staging --from 2026-09-25 refunds" />)
    fireEvent.focus(screen.getByText('pnpm replay --env staging --from 2026-09-25 refunds'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('pnpm replay --env staging --from 2026-09-25 refunds')
  })

  it('says why one wasn’t added under the id its field points at', () => {
    render(
      <NewCommandHint pattern="rm" match={CommandMatch.Prefix} onMatchChange={() => {}} error="Never already has it." errorId="why-not" />,
    )
    expect(document.getElementById('why-not')).toHaveTextContent('Never already has it.')
  })
})

describe('a naming pattern', () => {
  const rule = (value: string | null, onChange = vi.fn()) => {
    render(<NamingRule value={value} onChange={onChange} exampleOf={(p) => p} fallback="althar/{key}" repositories={[]} />)
    return { onChange, field: screen.getByRole('textbox', { name: 'Pattern' }) }
  }

  it('goes back to following the repository when its pattern is emptied', () => {
    const { onChange, field } = rule('mer/{key}')
    fireEvent.change(field, { target: { value: '  ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('empties what was typed on Escape where there was none of its own', () => {
    const { onChange, field } = rule(null)
    fireEvent.change(field, { target: { value: 'mer/' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(field).toHaveValue('')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('a project’s name', () => {
  it('renames nothing when the name typed is the one it has', () => {
    const onRename = vi.fn()
    render(<ProjectIdentity name="Meridian" seed="proj_1" ink={ProjectInk.Teal} onRename={onRename} onInk={() => {}} />)
    const field = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(field, { target: { value: ' Meridian ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onRename).not.toHaveBeenCalled()
    expect(field).toHaveValue('Meridian')
  })
})

describe('the services to connect', () => {
  it('draws a plug for a service with no mark of its own', () => {
    const plug = render(<Icon name="plug" size={16} />).container.innerHTML
    render(
      <Connections
        label="Code hosts and trackers"
        services={[{ id: 'forgejo', name: 'Forgejo' }]}
        connections={[]}
        onConnect={() => {}}
        onSignInAgain={() => {}}
        onDisconnect={() => {}}
      />,
    )
    expect(screen.getByRole('listitem').querySelector('svg')?.outerHTML).toBe(plug)
  })
})

describe('the control center’s parts', () => {
  it('hands a link’s button to a ref given as a function or an object', () => {
    const seen = vi.fn()
    const held = createRef<HTMLButtonElement>()
    render(
      <>
        <ControlLink title="Co-author" picture={null} onClick={() => {}} ref={seen} />
        <ControlLink title="Sounds" picture={null} onClick={() => {}} ref={held} />
      </>,
    )
    expect(seen).toHaveBeenCalledWith(screen.getByRole('button', { name: /Co-author/ }))
    expect(held.current).toBe(screen.getByRole('button', { name: /Sounds/ }))
  })

  it('says an agent needs you in the words it is given', () => {
    render(<ControlAgents agents={[{ id: 'codex', name: 'Codex', line: 'Signed out', tone: 'yours' }]} text={{ yours: 'waits on you' }} />)
    expect(screen.getByText(/waits on you/)).toBeInTheDocument()
  })
})

describe('the repositories a project starts from', () => {
  it('offers to clone one with nowhere said yet, and adds a URL on Enter', () => {
    const onAddUrl = vi.fn()
    render(
      <SourceMap
        sources={[{ ...MERIDIAN_MAP.at(-1)!, cloneTo: undefined }]}
        roles={ROLES}
        onRemove={() => {}}
        onOriginChange={() => {}}
        onAddUrl={onAddUrl}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'On this Mac: meridian-infra' })).toHaveTextContent('Clone it here')
    fireEvent.click(screen.getByRole('button', { name: 'Clone from a URL' }))
    const field = screen.getByRole('textbox', { name: 'Repository URL' })
    fireEvent.change(field, { target: { value: ' github.com/meridian/ledger.git ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onAddUrl).toHaveBeenCalledWith('github.com/meridian/ledger.git')
  })
})

describe('a settings page', () => {
  it('heads a section without a lede by its title alone', () => {
    render(
      <SettingsLayout side={<nav>Sections</nav>} section="general" title="General">
        <p>Keep awake</p>
      </SettingsLayout>,
    )
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByText('Keep awake')).toBeInTheDocument()
  })
})
