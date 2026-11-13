import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { fromRepository } from './shards'

/** Optional measurements, never test outcomes or a reason to turn a failed check green. */
export const recordTiming = (file: string, milliseconds: number) => {
  const report = process.env.TEST_TIMINGS
  if (report === undefined || !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) || !Number.isFinite(milliseconds) || milliseconds <= 0) return
  try {
    mkdirSync(dirname(report), { recursive: true })
    appendFileSync(
      report,
      `${JSON.stringify({
        platform: process.platform,
        file: fromRepository(file),
        milliseconds,
        run: process.env.GITHUB_RUN_ID,
        job: process.env.GITHUB_JOB,
      })}\n`,
    )
  } catch (error) {
    process.stderr.write(`Could not record test timing: ${String(error)}\n`)
  }
}
