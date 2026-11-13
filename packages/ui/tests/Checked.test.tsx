import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EvidenceKind } from '../src/foundations/vocabulary'
import { Checked } from '../src/thread/Checked/Checked'
import type { EvidencePiece } from '../src/thread/Evidence/Evidence'

/*
 * What a lead checked, under its result: nothing to say, nothing drawn. A turn that checked nothing has no "What it checked"
 * at all, though it was handed a piece that says nothing, or a line of what it couldn't check that says nothing either.
 */

const EMPTY_NOTE: EvidencePiece = { id: 'n', kind: EvidenceKind.Note, caption: ' ', form: 'note', text: '' }
const EMPTY_RUN: EvidencePiece = { id: 'r', kind: EvidenceKind.Log, caption: '', form: 'output', lines: ['', '  '] }
const TESTS: EvidencePiece = {
  id: 't',
  kind: EvidenceKind.TestRun,
  caption: 'The refund tests',
  form: 'output',
  command: 'bun run test refunds',
  exit: 0,
  lines: ['1 passed'],
}

describe('Checked', () => {
  it('draws nothing for a turn whose pieces say nothing, nor for blank lines of what it couldn’t check', () => {
    const { container } = render(<Checked pieces={[EMPTY_NOTE, EMPTY_RUN]} unverified={['', '   ']} />)
    expect(container.childElementCount).toBe(0)
    expect(screen.queryByText('What it checked')).toBeNull()
    expect(screen.queryByText('Not checked')).toBeNull()
  })

  it('draws what it checked, leaving out a piece that says nothing beside it', () => {
    render(<Checked pieces={[EMPTY_NOTE, TESTS]} />)
    expect(screen.getByText('What it checked')).toBeTruthy()
    // One row, the run's, which opens to what it printed: none for the piece beside it.
    expect(screen.getAllByRole('button').map((row) => row.getAttribute('aria-label'))).toEqual(['What it printed: The refund tests'])
  })
})
