import { describe, expect, it } from 'vitest'

import { browserCommand } from '../src/runtime/terminal'

describe('opening an agent’s sign-in page', () => {
  it('uses each system’s own way to open a page', () => {
    const page = 'https://auth.openai.com/oauth/authorize?a=1&b=2'
    expect(browserCommand(page, 'darwin')).toEqual(['open', page])
    // On Windows, the shell's handler for links, with no command line to quote the address's & for.
    expect(browserCommand(page, 'win32')).toEqual(['rundll32', 'url.dll,FileProtocolHandler', page])
    expect(browserCommand(page, 'linux')).toEqual(['xdg-open', page])
  })
})
