import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REQUESTS, STAGING } from '../src/fixtures/meridian'
import { Decision, PermissionScope } from '../src/foundations/vocabulary'
import { Permission, Permissions } from '../src/thread/Permission/Permission'

const project = 'Meridian'
/* Past the yes beat and the fold. */
const settle = () => void act(() => vi.advanceTimersByTime(1000))
const form = () => screen.getByRole('form', { name: /^Needs your permission/ })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Permission', () => {
  it('answers with the number keys and Enter', () => {
    const onAnswer = vi.fn()
    render(<Permission {...STAGING} project={project} onAnswer={onAnswer} />)
    fireEvent.keyDown(form(), { key: '2' })
    fireEvent.submit(form())
    settle()
    expect(onAnswer).toHaveBeenCalledWith({ decision: Decision.AllowAlways, cmd: STAGING.cmd, scope: PermissionScope.Exact })
    expect(screen.getByText('Allowed always')).toBeInTheDocument()
  })

  it('ignores keys that pick nothing, and keys typed into the note', () => {
    render(<Permission {...STAGING} project={project} />)
    fireEvent.keyDown(form(), { key: '9' })
    expect(screen.getByRole('radio', { name: /Yes, this once/ })).toBeChecked()
    fireEvent.keyDown(form(), { key: '3' })
    const note = screen.getByRole('textbox', { name: 'What to do instead' })
    fireEvent.keyDown(note, { key: '1' })
    expect(screen.getByRole('radio', { name: /No, and say/ })).toBeChecked()
  })

  it('denies with a note, and Undo brings the card back', () => {
    const onAnswer = vi.fn()
    const onUndo = vi.fn()
    render(<Permission {...STAGING} project={project} onAnswer={onAnswer} onUndo={onUndo} />)
    fireEvent.click(screen.getByRole('radio', { name: /No, and say/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What to do instead' }), { target: { value: 'Use the snapshot' } })
    fireEvent.submit(form())
    settle()
    expect(onAnswer).toHaveBeenCalledWith({ decision: Decision.Deny, cmd: STAGING.cmd, note: 'Use the snapshot' })
    expect(screen.getByText('Use the snapshot')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledWith({ decision: Decision.Deny, cmd: STAGING.cmd, note: 'Use the snapshot' })
    expect(form()).toBeInTheDocument()
  })

  it('has no Undo when the consumer cannot take an answer back', () => {
    render(<Permission {...STAGING} project={project} defaultAnswer={{ decision: Decision.AllowOnce, cmd: STAGING.cmd }} />)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('offers a prefix only when the request carries one', () => {
    const { unmount } = render(<Permission {...STAGING} project={project} />)
    fireEvent.click(screen.getByRole('radio', { name: /Yes, and always/ }))
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    unmount()
    render(<Permission {...STAGING} prefix={undefined} kind={undefined} project={project} />)
    fireEvent.click(screen.getByRole('radio', { name: /Yes, and always/ }))
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows a denial without a note as its command', () => {
    render(<Permission {...STAGING} project={project} defaultAnswer={{ decision: Decision.Deny, cmd: STAGING.cmd, note: '' }} />)
    expect(screen.getByText(STAGING.cmd)).toBeInTheDocument()
  })

  it('says each scope of an always', () => {
    const said = (props: Partial<typeof STAGING>, scope: PermissionScope) => {
      const { container, unmount } = render(
        <Permission
          {...STAGING}
          {...props}
          project={project}
          defaultAnswer={{ decision: Decision.AllowAlways, cmd: STAGING.cmd, scope }}
        />,
      )
      const text = container.textContent
      unmount()
      return text
    }
    expect(said({}, PermissionScope.Kind)).toContain('anything that reaches staging')
    expect(said({ kind: undefined }, PermissionScope.Kind)).toContain('this exact command')
    expect(said({}, PermissionScope.Exact)).toContain('this exact command')
    expect(said({}, PermissionScope.Prefix)).toContain('commands starting pnpm replay')
  })

  it('offers what the agent offers, and a never answers with its scope', () => {
    const onAnswer = vi.fn()
    render(<Permission {...STAGING} offers={[Decision.AllowOnce, Decision.DenyAlways]} project={project} onAnswer={onAnswer} />)
    expect(screen.queryByRole('radio', { name: /Yes, and always/ })).toBeNull()
    fireEvent.keyDown(form(), { key: '2' })
    expect(screen.getByRole('button', { name: /Deny/ })).toBeInTheDocument()
    fireEvent.submit(form())
    settle()
    expect(onAnswer).toHaveBeenCalledWith({ decision: Decision.DenyAlways, cmd: STAGING.cmd, scope: PermissionScope.Exact })
  })

  it('answers once, even when Enter is pressed again while it folds', () => {
    const onAnswer = vi.fn()
    render(<Permission {...STAGING} project={project} onAnswer={onAnswer} />)
    fireEvent.submit(form())
    fireEvent.submit(form())
    fireEvent.keyDown(form(), { key: '2' })
    settle()
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith({ decision: Decision.AllowOnce, cmd: STAGING.cmd })
  })
})

describe('Permission, kept as a rule', () => {
  const offers = [Decision.AllowOnce, Decision.AllowAlways, Decision.Deny, Decision.DenyAlways]

  it('offers an always only by the scopes that would hold, and each answer keeps one it offers', () => {
    const onAnswer = vi.fn()
    render(
      <Permission
        {...STAGING}
        offers={offers}
        scopes={{ [Decision.AllowAlways]: [PermissionScope.Exact, PermissionScope.Prefix], [Decision.DenyAlways]: [PermissionScope.Kind] }}
        defaultScope={PermissionScope.Prefix}
        project={project}
        onAnswer={onAnswer}
      />,
    )
    // The kind is offered for never alone, and the prefix picked for always isn't one never can keep.
    fireEvent.click(screen.getByRole('radio', { name: /No, and never allow/ }))
    expect(screen.getByText('anything that reaches staging')).toBeInTheDocument()
    fireEvent.submit(form())
    settle()
    expect(onAnswer).toHaveBeenCalledWith({ decision: Decision.DenyAlways, cmd: STAGING.cmd, scope: PermissionScope.Kind })
  })

  it('keeps the prefix picked where that answer offers it', () => {
    const onAnswer = vi.fn()
    render(<Permission {...STAGING} offers={offers} defaultScope={PermissionScope.Prefix} project={project} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('radio', { name: /Yes, and always allow/ }))
    fireEvent.submit(form())
    settle()
    expect(onAnswer).toHaveBeenCalledWith({ decision: Decision.AllowAlways, cmd: STAGING.cmd, scope: PermissionScope.Prefix })
  })

  it('leaves out an always with no scope to keep, and starts on the first answer offered instead', () => {
    render(
      <Permission
        {...STAGING}
        offers={offers}
        scopes={{ [Decision.AllowAlways]: [] }}
        defaultDecision={Decision.AllowAlways}
        project={project}
      />,
    )
    expect(screen.queryByRole('radio', { name: /Yes, and always allow/ })).toBeNull()
    expect(screen.getByRole('radio', { name: /Yes, this once/ })).toBeChecked()
  })

  it('says the one scope it would keep, and nothing where that is this command alone', () => {
    const { unmount } = render(<Permission {...STAGING} scopes={{ [Decision.AllowAlways]: [PermissionScope.Kind] }} project={project} />)
    expect(screen.getByText('anything that reaches staging')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
    unmount()
    render(<Permission {...STAGING} scopes={{ [Decision.AllowAlways]: [PermissionScope.Exact] }} project={project} />)
    expect(screen.queryByText('in Meridian')).toBeNull()
  })
})

describe('Permissions', () => {
  it('folds a stack of one as one card, with Undo', () => {
    const onUndo = vi.fn()
    render(<Permissions items={[STAGING]} project={project} onAnswer={() => {}} onUndo={onUndo} />)
    expect(screen.queryByText(/1 of 1/)).toBeNull()
    fireEvent.submit(form())
    settle()
    expect(screen.getByText('Allowed once')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledWith(STAGING, { decision: Decision.AllowOnce, cmd: STAGING.cmd })
    expect(form()).toBeInTheDocument()
  })

  it('beats the card in front once for Allow all, then folds', () => {
    render(<Permissions items={REQUESTS} project={project} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow all 3' }))
    // The front card stays for its beat.
    expect(form()).toBeInTheDocument()
    settle()
    expect(screen.getByText('Allowed 3')).toBeInTheDocument()
  })

  it('goes through the stack, and Allow all answers the rest', () => {
    const onAnswer = vi.fn()
    render(<Permissions items={REQUESTS} project={project} onAnswer={onAnswer} onUndo={() => {}} />)
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /No, and say/ }))
    fireEvent.submit(form())
    settle()
    expect(screen.getByText(/2 of 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Allow all 2' }))
    settle()
    expect(onAnswer).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Allowed 2, denied 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument()
  })

  it('says only what was allowed when nothing was denied', () => {
    render(<Permissions items={REQUESTS.slice(0, 2)} project={project} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow all 2' }))
    settle()
    expect(screen.getByText('Allowed 2')).toBeInTheDocument()
  })
})
