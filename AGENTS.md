# Working in this repository as an agent

[PRINCIPLES.md](PRINCIPLES.md) is what Althar is, and stays. A change to what Althar does or shows holds to it.

[DEVELOPMENT.md](DEVELOPMENT.md) says how to set up, check and test. Before you finish a task, show that it works: [Showing a change works](DEVELOPMENT.md#showing-a-change-works) says how to screenshot a component's story or the desktop app, headless, and where the shots go.

Run only what is cheap and fast: the checks and unit tests of the packages you changed and of those that build on them, with few workers (Vitest's `--maxWorkers=1`), and an end-to-end spec only when your change is what it covers (`bun run test:e2e e2e/that.spec.ts`, one worker already). Don't run the full suites, coverage or the desktop app's whole end-to-end run: the pull request runs the checks and unit tests, and coverage, the end-to-end run and packaging run after merge on main ([Changes and CI](DEVELOPMENT.md#changes-and-ci)). Althar tells you when one fails. Other agents share this computer.
