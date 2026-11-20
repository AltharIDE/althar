import { readFileSync, readdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [output] = process.argv.slice(2)
const metadata = JSON.parse(readFileSync(0, 'utf8'))
const directory = join(output, 'worker-licenses')
mkdirSync(directory)
const summary = []
for (const entry of metadata.packages) {
  if (!entry.source) continue
  const label = `${entry.name}-${entry.version}`
  const source = dirname(entry.manifest_path)
  const licenses = readdirSync(source, { withFileTypes: true }).filter(
    (file) => file.isFile() && /^(license|licence|copying|copyright|notice|unlicense)([_.-]|$)/i.test(file.name),
  )
  if (licenses.length > 0) {
    const destination = join(directory, label)
    mkdirSync(destination)
    for (const file of licenses) copyFileSync(join(source, file.name), join(destination, file.name))
  }
  summary.push(`${label}  ${entry.license ?? entry.license_file ?? 'See included notices'}`)
}
writeFileSync(join(directory, 'DEPENDENCIES.txt'), summary.sort().join('\n') + '\n')
