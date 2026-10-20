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
  'board/Board/Board.tsx': 'a collapsed lane’s rail, the whole of which opens it',
  'dock/ListPeek/ListPeek.tsx': 'an entry of the list',
  'outputs/ArtifactCard/ArtifactCard.tsx': 'the card’s title, which opens it',
  'outputs/ChangeSet/ChangeSet.tsx': 'the line of its checks, which folds their list; a folder’s row, which folds its files',
  'outputs/WhatItMade/WhatItMade.tsx': 'a picture, which opens full size',
  'thread/External/External.tsx': 'the row of an external call',
  'thread/FileArtifact/FileArtifact.tsx': 'the preview, which opens the file',
  'chrome/ProjectSwitcher/ProjectSwitcher.tsx': 'the switcher’s trigger and its project rows',
  'home/SinceRow/SinceRow.tsx': 'what happened, stretched over its row',
  'home/NeedLine/NeedLine.tsx': 'the call’s title, which opens its task',
  'home/ProjectList/ProjectList.tsx': 'a project’s row, which opens it; the quiet line, which folds',
  'chrome/ProjectTabs/ProjectTabs.tsx': 'a tab, whose shape joins the bar below it',
  'board/NextLine/NextLine.tsx': 'a row’s grip in the lane’s margin, held to drag the row',
  'chrome/WindowButtons/WindowButtons.tsx': 'the traffic lights, whose shape is the system’s own',
  'chrome/WorkStatus/WorkStatus.tsx': 'a row of what needs you, in the count’s preview',
  'chrome/LoadMeter/LoadPeek.tsx': 'a piece of work’s row, which opens it',
  'chrome/ProjectFront/ProjectFront.tsx': 'a repository’s or tracker’s mark and name, which opens it',
  /* opens and closes what is below it */
  'thread/Reasoning/Reasoning.tsx': 'the row that folds the reasoning',
  'thread/WorkedFor/WorkedFor.tsx': 'the row that folds the work',
  'thread/WorkLine/WorkLine.tsx': 'the line that folds a round’s work; what it looked at, as thumbnails',
  'thread/Checked/Checked.tsx': 'the row of a check, which folds what it printed',
  'thread/Tool/Tool.tsx': 'the rows that fold a call or a run of them, and the path as a link',
  'thread/Permission/Permission.tsx': 'the allowed line, which folds',
  'thread/Document/Document.tsx': 'the fold at the foot of a document',
  'thread/Step/Step.tsx': 'the caret that opens a step',
  'thread/Diff/Diff.tsx': 'a folded stretch of unchanged lines, which opens in place',
  'thread/Code/CodeLines.tsx': 'a gap in a file’s lines, stretched across them, which shows more of them in place',
  'thread/Evidence/Evidence.tsx': 'the row of a run or a response, which folds what it printed',
  'screens/Home/Home.tsx': 'the line that folds what the loop did since you looked',
  /* an option in a list or a rail */
  'composer/ModelPick/ModelPick.tsx': 'the picker and its options',
  'composer/ModelBrowser/ModelBrowser.tsx': 'the rail and a model’s row',
  'outputs/ChangeView/ChangeView.tsx': 'a file in the list of what changed',
  'screens/Start/Start.tsx': 'the ways to start, as large options',
  'setup/ConnectCard/ConnectCard.tsx': 'the ways in to a service, as large options',
  'setup/SettingsNav/SettingsNav.tsx': 'a section in the list down the side of Settings',
  /* a shape of its own */
  'composer/ContextRing/ContextRing.tsx': 'the ring',
  'chrome/LoadMeter/LoadMeter.tsx': 'the meters, drawn in steps as the ring is drawn',
  'composer/Composer/Composer.tsx': 'the dictation button, drawn as your voice',
  'thread/Shots/Shots.tsx': 'a screenshot’s thumbnail',
  'thread/Gallery/Gallery.tsx': 'a screenshot, large, which opens full size',
  'thread/Inline/Inline.tsx': 'a reference or citation inside prose',
  'thread/Code/CodeRef.tsx': 'a name that names code inside prose, as a chip or as its underlined words',
  'thread/Code/CodeView.tsx': 'a file to open instead, as a path’s chip; the way to the other version, a word at the end of a note',
  'thread/You/You.tsx': 'an attachment’s chip',
  'thread/Steer/Steer.tsx': 'a step’s name inside a sentence',
  'setup/Charter/Charter.tsx': 'a built-in setting, as an underlined word inside a sentence',
  'thread/Furniture/Furniture.tsx': 'the floating jump to the latest',
  'composer/Listening/Listening.tsx': 'the listening pill, and stop on its sunk bar',
  'composer/DictationPill/DictationPill.tsx': 'the words carried in the pill, stretched across it, which open it',
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
