import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { exampleName, MERIDIAN_ACCOUNTS, MERIDIAN_BRANCHES, MERIDIAN_TEMPLATES, MERIDIAN_TITLES } from '../src/fixtures/rules'
import { LimitPolicy, TaskEnd } from '../src/foundations/vocabulary'
import { ProjectTaskRules, type ProjectTaskRulesProps } from '../src/screens/ProjectRules/ProjectRules'

/*
 * What a project's task does when it is finished and when an agent's usage runs out: the Finished and Limits sentences
 * of its rules, which its Tasks say.
 */

const tasks = (more: Partial<ProjectTaskRulesProps> = {}) => {
  const props: ProjectTaskRulesProps = {
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
  render(<ProjectTaskRules {...props} />)
  return props
}

/** A sentence by its label, as it reads. */
const sentence = (label: string) => screen.getByRole('listitem', { name: label }).textContent

describe('how the sentences are put', () => {
  it('says only what finishing and a usage limit do, with no rules among them', () => {
    tasks()
    expect(screen.getByRole('listitem', { name: 'Finished' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Limits' })).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: 'Never' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Rules' })).not.toBeInTheDocument()
  })

  it('keeps its headings at the deepest level when it sits that deep', () => {
    tasks({ headingLevel: 6 })
    expect(screen.getByRole('heading', { level: 6, name: 'Finished' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 6, name: 'Limits' })).toBeInTheDocument()
  })

  it('describes pull requests in every repository’s own template when each has one', () => {
    tasks({ templates: MERIDIAN_TEMPLATES.map((repository) => ({ ...repository, path: '.github/pull_request_template.md' })) })
    expect(sentence('Finished')).toContain('described in each repository’s template')
  })

  it('names branches Althar’s own way for a project with no repositories yet', () => {
    tasks({ branches: { value: null, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: [] } })
    expect(sentence('Finished')).toContain('althar/MER-128-refund-banner')
  })
})

describe('changing one in place', () => {
  it('gives a branch pattern being typed when a click outside closes its popover', async () => {
    const onChange = vi.fn()
    tasks({ branches: { value: null, onChange, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES } })
    await userEvent.click(screen.getByRole('button', { name: 'feat/MER-128-refund-banner' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Branch names' }), 'mer/{{key}')
    await userEvent.click(screen.getByRole('heading', { name: 'Finished' }))
    expect(onChange).toHaveBeenCalledWith('mer/{key}')
  })

  it('gives it too when a press outside closes the popover before the field loses focus, as a secondary button’s does', async () => {
    const onChange = vi.fn()
    tasks({ branches: { value: null, onChange, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES } })
    await userEvent.click(screen.getByRole('button', { name: 'feat/MER-128-refund-banner' }))
    const field = await screen.findByRole('textbox', { name: 'Branch names' })
    await userEvent.type(field, 'mer/{{key}')
    expect(field).toHaveFocus()
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Finished' }), { button: 2 })
    expect(onChange).toHaveBeenCalledWith('mer/{key}')
    expect(field).not.toHaveFocus()
  })

  it('closes a branch popover on a click outside with nothing typed, giving nothing', async () => {
    const onChange = vi.fn()
    tasks({ branches: { value: null, onChange, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES } })
    await userEvent.click(screen.getByRole('button', { name: 'feat/MER-128-refund-banner' }))
    const pop = await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('heading', { name: 'Finished' }))
    await waitFor(() => expect(pop).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
    expect(within(document.body).queryByRole('textbox', { name: 'Branch names' })).not.toBeInTheDocument()
  })
})
