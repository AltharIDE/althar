// @vitest-environment node
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { build } from 'vite'
import { describe, expect, it } from 'vite-plus/test'

/*
 * `measure:startup` is a measurement run by hand on a Mac, which nothing else builds: bundled by something other than
 * Vite, the store found no migrations and it failed only when someone next ran it. Here it is bundled as that script
 * does, with every migration the store has in it.
 */
describe('the startup measurement', () => {
  it('bundles as measure:startup builds it, with every migration of the store', async () => {
    const built = await build({
      configFile: join(import.meta.dirname, '../scripts/measure-startup.config.ts'),
      logLevel: 'silent',
      build: { write: false },
    })
    const outputs = (Array.isArray(built) ? built : [built]).flatMap((one) => ('output' in one ? one.output : []))
    const code = outputs.map((chunk) => ('code' in chunk ? chunk.code : '')).join('\n')
    const migrations = readdirSync(join(import.meta.dirname, '../../../packages/persistence-sqlite/src/migrations')).filter((name) =>
      /^\d{4}_[a-z0-9_]+\.ts$/.test(name),
    )
    expect(migrations.length).toBeGreaterThan(100)
    expect(migrations.filter((name) => !code.includes(`./${name}`))).toEqual([])
  })
})
