import { assert, describe, it } from '@effect/vitest'

import { repairedWords, takenWords, unrepairedWords } from '../src/WorktreeRepair'

/* What a task's thread says of its folders' links, in each shape the repair can leave them. */

describe('the words of a repair', () => {
  it('says which folders were repaired, once', () => {
    assert.strictEqual(repairedWords(true, false), 'Folder link repaired')
    assert.strictEqual(repairedWords(false, true), 'Review copy’s folder link repaired')
    assert.strictEqual(repairedWords(true, true), 'Folder link repaired, and its review copy’s')
  })

  it('gives a way out where git couldn’t repair, with or without a branch, and ends git’s line once', () => {
    const onBranch = unrepairedWords('/w/task', false, '/r/main', 'althar/task', 'fatal: no')
    assert.include(onBranch.title, 'This task’s folder')
    assert.include(onBranch.description, 'git worktree add /w/task althar/task in /r/main')
    assert.isTrue(onBranch.description.endsWith('Git said: fatal: no.'))
    const detached = unrepairedWords('/w/task', false, '/r/main', null, 'fatal: no.')
    assert.include(detached.description, 'Its commits are safe in the repository')
    assert.isTrue(detached.description.endsWith('Git said: fatal: no.'))
    const copy = unrepairedWords('/w/.review/task/repo', true, '/r/main', null, 'fatal: no')
    assert.include(copy.title, 'The copy this task’s reviews read')
    assert.include(copy.description, 'Althar makes it again at the next review')
  })

  it('says whose record it would take, and leaves both', () => {
    const folder = takenWords('/w/task', false, '/r/main', 'althar/task', { folder: '/w/other' })
    assert.include(folder.title, 'linked to another copy, at /w/other')
    const branch = takenWords('/w/task', false, '/r/main', 'althar/task', { branch: 'althar/other' })
    assert.include(branch.title, 'another branch in the repository, althar/other')
    assert.include(branch.description, 'Its commits are safe on its branch, althar/task')
    const copy = takenWords('/w/.review/task/repo', true, '/r/main', null, { branch: 'althar/other' })
    assert.include(copy.title, 'The copy this task’s reviews read')
    assert.include(copy.description, 'remove the folder')
  })
})
