import { GITHUB_TRACKING } from './github'
import { GITLAB_TRACKING } from './gitlab'
import { JIRA_TRACKING } from './jira'
import { LINEAR_TRACKING } from './linear'
import {
  type IssueField,
  type IssueFilter,
  IssueField as IssueFields,
  IssueFilter as IssueFilters,
  type Product,
  type TrackerCapabilities,
} from './model'
import { TRELLO_TRACKING } from './trello'

/*
 * What each tracker Althar connects to can find and change, from the
 * capabilities its adapter has (`TrackerCapabilities`), read without a
 * connection: for the table agents read in their tools' descriptions, and
 * for a fake that finds as its product does. Jira's two editions find and
 * change alike.
 */

/** The trackers, by what a person calls each, in the order the table shows them. */
export const TRACKERS = [
  { name: 'Linear', products: ['linear'], capabilities: LINEAR_TRACKING },
  { name: 'Jira', products: ['jira_cloud', 'jira_dc'], capabilities: JIRA_TRACKING },
  { name: 'Trello', products: ['trello'], capabilities: TRELLO_TRACKING },
  { name: 'GitHub', products: ['github'], capabilities: GITHUB_TRACKING },
  { name: 'GitLab', products: ['gitlab'], capabilities: GITLAB_TRACKING },
] as const satisfies ReadonlyArray<{
  readonly name: string
  readonly products: ReadonlyArray<Product>
  readonly capabilities: TrackerCapabilities
}>

/** A product's tracker capabilities; none for a code host that has no issues (Bitbucket's). */
export const trackerCapabilities = (product: Product): TrackerCapabilities | undefined =>
  TRACKERS.find((tracker) => (tracker.products as ReadonlyArray<Product>).includes(product))?.capabilities

/** What each filter is called in the table and in find_issues. */
const FILTER_WORDS: Readonly<Record<IssueFilter, string>> = {
  text: 'words (text)',
  labels: 'labels',
  status: 'status, by name or category',
  project: 'project',
  milestone: 'milestone',
  cycle: 'cycle',
  assignee: 'assignee, anyone',
  priority: 'priority',
  parent: 'parent',
  updatedSince: 'updated since',
  keys: 'keys, a run or a list',
}

/** What each field is called in the table and in change_issue. */
const FIELD_WORDS: Readonly<Record<IssueField, string>> = {
  status: 'status',
  close: 'close',
  priority: 'priority',
  assignee: 'assignees',
  labels: 'labels',
  project: 'project',
  milestone: 'milestone',
  cycle: 'cycle',
  parent: 'parent',
  estimate: 'estimate',
  type: 'type',
  components: 'components',
  due: 'due date',
  title: 'title',
  description: 'description',
}

const row = (cells: ReadonlyArray<string>) => `| ${cells.join(' | ')} |`

/** A table in Markdown, a column per tracker, from their capabilities. */
const table = (
  title: string,
  rows: ReadonlyArray<{ readonly name: string; readonly cell: (capabilities: TrackerCapabilities) => string }>,
) =>
  [
    row([title, ...TRACKERS.map((tracker) => tracker.name)]),
    row(['---', ...TRACKERS.map(() => '---')]),
    ...rows.map((one) => row([one.name, ...TRACKERS.map((tracker) => one.cell(tracker.capabilities))])),
  ].join('\n')

/**
 * What each tracker's search narrows by: `yes` by its own search; `Althar`
 * where Althar narrows what its search gives, so a page can hold fewer;
 * `no` where it has no such field, and a search by it isn't made there.
 */
export const findTable = (): string =>
  table(
    'Find by',
    IssueFilters.literals.map((filter) => ({
      name: FILTER_WORDS[filter],
      cell: (capabilities) => {
        const by = capabilities.finds[filter]
        return by === 'search' ? 'yes' : by === 'after' ? 'Althar' : 'no'
      },
    })),
  )

/** What of an issue each tracker changes, and how many people an issue there has. */
export const changeTable = (): string =>
  table('Change', [
    ...IssueFields.literals.map((field) => ({
      name: FIELD_WORDS[field],
      cell: (capabilities: TrackerCapabilities) =>
        !capabilities.changes.includes(field)
          ? 'no'
          : field === 'assignee'
            ? capabilities.assignees === 'one'
              ? 'one'
              : 'several'
            : 'yes',
    })),
    { name: 'link a pull request', cell: (capabilities: TrackerCapabilities) => (capabilities.links ? 'yes' : 'by its name') },
  ])
