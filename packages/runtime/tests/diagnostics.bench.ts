import { measure } from '@althar/testing/performance'
import { test } from 'vitest'

import { diagnosticOf } from '../src/diagnostics'

/*
 * How fast a long failed output is read, for the performance run (`bun run test:performance`), which gates nothing: a
 * run of letters with no name in it (minified code, base64) once took minutes at 256 KB, and seconds at these sizes,
 * which stay within what is read for credentials. What it reads is diagnostics.test.ts's.
 */

/** Read once, as Vitest's module runner adds to each read of an import (vitest.dev/guide/benchmarking). */
const diagnostic = diagnosticOf
const failed = (printed: string) => () => diagnostic({ command: 'bun test', printed, error: null, exit: null, rawOutput: undefined })

test('reads a long output in time that grows with its length, not its square', (context) =>
  measure(context, 1_000, {
    'a run of letters': failed('a'.repeat(60_000)),
    'a name, then a run of letters': failed(`token${'a'.repeat(60_000)}`),
    'an address of colons': failed(`http://${'a:'.repeat(30_000)}`),
    'a key prefix, over and over': failed('sk-'.repeat(20_000)),
  }))
