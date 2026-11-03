# Release notes

One file per version, `<version>.md`, covering everything merged since the last tag. The release run refuses a tag without one, and its text becomes the GitHub release's body.

## How to write them

- **Open with one line,** "What changed since 0.6.1.", then a short paragraph naming the release's biggest changes plainly.
- **Three sections:** New, Improved, Fixed, in that order. No "Before you update" section; a change people must know about goes under Improved, beside the line it belongs with.
- **Sort New by how exciting each item is,** the most eye-catching first, not by size of the change or the order it merged.
- **Plain feature names as lead-ins.** Bold, and saying what the thing is: "Usage per task", "Mermaid diagrams", "Intel Mac build". No poetic or clever titles.
- **Keep each line compact and high-level:** one short sentence on what you can now do or what changed. No implementation details, limits, edge cases or setting paths unless the feature can't be found without one.
- **Fixed lines** say what no longer goes wrong, in a sentence, without a bold lead-in.
- **Describe the final behaviour once.** Work that was reworked, or a bug introduced and fixed within the same release, gets one line or none.
- **Leave out** what people never see: tests, CI, flaky-test fixes, ADRs and research, site-only changes, and dependency updates.
- **Name the agent adapters' versions** in a last Improved line: "Claude Code's adapter is 0.100.0 and Codex's is 2.5.0."
- **End with** "Tell us what breaks: Report a problem in the app, or https://github.com/AltharIDE/althar/issues".

## With each release

- Raise `version` in `apps/desktop/package.json` and the matching line in `bun.lock`.
- For a major or minor version, add it to the site's changelog (`apps/site/src/content/changelog.ts`) in shorter lines still, and its publish time to `PUBLISHED` in `apps/site/src/changelog/takes/LogData.ts` once it's published. Patch releases don't touch the site.
