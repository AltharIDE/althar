# @charrette/ui — Architecture

This package holds Charrette's interface components: the primitives (buttons, menus, popovers), the thread (messages, tool calls, steps, permissions), the composer, the coordinator's cards, the board, the dock beside it, a task's outputs, and the window's chrome. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target. This document adds what is specific to UI components. Where the code does not yet meet it, see **Gaps** at the end.

- **Owner:** Repository maintainers
- **Consumers:** the Charrette desktop shell. The pitch app may adopt components later.
- **Dependency direction:** apps depend on this package; it depends on no app. Inside the package: `foundations` ← `primitives` ← `composer`, `thread`, `coordinator`, `board`, `dock`, `outputs`, `chrome`, `setup` ← `onboarding`. A layer imports only from layers to its left; the eight in the middle don't import each other, and nothing imports `onboarding`, which composes them. `fixtures` and `storybook` are for stories, tests and the workbench, and nothing in `src` outside them imports them. The demo models, the runtimes, pins and default efforts live in `fixtures/models.ts`, standing in for what a consumer owns.

## Principles

### Components are presentational and composable from outside

A component renders what it is given and reports what happened. It does not fetch, persist, subscribe to app stores, or know which project, task, or model catalogue it is in.

- **Data comes in as props, already resolved.** A component takes a `ModelInfo`, not a model id it then looks up in a registry. Lists, counts and names are props. The same goes for how something is drawn: `Model`, `Listening` and `Arrived` take a `Brand`, not a lab or a source kind that they would map to a mark themselves.
- **Data never lives in a component file.** Drawings, lookup tables and registries each get their own module: brand drawings in `foundations/brands/brands.ts`, which lab or source takes which mark in `foundations/brands/resolve.ts`, and the icon table in `foundations/Icon/icons.ts`. A component file holds the component, its props, and its `text`. The consumer, or a fixture standing in for it, calls the lookups and passes the result down.
- **Effects go out as callbacks.** Examples are `onSelect`, `onAnswer`, `onStop` and `onTogglePin`. Nothing inside writes to storage or calls a service.
- **Local UI state is fine, and replaceable.** Examples are whether a fold is open, which option is highlighted, or a draft in a field. Where a parent may need to drive that state, offer the controlled pair (`open` / `onOpenChange`) alongside an uncontrolled default (`defaultOpen`). `useControlled` (`src/lib/controlled.ts`) does the wiring, and everything that folds takes the `Disclosable` props and uses `useDisclosure`.
- **No dead controls.** A button whose action belongs to the consumer, like Quote, Open in the editor, or Connect a runtime, renders only when its callback is given. A component never shows a control that does nothing.
- **Build on what exists.** Where a primitive or another component already does the job, use it and compose from it. Don't draw it again in the component's own markup and CSS. A component styles what it uses only to place it in its context. If the existing piece doesn't quite fit, extend it rather than copying it.
- **Composition over configuration.** Prefer `children` and slots (`above`, `trigger`, `card`) to growing lists of flags. For example, the Composer does not know about models: its `picker` and `meter` slots take a ModelPick and a ContextRing, which the consumer wires to its own state. A component that needs a new variant for one caller usually needs a slot instead.
- **Context only for host services.** Examples are opening a side panel or a lightbox (`Shell`). Such context must have harmless defaults, so every component renders alone in a story.

### No raw strings inside components

Every word a component shows or announces, including accessible names and live-region text, comes from the parent. There are two routes, in order of preference:

1. **A prop**, when the text is content: a message body, a title, a command.
2. **A `text` prop with English defaults**, when the text is the component's own copy. Examples are "Copy", "Worked for 12m", "Stop listening to PR 1206" and "Needs your permission".

Each component with its own copy exports its shape and its defaults, and interpolations are functions:

```ts
export interface WorkedForText { took: (duration: string) => string }
export const workedForText: WorkedForText = { took: (d) => `Worked for ${d}` }

export function WorkedFor({ text, ...props }: WorkedForProps) {
  const t = { ...workedForText, ...text }
}
```

The prop named `text` is always the component's copy. Content that happens to be text gets another name: `content` for streamed prose, `value` for what CopyButton copies, `question`, `label`.

Translations live in the consumer. It passes `text` from its own translation files, or wraps components once to do so. The English defaults exist so that stories and the workbench read naturally. They are not the product's copy source.

The same holds for formatting: dates, durations, counts and file sizes arrive formatted.

### Types: enums for vocabularies, unions for looks

- **Domain vocabularies are `enum`s, in `src/foundations/vocabulary.ts`:** for example `ToolKind`, `ToolState`, `StepState`, `Decision`, `FindingState`, `GraphNodeState`, `TaskStatus`, `TaskEnd`, `PermissionPolicy` and `IssueStatus`. Where a protocol has its own vocabulary, ours is a superset of it: `ToolKind` covers every ACP tool kind, and `ToolState` adds Declined and Cancelled to ACP's statuses. These are string enums, so values are readable in data and stories. They are shared, named, and exhaustively handled. Open-ended sets stay strings; a runtime id is an example, because consumers add runtimes.
- **Visual options stay string-literal unions:** `variant`, `tone`, `size`, `placement`, `align`. They read naturally in JSX (`variant="signal"`), and are the component's own business.
- **Branch on a vocabulary with a `switch` that TypeScript checks for exhaustiveness.** Examples are choosing a glyph or a label, as in `labBrand`, `Tool`'s glyph and `Step`'s track. End it with `default: return unreachable(value)`, so a new member fails the build wherever it is not handled. Don't use chained ternaries or ad hoc lookup tables whose keys can drift from the type. A `Record<Enum, …>` is fine when it is a pure table and the compiler enforces every key, as for per-state copy in a `text` object.
- The repository's rules apply unchanged: strict mode, no `any`, no non-null assertions, no unchecked casts.

### Styling: CSS Modules and tokens

- **One folder per component,** holding `Component.tsx`, `Component.module.css` and `Component.stories.tsx`. A small family that is always used together, like `Menu`, `MenuItem` and `MenuRadioGroup`, may share a folder.
- **Global CSS is only tokens and a zero-specificity base** (`src/styles`). The base's resets and focus ring are wrapped in `:where()`, so any module rule wins. There are no global class names, apart from `ch-root`, which carries type into portals and the top layer.
- **Colour is semantic, and each colour has one meaning:**
  - cobalt `--live` is work in motion
  - violet `--signal` is a decision that waits on a person
  - green is only for additions and merges
  - `--danger` is only for deletions and failures
  - source colours, like `--linear`, are only for that source's mark
- Visual rules from the product voice apply. There are no side stripes, coloured shadows or badge pills, and there is no selling copy.
- **Text meets contrast.** `--t-4` is for disabled text and decoration, never for information.
- **Spacing between parts belongs to the layout, not the parts.** A part never sets its own top margin in a thread. Its root carries `data-rhythm` (the `Rhythm` enum in `src/lib/rhythm.ts`), and `Thread` and `Turn` space parts from it:
  - a new turn is 30px from the last, and parts inside a turn are 14px apart
  - steps stack 12px apart; a steer, graph change or allowed line sits 8px from its step
  - graph changes, runs of tools, snippets and external calls stack tight
  - your consecutive messages are 6px apart
  - a closed fold is followed at 8px

  The layout rules use `> :not(:first-child)` rather than `> * + *`, so their specificity (0,2,0) beats a part's own margin reset whatever order the modules load in. A host that places parts outside a Thread wraps them in one.
- **Stacking has four levels,** as tokens: `--z-float` for what floats over the page, `--z-dialog` for a modal and its scrim, `--z-popover` for what a modal opens, and `--z-tip` for what that opens. Nothing uses a raw z-index above 3; small values only order siblings inside one component.

### Behaviour: Radix primitives, our look

Widgets with real behaviour are built on Radix primitives (`radix-ui`), styled through the module classes on their parts. Radix brings keyboard handling, focus management, dismissal, and positioning that stays on screen.

| Radix primitive | Ours |
| --- | --- |
| Popover | Popover. `onEscapeKeyDown` lets something inside take the first Escape (ProjectSwitcher leaves renaming before it closes), because Radix hears Escape on the document before anything inside can stop it. A field marked `data-own-escape` gets the same without a handler: ConnectAgent's key field uses it. |
| DropdownMenu | Menu, TaskMenu |
| Tooltip | HoverCard. It is built on Tooltip so that it opens for the keyboard too. |
| Dialog | ModelBrowser, Lightbox. The title sits in `VisuallyHidden` when it isn't shown. |
| (none) | SidePanel. It is not modal: it sits beside the thread or the board, takes focus when it opens, and returns focus when it closes. It hears Escape last, so a menu or a form inside takes its own Escape first. DocPanel, StepPanel and Dock are built on it. |
| Select | Select (`position="popper"`) |
| RadioGroup | Segmented, Choices |
| Checkbox | CheckList |
| Tabs | StepPanel |
| Collapsible | Disclosure / Fold. Content is force-mounted so it can animate, and `inert` while closed. |
| Accordion | SubAgents |
| Toggle | The pin in ModelBrowser |
| VisuallyHidden | VisuallyHidden |

Plain semantic elements stay plain. A button is a `<button>`, and a list is a `<ul>`.

### Icons and marks

- **Icons are Iconoir** (`iconoir-react`, MIT). They are named by what they mean in Charrette (`work`, `after`, `corner`), not by their drawing. `Icon` sets a stroke width that holds up at 11–14px.
- **Marks are brands, drawn in ink.** `BrandMark` draws a `Brand` from `foundations/brands/brands.ts`. That file is generated from Lobe Icons (MIT) and Simple Icons (CC0). Brand colour is not used, apart from Linear's issue card.

### Shared building blocks

A pattern that appears in two components becomes one part, so the two cannot drift:

- **Ask** (`AskCard`, `AskFoot`, `AskAnswered`, `AskNote`): the card for anything that waits on a person, and the line it folds to once answered. Permission and GraphProposal are built on it.
- **SidePanel**: what opens beside a thread or the board. DocPanel, StepPanel and Dock are built on it.
- **TaskGlyph**: where a task stands as a glyph (live, yours, paused, stopped, done). TaskCard, WorkCard, TaskHeader and WorkPeek use it.
- **FileChanges**, with **Delta** and **DiffStat**: the files a change touched, with lines added and removed. ChangeSet and AcceptPeek use them, and a tool call shows Delta as its meta.
- **Checks**: a change's checks and reviews, each with where it stands. ChangeSet and AcceptPeek use it.
- **NoteForm**: a one-line note sent with an action, as when sending a change back. ChangeSet, AcceptPeek and Stuck use it.
- **Field**: one line of text to type. NoteForm, SourceMap and NewProject use it.
- **Panel** and **FormRow**: a sheet of settings with a kicker, a title and a foot, and its rows of a label beside a control. ProjectRules and NewProject are built on them.
- **KeyValues**: a small definition list with a fixed key column. External and GraphProposal use it.
- **StepRow**: a step's row, its track and its thread link. Step and Review use it.
- **StepTrack**: a task's steps as a row of bars, coloured by where the task stands. TaskCard and TaskHeader show it with labels, WorkCard without.
- **`useOnScreen`** (`src/lib/onScreen.ts`): clocks that run only while someone can see them, like the TaskLaunch countdown and the GraphChanged undo window. Without an IntersectionObserver, the element counts as on screen.
- **`useStickToBottom`** (`src/lib/stick.ts`): a thread that follows new content unless you have scrolled away. TaskFace uses it.

The layers are `thread` for what appears in a conversation (including Stuck, the call a task makes when the repair ladder runs out, and the Interrupted and Restarted lines), `composer` for what writes into one, and `coordinator` for what the coordinator shows about tasks: Issue, TaskLaunch, TaskCard and TaskMark, TaskHeld, and ProjectRules. `board` is the project's work in lanes: Board and BoardColumn, and the cards and rows for each lane (NextRow, WorkCard, CallCard, AcceptCard, SettledRow). Each card is one button, its title, stretched over the card. `dock` is what opens beside the board, on SidePanel: Dock with its head and foot, and a peek for each kind of card (CallPeek, AcceptPeek, WorkPeek and SettledPeek, ListPeek for knowledge and artifacts). `outputs` is what a task made: ChangeSet (its pull requests, files and checks, and accepting it) and ArtifactCard. `chrome` is the window's own furniture: TitleBar, ProjectSwitcher, Elsewhere, RoomSwitch, WorkStatus, ChromeButton, and for a task that has the window, BackCrumb and TaskHeader. The bar does not lay itself out: the consumer puts the pieces in it. TaskMenu holds what you can do to a task as a whole: stop, resume, abandon, reopen. `setup` is what comes before a project: Start (the first run), Runtimes (the agents on this machine and how each is signed in) with ConnectAgent (every other way to reach one), SourceMap (a project's repositories as read, with what reading found) and NewProject. A runtime keeps its own sign-in; these components only report what it says and open its own sign-in. `onboarding` is Welcome, shown once after install, and it is made of the other layers' real components rather than pictures of them. It opens with Opening: close on the mark as it is drawn, then a strong pull back before the name comes into focus. Its zoom resizes the vector mark and the grid rather than scaling them, so it stays sharp close up. Its point still has versions while it is being chosen. It is drawn on the welcome's own table, and its grid meets the table's exactly, so Begin (and Back) is the camera moving across the table, straight to the first plot, rather than a change of screen. A camera (`camera.ts`) moves over five Stations in two ways, both sampled into WAAPI keyframes. From the opening to the first plot, and from each plot to the next, it glides (`glide`): straight and low, hardly pulling back, tipped toward where it is going, with the pencil route drawn beside it, kept level with it however the route bends, and rubbed out going back. The camera never follows a bend or rolls into one. The pull back over the whole table at the end is a zoom (`frames`) along van Wijk and Nuij's zoom-and-pan path: it pulls back only as far as the distance needs, the tilt follows how far it has pulled back, and the table's line weight (`--far`) thickens with distance so the whole table reads. The table carries no will-change, so it is painted again at the scale it lands at. A Station pegs out its plot, and when the camera first lands it traces its scene in pencil from the scene's own measured layout (every box with a fill, edge or shadow, every line of text), then uncovers the real thing while wiping the pencil away along the same edge. Each scene's script (`useScene`) changes the scene's state and moves a pointer that lights what it is over as a hover would, gives it under the press, and really clicks it. Notes leave from the edge of the box around the part they name, measured by layout and again whenever the scene changes, so a leader never crosses what is inside and follows the part when it moves. The scenes are inert and hidden from assistive technology; the words beside them carry the meaning. Leaving a scene early, reduced motion, and `still` all show the scene's end state. `demo.ts` is the welcome's own content, not a fixture: it ships with the component. `ModelPick` has a `quiet` variant for the composer and a `field` variant for forms like TaskLaunch.

### Accessibility is part of the component

The target is WCAG 2.2 AA, per the root document. In a component that means:

- Semantic elements first; ARIA only where HTML has no equivalent.
- Every control has an accessible name. The visible label is part of that name (WCAG 2.5.3).
- There is full keyboard operation, and focus is visible and returns sensibly: Escape sends it back to the trigger.
- Motion respects `prefers-reduced-motion`.
- Live changes are announced politely: arrivals, copy confirmation, and streaming completion via `aria-busy`.
- No interactive element sits inside another.

### Every component has stories, and every state is one

- **Storybook is the component catalogue.** Every exported component has a `*.stories.tsx` beside it.
- **Every state someone will meet is a story:** rest, hover, focus, pressed, disabled, busy, selected, open, empty, error, long content, and at the viewport edge. Every stories file ends with an `AllStates` story that lays them out in the `States` grid (`src/storybook/States.tsx`). Interaction states are forced with `storybook-addon-pseudo-states`: a cell's `force` sets the whole cell, and `statesOn({ hover, focus, pressed })` puts the state on one part of the component, such as a single option of a radio group.
- **Behaviour is specified in `play` functions,** for example that Escape returns focus, arrows move, or Enter submits. Those play functions also run as tests.
- The accessibility addon runs on every story with `test: 'error'`.
- Stories use the shared demo world in `src/fixtures` (one project, one task), so components are seen together as they will be used.

### The workbench

The workbench (`workbench/`, `bun run workbench`) is where components are seen in use rather than one at a time. It holds the specimen catalogue, where one thread shows each state named in the margin, and the example conversations. It sits outside Storybook's one-component-per-story model on purpose. It is also exposed as Storybook stories under **Workbench**. The workbench composes package components only. If it needs markup that isn't a component, that is a sign a component is missing.

## Public API

- `@charrette/ui` exports components, their prop and `text` types, their default `text`, and the enums, all from `src/index.ts`.
- `@charrette/ui/styles.css` provides the tokens and the base. The consumer imports it once and wraps its UI in `.ch-root`.
- Anything not exported from `src/index.ts` is internal. Until there is a second consumer, the API may change without a deprecation period; after that, breaking changes need an ADR.

## Checks

- `bun run check`: type-aware lint, format and type checks (`vp check`). Lint and format settings are in the repository root's `vite.config.ts` and apply to every workspace. A pre-commit hook (`.vite-hooks/pre-commit`, installed by `prepare`) runs `vp staged`, which fixes and checks the staged files.
- `bun run test:coverage`: Vitest in jsdom. It renders every story through `composeStories` and runs their `play` functions (`tests/stories.test.tsx`). Unit tests beside it cover what a play cannot reach: every Permission answer, the ModelBrowser keyboard, stream pacing, the pixel field and the thread's scroll. The gate is 90% lines and branches over `src/**`, excluding stories and fixtures.
- `bun run storybook` runs the catalogue with the accessibility addon. `bun run build` builds the static Storybook.

## Gaps

These are known departures from the principles above, with the way back:

- **The workbench** is not yet in the package. The prototype's specimen, once migrated to these components, is the catalogue it should hold.
- **Plays that need a browser.** Testing Library in jsdom does not know `inert`, and cannot click a label that forwards a pointer event. Five plays run in Storybook only; they are listed in `tests/stories.test.tsx`.
- **The marks generator is not in the repository.** `brands.ts` says to regenerate rather than edit by hand, but the script that writes it lives outside the repo. It should move to `packages/ui/scripts/marks` as a Bun script that reads `simple-icons` and `@lobehub/icons-static-svg`.
- **Dictation recording is red.** The Composer's recording state uses `--danger`, which is kept for deletions and failures. It needs its own treatment.
- **Accessibility lint warnings.** `vp check` warns about some deliberate patterns: forms that listen for number keys, focusable scroll regions, and a `role="status"` where the rule prefers `<output>`. Each one has been reviewed. The warnings stay visible rather than being disabled.
