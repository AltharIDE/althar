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

## The site's changelog page

Major and minor versions only; patch releases don't touch the site.

- **Pick one theme** for the release: the feature people will be most excited by, not the biggest change or what people already expect to work. Its items lead New, in the notes and on the site.
- **A grand headline** for that theme, as the release's lead highlight in `HIGHLIGHTS` (`apps/site/src/changelog/takes/LogData.ts`). It opens the page, large: "Reviews, supercharged", "Automations". Under it, a line or two on why it matters.
- **The release's own title** in `changelog.ts` sits small above the headline, and is plainer: "Reviewed before you see it".
- **The lines** in `changelog.ts` are the notes' lines, shorter still, in the same order.
- **An animated picture** for the headline, in `LogPictures.tsx`: the app drawn as it looks, lit by the one cobalt light, playing the feature through on a loop. Text, marks and hairlines only, no pretend buttons or pills.
- **The animation never changes the page's height.** Whatever opens or grows does it inside room that is already there. It plays only while on screen in a shown tab, rests on its most telling frame with reduced motion, and fits a phone with no sideways scroll.

## With each release

- Raise `version` in `apps/desktop/package.json` and the matching line in `bun.lock`.
- For a major or minor version, add it to the site as above, and its publish time to `PUBLISHED` in `LogData.ts` once it's published.
