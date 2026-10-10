import { fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { STAGING } from '../src/fixtures/meridian'
import { Decision, PermissionScope } from '../src/foundations/vocabulary'
import { PermissionAnswers } from '../src/thread/Permission/PermissionAnswers'

const offers = [Decision.AllowOnce, Decision.AllowAlways, Decision.Deny, Decision.DenyAlways]

describe('PermissionAnswers', () => {
  it('denies without a note from its button', () => {
    const onAnswer = vi.fn()
    render(<PermissionAnswers request={STAGING} project="Meridian" onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(onAnswer).toHaveBeenCalledWith({ decision: Decision.Deny, cmd: STAGING.cmd, note: '' })
  })

  it('offers every always and never the request can keep, by its words', async () => {
    const onAnswer = vi.fn()
    render(<PermissionAnswers request={{ ...STAGING, offers }} project="Meridian" onAnswer={onAnswer} />)
    await userEvent.click(screen.getByRole('button', { name: 'More answers' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Always allow this exact command',
      'Always allow commands starting “pnpm replay”',
      'Always allow anything that reaches staging',
      'Deny, and say what to do instead',
      'Never allow this exact command',
      'Never allow commands starting “pnpm replay”',
      'Never allow anything that reaches staging',
    ])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Never allow this exact command' }))
    expect(onAnswer).toHaveBeenCalledWith({ decision: Decision.DenyAlways, cmd: STAGING.cmd, scope: PermissionScope.Exact })
  })

  it('says what is missing when the note is sent empty, and Cancel puts it away', async () => {
    const onAnswer = vi.fn()
    render(<PermissionAnswers request={STAGING} project="Meridian" onAnswer={onAnswer} />)
    await userEvent.click(screen.getByRole('button', { name: 'More answers' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Deny, and say what to do instead' }))
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(onAnswer).not.toHaveBeenCalled()
    expect(screen.getByText('Write a note first')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument()
  })
})
