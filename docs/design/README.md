# The screens, as designed

Five screens from the third design round, the specification the front end is built against
([ADR-0052](../adr/0052-the-third-design-round-is-the-specification-and-the-front-end-opens.md)).
They hold for structure, behaviour, copy and appearance alike. The second round's three files
were replaced by these; git keeps them.

| File | Screen |
|---|---|
| `week-desktop.dc.html` | the week from 1100px, with the opened row, creating a task and the shortcut legend |
| `day-phone.dc.html` | one day below 640px, and one day beside the week from 640 to 1099px |
| `plan.dc.html` | asking for a plan, waiting, reviewing, approving, a plan written by hand, progress |
| `settings.dc.html` | address, time zone, theme, the usable day, days off, block length, password, sign out |
| `sign-in.dc.html` | sign in, create an account, confirm with a code or a link, recover a password |

## Opening them

Each file loads `support.js`, the design tool's runtime, and `tokens/syncaai-a-papel.css`, a
copy of the tokens, from beside it, and its fonts from Google Fonts. Serve the folder rather
than opening a file directly:

```powershell
python -m http.server 8765 --directory docs/design
```

Then open `http://localhost:8765/week-desktop.dc.html`. A review bar across the top of every
screen switches width, theme, reduced motion and 200% text, and opens each state. The tokens'
source is `apps/web/src/styles/tokens.css`, held to its contrast pairs by a test (ADR-0026);
the copy here only renders the screens.

## What holds across every screen

- **The big number of a day is what is booked, not what is free.** Free has a floor at zero,
  so it sits underneath with its denominator: `2h30 free of 16h`.
- **A task belongs to the day it begins on.** The day it runs into gets a dimmed band with no
  verbs and a way back to the row that owns it.
- **The accent means trouble and only trouble:** above budget, a conflict, a refusal.
- **Plan against actual is on the row, in neutral ink,** and a late completion shows the real
  elapsed time.
- **Completing is the permanent box before the title.** The other verbs live in the opened row.
- **The server decides.** Every refusal shows the server's own sentence, where the action was
  taken.
- **A form opens as a full sheet on a phone,** with Save at the top so the keyboard never hides
  it, and saving never replaces the screen with a skeleton.
- **One status region** carries undo, "moved to" and "plan ready". It sits above the day bar on
  a phone, and it can point to a day that is not on screen.
- **Targets are 44px under touch,** with a pressed state drawn. Shortcut keys and their legend
  are hidden under touch.

## What was decided in each

**The week on a desktop.**
- **The day's header:** the booked figure, free "of" the person's budget under it, and the
  load sentence from the server's ladder (heavy above the budget, strained above 18h,
  unsustainable above 20h).
- **Creating a task:** "+ new task" on every day from today on, opened with N. Complete is
  Space, the checklist is C, and the legend can be collapsed.

**The day on a phone.**
- **Moving between days:** a bottom bar naming the days on either side, with New task between
  them. Swiping is only a shortcut.
- **The week at a glance:** always in view, as seven 44px cells. It wraps rather than shrinks.
- **The time zone:** a sentence under the strip, always visible.

**The plan.**
- **Asking:** a "Plan" button in the header, beside Menu. Its label carries the state:
  queued, making, ready, or "3 of 5".
- **Review on a phone:** a full view in place of the day.
- **Review from 1100px:** a 440px panel beside the week, with the proposed steps in their days,
  edged with a dashed line.
- **Writing by hand:** offered whenever the model is down or planning is paused.

**Settings.**
- **Saving:** the usable day, days off and the block save together with one Save, because the
  server judges them as one request and writes none of it when one part is refused.
- **Theme:** applies on tap.
- **Password and sign out:** each is its own action.

**Signing in.**
- **Answers that must not reveal an account look the same:** signing up, resending and
  recovering end on one "Check your inbox" view built from one template (ADR-0019).
- **Focus:** no field takes it on load.
- **A link that no longer works:** one state, whether it was used or has expired.

## Where the code departs from the drawings

- **Creating a task is open on every future day, in any week.** The drawings switch it off
  outside the current week only because the prototype holds one week of data.
- **A person's usable day and days off come from their settings.** The plan's drawing assumed
  07:00 to 23:00 with the weekend off; a new account starts at 06:00 to 22:00 with none.
- **A discarded step's reasons are shown sentence-cased,** from the validator's text.
- **Two lines that do not wrap at 200% text are made to wrap:**
  - the late completion line on a phone;
  - the day field when a plan's step is edited at 320px.
