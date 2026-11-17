import { describe, expect, it } from 'vitest'

import { commandAtGlance, readCommand } from '../src/lib/runCommand'

describe('a run’s command, read for a person', () => {
  it('takes its folder, what it sets, the program by its own name, its words and its options apart', () => {
    expect(readCommand('cd packages/ui && PORT=6143 ../../node_modules/.bin/vp dev --config prototypes/x/vite.config.mjs --open')).toEqual({
      dir: 'packages/ui',
      env: [['PORT', '6143']],
      program: 'vp',
      words: ['dev'],
      options: [{ flag: '--config', value: 'prototypes/x/vite.config.mjs' }, { flag: '--open' }],
    })
  })

  it('keeps a quoted folder, quoted settings and $( ) whole, and an option written with =', () => {
    expect(readCommand(`cd "my app" && ALTHAR_PROFILE="$(mktemp -d -t althar fresh)" bun run dev --remote-debugging-port=9222`)).toEqual({
      dir: 'my app',
      env: [['ALTHAR_PROFILE', '$(mktemp -d -t althar fresh)']],
      program: 'bun',
      words: ['run', 'dev'],
      options: [{ flag: '--remote-debugging-port', value: '9222', joined: true }],
    })
  })

  it('reads a plain command as it is, with nothing before it', () => {
    expect(readCommand('npm run dev -- --host')).toEqual({
      env: [],
      program: 'npm',
      words: ['run', 'dev'],
      options: [{ flag: '--' }, { flag: '--host' }],
    })
  })

  it('says what it runs at a glance, or the command where there is nothing to read', () => {
    expect(commandAtGlance('cd web && ../../node_modules/.bin/vite --port 5173')).toBe('vite')
    expect(commandAtGlance('bun run dev')).toBe('bun run dev')
    expect(commandAtGlance('   ')).toBe('')
  })
})
