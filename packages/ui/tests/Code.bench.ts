import { measure } from '@althar/testing/performance'
import { test } from 'vitest'

import { withoutLines } from '../src/thread/Code/code'

/*
 * How fast a name's lines are taken off a long run of what looks like lines, for the performance run (`bun run
 * test:performance`), which gates nothing: a pattern tried again from each place, failing at the end, took seconds over
 * these. What it reads is Code.test.tsx's.
 */

/** Read once, as Vitest's module runner adds to each read of an import (vitest.dev/guide/benchmarking). */
const strip = withoutLines
const read = (name: string) => () => strip(name)

test('reads a long run of what looks like lines at once, not again from each place', (context) =>
  measure(context, 100, {
    'line numbers, then not': read(`a${':9'.repeat(40_000)}\n!`),
    colons: read(`a${':'.repeat(100_000)}`),
    hashes: read(`a${'#'.repeat(100_000)}`),
  }))
