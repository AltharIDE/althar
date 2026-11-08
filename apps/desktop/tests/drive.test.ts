// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  acted,
  answerOf,
  chordOf,
  chosenOf,
  describedOf,
  doneOf,
  filledOf,
  inputOf,
  keydowns,
  keyEvents,
  layoutOf,
  lineWords,
  locatedOf,
  logsOf,
  logWords,
  MODIFIER,
  movedWords,
  pngSize,
  personUsed,
  readLogs,
  refusalWords,
  scrolledOf,
  signInWords,
  snapshotOf,
  stateWords,
  troubleSince,
  viewportWords,
  words,
} from '../src/main/browser/drive'

/*
 * What an agent driving a page beside its conversation needs that has no
 * Electron in it (ADR-100): the keys it presses, how the person's own input
 * is told from its, the log of what the page said and what failed, what the
 * in-page driver may answer (read as untrusted), and every answer in words.
 */

const picked = {
  selector: 'button.save',
  label: 'button.save',
  text: 'Save',
  rect: { x: 10, y: 20, width: 80, height: 32 },
  font: '14px · 500 · Inter',
  colour: '#000000',
  background: '#ffffff',
  page: { width: 640, height: 700 },
}

const found = {
  ok: true,
  ref: 'e12',
  role: 'button',
  name: 'Save',
  rect: { x: 10, y: 20, width: 80, height: 32 },
  at: { x: 50, y: 36 },
  picked,
  covered: null,
  disabled: false,
  editable: false,
  inView: true,
}

describe('keys', () => {
  const names = (key: string, mac = false) => {
    const chord = chordOf(key, mac)
    return chord.ok ? chord.strokes.map((stroke) => stroke.key) : chord.why
  }

  it('reads names, aliases, single characters and function keys', () => {
    expect(names('Enter')).toEqual(['Enter'])
    expect(names('return')).toEqual(['Enter'])
    expect(names('esc')).toEqual(['Escape'])
    expect(names('PageDown')).toEqual(['PageDown'])
    expect(names('arrowdown')).toEqual(['ArrowDown'])
    expect(names('F5')).toEqual(['F5'])
    expect(names('Space')).toEqual([' '])
    expect(names('a')).toEqual(['a'])
    expect(names('/')).toEqual(['/'])
    expect(names('é')).toEqual(['é'])
  })

  it('reads chords, modifiers first, ControlOrMeta as the system’s own', () => {
    expect(names('Control+A')).toEqual(['Control', 'a'])
    expect(names('Shift+Tab')).toEqual(['Shift', 'Tab'])
    expect(names('ctrl+shift+k')).toEqual(['Control', 'Shift', 'K'])
    expect(names('ControlOrMeta+K', true)).toEqual(['Meta', 'k'])
    expect(names('ControlOrMeta+K', false)).toEqual(['Control', 'k'])
    expect(names('Cmd+Option+I')).toEqual(['Meta', 'Alt', 'i'])
    expect(names('Control++')).toEqual(['Control', '+'])
    expect(names('+')).toEqual(['+'])
    expect(names('Shift')).toEqual(['Shift'])
  })

  it('says what it doesn’t know, with what it does', () => {
    for (const bad of ['', 'Fn', 'Control+Banana', 'Control+Control+A', 'Banana+A', 'a'.repeat(65)])
      expect(names(bad), bad).toMatch(/isn’t a key I know\. Use a name such as Enter/)
  })

  it('sends a chord’s keys down in order and up in reverse, the page typing only what no shortcut holds', () => {
    const chord = chordOf('Control+A', false)
    if (!chord.ok) throw new Error('A chord')
    const events = keyEvents(chord.strokes, false)
    expect(events.map((one) => `${String(one.type)} ${String(one.key)} ${String(one.modifiers)}`)).toEqual([
      `rawKeyDown Control ${MODIFIER.control}`,
      `rawKeyDown a ${MODIFIER.control}`,
      `keyUp a ${MODIFIER.control}`,
      `keyUp Control ${MODIFIER.control}`,
    ])
    expect(events.some((one) => 'text' in one)).toBe(false)
    expect(keydowns(chord.strokes)).toBe(2)
  })

  it('types the character of a plain key, and Enter as a return', () => {
    const letter = chordOf('Shift+a', false)
    const enter = chordOf('Enter', false)
    if (!letter.ok || !enter.ok) throw new Error('A chord')
    expect(keyEvents(letter.strokes, false)[1]).toMatchObject({
      type: 'keyDown',
      key: 'A',
      text: 'A',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
    })
    expect(keyEvents(enter.strokes, false)[0]).toMatchObject({ type: 'keyDown', key: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
  })

  it('gives a Mac its editing command for a shortcut, which its keyboard layer would have said', () => {
    const chord = chordOf('ControlOrMeta+A', true)
    if (!chord.ok) throw new Error('A chord')
    expect(keyEvents(chord.strokes, true)[1]).toMatchObject({ key: 'a', modifiers: MODIFIER.meta, commands: ['selectAll'] })
    expect(keyEvents(chord.strokes, false)[1]).not.toHaveProperty('commands')
  })
})

describe('the person’s input wins', () => {
  it('is the person when the page counts more real inputs than the lead sent', () => {
    const hand = { baseline: 4, injected: 1 }
    expect(personUsed(hand, 5)).toBe(false)
    expect(personUsed(hand, 6)).toBe(true)
    hand.injected = 3
    expect(personUsed(hand, 7)).toBe(false)
    expect(personUsed(hand, 8)).toBe(true)
  })

  it('begins again at a new document, which counts from none', () => {
    const hand = { baseline: 9, injected: 2 }
    expect(personUsed(hand, 0)).toBe(false)
    expect(hand).toEqual({ baseline: 0, injected: 0 })
    expect(personUsed(hand, 2)).toBe(true)
  })

  it('can’t tell where the page doesn’t say', () => {
    expect(personUsed({ baseline: 0, injected: 0 }, null)).toBe(false)
    expect(inputOf(3)).toBe(3)
    expect(inputOf(-1)).toBeNull()
    expect(inputOf('3')).toBeNull()
    expect(inputOf(Number.NaN)).toBeNull()
  })
})

describe('the log of what the page said', () => {
  it('numbers entries from one across the page’s life, keeping the last few hundred', () => {
    const logs = logsOf(3)
    expect(logs.mark()).toBe(0)
    for (const text of ['a', 'b', 'c', 'd']) logs.add('console', 'info', text)
    expect(logs.mark()).toBe(4)
    expect(logs.all().map((entry) => [entry.n, entry.text])).toEqual([
      [2, 'b'],
      [3, 'c'],
      [4, 'd'],
    ])
  })

  it('reads what came after a point, of one kind or both, and says where to read on', () => {
    const logs = logsOf()
    logs.add('console', 'error', 'TypeError: x is undefined (app.js:12)')
    logs.add('network', 'error', 'GET http://localhost:5173/api answered 500 Internal Server Error')
    logs.add('console', 'warn', 'deprecated')
    expect(readLogs(logs, 0, 'all').entries.map((entry) => entry.n)).toEqual([1, 2, 3])
    expect(readLogs(logs, 1, 'all').entries.map((entry) => entry.n)).toEqual([2, 3])
    expect(readLogs(logs, 0, 'network').entries.map((entry) => entry.n)).toEqual([2])
    expect(readLogs(logs, 0, 'console').entries.map((entry) => entry.level)).toEqual(['error', 'warning'])
    const read = readLogs(logs, 0, 'all', 2)
    expect(read).toMatchObject({ next: 2, more: 1, lost: false })
    expect(logWords(read, 0, 'all')).toBe(
      [
        'Console messages and failed requests since 0 (2 of 3):',
        '[1] console error TypeError: x is undefined (app.js:12)',
        '[2] network error GET http://localhost:5173/api answered 500 Internal Server Error',
        'Read on from 2 for the other 1. Log mark: 2.',
      ].join('\n'),
    )
  })

  it('says nothing new, with the mark to read from next, and says when older entries were dropped', () => {
    const logs = logsOf(2)
    for (const text of ['a', 'b', 'c']) logs.add('console', 'info', text)
    expect(logWords(readLogs(logs, 3, 'all'), 3, 'all')).toBe('Console messages and failed requests: nothing new since 3. Log mark: 3.')
    expect(logWords(readLogs(logs, 0, 'console'), 0, 'console')).toContain('(Older entries were dropped as the log filled.)')
  })

  it('keeps an entry to one line, cut short, and an unknown level as info', () => {
    const logs = logsOf()
    logs.add('console', 'verbose', `first\n  second   ${'x'.repeat(500)}`)
    const [entry] = logs.all()
    expect(entry?.level).toBe('info')
    expect(entry?.text.startsWith('first second x')).toBe(true)
    expect(entry?.text.length).toBe(400)
    expect(entry?.text.endsWith('…')).toBe(true)
  })

  it('tells what went wrong after a point in a line, and nothing where nothing did', () => {
    const logs = logsOf()
    logs.add('console', 'error', 'old')
    const mark = logs.mark()
    expect(troubleSince(logs, mark)).toBe('')
    logs.add('console', 'info', 'fine')
    expect(troubleSince(logs, mark)).toBe('')
    logs.add('console', 'error', 'boom')
    expect(troubleSince(logs, mark)).toBe('Meanwhile: 1 console error. page_logs with since 1 reads it.')
    logs.add('console', 'warning', 'hmm')
    logs.add('network', 'error', 'GET x failed: net::ERR_CONNECTION_REFUSED')
    logs.add('network', 'error', 'GET y answered 404')
    expect(troubleSince(logs, mark)).toBe(
      'Meanwhile: 1 console error, 1 console warning, 2 failed requests. page_logs with since 1 reads them.',
    )
  })
})

describe('what the in-page driver may answer', () => {
  it('is read whole, or not at all', () => {
    expect(locatedOf(found)).toEqual(found)
    expect(locatedOf({ ok: false, why: 'e9 isn’t on the page any more. Take a new snapshot.' })).toEqual({
      ok: false,
      why: 'e9 isn’t on the page any more. Take a new snapshot.',
    })
    for (const bad of [
      null,
      'found',
      {},
      { ok: true },
      { ...found, ref: 'x1' },
      { ...found, ref: 'e1; alert(1)' },
      { ...found, role: 7 },
      { ...found, name: 'n'.repeat(301) },
      { ...found, rect: { x: 1, y: 1 } },
      { ...found, at: { x: 'a', y: 1 } },
      { ...found, picked: { ...picked, selector: '' } },
      { ...found, covered: 4 },
      { ...found, disabled: 'no' },
      { ...found, editable: undefined },
      { ...found, inView: null },
      { ok: false },
      { ok: false, why: 5 },
    ])
      expect(locatedOf(bad), JSON.stringify(bad)).toBeNull()
    expect(locatedOf({ ...found, covered: 'div.modal' })).toMatchObject({ covered: 'div.modal' })
  })

  it('reads a snapshot, a layout, a scroll, a fill, a choice and a description the same way', () => {
    expect(snapshotOf({ ok: true, text: '- button "Save" [ref=e1]', nodes: 1, truncated: false })).toEqual({
      ok: true,
      text: '- button "Save" [ref=e1]',
      nodes: 1,
      truncated: false,
    })
    expect(snapshotOf({ ok: true, text: 3, nodes: 1, truncated: false })).toBeNull()
    expect(snapshotOf({ ok: true, text: 'x'.repeat(200_001), nodes: 1, truncated: false })).toBeNull()
    expect(snapshotOf({ ok: false, why: 'Nothing on the page matches `.x`.' })).toEqual({
      ok: false,
      why: 'Nothing on the page matches `.x`.',
    })
    expect(layoutOf({ width: 640, height: 700, scrollX: 0, scrollY: 10, contentWidth: 640, contentHeight: 2000 })).toMatchObject({
      contentHeight: 2000,
    })
    expect(layoutOf({ width: 640 })).toBeNull()
    expect(scrolledOf({ ok: true, x: 0, y: 5, atStart: false, atEnd: true })).toMatchObject({ atEnd: true })
    expect(scrolledOf({ ok: true, x: 0, y: 5 })).toBeNull()
    expect(filledOf({ ok: true, value: 'abc' })).toEqual({ ok: true, value: 'abc' })
    expect(filledOf({ ok: true, value: 4 })).toBeNull()
    expect(chosenOf({ ok: true, chosen: ['Spain'] })).toEqual({ ok: true, chosen: ['Spain'] })
    expect(chosenOf({ ok: true, chosen: [1] })).toBeNull()
    expect(chosenOf({ ok: true, chosen: Array.from({ length: 101 }, () => 'x') })).toBeNull()
    expect(describedOf({ ok: true, picked })).toEqual({ ok: true, picked })
    expect(describedOf({ ok: true, picked: {} })).toBeNull()
    expect(doneOf({ ok: true })).toEqual({ ok: true })
    expect(doneOf({ ok: false, why: 'No.' })).toEqual({ ok: false, why: 'No.' })
    expect(doneOf({ ok: 'yes' })).toBeNull()
  })

  it('reads a PNG’s size from its header, and nothing else’s', () => {
    const header = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
    header.writeUInt32BE(13, 8)
    header.write('IHDR', 12, 'ascii')
    header.writeUInt32BE(640, 16)
    header.writeUInt32BE(2_000, 20)
    expect(pngSize(header.toString('base64'))).toEqual({ width: 640, height: 2_000 })
    expect(pngSize(Buffer.from('not a picture at all, not even close').toString('base64'))).toBeNull()
    expect(pngSize('')).toBeNull()
  })
})

describe('what is said to the lead', () => {
  it('says why an address won’t open, and that the page stayed where it was', () => {
    expect(refusalWords('file', 'open')).toBe(
      'Files on this computer don’t open here: only http and https web pages do, so the page stayed where it was.',
    )
    expect(refusalWords('scheme', 'open', 'javascript:')).toBe(
      'Only http and https web pages open here, not javascript: addresses, so the page stayed where it was.',
    )
    expect(refusalWords('address', 'open')).toBe(words.notAnAddress)
    expect(refusalWords('file', 'action')).toBe(
      'That would have taken the page to a file on this computer. Only http and https web pages open here, so the page stayed where it was.',
    )
    expect(refusalWords('scheme', 'action')).toContain('isn’t a web page')
  })

  it('says a sign-in went to the person’s browser, and never happens in the page', () => {
    for (const service of ['Claude', 'GitHub', 'GitLab', 'Linear'] as const) {
      expect(signInWords(service, 'open')).toContain(`That is ${service}’s sign-in.`)
      expect(signInWords(service, 'action')).toContain(`That led to ${service}’s sign-in.`)
    }
    expect(signInWords('GitHub', 'open')).toContain('happen in the person’s own browser, never in this page')
  })

  it('says what the page’s guards did, line by line', () => {
    expect(lineWords(null)).toBeNull()
    expect(lineWords({ kind: 'refused', refusal: 'file' })).toContain('a file on this computer')
    expect(lineWords({ kind: 'sign-in', service: 'Linear' })).toContain('Linear’s sign-in')
    expect(lineWords({ kind: 'asked', asked: 'camera', host: 'meet.example' })).toBe(
      'meet.example asked for the camera, which pages here never get.',
    )
    expect(lineWords({ kind: 'asked', asked: 'location', host: '' })).toBe('The page asked for the location, which pages here never get.')
    expect(lineWords({ kind: 'download', name: 'report.pdf', offered: true })).toBe(
      'The page tried to download report.pdf. Downloads are refused here, and offered to the person’s browser instead.',
    )
    expect(lineWords({ kind: 'download', name: '', offered: false })).toBe('The page tried to download a file. Downloads are refused here.')
    expect(lineWords({ kind: 'failed', host: 'localhost:5173' })).toBe('localhost:5173 didn’t answer.')
    expect(lineWords({ kind: 'gone' })).toContain('page_move with reload')
  })

  it('says why Althar can’t help, plainly', () => {
    expect(words.noWindow('task')).toBe(
      'Althar has no window open, so there is no page beside this task to read or drive. Open Althar’s window and ask again.',
    )
    expect(words.noWindow('project')).toContain('beside this project’s conversation')
    expect(words.nothingOpen('task')).toBe('Nothing is open beside this task. page_open opens it at an address.')
    expect(words.quitting).toBe('Althar is quitting, so the page is going.')
    expect(words.yielded('')).toBe(
      'The person clicked, typed or scrolled in the page while you acted on it, so the action stopped. Take a new snapshot to see where the page is now.',
    )
    expect(words.yielded('the press had been made')).toContain('(the press had been made)')
  })

  it('says what is open beside a conversation, where, at what size, and what it says', () => {
    const base = {
      whose: 'task' as const,
      window: true,
      open: true,
      address: 'http://localhost:5173/refunds',
      title: 'Refunds',
      viewport: 'phone' as const,
      place: 'beside' as const,
      loading: false,
      back: true,
      forward: false,
      line: null,
      mark: 12,
    }
    expect(stateWords(base)).toBe(
      [
        'Page beside this task: http://localhost:5173/refunds (“Refunds”)',
        'Shown: beside the conversation, on screen',
        'Viewport: phone (390×844, a touch screen with a mobile browser’s agent)',
        'History: back is possible',
        'Log mark: 12',
      ].join('\n'),
    )
    expect(stateWords({ ...base, place: 'asleep', viewport: 'fit' })).toContain('Shown: asleep; it wakes where it was when a tool needs it')
    expect(stateWords({ ...base, place: 'waiting', loading: true, line: { kind: 'gone' }, window: false })).toContain('Loading now.')
    expect(stateWords({ ...base, window: false })).toContain('Althar’s window: not open')
    expect(stateWords({ ...base, open: false, whose: 'project' })).toBe(
      'Nothing is open beside this project’s conversation. page_open opens it at an address.',
    )
    expect(viewportWords('fit')).toBe('fit (the panel’s own size)')
  })

  it('names what it acted on, with the words a comment uses for the element', () => {
    const found = locatedOf({
      ok: true,
      ref: 'e12',
      role: 'button',
      name: 'Save',
      rect: picked.rect,
      at: { x: 50, y: 36 },
      picked,
      covered: null,
      disabled: false,
      editable: false,
      inView: true,
    })
    if (found === null || !found.ok) throw new Error('A found element')
    expect(acted('Clicked', found, ['', 'Log mark: 3.'])).toBe(
      ['Clicked button “Save”.', 'On `button.save` (“Save”), 80 × 32', 'Selector: `button.save`', 'Log mark: 3.'].join('\n'),
    )
    expect(acted('Pressed Enter', null, [])).toBe('Pressed Enter.')
    expect(movedWords('http://a/', { address: 'http://a/', title: 'A' })).toBe('')
    expect(movedWords('http://a/', { address: 'http://a/b', title: 'B' })).toBe('The page is now at http://a/b (“B”).')
  })

  it('gives a script’s answer as text, cut where it is long', () => {
    expect(answerOf(undefined)).toBe('undefined')
    expect(answerOf('Refunds')).toBe('Refunds')
    expect(answerOf({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(answerOf(7)).toBe('7')
    expect(answerOf('x'.repeat(20_050))).toContain('… (cut at 20000 characters)')
  })
})
