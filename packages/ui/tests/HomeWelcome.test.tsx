import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Brand } from '../src/foundations/brands/brands'
import { ProjectInk } from '../src/foundations/ProjectMark/drawing'
import { HomeWelcome, type HomeWelcomeProps, type WelcomeNeed } from '../src/screens/HomeWelcome/HomeWelcome'

/* runner-1's welcome, as a window on it shows it while it has no projects. */

const NEEDS: readonly WelcomeNeed[] = [
  { id: 'claude-code', name: 'Claude Code', brand: Brand.Anthropic, state: 'ready', note: '2.1.3' },
  { id: 'codex', name: 'Codex', brand: Brand.OpenAI, state: 'signedOut', command: 'codex login --device-auth' },
  { id: 'gemini', name: 'Gemini CLI', brand: Brand.Google, state: 'missing', guide: 'https://example.com/gemini' },
  { id: 'git', name: 'git', icon: 'branch', state: 'ready', note: '2.43.0' },
]

const welcome = (props: Partial<HomeWelcomeProps> = {}) => {
  const all: HomeWelcomeProps = {
    name: 'runner-1',
    at: 'althar@runner-1',
    machine: { system: 'Ubuntu 24.04.1 LTS', cores: 8, memory: 32 * 1024 ** 3, disk: { free: 212e9, size: 512e9 } },
    git: '2.43.0',
    needs: NEEDS,
    repositories: [{ id: 'repo_site', ink: ProjectInk.Clay }],
    found: ['~/code/site', '~/code/api'],
    onDoor: vi.fn(),
    onPaste: vi.fn(() => true),
    toured: false,
    onToured: vi.fn(),
    onCopy: vi.fn(),
    onGuide: vi.fn(),
    ...props,
  }
  render(<HomeWelcome {...all} />)
  return all
}

afterEach(() => vi.useRealTimers())

describe('a home’s welcome, the first time', () => {
  it('says what the home is, set out as a spec', () => {
    welcome()
    expect(screen.getByRole('heading', { level: 1, name: 'This is runner-1' })).not.toBeNull()
    const figures = screen.getByRole('main').querySelector('dl')!
    expect(within(figures).getByText('8')).not.toBeNull()
    expect(within(figures).getByText('32')).not.toBeNull()
    expect(within(figures).getByText('212')).not.toBeNull()
    expect(within(figures).getByText('GB of 512')).not.toBeNull()
    expect(screen.getByText('Ubuntu 24.04.1 LTS')).not.toBeNull()
    expect(screen.getByText('git 2.43.0')).not.toBeNull()
    // The agents ready there, ticked; git has a line of its own.
    expect(screen.getByText('Claude Code 2.1.3')).not.toBeNull()
  })

  it('holds the figures’ places while the home is asked', () => {
    welcome({ machine: null, git: undefined, needs: null })
    const figures = screen.getByRole('main').querySelector('dl')!
    expect(figures.getAttribute('aria-busy')).toBe('true')
    expect(within(figures).getAllByText('–')).toHaveLength(3)
  })

  it('turns a page at a time, by Next and Back and by the arrows, and says which page it is on', () => {
    welcome()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { level: 1, name: 'What runner-1 has' })).not.toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Page 2 of 3: What runner-1 has')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { level: 1, name: 'This is runner-1' })).not.toBeNull()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByRole('heading', { level: 1, name: 'What runner-1 has' })).not.toBeNull()
    // With a modifier, the key is someone else's.
    fireEvent.keyDown(window, { key: 'ArrowLeft', metaKey: true })
    expect(screen.getByRole('heading', { level: 1, name: 'What runner-1 has' })).not.toBeNull()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByRole('heading', { level: 1, name: 'This is runner-1' })).not.toBeNull()
  })

  it('lists what work there needs, each that isn’t ready with the one thing that makes it so', () => {
    vi.useFakeTimers()
    const at = welcome()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    const list = screen.getByRole('list', { name: 'On runner-1' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    expect(within(list).getByText('codex login --device-auth')).not.toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: 'Copy Codex’s sign-in command' }))
    expect(at.onCopy).toHaveBeenCalledWith('codex login --device-auth')
    expect(within(list).getByRole('button', { name: 'Copy Codex’s sign-in command' }).textContent).toContain('Copied')
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(within(list).getByRole('button', { name: 'Copy Codex’s sign-in command' }).textContent).toContain('Copy')
    fireEvent.click(within(list).getByRole('button', { name: 'How to install' }))
    expect(at.onGuide).toHaveBeenCalledWith('https://example.com/gemini')
  })

  it('opens into the arrival, its title focused, and is seen once it gets there', () => {
    const at = welcome()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const title = screen.getByRole('heading', { level: 1, name: 'Welcome to runner-1' })
    expect(document.activeElement).toBe(title)
    expect(at.onToured).toHaveBeenCalledOnce()
    // Back closes it onto the card again, its Next focused; going on again doesn't say it was seen twice.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { level: 1, name: 'What runner-1 has' })).not.toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(at.onToured).toHaveBeenCalledOnce()
  })

  it('skips straight to the arrival', () => {
    const at = welcome()
    fireEvent.click(screen.getByRole('button', { name: 'Skip the tour' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to runner-1' })).not.toBeNull()
    expect(at.onToured).toHaveBeenCalledOnce()
  })
})

describe('a home’s welcome, every time after', () => {
  it('starts on the arrival, with no tour', () => {
    const at = welcome({ toured: true })
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to runner-1' })).not.toBeNull()
    expect(screen.queryByRole('list', { name: 'Pages' })).toBeNull()
    expect(screen.getByText('althar@runner-1 · Ubuntu 24.04.1 LTS')).not.toBeNull()
    expect(at.onToured).not.toHaveBeenCalled()
  })

  it('has a door for each way in, each opening the way it is', () => {
    const at = welcome({ toured: true })
    const doors = screen.getByRole('list', { name: 'Ways in' })
    expect(within(doors).getAllByRole('button')).toHaveLength(3)
    for (const door of ['Clone a repository', 'A folder on runner-1', 'Start empty'])
      expect(within(doors).getByRole('button', { name: door })).not.toBeNull()
    expect(
      within(doors).getByRole('button', { name: 'A folder on runner-1', description: '2 repositories found on runner-1' }),
    ).not.toBeNull()
    fireEvent.click(within(doors).getByRole('button', { name: 'A folder on runner-1' }))
    expect(at.onDoor).toHaveBeenCalledWith('folder', expect.any(HTMLButtonElement))
  })

  it('says it is still looking on the folder door', () => {
    welcome({ toured: true, found: null })
    expect(screen.getByText('Looking…')).not.toBeNull()
  })

  it('has no folder door where it found no repositories', () => {
    welcome({ toured: true, found: [] })
    const doors = screen.getByRole('list', { name: 'Ways in' })
    expect(within(doors).getAllByRole('button')).toHaveLength(2)
    expect(within(doors).queryByRole('button', { name: /A folder/ })).toBeNull()
  })

  it('keeps the folder door where it couldn’t look, saying so rather than that there was nothing', () => {
    welcome({ toured: true, found: 'failed' })
    expect(screen.getByRole('button', { name: 'A folder on runner-1', description: 'Couldn’t look on runner-1 just now' })).not.toBeNull()
  })

  it('says under the update command where it can’t be sure that’s how the home was installed', () => {
    welcome({ toured: true, update: { command: 'sh launcher update --apply --wait', installed: 'unknown' } })
    expect(screen.getByText(/That’s for a home Althar installed. If runner-1 was installed another way/)).not.toBeNull()
    cleanup()
    welcome({ toured: true, update: { command: "sh '/opt/althar/launcher' update --apply --wait", installed: 'custom' } })
    expect(screen.getByText(/If it runs runner-1 from a source checkout, pull and rebuild there instead/)).not.toBeNull()
    cleanup()
    welcome({ toured: true, update: { command: 'sh launcher update --apply --wait', installed: 'known' } })
    expect(screen.queryByText(/That’s/)).toBeNull()
  })

  it('asks an older home to update, with its command to copy, in place of the ways in and the tour', () => {
    const at = welcome({ toured: false, update: { command: 'sh launcher update --apply --wait' } })
    expect(screen.getByRole('heading', { name: 'Welcome to runner-1' })).not.toBeNull()
    expect(screen.queryByRole('list', { name: 'Ways in' })).toBeNull()
    expect(screen.getByText(/runner-1 runs an older Althar/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy the update command' }))
    expect(at.onCopy).toHaveBeenCalledWith('sh launcher update --apply --wait')
  })

  it('shows what the home has along its foot, with what one that isn’t ready takes', () => {
    const at = welcome({ toured: true })
    const strip = screen.getByRole('list', { name: 'On runner-1' })
    expect(within(strip).getByText('Signed out')).not.toBeNull()
    fireEvent.click(within(strip).getByRole('button', { name: 'Copy Codex’s sign-in command' }))
    expect(at.onCopy).toHaveBeenCalledWith('codex login --device-auth')
  })

  it('takes a repository’s address pasted anywhere but a field', () => {
    const at = welcome({ toured: true })
    const pasted = (target: EventTarget, text: string) => {
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
      target.dispatchEvent(event)
      return event
    }
    expect(pasted(document.body, ' https://github.com/acme/site ').defaultPrevented).toBe(true)
    expect(at.onPaste).toHaveBeenCalledWith('https://github.com/acme/site')
    const field = document.createElement('input')
    document.body.append(field)
    expect(pasted(field, 'https://github.com/acme/api').defaultPrevented).toBe(false)
    expect(at.onPaste).toHaveBeenCalledOnce()
    field.remove()
  })
})
