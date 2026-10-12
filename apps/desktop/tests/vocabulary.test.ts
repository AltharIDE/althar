import { describe, expect, it } from 'vitest'

import { NO_VOCABULARY, partsOf, respell, vocabularyOf } from '../src/renderer/shared/dictation/vocabulary'

/*
 * The project's own names in what was said: the speech model writes
 * `RefundLedger` as "refund ledger"; where the code has that name, it is
 * written as the code writes it. Ordinary sentences stay ordinary.
 */

const project = vocabularyOf([
  'RefundLedger',
  'RefundLedger.ts',
  'refundLedger',
  'RefundLedgerEntry',
  'useEffect',
  'idempotency_key',
  'MAX_RETRIES',
  'meridian-api',
  'charges.ts',
  'isOpen',
  'getUser',
  'toString',
  'README',
])

describe('the project’s names in what was said', () => {
  it('says a name as its parts', () => {
    expect(partsOf('RefundLedger')).toEqual(['refund', 'ledger'])
    expect(partsOf('useEffect')).toEqual(['use', 'effect'])
    expect(partsOf('MAX_RETRIES')).toEqual(['max', 'retries'])
    expect(partsOf('meridian-api')).toEqual(['meridian', 'api'])
    expect(partsOf('HTTPServer')).toEqual(['http', 'server'])
    expect(partsOf('v2Client')).toEqual(['v2', 'client'])
  })

  it('writes names as the code does, the one used most where two are said alike, and the longest that fits', () => {
    expect(respell('Open use effect in the refund ledger, then refund ledger entry.', project)).toBe(
      'Open useEffect in the RefundLedger, then RefundLedgerEntry.',
    )
    expect(respell('Check the Idempotency Key and max retries in Meridian API.', project)).toBe(
      'Check the idempotency_key and MAX_RETRIES in meridian-api.',
    )
  })

  it('keeps what follows a name: an ’s, a full stop', () => {
    expect(respell("The refund ledger’s tests and the refund ledger's.", project)).toBe("The RefundLedger’s tests and the RefundLedger's.")
  })

  it('writes a file the project has, said or written with its ending', () => {
    expect(respell('Look in refund ledger dot TS and charges dot ts.', project)).toBe('Look in RefundLedger.ts and charges.ts.')
    expect(respell('Look in refund ledger.TS, not ledger.ts.', project)).toBe('Look in RefundLedger.ts, not ledger.ts.')
  })

  it('leaves sentences alone: names with small words, words a comma parts, and single words', () => {
    expect(respell('The task is open, so get user to string it. Refund, ledger.', project)).toBe(
      'The task is open, so get user to string it. Refund, ledger.',
    )
    expect(respell('Read the readme.', project)).toBe('Read the readme.')
  })

  it('leaves what was said alone without the project’s names', () => {
    expect(respell('the refund ledger', NO_VOCABULARY)).toBe('the refund ledger')
    expect(respell('the refund ledger', vocabularyOf(['README']))).toBe('the refund ledger')
  })
})
