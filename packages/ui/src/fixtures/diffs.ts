import { DiffLineKind } from '../foundations/vocabulary'
import type { DiffLine } from '../thread/Diff/Diff'

/**
 * A diff written as git prints it, each line led by ' ' (unchanged), '+'
 * (added), '-' (removed) or a hunk's '@@ -a,b +c,d @@' header, numbered from
 * where the hunk says or from 1. A changed stretch of a line is written
 * ⟦like this⟧.
 */
export const diffOf = (text: string): DiffLine[] => {
  const lines: DiffLine[] = []
  let old = 1
  let next = 1
  for (const row of text.replace(/^\n/, '').replace(/\n$/, '').split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(row)
    if (hunk !== null) {
      old = Number(hunk[1])
      next = Number(hunk[2])
      lines.push({ kind: DiffLineKind.Hunk, text: row })
      continue
    }
    const sign = row[0]
    const body = row.slice(1)
    const changed = [...body.matchAll(/⟦(.*?)⟧/g)].map((found) => found[1] ?? '')
    const plain = body.replaceAll(/[⟦⟧]/g, '')
    const marks = changed.length === 0 ? {} : { changed }
    if (sign === '+') lines.push({ kind: DiffLineKind.Added, new: next++, text: plain, ...marks })
    else if (sign === '-') lines.push({ kind: DiffLineKind.Removed, old: old++, text: plain, ...marks })
    else lines.push({ kind: DiffLineKind.Context, old: old++, new: next++, text: plain })
  }
  return lines
}

/** A React component whose props grew a field: the whole file, so its unchanged stretches fold. */
export const TSX_DIFF = diffOf(`
 import { useState } from 'react'

 import { Button } from '../Button/Button'
 import s from './RefundForm.module.css'

 export interface RefundFormProps {
   amount: number
-  onRefund: (amount: number) => void
+  onRefund: (amount: number, ⟦reason: string⟧) => void
+  /** Why, for the merchant's statement. */
+  reasons?: readonly string[]
 }

 /** How much to give back, and why: the amount starts at what was charged. */
 export function RefundForm({ amount, onRefund, reasons = [] }: RefundFormProps) {
   const [value, setValue] = useState(amount)
+  const [reason, setReason] = useState(reasons[0] ?? '')
   const over = value > amount
   return (
     <form className={s.form} onSubmit={(e) => e.preventDefault()}>
       <input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} />
+      {reasons.length > 0 && (
+        <select value={reason} onChange={(e) => setReason(e.target.value)}>
+          {reasons.map((r) => (
+            <option key={r}>{r}</option>
+          ))}
+        </select>
+      )}
       {over && <p role="alert">More than was charged</p>}
-      <Button disabled={over} onClick={() => onRefund(value)}>
+      <Button disabled={over} onClick={() => onRefund(value⟦, reason⟧)}>
         Refund
       </Button>
     </form>
   )
 }
`)

/** A stylesheet: a colour moved to a token, a rule added. */
export const CSS_DIFF = diffOf(`
@@ -12,9 +12,14 @@ .form
 .form {
   display: grid;
   gap: 8px;
-  color: ⟦#3a3a40⟧;
+  color: ⟦var(--t-2)⟧;
 }
+/* a reason is picked from the merchant's own list */
+.form select {
+  font: inherit;
+  border-radius: 6px;
+}
 .form [role='alert'] {
   color: var(--danger);
 }
`)

/** A package's manifest: a version moved, a script added. */
export const JSON_DIFF = diffOf(`
 {
   "name": "@meridian/refunds",
-  "version": "⟦2.3.1⟧",
+  "version": "⟦2.4.0⟧",
   "private": true,
   "scripts": {
-    "test": "vitest run"
+    "test": "vitest run",
+    "check": "tsc --noEmit"
   },
   "dependencies": {
     "effect": "^3.17.0"
   }
 }
`)

/** A readme: a heading, a list, code written out. */
export const MARKDOWN_DIFF = diffOf(`
 # Refunds

 Gives back what a merchant charged, in part or whole.

-## Limits
+## Limits and reasons

-A merchant may refund **20** times a day.
+A merchant may refund as often as \`limitOf(merchant)\` allows, and must say *why*:
+
+- \`duplicate\`
+- \`fraud\`
+- \`asked\`
`)

/**
 * A block comment that opens before a change and closes after it, and a
 * template string across lines: colouring each side as a file of its own
 * keeps the changed lines inside them coloured as comment and string.
 */
export const COMMENT_DIFF = diffOf(`
@@ -40,14 +40,15 @@ export const limitOf
 /*
  * How many refunds a merchant may ask for in a window.
- * Twenty a day, for everyone.
+ * A partner's own limit where it has one,
+ * and twenty a day for the rest.
  */
 export const limitOf = (merchant: Merchant): Limit =>
   merchant.partner?.limit ?? { perWindow: 20, windowSeconds: 86_400 }

 const said = (limit: Limit) => \`
-  At most \${limit.perWindow} refunds
+  At most \${limit.perWindow} refunds every
   \${limit.windowSeconds / 3600} hours.
 \`
`)
