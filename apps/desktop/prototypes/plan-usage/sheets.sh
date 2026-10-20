#!/bin/sh
# Scrappy: the shots grouped onto one sheet per direction, in shots.json's order, numbered and captioned. Run after shoot.mjs, outside the agent sandbox.
cd "$(dirname "$0")"
node sheet.mjs shots/sheet-ninemate.png 2 'Ninemate’s · as built: the Usage button and ⌘U view, the Talk room’s warnings; steering as a plain runtime line' --shots n-
node sheet.mjs shots/sheet-a.png 2 'A · A quiet chip in the bar: nothing while there is plenty, the tightest limit when there isn’t, a popover for the rest' --shots a-
node sheet.mjs shots/sheet-b.png 2 'B · Beside the models: each model says what its route has left, where a model is chosen' --shots b-
node sheet.mjs shots/sheet-c.png 2 'C · Home and Settings › Accounts: a quiet line per agent, the full reading under each account, Needs you only when work is held' --shots c-
