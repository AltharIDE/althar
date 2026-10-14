// Scrappy: the paths side by side, in a dialog over the page, from the bar's Compare.
import { Dialog, Table } from '@althar/ui'

const ROWS = [
  [
    'Today',
    'Nothing new: the mode is one word in the rules’ last sentence.',
    'No per-task choice. A card for a kind that always asks offers no “always allow” and doesn’t say why. Seven prompts, one at a time, or Allow all (each once).',
    'Project: 2 (the word, then the mode). Task: none',
    'Not on the task or the board at all.',
  ],
  [
    'A · One switch',
    'Simplest to explain: one switch for the project, the same one in the task’s menu. The lists quieten under it.',
    'A switch hides the other three modes’ difference. The task’s switch sits in a menu, three levels from the moment it hurts. “Unrestricted” is a new word.',
    'Project: 1. Task: 2 (menu, switch)',
    '“Unrestricted” beside the task’s menu, and on its board card. Quiet.',
  ],
  [
    'B · Modes, task chip',
    'All four modes are visible and comparable; the task’s chip always says what it runs under, and goes back to the project’s in one press.',
    'A chip on every task, even when nothing differs. Overriding to “Ask me” or “Coordinator” per task is power few need.',
    'Project: 1. Task: 2 (chip, Allow everything)',
    'Always: the chip names the mode. Allow everything reads in the chip and on the card.',
  ],
  [
    'C · From the prompt',
    'Arrives where the pain is: on the seventh prompt, one answer clears the queue and stops the rest.',
    'Easy to say yes to more than you meant at the end of a long run. Hard to find again to undo: only the thread’s line and the menu.',
    'Project: as today. Task: 2 (pick, Allow)',
    'A warm word beside the task’s menu and on its card, while it lasts.',
  ],
  [
    'D · For a while',
    'Bounded by default: an hour, the task’s work, or until you say. It ends by itself, says when, and what went ahead.',
    'More choices at the moment of pain. A clock to watch. “Until it’s ready” needs the task to know when it is.',
    'Project: 2 (how long, then which). Task: 2 (pick, Allow), or 2 from the menu',
    'A pill over the composer with the time left, the header and the card say it too; ending leaves a line in the thread.',
  ],
  [
    'B+C · Chip and prompt',
    'C’s moment, B’s place to see and undo it: the card sets the chip, the chip takes it back.',
    'Two ways in to the same thing to explain. The chip is there on every task.',
    'Project: 1. Task: 2 from the card, or 2 from the chip',
    'The chip says “This task · Allow everything”; the card says it too.',
  ],
] as const

export function Compare({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="Allow everything: the paths side by side"
      description="Clicks counted from the screen where it hurts: the Rules page for the project, the task with prompts waiting for the task. Never still holds in every path, and no lead reads credentials or reaches the code host except through Althar."
      onClose={onClose}
      width={1180}
    >
      <Table head={['Path', 'Good at', 'Risks', 'Clicks to allow everything', 'How visible']} rows={ROWS.map((row) => [...row])} wrap />
    </Dialog>
  )
}
