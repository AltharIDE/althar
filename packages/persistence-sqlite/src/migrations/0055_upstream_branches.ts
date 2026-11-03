import { at } from './0001_initial/columns'

/*
 * A fork's tasks may push their branches to the repository it was forked
 * from, once its host says the person can push there (ADR-085): a third
 * place for its work, `upstream_branch`, beside opening pull requests there
 * from the fork's branches, or on the fork. The clone's remotes stay as they
 * are. When Althar first sees that the person can push there, it offers the
 * switch once; `upstream_offer_at` is when they took it or said not now, and
 * null while it hasn't been answered.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_change_target (word) VALUES ('upstream_branch')",
  `ALTER TABLE repository_bindings ADD COLUMN ${at('upstream_offer_at', { nullable: true })}`,
]
