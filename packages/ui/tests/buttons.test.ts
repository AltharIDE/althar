import { describe, expect, it } from 'vitest'

/*
 * Buttons come from the primitives: Button, ActionButton, SplitButton,
 * IconButton, LinkButton, CopyButton, and ChromeButton in the chrome. A
 * plain <button> outside them is either one of the kinds below, listed with
 * its reason, or a primitive drawn again by hand, which then drifts from the
 * original by a pixel or a shade. A new file with a plain button fails here
 * until it is moved onto a primitive or listed with why it can't be.
 */
const PLAIN: Readonly<Record<string, string>> = {
  /* the whole card or row is the target */
  'board/Board/CardTitle.tsx': 'a card’s or row’s title, stretched over it',
  'dock/ListPeek/ListPeek.tsx': 'an entry of the list',
  'outputs/ArtifactCard/ArtifactCard.tsx': 'the card’s title, which opens it',
  'thread/External/External.tsx': 'the row of an external call',
  'thread/FileArtifact/FileArtifact.tsx': 'the preview, which opens the file',
  'chrome/ProjectSwitcher/ProjectSwitcher.tsx': 'the switcher’s trigger and its project rows',
  'home/NeedCard/NeedCard.tsx': 'the call’s title, which opens it in the dock',
  'home/RunRow/RunRow.tsx': 'a running task’s title, stretched over its row',
  'home/SinceRow/SinceRow.tsx': 'what happened, stretched over its row',
  'home/ProjectRow/ProjectRow.tsx': 'a project’s row, which opens the project',
  'home/EdgeRow/EdgeRow.tsx': 'a task’s title, which opens it in Althar',
  'chrome/ProjectTabs/ProjectTabs.tsx': 'a tab, whose shape joins the bar below it',
  'chrome/WindowButtons/WindowButtons.tsx': 'the traffic lights, whose shape is the system’s own',
  'chrome/WorkStatus/WorkStatus.tsx': 'a row of what needs you, in the count’s preview',
  /* opens and closes what is below it */
  'thread/Reasoning/Reasoning.tsx': 'the row that folds the reasoning',
  'thread/WorkedFor/WorkedFor.tsx': 'the row that folds the work',
  'thread/Tool/Tool.tsx': 'the rows that fold a call or a run of them, and the path as a link',
  'thread/Permission/Permission.tsx': 'the allowed line, which folds',
  'thread/Document/Document.tsx': 'the fold at the foot of a document',
  'thread/Step/Step.tsx': 'the caret that opens a step',
  'thread/Diff/Diff.tsx': 'a folded stretch of unchanged lines, which opens in place',
  /* an option in a list or a rail */
  'composer/ModelPick/ModelPick.tsx': 'the picker and its options',
  'composer/ModelBrowser/ModelBrowser.tsx': 'the rail and a model’s row',
  'outputs/ChangeView/ChangeView.tsx': 'a file in the list of what changed',
  'screens/Start/Start.tsx': 'the ways to start, as large options',
  /* a shape of its own */
  'composer/ContextRing/ContextRing.tsx': 'the ring',
  'composer/Composer/Composer.tsx': 'the dictation button, drawn as your voice',
  'thread/Shots/Shots.tsx': 'a screenshot’s thumbnail',
  'thread/Inline/Inline.tsx': 'a reference or citation inside prose',
  'thread/You/You.tsx': 'an attachment’s chip',
  'thread/Steer/Steer.tsx': 'a step’s name inside a sentence',
  'thread/Furniture/Furniture.tsx': 'the floating jump to the latest',
  'composer/Listening/Listening.tsx': 'the listening pill, and stop on its sunk bar',
  'composer/Running/Running.tsx': 'the running pill, and its actions on the sunk bar',
  'setup/ControlCenter/ControlCenter.tsx': 'a module, the whole of which opens it out, and a round switch',
  'home/Island/Island.tsx': 'the mark and the count, on the notch’s black',
  /* close to a primitive, not yet moved onto one */
  'chrome/BackCrumb/BackCrumb.tsx': 'a ChromeButton that is never pressed',
}

const sources = import.meta.glob<string>('../src/**/*.tsx', { query: '?raw', import: 'default', eager: true })
const OWN = /^(primitives|storybook|fixtures)\/|\.stories\.tsx$|^chrome\/ChromeButton\//

const plain = Object.entries(sources)
  .map(([path, source]) => [path.replace('../src/', ''), source] as const)
  .filter(([path, source]) => !OWN.test(path) && /<button[\s>]/.test(source))
  .map(([path]) => path)

describe('buttons', () => {
  it('come from the primitives, or are listed with why they can’t', () => {
    expect(plain.filter((path) => !(path in PLAIN))).toEqual([])
  })

  it('are listed only while the file still has one', () => {
    expect(Object.keys(PLAIN).filter((path) => !plain.includes(path))).toEqual([])
  })
})
