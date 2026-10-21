import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AccountSignIn, type AccountSignInProps } from '../src/setup/Accounts/AccountSignIn'
import { SignInWay } from '../src/foundations/vocabulary'

/* An account signing in, by the ways its agent offers when it has neither a browser nor a terminal sign-in. */

const signIn = (more: Partial<AccountSignInProps>) => {
  const props: AccountSignInProps = {
    agent: 'Claude Code',
    position: 2,
    step: { kind: 'choose' },
    ways: {},
    onWay: vi.fn(),
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...more,
  }
  const { rerender } = render(<AccountSignIn {...props} />)
  return { ...props, again: (next: Partial<AccountSignInProps>) => rerender(<AccountSignIn {...props} {...next} />) }
}

describe('signing in without a browser or a terminal', () => {
  it('offers its other ways alone, with no first button and no “or”', () => {
    const { onWay } = signIn({ ways: { key: 'Anthropic API key', console: 'Anthropic Console' } })
    expect(screen.queryByRole('button', { name: /Continue with|Sign in from a terminal/ })).not.toBeInTheDocument()
    expect(screen.queryByText('or')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Anthropic API key' }))
    expect(onWay).toHaveBeenCalledWith(SignInWay.Key)
  })

  it('offers only another folder where no account switcher left one to add', () => {
    const onChooseFolder = vi.fn()
    signIn({ step: { kind: 'folders' }, ways: { choose: true }, onChooseFolder })
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Another folder…' }))
    expect(onChooseFolder).toHaveBeenCalled()
  })
})

describe('naming the account signed in', () => {
  it('starts again from the name it comes with when it is signed in again after it stopped', () => {
    const { again } = signIn({ step: { kind: 'named', name: 'Work', who: 'you@meridian.dev' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name this account' }), { target: { value: 'Personal' } })
    again({ step: { kind: 'failed', said: 'The sign-in page closed.' } })
    expect(screen.queryByRole('textbox', { name: 'Name this account' })).not.toBeInTheDocument()
    again({ step: { kind: 'named', name: 'Work', who: 'you@meridian.dev' } })
    expect(screen.getByRole('textbox', { name: 'Name this account' })).toHaveValue('Work')
  })
})
