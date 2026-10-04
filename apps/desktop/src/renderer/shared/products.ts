import type { Product } from '@althar/contracts'
import { Brand, IssuePriority, IssueStatus } from '@althar/ui'

/*
 * How a code host or tracker is drawn: its name and its mark, whichever of
 * its products it is (Cloud or Data Center), and an issue's status and
 * priority as the kit's.
 */

const PRODUCTS: Readonly<Record<Product, { readonly name: string; readonly brand: Brand }>> = {
  github: { name: 'GitHub', brand: Brand.GitHub },
  gitlab: { name: 'GitLab', brand: Brand.GitLab },
  bitbucket_cloud: { name: 'Bitbucket', brand: Brand.Bitbucket },
  bitbucket_dc: { name: 'Bitbucket', brand: Brand.Bitbucket },
  linear: { name: 'Linear', brand: Brand.Linear },
  jira_cloud: { name: 'Jira', brand: Brand.Jira },
  jira_dc: { name: 'Jira', brand: Brand.Jira },
  trello: { name: 'Trello', brand: Brand.Trello },
}

export const productName = (product: Product): string => PRODUCTS[product].name
export const productBrand = (product: Product): Brand => PRODUCTS[product].brand

/** An issue's status category, as the kit draws one. */
export const issueStatus = (category: 'triage' | 'backlog' | 'todo' | 'started' | 'done' | 'cancelled'): IssueStatus => {
  switch (category) {
    case 'triage':
    case 'backlog':
      return IssueStatus.Backlog
    case 'todo':
      return IssueStatus.Todo
    case 'started':
      return IssueStatus.InProgress
    case 'done':
      return IssueStatus.Done
    case 'cancelled':
      return IssueStatus.Cancelled
  }
}

/** An issue's priority, as the kit draws one; a level the kit doesn't know is none. */
export const issuePriority = (level: string): IssuePriority => {
  switch (level) {
    case 'urgent':
      return IssuePriority.Urgent
    case 'high':
      return IssuePriority.High
    case 'medium':
      return IssuePriority.Medium
    case 'low':
      return IssuePriority.Low
    default:
      return IssuePriority.None
  }
}
