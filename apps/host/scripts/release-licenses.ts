import { readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

const retainedNotices = new Map([
  // This release omits LICENSE from its npm tarball. Keep the tagged license and the bundled BSD notice.
  ['@bufbuild/protobuf@2.17.0', new URL('./notices/bufbuild-protobuf-2.17.0.LICENSE', import.meta.url)],
])

/** Build-time only: retain the notices of modules actually included in the JavaScript bundle. */
export const releaseLicenses = () => ({
  name: 'host-release-licenses',
  generateBundle(this: {
    getModuleIds(): IterableIterator<string>
    emitFile(asset: { type: 'asset'; fileName: string; source: string }): string
  }) {
    const packages = new Map<string, string>()
    const visited = new Set<string>()
    for (const id of this.getModuleIds()) {
      if (!isAbsolute(id)) continue
      let directory = dirname(id.split('?')[0] ?? id)
      while (!visited.has(directory)) {
        visited.add(directory)
        let metadata: unknown
        try {
          metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
        } catch (error) {
          if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
          const parent = dirname(directory)
          if (parent === directory) break
          directory = parent
          continue
        }
        // Nested package.json files often only select ESM/CommonJS mode.
        if (
          typeof metadata !== 'object' ||
          metadata === null ||
          !('name' in metadata) ||
          typeof metadata.name !== 'string' ||
          !('version' in metadata) ||
          typeof metadata.version !== 'string'
        ) {
          const parent = dirname(directory)
          if (parent === directory) break
          directory = parent
          continue
        }
        if (!metadata.name.startsWith('@althar/')) {
          const files = readdirSync(directory)
            .filter((name) => /^(license|licence|copying|notice)(?:[.-].*)?$/i.test(name))
            .sort()
          const packageVersion = `${metadata.name}@${metadata.version}`
          const retained = retainedNotices.get(packageVersion)
          if (retained !== undefined) packages.set(packageVersion, readFileSync(retained, 'utf8'))
          else {
            if (files.length === 0) throw new Error(`Missing license notice for ${packageVersion}`)
            packages.set(packageVersion, files.map((name) => `${name}\n${readFileSync(join(directory, name), 'utf8')}`).join('\n\n'))
          }
        }
        break
      }
    }
    this.emitFile({ type: 'asset', fileName: 'LICENSE', source: readFileSync(new URL('../../../LICENSE', import.meta.url), 'utf8') })
    this.emitFile({
      type: 'asset',
      fileName: 'THIRD_PARTY_NOTICES.txt',
      source: [...packages.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, text]) => `${name}\n${'='.repeat(name.length)}\n${text}`)
        .join('\n\n'),
    })
  },
})
