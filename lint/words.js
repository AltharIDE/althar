import { defineRule } from 'vite-plus/lint/plugins'

/*
 * A task's status and the board's lanes are said in one set of words, the kit's (`taskStatusText` and `boardLaneText`,
 * in packages/ui/src/foundations/vocabularyText.ts, as docs/glossary.md says them). Written out again where a screen
 * shows them, a table drifts: the board's cards and the kit's said Waiting on you, the glossary's word for a stuck
 * lead's call alone, while the coordinator's thread said Needs you. This fails on an object that gives a
 * `TaskStatus` or `BoardLane` member a word of its own anywhere but there. A screen that says one differently spreads
 * the table and passes the word it says by a name, with why beside it.
 */

const VOCABULARIES = new Set(['TaskStatus', 'BoardLane'])

/** What a value is under `as` and `satisfies`. */
const bare = (node) => (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' ? bare(node.expression) : node)

/** A word written out: a string, or a template with nothing in it. */
const isWord = (node) =>
  (node.type === 'Literal' && typeof node.value === 'string') || (node.type === 'TemplateLiteral' && node.expressions.length === 0)

export const statusWords = defineRule({
  meta: {
    type: 'problem',
    messages: {
      word: '{{member}} is given a word of its own here. A task’s status and the board’s lanes are said in taskStatusText and boardLaneText (packages/ui/src/foundations/vocabularyText.ts): read the word there, or, where this place says it differently, pass that word by a name, with why.',
    },
  },
  create(context) {
    return {
      Property(node) {
        const { key } = node
        if (!node.computed || key.type !== 'MemberExpression' || key.object.type !== 'Identifier') return
        if (VOCABULARIES.has(key.object.name) && isWord(bare(node.value)))
          context.report({ node, messageId: 'word', data: { member: context.sourceCode.getText(key) } })
      },
    }
  },
})
