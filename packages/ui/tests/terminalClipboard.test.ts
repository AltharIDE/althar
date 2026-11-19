import { afterEach, describe, expect, it, vi } from 'vitest'

import { TerminalSession } from '../src/chrome/TerminalView/session'

/* What a shell prints never reaches the clipboard: copy is the person's selection, paste the Edit menu's. */

describe('a terminal’s output and the clipboard', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('neither writes nor reads the clipboard for an OSC 52 sequence it prints', async () => {
    const clipboard = { writeText: vi.fn(() => Promise.resolve()), readText: vi.fn(() => Promise.resolve('secret')) }
    vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard })
    const typed: string[] = []
    const session = new TerminalSession({ onData: (data) => typed.push(data), onResize: () => {} })
    session.write(`\x1b]52;c;${btoa('rm -rf ~')}\x07`)
    session.write('\x1b]52;c;not base64!\x07')
    session.write('\x1b]52;c;?\x07')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(clipboard.readText).not.toHaveBeenCalled()
    expect(typed).toEqual([])
    session.dispose()
  })
})
