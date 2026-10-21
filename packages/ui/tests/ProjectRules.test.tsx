import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import {
  exampleName,
  MERIDIAN_ACCOUNTS,
  MERIDIAN_BRANCHES,
  MERIDIAN_KINDS,
  MERIDIAN_TEMPLATES,
  MERIDIAN_TITLES,
} from '../src/fixtures/rules'
import { CommandMatch, LimitPolicy, PermissionPolicy, RuleKind, RulePlace, TaskEnd } from '../src/foundations/vocabulary'
import { ProjectRules, type ProjectRulesProps, type RuleCommand } from '../src/screens/ProjectRules/ProjectRules'

/*
 * A project's rules as a few sentences. Who each sentence is about is said
 * once: the agents the first time they're named, they after that.
 */

const command = (place: RuleCommand['place'], pattern: string): RuleCommand => ({
  id: `${place}:${pattern}`,
  pattern,
  match: CommandMatch.Prefix,
  place,
})

/* Every kind of request left to the rest, so each test puts where it wants only what it names. */
const REST = Object.fromEntries(Object.values(RuleKind).map((kind) => [kind, RulePlace.Rest])) as Record<RuleKind, RulePlace>

const rules = (more: Partial<ProjectRulesProps> = {}) => {
  const props: ProjectRulesProps = {
    project: 'Meridian',
    mode: PermissionPolicy.Coordinator,
    onModeChange: vi.fn(),
    allowAll: false,
    onAllowAllChange: vi.fn(),
    kinds: MERIDIAN_KINDS,
    onKindChange: vi.fn(),
    commands: [],
    onRemoveCommand: vi.fn(),
    onAddCommand: vi.fn(() => undefined),
    end: TaskEnd.DraftPr,
    onEndChange: vi.fn(),
    branches: { value: null, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES },
    titles: { value: '{key}: {title}', onChange: vi.fn(), exampleOf: exampleName, fallback: '{title}', repositories: MERIDIAN_TITLES },
    templates: MERIDIAN_TEMPLATES,
    limit: LimitPolicy.Move,
    onLimitChange: vi.fn(),
    agentAccounts: MERIDIAN_ACCOUNTS,
    rotate: false,
    onRotateChange: vi.fn(),
    allowed: {},
    onAllowedChange: vi.fn(),
    ...more,
  }
  render(<ProjectRules {...props} />)
  return props
}

/** A sentence by its label, as it reads. */
const sentence = (label: string) => screen.getByRole('listitem', { name: label }).textContent

describe('who each sentence is about', () => {
  it('names the agents in Never when it lists kinds alone', () => {
    rules({ kinds: { ...REST, [RuleKind.ForcePush]: RulePlace.Never } })
    expect(sentence('Never')).toContain('Agents never force push')
  })

  it('names them in Ask me when nothing is refused, and calls them they in Go ahead', () => {
    rules({
      kinds: { ...REST, [RuleKind.Deploy]: RulePlace.Ask },
      commands: [command(RulePlace.Ask, 'stripe'), command(RulePlace.Allow, 'bun test')],
    })
    expect(sentence('Ask me')).toContain('Agents ask you before deploying or publishing, and before running stripe')
    expect(sentence('Go ahead')).toContain('They go ahead with bun test')
  })

  it('asks before running commands alone, by they after Never named them', () => {
    rules({ kinds: { ...REST, [RuleKind.ForcePush]: RulePlace.Never }, commands: [command(RulePlace.Ask, 'psql')] })
    expect(sentence('Ask me')).toContain('They ask you before running psql')
  })

  it('asks before running commands alone, by the agents where nothing came before', () => {
    rules({ kinds: REST, commands: [command(RulePlace.Ask, 'psql')] })
    expect(sentence('Ask me')).toContain('Agents ask you before running psql')
  })

  it('names the agents in Go ahead when it is the first sentence to list anything', () => {
    rules({ kinds: REST, commands: [command(RulePlace.Allow, 'git fetch')] })
    expect(sentence('Go ahead')).toContain('Agents go ahead with git fetch')
  })
})

describe('how the page is put', () => {
  it('keeps its headings at the deepest level when it sits that deep', () => {
    rules({ headingLevel: 6 })
    expect(screen.getByRole('heading', { level: 6, name: 'Rules' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 6, name: 'Never' })).toBeInTheDocument()
  })

  it('leaves its title to the page around it when untitled', () => {
    rules({ titled: false })
    expect(screen.queryByRole('heading', { name: 'Rules' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Never' })).toBeInTheDocument()
  })

  it('describes pull requests in every repository’s own template when each has one', () => {
    rules({ templates: MERIDIAN_TEMPLATES.map((repository) => ({ ...repository, path: '.github/pull_request_template.md' })) })
    expect(sentence('Finished')).toContain('described in each repository’s template')
  })

  it('names branches Althar’s own way for a project with no repositories yet', () => {
    rules({ branches: { value: null, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: [] } })
    expect(sentence('Finished')).toContain('althar/MER-128-refund-banner')
  })
})

describe('changing a rule in place', () => {
  it('keeps a kind where it is when its own sentence is picked again', async () => {
    const { onKindChange } = rules({ kinds: { ...REST, [RuleKind.ForcePush]: RulePlace.Never } })
    const word = screen.getByRole('button', { name: 'force push' })
    await userEvent.click(word)
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /^Never/ }))
    expect(onKindChange).toHaveBeenCalledWith(RuleKind.ForcePush, RulePlace.Never)
    expect(screen.getByRole('button', { name: 'force push' })).toBeInTheDocument()
  })

  it('gives a branch pattern being typed when a click outside closes its popover', async () => {
    const onChange = vi.fn()
    rules({ branches: { value: null, onChange, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES } })
    await userEvent.click(screen.getByRole('button', { name: 'feat/MER-128-refund-banner' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Branch names' }), 'mer/{{key}')
    await userEvent.click(screen.getByRole('heading', { name: 'Rules' }))
    expect(onChange).toHaveBeenCalledWith('mer/{key}')
  })

  it('gives it too when a press outside closes the popover before the field loses focus, as a secondary button’s does', async () => {
    const onChange = vi.fn()
    rules({ branches: { value: null, onChange, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES } })
    await userEvent.click(screen.getByRole('button', { name: 'feat/MER-128-refund-banner' }))
    const field = await screen.findByRole('textbox', { name: 'Branch names' })
    await userEvent.type(field, 'mer/{{key}')
    expect(field).toHaveFocus()
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Rules' }), { button: 2 })
    expect(onChange).toHaveBeenCalledWith('mer/{key}')
    expect(field).not.toHaveFocus()
  })

  it('closes a branch popover on a click outside with nothing typed, giving nothing', async () => {
    const onChange = vi.fn()
    rules({ branches: { value: null, onChange, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES } })
    await userEvent.click(screen.getByRole('button', { name: 'feat/MER-128-refund-banner' }))
    const pop = await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('heading', { name: 'Rules' }))
    await waitFor(() => expect(pop).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
    expect(within(document.body).queryByRole('textbox', { name: 'Branch names' })).not.toBeInTheDocument()
  })
})
