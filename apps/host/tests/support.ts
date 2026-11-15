import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeTreeSync } from '@althar/testing'
import { afterEach } from 'vitest'

const roots: string[] = []
export const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-host-test-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) removeTreeSync(root)
})
