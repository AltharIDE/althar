import { makeFakeLinear } from '../src/testing/fakeLinear'

/*
 * A fake Linear on http://127.0.0.1:8788, for running the Worker locally
 * without a Linear account: .dev.vars.example points LINEAR_API_URL at it,
 * and `bun run dev` runs the Worker beside it. The team has Triage on, and
 * the label is missing until the first report makes it. It prints every
 * request it gets: the operation and its variables (the description in
 * full), and for uploads the path, type, size and headers.
 */

const PORT = 8788
const fake = makeFakeLinear()

const print = (line = '') => process.stdout.write(`${line}\n`)

/** A variable's value on one line; the description gets its own block. */
const shown = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))

const report = (index: number) => {
  const call = fake.calls[index]
  if (call === undefined) return
  const path = new URL(call.url).pathname
  if (call.operation === null) {
    print(`${call.method} ${path} -> ${call.status}`)
    if (call.bytes !== null) print(`  ${call.headers['content-type'] ?? '(no type)'}, ${call.bytes.byteLength} bytes`)
    for (const [name, value] of Object.entries(call.headers)) if (name !== 'content-type') print(`  ${name}: ${value}`)
    print()
    return
  }
  print(`${call.method} ${path} ${call.operation} -> ${call.status}`)
  print(`  authorization: ${call.headers.authorization === undefined ? 'missing' : 'present'}`)
  const { input, ...rest } = call.variables
  for (const [name, value] of Object.entries(rest)) print(`  ${name}: ${shown(value)}`)
  if (typeof input === 'object' && input !== null) {
    const { description, ...fields } = Object.fromEntries(Object.entries(input))
    for (const [name, value] of Object.entries(fields)) print(`  input.${name}: ${shown(value)}`)
    if (typeof description === 'string') {
      print('  input.description:')
      for (const line of description.split('\n')) print(`    | ${line}`)
    }
  }
  print()
}

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  fetch: async (request) => {
    const response = await fake.handle(request)
    report(fake.calls.length - 1)
    return response
  },
})

print(`Fake Linear on http://127.0.0.1:${PORT}/graphql`)
print()
