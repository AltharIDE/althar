import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { fileHolds } from '../src/testing/fileHolds'

describe('a fake agent held across processes', () => {
  it('waits for the other side, can be held again, and leaves unnamed markers alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'althar-holds-'))
    try {
      const files = { '[answers-after:5s]': join(dir, 'answer') }
      const agent = fileHolds(files)
      const test = fileHolds(files)
      expect(test.waiting('[answers-after:5s]')).toBe(false)
      expect(agent.opened('[answers-after:5s]')).toBe(false)
      expect(test.waiting('[answers-after:5s]')).toBe(true)
      expect(agent.has?.('[lead:slowly]')).toBe(false)
      expect(agent.opened('[lead:wait]')).toBe(false)
      test.open('[answers-after:5s]')
      expect(agent.opened('[answers-after:5s]')).toBe(true)
      test.close('[answers-after:5s]')
      expect(test.waiting('[answers-after:5s]')).toBe(false)
      expect(agent.opened('[answers-after:5s]')).toBe(false)
      expect(() => test.open('misspelled')).toThrow('No file holds')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
