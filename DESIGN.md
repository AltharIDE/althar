# Design

The taste every change to Althar's interface, copy and site follows: the app, the kit and the site alike. Read it before UI, copy or site work.

It adds to what is already written, and doesn't repeat it:

- [packages/ui/ARCHITECTURE.md](packages/ui/ARCHITECTURE.md#styling-css-modules-and-tokens): what each colour means, the product voice's visual rules (no side stripes, coloured shadows, badge pills or selling copy), `data-rhythm` spacing, stacking levels, Iconoir and brand marks, and what accessibility means in a component.
- [packages/ui/src/styles/tokens.css](packages/ui/src/styles/tokens.css): the palette, the type and the motion, as tokens. Use them; don't invent a colour, a size or an ease.
- [ARCHITECTURE.md](ARCHITECTURE.md#accessibility): WCAG 2.2 AA, contrast, visible focus and reduced motion.
- [CONTRIBUTING.md](CONTRIBUTING.md#interface-copy): words on screen state facts plainly.
- [docs/glossary.md](docs/glossary.md): the words the interface uses.
- [brand/README.md](brand/README.md#using-the-mark): the mark, and violet never in it.

Rules marked "prefer" are leanings; follow them unless the screen gives a reason not to.

## Visual style

- **Keep it calm, with room to breathe.** Clear hierarchy and space between things; nothing blurs into one.
- **Cut text back.** Agents tend to put words everywhere; most screens need fewer.
- **Show a visible order of type sizes:** page title › section title › item name › help text.
- **Make secondary text smaller and lighter** than what it explains.
- **Line everything up.** Icons with the inputs beside them, and one icon column down a list.
- **Set code-like values in mono, looking like code:** commands, paths, branches.
- **Give syntax highlighting real contrast.** Colours you have to squint to tell apart aren't highlighting.
- **Be quiet by default, louder only where it matters.** Usage shows in the model picker, where it changes a choice, not on every screen.
- **Light is the default appearance; make dark just as polished.** Check both before calling a change done.
- **Prefer staying inside the warm beige palette.** No panel pops out cooler or brighter than the rest; dark is warm too.
- **Prefer quiet buttons to heavy black ones.**
- **Prefer focus rings for keyboard focus only** (`:focus-visible`), not on every click.
- **Prefer drawing other companies' marks cleanly,** without stray borders or boxes around them.
- **Prefer the app's usual padding in popovers,** rather than one of their own.

## Motion

- **Move cleanly first, playfully second.** The segmented control's highlight slides with a slight spring (`--ease-slide`), not a cartoon bounce.
- **Give motion a purpose:** where something came from or went, an answer to a press, or continuity. Nothing moves for decoration.
- **Name motion by what happens:** `--enter` for what arrives or answers, `--exit` (quicker) for what goes, `--move` for what is on screen and goes elsewhere, `--fast` for hover and colour. Ease out; never ease in.
- **Grow an overlay from what opened it,** from `--scale-pop` with a fade, never from nothing.
- **Leave still what happens many times a day or by key:** switching tabs, projects and rooms, the command menu, words as they stream.
- **Move only transform and opacity,** in a way that can turn back mid-way: transitions, or the browser's animations, not keyframes, for a state that flips.
- **Move a list as a whole.** Give its items a `data-move` key inside a `ListMotion`: an item slides to its new place, travels to another lane, comes in and fades out ([ADR-069](docs/decisions/069-motion-is-one-system-named-by-what-happens.md)).
- **With reduced motion, nothing travels or grows;** what comes and goes only fades.
- **Never let things jump.** No page shifting when an answer arrives, no widths that change as content updates, no reflow under the pointer while dragging.
- **Reserve the space.** Fix widths for numbers and labels that change, so their neighbours stay put.
- **Put a placeholder where the content will appear, and replace it in place.** A shimmering "thinking" line is where the reply lands.
- **On the site, don't animate text sections on scroll.** Where the site moves, it's a high-fidelity looping illustration.

## Layout and components

- **Don't use sidebars:** no side nav, index column or detail panel. Details open in place. Project settings' side nav is the one accepted exception.
- **Keep the top bar uncluttered.** One pill or chip rather than several.
- **Nothing overlaps or overflows:** labels, chips, model lists, queued messages, popovers. Check the longest name and the narrowest window.
- **Truncate with "…", and show the full text on hover.**
- **Never leave a button alone on its own row.** Put it beside what it acts on.
- **Lay a card out as a tidy list of facts,** not a wrapped run of dot-separated words.
- **Order a card's facts by urgency:** problems first, then what to do, then what's fine.
- **Make what blocks a task visible at a glance,** without opening it.
- **Never let a card's label contradict its facts.** "Ready" over a failing check is wrong.
- **Design empty states and banners.** A bare line of text isn't one; an empty state says what will be here and how it gets here, without being bleak.
- **Set destructive actions apart, in the danger colour.** Removing a project sits at the bottom of its settings, not among the ordinary ones.
- **Prefer compact lists to prose.**
- **Prefer keeping primary actions in sight on long forms** (sticky at the bottom).
- **Prefer using the width where it helps:** outputs and two-column layouts take it; the conversation stays narrow.
- **Prefer secondary actions on hover,** so a row at rest shows only what it is.

## Copy and voice

- **Never narrate what is plainly on screen.** "Closing the tab makes nothing." says nothing the person can't see.
- **Drop hints that state the obvious:** key hints like "Enter queues it", lines like "hands the conversation to …", status asides like "Codex out · 2m".
- **Don't add pressure words** like "Memory is tight" or "Busy". Show a problem when there is one, and what to do about it.
- **Talk like a person, not like the code.** No internal terms ("Unrestricted", "Resumed after a rejection") and no raw tool names (`moveIssues`).
- **Name a setting plainly, with its on and off clear:** "Resolve conflicts automatically", not a terse house phrase.
- **Don't repeat what is already visible.** No model name inside its own chat, no branch or date on every repository row, no breakdown of file counts beside the files.
- **Word everything for every OS.** No Mac-only words, no ⌘-only hints; a shortcut shows the key for the platform it runs on.
- **Write pull request descriptions as a teammate would:** why, what changed, and how it was reasoned about. No "evidence", review rounds or Althar's internal terms.
- **In a thread, an agent acknowledges briefly, narrates little and ends with a clear final message.**

## Interaction

- **Act in place.** A one-click action (push, approve, allow) never sends the person to another screen; answer it from the board, the tab or the menu bar.
- **Switch instantly.** Changing project or view shows what was there last time and refreshes quietly; no skeleton flash for something already seen.
- **Lose nothing on leaving a screen:** composer text, dictation, scroll position.
- **Show a validation error at its field, and scroll to it.** A message at the top of a form only for an error that belongs to no field.
- **Make every error recoverable.** Say what went wrong in plain words ("Claude Code is signed out.", not "Authentication required"), and offer the action that fixes it: sign in, reconnect, switch model, compact, retry. That action takes the person to exactly the place it's fixed, opened and focused there (Settings on that agent's sign-in, already started), and once it is fixed, Try again picks up where it stopped. Offer "Try again" alone only where trying again can work.
- **Don't ask the person to decide what Althar can decide.** After a restart, carry on.
- **Make state changes explicit.** Nothing moves between places silently; say where it went.
- **Make every element earn its place.** For each piece, ask what the person does with it. No duplicates, no labels repeating their content, no tallies, nothing placed at random.
- **Keep the main thing to watch the main thing.** Needs you is where a person looks; show only the buttons they must have, and leave the rest to the composer.
- **Simple and easy to use first,** and loose enough to bend as the product changes.

## Designing

The project's notes on prototyping, kept by the coordinator, hold the details. In short:

- **Prototype on a live local page,** built from the kit's real components and the app's real screens, with a bar along the bottom that swaps directions in place (A, B, C…, with keys). Light mode only. Never in Storybook, and never with lookalike components.
- **Leave the page's server running, and give its address first.** Screenshots are secondary: whole-window, grouped, ordered and captioned.
- **Start broad:** three to five genuinely different directions, including a crowded case and a narrow window.
- **Then narrow:** iterate only on the chosen direction, and keep its core as it was picked.
- **Delete the prototype once a direction is picked to build,** before building it; never patch it along beside the real thing.
- **Polish what is built to production quality,** in both appearances.
- **Treat a lead's recommendation as advice.** The person often picks differently; show the options fairly.

## Never

- Sidebars, a crowded top bar, heavy black buttons.
- Prototypes in Storybook or with lookalike components.
- Copy that narrates the screen, hints that state the obvious, jargon or internal labels.
- Mac-only wording, or a ⌘ with no other key beside it.
- The same fact shown twice.
- Text-heavy marketing sections; people don't read them.
- Overlapping or overflowing text, widths that shift, a page that jumps.
- A skeleton flash for something already seen.
- Errors gathered at the top of a form.
- A dead-end error: one with no way out, or only a "Try again" that can't fix it.
- Sending someone to another screen for a one-click action.
- A bleak empty state, or plain text standing in for a banner.
