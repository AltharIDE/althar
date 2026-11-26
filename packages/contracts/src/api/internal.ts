import { Schema } from 'effect'

/* What modules of the contract share and the package doesn't export (index.ts doesn't re-export this module). */

export const CodeLine = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
