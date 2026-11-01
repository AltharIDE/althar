/* Test the actual deployment artifacts, after prerendering, on every build. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { NOT_FOUND, PAGE_META } from '../src/content/pages'

const dist = resolve(import.meta.dirname, '../dist')
for (const page of [...Object.values(PAGE_META), NOT_FOUND]) {
  const file = page.path === '/' ? 'index.html' : `${page.path.slice(1)}.html`
  const html = await readFile(resolve(dist, file), 'utf8')
  const head = html.split('</head>')[0]!
  const content = (key: string) => {
    const tags = [...head.matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"\s*\/?\s*>/g)]
    const matches = tags.filter((tag) => tag[1] === key)
    assert.equal(matches.length, 1, `${file}: expected one ${key}`)
    return matches[0]![2]!
  }
  const image = content('og:image')
  assert.match(image, /^https?:\/\/[^/]+\/og\//, `${file}: absolute og:image`)
  assert.equal(content('twitter:card'), 'summary_large_image', file)
  assert.equal(content('twitter:image'), image, file)
  assert.equal(content('twitter:title'), content('og:title'), file)
  assert.equal(content('twitter:description'), content('og:description'), file)
}
console.warn('built HTML: all 7 pages and 404 have absolute social images and complete Twitter cards')
