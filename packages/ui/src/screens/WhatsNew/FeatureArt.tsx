import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Button } from '../../primitives/Button/Button'
import l from './WhatsNew.module.css'

/*
 * A feature's small picture on its tile in What's new, in the app's own
 * marks and type: the ask to use the computer's apps, a board pointed at and
 * its next version, a goal, the agents' marks, a terminal, and the tools work
 * comes in from. Drawn only, never pressed.
 */

export type FeatureArtKey = 'computer-use' | 'artifacts' | 'goals' | 'agents' | 'terminals' | 'bring-in'

export function FeatureArt({ of }: { of: FeatureArtKey }) {
  if (of === 'computer-use')
    return (
      <div className={l.artAsk} aria-hidden="true">
        <span className={l.askIcon}>
          <Icon name="viewport" size={15} />
        </span>
        <span className={l.askWords}>
          <b>Use Simulator and Safari?</b>
          <span>This turn</span>
        </span>
        <span className={l.askWays}>
          <Button size="small" variant="quiet" tabIndex={-1}>
            Deny
          </Button>
          <Button size="small" variant="signal" tabIndex={-1}>
            Allow once
          </Button>
        </span>
      </div>
    )
  if (of === 'artifacts')
    return (
      <div className={l.artBoard} aria-hidden="true">
        <div className={l.board}>
          <i className={l.boardHead} />
          <i className={l.boardLine} />
          <i className={l.boardPrice} />
          <span className={l.pin}>1</span>
        </div>
        <div className={l.said}>
          <span className={l.saidPin}>1</span>
          <span>Bigger price, less copy</span>
        </div>
        <Icon name="arrow" size={14} className={l.into} />
        <code className={l.next}>
          <span className={l.was}>v2</span>
          <span className={l.now}>v3</span>
        </code>
      </div>
    )
  if (of === 'goals')
    return (
      <div className={l.artGoal} aria-hidden="true">
        <span className={l.slash}>/goal</span> ship the pricing page
      </div>
    )
  if (of === 'agents')
    return (
      <div className={l.artMarks} aria-hidden="true">
        {[Brand.ClaudeCode, Brand.Codex, Brand.OpenCode, Brand.GeminiCli, Brand.Cursor, Brand.GitHubCopilot].map((brand) => (
          <span key={brand} className={l.markChip}>
            <BrandMark brand={brand} size={16} />
          </span>
        ))}
        <span className={l.markChip}>
          <Icon name="plus" size={14} />
        </span>
      </div>
    )
  if (of === 'terminals')
    return (
      <pre className={l.artTerm} aria-hidden="true">
        <span className={l.prompt}>$</span> bun run dev{'\n'}
        <span className={l.dim}> ready on</span> localhost:5173{'\n'}
        <span className={l.prompt}>$</span> <span className={l.caret} />
      </pre>
    )
  return (
    <div className={l.artFrom} aria-hidden="true">
      {[Brand.Conductor, Brand.Orca, Brand.Paradev, Brand.Cursor, Brand.Codex].map((brand) => (
        <BrandMark key={brand} brand={brand} size={18} />
      ))}
      <Icon name="arrow" size={14} className={l.into} />
      <span className={l.intoTask}>Tasks</span>
    </div>
  )
}
