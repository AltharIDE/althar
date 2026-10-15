import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../src/frontmatter'
import { fileHashes, sha256, treeHash } from '../src/hash'
import { lintPushes } from '../src/lint'
import { isSafePath, validateSkill } from '../src/validate'
import { good, skillMd, tree } from './support'

const codes = (files: Record<string, string>, directory = 'my-skill') =>
  validateSkill(directory, tree(files)).findings.map((finding) => `${finding.level}:${finding.code}`)

describe('parseFrontmatter', () => {
  it('reads the block and the body, with CRLF and a byte-order mark', () => {
    const parsed = parseFrontmatter('\uFEFF---\r\nname: a\r\ndescription: >-\r\n  one\r\n  two\r\n---\r\nBody')
    expect(parsed?.data).toEqual({ name: 'a', description: 'one two' })
    expect(parsed?.body).toBe('Body')
  })

  it.each(['no block', '---\nname: a\nno end', '---\n: : :\n  - [\n---\n', '---\n- a\n- b\n---\n', '---\njust text\n---\n'])(
    'refuses %j',
    (text) => {
      expect(parseFrontmatter(text)).toBeNull()
    },
  )
})

describe('hashing', () => {
  it('gives one tree hash whatever the order, and another when a byte changes', () => {
    const a = tree({ 'SKILL.md': 'x', 'a/b.md': 'y' })
    const b = tree({ 'a/b.md': 'y', 'SKILL.md': 'x' })
    expect(treeHash(a)).toBe(treeHash(b))
    expect(treeHash(a)).not.toBe(treeHash(tree({ 'SKILL.md': 'x', 'a/b.md': 'z' })))
    expect(Object.keys(fileHashes(a))).toEqual(['SKILL.md', 'a/b.md'])
    expect(sha256(new Uint8Array())).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('isSafePath', () => {
  it.each(['SKILL.md', 'references/a.md', 'a/b/c.txt'])('accepts %s', (path) => expect(isSafePath(path)).toBe(true))
  it.each(['', '/etc/passwd', '../x', 'a/../../x', 'a//b', './a', 'a\\b', 'C:/x', 'a\0b', 'a/.'])('refuses %j', (path) =>
    expect(isSafePath(path)).toBe(false),
  )
})

describe('validateSkill', () => {
  it('accepts a plain skill and reports its name, description and licence', () => {
    const checked = validateSkill('my-skill', tree(good()))
    expect(checked).toMatchObject({ ok: true, name: 'my-skill', description: 'Use when testing.', license: 'MIT', findings: [] })
  })

  it('rejects allowed-tools and hooks, whatever they hold', () => {
    expect(codes({ 'SKILL.md': skillMd('name: my-skill\ndescription: d\nallowed-tools: Bash(git:*)') })).toEqual([
      'reject:authorizing-field',
    ])
    expect(codes({ 'SKILL.md': skillMd('name: my-skill\ndescription: d\nhooks:\n  PreToolUse: []') })).toEqual(['reject:authorizing-field'])
  })

  it('flags a field outside the specification without rejecting', () => {
    const checked = validateSkill('my-skill', tree({ 'SKILL.md': skillMd('name: my-skill\ndescription: d\ncolor: red') }))
    expect(checked.ok).toBe(true)
    expect(checked.findings.map((finding) => finding.code)).toEqual(['unknown-field'])
  })

  it('flags scripts, which Althar never runs', () => {
    expect(codes({ ...good(), 'scripts/run': 'x', 'tools/a.py': 'x' })).toEqual(['flag:executable', 'flag:executable'])
  })

  it.each([
    [{}, 'reject:no-skill-md'],
    [{ 'SKILL.md': 'no frontmatter' }, 'reject:bad-frontmatter'],
    [{ 'SKILL.md': skillMd('description: d') }, 'reject:no-name'],
    [{ 'SKILL.md': skillMd('name: My_Skill\ndescription: d') }, 'reject:bad-name'],
    [{ 'SKILL.md': skillMd('name: a--b\ndescription: d') }, 'reject:bad-name'],
    [{ 'SKILL.md': skillMd('name: other\ndescription: d') }, 'reject:name-mismatch'],
    [{ 'SKILL.md': skillMd('name: my-skill') }, 'reject:no-description'],
    [{ 'SKILL.md': skillMd('name: my-skill\ndescription: ""') }, 'reject:no-description'],
    [{ 'SKILL.md': skillMd(`name: my-skill\ndescription: ${'x'.repeat(1025)}`) }, 'reject:long-description'],
    [{ 'SKILL.md': skillMd('name: my-skill\ndescription: d\nmetadata:\n  n: 1') }, 'reject:bad-metadata'],
    [{ 'SKILL.md': skillMd('name: my-skill\ndescription: d\nmetadata: text') }, 'reject:bad-metadata'],
    [{ 'SKILL.md': skillMd(`name: my-skill\ndescription: d\ncompatibility: ${'x'.repeat(501)}`) }, 'reject:bad-compatibility'],
    [{ 'SKILL.md': skillMd('name: my-skill\ndescription: d\nlicense: 3') }, 'reject:bad-license'],
    [{ ...good(), '../escape.md': 'x' }, 'reject:unsafe-path'],
  ])('refuses %#', (files, code) => {
    expect(codes(files as Record<string, string>)).toContain(code)
  })

  it('refuses a skill with too many files or too many bytes', () => {
    const limits = { files: 1, bytes: 10, fileBytes: 5 }
    const checked = validateSkill('my-skill', tree({ ...good(), 'a.md': 'x' }), limits)
    expect(checked.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['too-many-files', 'too-large', 'file-too-large']),
    )
    expect(checked.ok).toBe(false)
  })
})

describe('lintPushes', () => {
  it('finds push and pull-request instructions in Markdown only, at the level asked', () => {
    const files = tree({
      'SKILL.md': 'Run `git push -u origin x` then `gh pr create`.',
      'references/a.md': 'glab mr create',
      'scripts/x.sh': 'git push',
      'clean.md': 'git pushover is a word',
    })
    expect(lintPushes(files, 'reject').map((finding) => `${finding.level} ${finding.path}`)).toEqual([
      'reject SKILL.md',
      'reject SKILL.md',
      'reject references/a.md',
    ])
    expect(lintPushes(files, 'flag')[0]?.level).toBe('flag')
  })
})
