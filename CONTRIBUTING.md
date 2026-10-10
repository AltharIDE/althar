# Contributing to Althar

Thanks for wanting to help. Althar is early, so the most useful contributions right now are often not code.

## Ways to help

- **Use it on real work, and tell us what breaks.** Open [an issue](https://github.com/AltharIDE/althar/issues) with what you did, what you expected and what happened. Say which agents and models were involved, and attach the app's log if you can.
- **Tell us how you work.** What goes wrong today when you switch agents, run out of a plan's limit, or leave a task running overnight? An issue is the right place.
- **Argue with the thesis.** [THESIS.md](THESIS.md) makes claims about where software engineering is going. Tell us where it's wrong.
- **Bring an agent.** Agents join through the Agent Client Protocol, so a new one takes an adapter, not a rewrite. See [the agent runtime](docs/architecture/03-agent-runtime-and-auth.md) and `packages/provider-adapters`.
- **Fix something.** Issues labelled `good first issue` are a place to start.

For anything bigger than a bug fix, open an issue first so we can agree on the shape before you spend time on it.

## Before you change code

Read, in this order:

1. [DEVELOPMENT.md](DEVELOPMENT.md): setting up, the commands, and how the repository is laid out.
2. [ARCHITECTURE.md](ARCHITECTURE.md): the standards every app and package holds to.
3. The `README.md` and `ARCHITECTURE.md` of the app or package you're changing.
4. [The glossary](docs/glossary.md), before you put a word on screen.

## Making a change

1. Fork the repository and work on a branch.
2. Write the test first for new behaviour. Each app and package keeps at least 90% line and branch coverage.
3. Keep the interface accessible to WCAG 2.2 AA from the first version, not as a follow-up.
4. If the change is a consequential decision, add an ADR in [`docs/decisions`](docs/decisions).
5. Run what CI runs, in the packages you touched and the ones that depend on them:

   ```bash
   bun run verify
   ```

6. Open a pull request to `main`. Its title says what the change does for someone using Althar, as a sentence: "Connect Trello, with the API key its token was made for", not "feat(connectors): trello". Its description says why, what you checked, and anything a reviewer should look at closely.

Pull requests are squash-merged once every check is green and a maintainer has reviewed them.

### Interface copy

Words on screen state facts plainly. They don't sell, justify or joke. Use the glossary's words, and match the screens around yours.

## Licence of contributions

Althar is licensed under the [Apache License 2.0](LICENSE). Unless you say otherwise, anything you submit for inclusion is licensed under the same terms, as section 5 of the licence sets out. There is no separate contributor agreement to sign.

## Conduct

Everyone taking part in Althar's spaces follows the [code of conduct](CODE_OF_CONDUCT.md).

## Security

Please don't report security problems in public issues. See [SECURITY.md](SECURITY.md).
