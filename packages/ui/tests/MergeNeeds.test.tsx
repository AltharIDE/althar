import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GITHUB } from '../src/fixtures/outputs'
import { ChangeState, CheckState } from '../src/foundations/vocabulary'
import { ChangeSet } from '../src/outputs/ChangeSet/ChangeSet'
import { type MergeNeed, MergeNeeds } from '../src/outputs/ChangeSet/MergeNeeds'

/*
 * What merging a change needs on its host (DEV-204): crossed first, each
 * saying what to do, then waiting, then not known; what is met folded away.
 */

const lines = () => within(screen.getByRole('list', { name: 'What merging needs' })).getAllByRole('listitem')

describe('what merging needs', () => {
  it('lists a missing approval, a failed required check and being behind first, each saying what to do', () => {
    const needs: MergeNeed[] = [
      { kind: 'checks', state: 'unmet', have: 1, need: 2, who: ['build'], required: ['build', 'lint'] },
      { kind: 'approvals', state: 'unmet', have: 0, need: 1 },
      { kind: 'changes_requested', state: 'met' },
      { kind: 'up_to_date', state: 'unmet', have: 3 },
      { kind: 'conflicts', state: 'met' },
      { kind: 'draft', state: 'met' },
    ]
    render(<MergeNeeds needs={needs} host="GitHub" />)
    const said = lines().map((li) => li.textContent)
    expect(said[0]).toContain('Missing: build failed')
    expect(said[0]).toContain('Ask the lead')
    expect(said[1]).toContain('Missing: Needs an approval')
    expect(said[1]).toContain('Ask for a review')
    expect(said[2]).toContain('Missing: 3 commits behind main')
    expect(said[2]).toContain('Update the branch')
    // What is met, folded under one line, opens to each.
    expect(screen.getByRole('button', { name: /3 more met/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /3 more met/ }))
    expect(screen.getByText('No conflicts with main')).toBeInTheDocument()
  })

  it('shows what the host does not say as not known, never ticked, and with nothing to do', () => {
    render(<MergeNeeds needs={[{ kind: 'conversations', state: 'unknown' }]} host="Bitbucket" />)
    const [line] = lines()
    expect(line).toHaveTextContent(/^\?Not known: Conversations resolved: Bitbucket doesn’t say$/)
    expect(line?.querySelector('svg')).toBeNull()
    expect(screen.queryByText(/Everything .* is met/)).not.toBeInTheDocument()
  })

  it('says everything is met only when every line is', () => {
    render(
      <MergeNeeds
        needs={[
          { kind: 'checks', state: 'met', have: 2, need: 2 },
          { kind: 'approvals', state: 'met', have: 1, need: 1, who: ['ben'] },
        ]}
        host="GitHub"
      />,
    )
    expect(screen.getByRole('button', { name: /Everything GitHub needs is met/ })).toBeInTheDocument()
  })

  it('takes the place of the checks’ line on the card, opening to its checks with the optional ones apart', () => {
    render(
      <ChangeSet
        state={ChangeState.Ready}
        host={GITHUB}
        prs={[{ repo: 'acme/api', number: 7, files: [] }]}
        checks={[
          { id: '1', name: 'build', state: CheckState.Passed },
          { id: '2', name: 'preview', state: CheckState.Failed },
        ]}
        needs={[
          { kind: 'checks', state: 'met', have: 1, need: 1, required: ['build'], apart: { passed: 0, failed: ['preview'], running: 0 } },
        ]}
      />,
    )
    const line = screen.getByRole('button', { name: /The required check passed/ })
    expect(line).toHaveTextContent('optional preview failed')
    fireEvent.click(line)
    expect(screen.getByText('Optional')).toBeInTheDocument()
  })

  it('lists skipped checks last in each group, keeping the host’s order otherwise', () => {
    render(
      <ChangeSet
        state={ChangeState.Ready}
        host={GITHUB}
        prs={[{ repo: 'acme/api', number: 7, files: [] }]}
        checks={[
          { id: '1', name: 'build', state: CheckState.Passed },
          { id: '2', name: 'ui', state: CheckState.Skipped },
          { id: '3', name: 'lint', state: CheckState.Passed },
          { id: '4', name: 'site', state: CheckState.Skipped },
          { id: '5', name: 'verify', state: CheckState.Passed },
        ]}
        needs={[{ kind: 'checks', state: 'met', have: 1, need: 1, required: ['build'] }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /The required check passed/ }))
    const names = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    const order = ['lint', 'verify', 'ui', 'site'].map((n) => names.findIndex((x) => x.startsWith(n)))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((i) => i >= 0)).toBe(true)
  })
})
