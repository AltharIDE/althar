import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { apiSchema } from './apiSchema'

// Writes api.schema.json; `bun run snapshot` formats it as the repository formats JSON, and tests/apiSchema.test.ts compares.
writeFileSync(join(import.meta.dirname, '../api.schema.json'), `${JSON.stringify(apiSchema(), null, 2)}\n`)
