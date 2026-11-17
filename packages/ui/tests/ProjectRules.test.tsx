import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { MERIDIAN_KINDS } from '../src/fixtures/rules'
import { CommandMatch, PermissionPolicy, RuleKind, RulePlace } from '../src/foundations/vocabulary'
import { ProjectRules, type ProjectRulesProps, type RuleCommand, sandboxGroups } from '../src/screens/ProjectRules/ProjectRules'

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
})

describe('the commands leads run outside their sandbox', () => {
  it('are named once per tool however they are run, a script once by any manager, and the rest in their own words', () => {
    const groups = sandboxGroups([
      'ps',
      'vite',
      'npx vite',
      'bunx vite',
      'pnpm exec vite',
      'yarn vite',
      'bunx playwright',
      'npm run dev',
      'pnpm dev',
      'yarn run dev',
      'yarn dev',
      'node scripts/e2e.ts',
    ])
    expect(groups.map((group) => group.label)).toEqual(['ps', 'vite', 'bunx playwright', 'npm run dev', 'node scripts/e2e.ts'])
    expect(groups[1]?.members).toEqual(['vite', 'npx vite', 'bunx vite', 'pnpm exec vite', 'yarn vite'])
    expect(groups[3]?.members).toEqual(['npm run dev', 'pnpm dev', 'yarn run dev', 'yarn dev'])
  })
})
