import type { Brand } from './brands/brands'

/** Where a change's pull request lives: its name, for words, and its mark when Althar has one. */
export interface CodeHost {
  /** GitHub, GitLab, a self-hosted Gitea. */
  name: string
  brand?: Brand
}
