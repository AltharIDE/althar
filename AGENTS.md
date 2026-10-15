# Working in this repository as an agent

[DEVELOPMENT.md](DEVELOPMENT.md) says how to set up, check and test. Before you finish a task, show that it works: [Showing a change works](DEVELOPMENT.md#showing-a-change-works) says how to screenshot a component's story or the desktop app, headless, and where the shots go.

Run the checks and tests of the packages you changed and of those that build on them, and the end-to-end specs your change touches (`bun run test:e2e e2e/that.spec.ts`), with few workers (`--maxWorkers=1`). Leave the full suites, the desktop app's end-to-end run above all, to CI: the pull request runs them, and Althar tells you when one fails. Other agents share this computer.
