/*
 * A turn's last message carries everything the person needs (ADR-099). What
 * an agent says along the way folds under "Worked for…", and only its last
 * message stands open: a lead's last message, or its report where it writes
 * nothing after it; the coordinator's answer; a reviewer's report. So each
 * role is told plainly to put all of it there, never "see above"; and, as
 * the agents don't always do as they're told, a lead whose turn ends with
 * what stands open only pointing back at what folded is told once to say
 * it again in full (Runs.ts, `restate`).
 */

/** What every lead is told of its last message: it is what the person reads. */
export const LAST_MESSAGE_LEAD =
  'Everything you say before your last message folds out of sight under "Worked for…": the person reads your last message, and nothing said before it unless they open the fold. So your last message must stand on its own, with everything they need from it in full: the whole proposal, every question, your findings, the decisions you need from them, and what was built or not. Never write "see above" or "the proposal above", or point at anything said earlier in the turn: say it again there, in full. Progress lines along the way are fine; they fold. Where you write nothing after your finish_step report, the report is what stays open, so it carries all of that; where you write after it, your last message stays open instead, and must.'

/** What a review task's lead is told: its draft's card stays open beside its last message. */
export const LAST_MESSAGE_REVIEWING =
  'Everything you say before your last message folds out of sight under "Worked for…": the person reads your last message and the draft\'s card. So your last message must stand on its own, with what you found and anything you need from the person in full. Never write "see above", or point at anything said earlier in the turn. Progress lines along the way are fine; they fold.'

/** What a reviewer is told: the person reads its report, not what it said on the way. */
export const LAST_MESSAGE_REVIEWER =
  'What you say along the way folds out of sight: the person and the lead read your report_review. So its summary and findings must stand on their own, every finding in full. Never write "see above", or point at anything said earlier in your turn.'

/** What the coordinator is told of its answer. */
export const LAST_MESSAGE_COORDINATOR =
  'Everything you say before your last message folds out of sight under "Worked for…": the person reads your last message. So it must stand on its own, with everything they need from it in full: what you found, a proposal, every question, and the decisions you need from them. Never write "see above", or point at anything said earlier in your turn: say it again there. Progress lines along the way are fine; they fold. Cards Althar shows, a task or an issue draft, stay open, so you needn\'t repeat what they show.'

/** What a lead is told, once, when what stands open of its turn only points back at what folded. */
export const restateWords = (pointing: string) =>
  `Your last message points back at what you said earlier ("${pointing}"), and that is folded out of sight: the person reads only your last message, or your report where you wrote nothing after it. Write your last message again so it stands on its own: everything the person needs from it in full, the proposal, every question, your findings, the decisions you need from them, and what was built or not, without pointing at anything said earlier. Don't call finish_step again for this.`

/** How a restatement asked for starts, to know a turn that answers one. */
export const RESTATE_START = 'Your last message points back at what you said earlier'

// Words that refer back to earlier text in a turn. "above" counts only where it isn't a place on a page ("above the composer").
const POINTING: ReadonlyArray<RegExp> = [
  /\b(?:see|seen|posted|shown|listed|outlined|described|written|wrote|detailed|given|laid out|set out|proposed|mentioned|noted|summari[sz]ed|explained|stated|said|shared|quoted|as)\s+(?:just\s+|right\s+)?above\b/i,
  /\b(?:the|my|these|those|this|that)\s+(?:[\w'-]+\s+){0,4}above\b(?!\s+(?:the|a|an|its|their|his|her|it|this|that|these|those|all|any|each|every|or|and|\d)\b)/i,
  /\b(?:is|are|stands?|sits?)\s+(?:all\s+|just\s+|right\s+|up\s+)?above\s*(?:[.,;:!?)]|$)/im,
  /\b(?:above|earlier|before)\s+in\s+(?:the|this|my)\s+(?:thread|turn|conversation|chat|trail|message)\b/i,
  /\b(?:posted|said|wrote|written|shared|listed|laid out|set out|left)\s+(?:it\s+|them\s+)?(?:in|on)\s+the\s+(?:thread|trail)\b/i,
  /\b(?:posted|written|given|shared|listed|laid out|set out|sent|said)\s+earlier\b/i,
  /\b(?:my|the)\s+(?:previous|earlier|prior)\s+(?:message|reply|post|comment)\b/i,
  /\bscroll\s+(?:back\s+)?up\b/i,
  /\b(?:as\s+)?(?:i|we)\s+(?:said|wrote|posted|mentioned|noted|listed|laid out|set out|proposed)\s+(?:earlier|before|above)\b/i,
]

/** Text as read for pointing words: code and quotations are what it is about, not where it points. */
const prose = (text: string) =>
  text
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/"[^"\n]*"|“[^”\n]*”/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')

/** The words with which a message points back at earlier text, or undefined where it doesn't. */
export const pointsBack = (text: string): string | undefined => {
  const read = prose(text)
  for (const pattern of POINTING) {
    const found = pattern.exec(read)
    if (found !== null) return found[0].trim()
  }
  return undefined
}

/** What a lead's round holds, in order, of what may stand open: what it said, and its reports. */
export type RoundItem =
  | { readonly kind: 'message'; readonly text: string; readonly thisTurn: boolean }
  | { readonly kind: 'report'; readonly text: string; readonly thisTurn: boolean }

/**
 * Whether what stands open of a lead's round only points back at what
 * folded, and with which words: its last message, or its report where
 * nothing follows it (rounds.ts reads it so), written in the turn that just
 * ended, after something said earlier in the round that it may mean.
 */
export const toRestate = (round: ReadonlyArray<RoundItem>): string | undefined => {
  const open = round.findLastIndex((item) => item.text.trim() !== '')
  const last = round[open]
  if (last === undefined || !last.thisTurn) return undefined
  const earlier = round.slice(0, open).some((item) => item.kind === 'message' && item.text.trim() !== '')
  return earlier ? pointsBack(last.text) : undefined
}
