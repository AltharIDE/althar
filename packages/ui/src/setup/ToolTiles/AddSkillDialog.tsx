import { Dialog } from '../../primitives/Dialog/Dialog'
import { Problem } from '../../primitives/Problem/Problem'
import {
  SkillInstall,
  type SkillInstallProps,
  type SkillInstallText,
  SkillReview,
  type SkillReviewModel,
  type SkillReviewText,
} from '../Skills/Skills'

/*
 * Add from GitHub, the one way Althar adds a skill: find the repository's
 * skill folders (SkillInstall), read the one chosen as it would be added
 * (SkillReview), then add it, or step back to the folders. Both steps are the
 * kit's own; this is only the dialog they sit in.
 */

export interface AddSkillDialogText {
  title: string
}

export const addSkillDialogText: AddSkillDialogText = { title: 'Add a skill from GitHub' }

export interface AddSkillDialogProps {
  found: SkillInstallProps['found']
  busy: boolean
  /** What went wrong finding, reading or adding it, in words. */
  error: string | null
  /** The folder being read, once one is chosen: the dialog shows its review. */
  card: SkillReviewModel | null
  onFind: (source: string) => void
  onReview: (subpath: string) => void
  onInstall: (replace: boolean) => void
  /** From the review back to the folders found. */
  onBack: () => void
  onClose: () => void
  text?: Partial<AddSkillDialogText>
  installText?: Partial<SkillInstallText>
  reviewText?: Partial<SkillReviewText>
}

/** Finding a skill on GitHub, reading it, and adding it, in a dialog. */
export function AddSkillDialog({
  found,
  busy,
  error,
  card,
  onFind,
  onReview,
  onInstall,
  onBack,
  onClose,
  text,
  installText,
  reviewText,
}: AddSkillDialogProps) {
  const t = { ...addSkillDialogText, ...text }
  return (
    <Dialog title={t.title} width={640} tall holding={busy} onClose={onClose} {...(card === null ? {} : { onBack })}>
      {card === null ? (
        <SkillInstall
          found={found}
          busy={busy}
          error={error}
          onFind={onFind}
          onReview={onReview}
          {...(installText === undefined ? {} : { text: installText })}
        />
      ) : (
        <>
          {error !== null && <Problem>{error}</Problem>}
          <SkillReview
            card={card}
            busy={busy}
            onInstall={onInstall}
            onCancel={onBack}
            {...(reviewText === undefined ? {} : { text: reviewText })}
          />
        </>
      )}
    </Dialog>
  )
}
