import { BaseSequencer, type TestSpecification } from 'vite-plus/test/node'

import { balance, durations, fromRepository } from './shards.ts'

/** Preserve Vitest's sorting and isolation; only distribute files by their recorded cost. */
export default class DurationSequencer extends BaseSequencer {
  override shard(files: Array<TestSpecification>): Promise<Array<TestSpecification>> {
    const shard = this.ctx.config.shard
    if (shard === undefined) return Promise.resolve(files)
    return Promise.resolve(balance(files, shard.count, (file) => fromRepository(file.moduleId), durations())[shard.index - 1] ?? [])
  }
}
