import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Usage, usageText } from '../src/chrome/Usage/Usage'
import { UsageButton } from '../src/chrome/Usage/UsageButton'
import { UsageNotice } from '../src/chrome/Usage/UsageNotice'
import { usageTone, UsageTone } from '../src/chrome/Usage/tone'
import { FAULTS, HEALTHY, RUNNING_LOW, WITH_KEY } from '../src/fixtures/usage'

const opened = (props: Partial<Parameters<typeof Usage>[0]> = {}) => {
  const onRefresh = vi.fn()
  const onClose = vi.fn()
  render(<Usage groups={HEALTHY} onRefresh={onRefresh} onClose={onClose} {...props} />)
  return { onRefresh, onClose, dialog: screen.getByRole('dialog', { name: 'Plan usage' }) }
}

describe('the tone of a window', () => {
  it('changes at the thresholds the warnings come at', () => {
    expect([100, 51, 50, 26, 25, 11, 10, 6, 5, 0].map(usageTone)).toEqual([
      UsageTone.Plenty,
      UsageTone.Plenty,
      UsageTone.Half,
      UsageTone.Half,
      UsageTone.Low,
      UsageTone.Low,
      UsageTone.Critical,
      UsageTone.Critical,
      UsageTone.Last,
      UsageTone.Last,
    ])
  })
})

describe('the usage view', () => {
  it('lists each agent’s accounts, a meter per window with what is left and when it resets', () => {
    const { dialog } = opened()
    expect(
      within(dialog)
        .getAllByRole('heading', { level: 3 })
        .map((one) => one.textContent),
    ).toEqual(['Claude Code', 'Codex', 'OpenCode'])
    const claude = within(dialog).getByRole('list', { name: 'Claude Code accounts' })
    expect(within(claude).getByText('Max plan')).toBeTruthy()
    const meters = within(claude).getAllByRole('meter')
    expect(meters.map((one) => one.getAttribute('aria-label'))).toEqual([
      'Claude Code work, 5 hours',
      'Claude Code work, Week',
      'Claude Code work, Opus',
    ])
    expect(meters[0]?.getAttribute('value')).toBe('72')
    expect(meters[0]?.getAttribute('aria-valuetext')).toBe('72% left, Resets 17:00')
    expect(within(claude).getByText('From Claude Code’s last report · 4m ago')).toBeTruthy()
  })

  it('tones a meter as it runs down, and still says the share in words', () => {
    const { dialog } = opened({ groups: RUNNING_LOW })
    const tone = (words: string) => within(dialog).getByText(words).parentElement?.getAttribute('data-tone')
    expect(tone('81% left')).toBe('plenty')
    expect(tone('40% left')).toBe('half')
    expect(tone('22% left')).toBe('low')
    expect(tone('9% left')).toBe('critical')
    expect(tone('4% left')).toBe('last')
  })

  it('says what is wrong with an account, not an empty row, and keeps the last numbers beside it, dimmed', () => {
    const { dialog } = opened({ groups: FAULTS })
    for (const head of [
      'Sign in again',
      'The usage source changed',
      'Can’t reach the usage source',
      'No usage data yet',
      'No usage source',
      'Can’t tell what this account uses',
    ])
      expect(within(dialog).getByText(head)).toBeTruthy()
    expect(within(dialog).getByText('Codex did not answer in time.')).toBeTruthy()
    // The windows kept beside a fault are the last ones: dimmed, and said so to a screen reader.
    const kept = within(dialog).getAllByRole('meter')
    expect(kept.length).toBeGreaterThan(0)
    for (const one of kept) expect(one.parentElement?.hasAttribute('data-stale')).toBe(true)
    expect(within(dialog).getAllByText('Last numbers read').length).toBeGreaterThan(0)
  })

  it('says an API key has no plan window, calmly', () => {
    const { dialog } = opened({ groups: WITH_KEY })
    expect(within(dialog).getByText('API key – no plan window')).toBeTruthy()
    expect(dialog.querySelector('[data-kind]')).toBeNull()
  })

  it('says so when there are no accounts', () => {
    const { dialog } = opened({ groups: [] })
    expect(within(dialog).getByText('No agent accounts yet.')).toBeTruthy()
    expect(within(dialog).queryAllByRole('meter')).toHaveLength(0)
  })

  it('reads again on press, and while it reads waits and says so', () => {
    const { onRefresh, dialog } = opened()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Read again' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('ignores presses while reading', () => {
    const { onRefresh, dialog } = opened({ reading: true })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reading…' }))
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('closes on Escape and on Close, and gives focus back to what had it', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const { onClose, dialog } = opened()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    trigger.remove()
  })

  it('takes the words it is given', () => {
    render(
      <Usage
        groups={FAULTS}
        onRefresh={() => {}}
        onClose={() => {}}
        text={{ title: 'Verbrauch', readAgain: 'Neu lesen', fault: { ...usageText.fault, sign_in_again: 'Neu anmelden' } }}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Verbrauch' })
    expect(within(dialog).getByText('Neu anmelden')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Neu lesen' })).toBeTruthy()
  })
})

describe('the usage notice', () => {
  const notice = (props: Partial<Parameters<typeof UsageNotice>[0]> = {}) => {
    const onSeen = vi.fn()
    const onOpen = vi.fn()
    render(<UsageNotice account="Codex · work" which="5-hour window" left={25} until="17:00" onSeen={onSeen} onOpen={onOpen} {...props} />)
    return { onSeen, onOpen, region: screen.getByRole('region', { name: 'Plan usage' }) }
  }

  it('says whose, how much and until when, and tones by what is left', () => {
    const { region } = notice()
    expect(within(region).getByRole('status').textContent).toBe('Codex · work: 25% of the 5-hour window is left, until 17:00.')
    expect(region.getAttribute('data-tone')).toBe('low')
  })

  it('leaves out the time when none was given', () => {
    const { region } = notice({ until: null, left: 5 })
    expect(within(region).getByRole('status').textContent).toBe('Codex · work: 5% of the 5-hour window is left.')
    expect(region.getAttribute('data-tone')).toBe('last')
  })

  it('is seen, or opens the usage view', () => {
    const { onSeen, onOpen, region } = notice()
    fireEvent.click(within(region).getByRole('button', { name: 'Open usage' }))
    expect(onOpen).toHaveBeenCalledOnce()
    fireEvent.click(within(region).getByRole('button', { name: 'Seen' }))
    expect(onSeen).toHaveBeenCalledOnce()
  })
})

describe('the usage button', () => {
  it('is named Usage, and says how many warnings wait once some do', () => {
    const view = render(<UsageButton />)
    expect(screen.getByRole('button', { name: 'Usage' }).textContent).not.toMatch(/\d/)
    view.rerender(<UsageButton waiting={1} />)
    expect(screen.getByRole('button', { name: 'Usage, 1 warning not seen' }).textContent).toContain('1')
    view.rerender(<UsageButton waiting={3} expanded />)
    const button = screen.getByRole('button', { name: 'Usage, 3 warnings not seen' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })
})
