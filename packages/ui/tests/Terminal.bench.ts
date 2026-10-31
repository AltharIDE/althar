import { measure } from '@althar/testing/performance'
import { test } from 'vitest'

import { plainTerminalLine } from '../src/thread/Terminal/Terminal'

/*
 * How fast a log's codes are taken off, for the performance run (`bun run test:performance`), which gates nothing: a
 * check's log is anyone's text, and many title codes that never end once took time growing with their square. What it
 * keeps is Terminal.test.ts's.
 */

const line = '\u001b]'.repeat(50_000)
/** Read once, as Vitest's module runner adds to each read of an import (vitest.dev/guide/benchmarking). */
const plain = plainTerminalLine

test('reads a log of unended title codes at once', (context) => measure(context, 200, { 'unended title codes': () => plain(line) }))
