import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vite-plus/test'

import { realPath, removeTree, removeTreeSync, slashPath } from '../src/files'

test('uses the same canonical temporary path as git, and keeps output paths portable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-test paths-'))
  try {
    const canonical = realPath(root)
    expect(existsSync(canonical)).toBe(true)
    expect(realPath(canonical)).toBe(canonical)
    expect(slashPath('C:\\Users\\test\\a folder')).toBe('C:/Users/test/a folder')
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'nested', 'file'), 'kept')
    await removeTree(root)
    expect(existsSync(root)).toBe(false)
    // Cleanup is safe when an earlier step has already removed what it made.
    removeTreeSync(root)
    await removeTree(root)
  } finally {
    removeTreeSync(root)
  }
})
