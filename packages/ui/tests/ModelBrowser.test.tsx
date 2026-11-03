import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ModelBrowser, type ModelBrowserProps } from '../src/composer/ModelBrowser/ModelBrowser'
import { effortFor, MODEL_LIST, RUNTIMES, UNKNOWN_MODEL } from '../src/fixtures/models'

function open(props: Partial<ModelBrowserProps> = {}) {
  const handlers = { onPick: vi.fn(), onClose: vi.fn(), onTogglePin: vi.fn(), onSetDefaultEffort: vi.fn(), onConnect: vi.fn() }
  render(
    <ModelBrowser
      models={[...MODEL_LIST, UNKNOWN_MODEL]}
      runtimes={RUNTIMES}
      value="claude-opus-5"
      pins={['gpt-5.2-codex']}
      defaultEffort={(m) => effortFor(m)}
      {...handlers}
      {...props}
    />,
  )
  const dialog = screen.getByRole('dialog')
  const search = within(dialog).getByRole('searchbox')
  const rows = () => within(dialog).getAllByRole('listitem')
  return { ...handlers, dialog, search, rows }
}

describe('ModelBrowser', () => {
  it('starts in the search, pinned first', () => {
    const { search, rows } = open()
    expect(search).toHaveFocus()
    expect(rows()[0]).toHaveAttribute('data-id', 'gpt-5.2-codex')
  })

  it('searches names, ids and runtime names; Enter uses the first', () => {
    const { search, rows, onPick, dialog } = open()
    fireEvent.change(search, { target: { value: 'openrouter' } })
    expect(rows().every((r) => r.textContent?.includes('OpenRouter'))).toBe(true)
    fireEvent.change(search, { target: { value: 'haiku' } })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('claude-haiku-4-5')
  })

  it('lists the usable models first, pinned first within each group, and the switched-off ones last', () => {
    const { rows, dialog, search, onPick } = open({ pins: ['gpt-5.2-codex', 'gemini-3-pro'], blocked: ['gpt-5.2-codex', 'kimi-k2'] })
    expect(rows().map((r) => r.dataset.id)).toEqual([
      'gemini-3-pro',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'gpt-5.2',
      'gpt-5-mini',
      'gemini-3-flash',
      'qwen3-coder',
      'devstral-small',
      'deepseek-v3.2',
      'glm-4.6',
      'grok-4',
      'llama-4-maverick',
      UNKNOWN_MODEL.id,
      'gpt-5.2-codex',
      'kimi-k2',
    ])
    /* the first usable model leads, so Enter from the search still picks it */
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(search).toHaveFocus()
    expect(onPick).toHaveBeenCalledWith('gemini-3-pro')
  })

  it('filters by pins and by runtime', () => {
    const { rows, dialog } = open()
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Pinned/ }))
    expect(rows()).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Ollama/ }))
    expect(rows().map((r) => r.dataset.id)).toEqual(['qwen3-coder', 'devstral-small', UNKNOWN_MODEL.id])
    expect(within(dialog).getByRole('radio', { name: /^Ollama/ })).toBeChecked()
    fireEvent.click(within(dialog).getByRole('radio', { name: /^All/ }))
    expect(rows().length).toBeGreaterThan(3)
  })

  it('moves with the arrows and back to the search; ⌘P pins the focused row', () => {
    const { search, dialog, onTogglePin } = open()
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    const first = document.activeElement as HTMLElement
    expect(first).toHaveAttribute('data-use')
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    expect(document.activeElement).not.toBe(first)
    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(dialog, { key: 'p', metaKey: true })
    expect(onTogglePin).toHaveBeenCalledWith('gpt-5.2-codex')
    fireEvent.keyDown(dialog, { key: 'p' })
    expect(onTogglePin).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    expect(search).toHaveFocus()
    /* Enter anywhere but the search is the focused button's own */
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    fireEvent.keyDown(dialog, { key: 'x' })
  })

  it('picks, pins, connects and closes', () => {
    const { dialog, onPick, onTogglePin, onConnect, onClose } = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /Use Kimi K2/ }))
    expect(onPick).toHaveBeenCalledWith('kimi-k2')
    fireEvent.click(within(dialog).getByRole('button', { name: /Pin Kimi K2/ }))
    expect(onTogglePin).toHaveBeenCalledWith('kimi-k2')
    fireEvent.click(within(dialog).getByRole('button', { name: /Connect/ }))
    expect(onConnect).toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a model from a runtime it does not know by the runtime id, and an empty search as none', () => {
    const { search, rows, dialog } = open({ runtimes: RUNTIMES.filter((r) => r.id !== 'ollama') })
    fireEvent.change(search, { target: { value: 'some-new' } })
    expect(rows()[0]).toHaveTextContent('ollama')
    fireEvent.change(search, { target: { value: 'nothing like this' } })
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0)
    fireEvent.keyDown(dialog, { key: 'Enter' })
  })

  describe('names and what sits beside them', () => {
    afterEach(() => vi.restoreAllMocks())
    const cutShort = () => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300)
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
    }

    it('says a cut name in full on focus, and on hover', async () => {
      cutShort()
      const { dialog } = open()
      fireEvent.focus(within(dialog).getByRole('button', { name: 'Use Claude Haiku 4.5' }))
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Claude Haiku 4.5')
      fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' })
      fireEvent.pointerMove(within(dialog).getByRole('button', { name: 'Use Claude Opus 5, in use' }))
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Claude Opus 5')
    })

    it('says a cut name in full on a switched-off row too', async () => {
      cutShort()
      const { dialog } = open({ blocked: ['claude-haiku-4-5'] })
      fireEvent.pointerMove(within(dialog).getByRole('button', { name: 'Use Claude Haiku 4.5' }).parentElement as HTMLElement)
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Claude Haiku 4.5')
    })

    it('says nothing more where the name is whole', () => {
      const { dialog } = open()
      fireEvent.focus(within(dialog).getByRole('button', { name: 'Use Claude Haiku 4.5' }))
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('has no "no reading", "in use", "not used" or "signed in" beside a name; the model in use is marked by the row', () => {
      const { dialog, rows } = open({ blocked: ['kimi-k2'], room: () => null })
      expect(dialog).not.toHaveTextContent(/no reading|in use|not used|signed in/)
      expect(within(dialog).getByRole('button', { name: 'Use Claude Opus 5, in use' })).toHaveAttribute('aria-current', 'true')
      expect(rows().filter((r) => r.querySelector('[aria-current]'))).toHaveLength(1)
    })

    it('shows a usage column only where a model has a reading, and the agent’s state only where it is off', () => {
      const runtimes = RUNTIMES.map((r) => (r.id === 'codex' ? { ...r, how: 'signed out' } : r))
      const room = (m: { id: string }) => (m.id === 'claude-opus-5' ? { left: 19, until: null, account: null } : null)
      const { dialog } = open({ runtimes, room })
      expect(within(dialog).getByText('Usage')).toBeInTheDocument()
      expect(within(dialog).getByText('19%')).toBeInTheDocument()
      expect(within(dialog).getAllByText('signed out').length).toBeGreaterThan(0)
    })

    it('leaves out the context column where no model shown has a window', () => {
      const { dialog, search } = open()
      expect(within(dialog).getByText('Context')).toBeInTheDocument()
      fireEvent.change(search, { target: { value: UNKNOWN_MODEL.id } })
      expect(within(dialog).queryByText('Context')).toBeNull()
      expect(within(dialog).queryByText('—', { selector: '[id$="-ctx"]' })).toBeNull()
    })
  })
})
