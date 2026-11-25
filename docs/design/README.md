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
- **The task count stays, below 1100px only** (decided on 2026-11-21). The day's heading says
  "3 tasks", as drawn, although the week from 1100px leaves the count out under item 17, each
  number once. On the week every row of every day is in view, so a count repeats what the eye
  already has. Here one day is on screen, its rows run on past the bar at the bottom, and the
  strip shows only booked time: the count is the one figure that says how many rows are still
  to scroll to.

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
- **One vocabulary at every width.** Where the phone's drawing and the desktop's name the same
  thing in different words, the desktop's are used at every width, case included: "booked",
  not "reserved"; "today" and "+ new task", not "Today" and "+ New task"; "go to date", and in
  its sheet "go" and "cancel", not "Go to a date", "Go to Thursday 22 Oct" and "Close"; the
  range as `16 – 22 Nov 2026`. On the day: "Thursday 22 Oct", not "Thursday 22 October";
  `13:30 – 16:30 · 3h` with its `+1`; "1/3 checked", not "1 of 3 ticked"; the done line as
  one sentence; the band's "↳ carried from Wed" and "go to Wed", not "Started Wednesday 22:00
  · open it there"; "Nothing booked." and "saving…". A task should not change its words
  between 1099 and 1100px. What only the phone draws keeps the phone's words: Today, the
  day's task count, the trail's label and how long a running task has run.
- **Below 640px the range is the page's heading, and "go to date" is a button under it.** The
  drawing makes the range itself the button, but a heading cannot sit inside one, and the
  range is what the router puts focus on. The button's target is stretched over both, so the
  press lands where the drawing puts it.
- **An opened row below 1100px uses the desktop's panels.** Its verbs stay in view under
  whichever panel is open, and an item is renamed in place and saved as the field is left.
  The drawing swaps the verbs out for the panel and gives a rename its own Save and Cancel.
  One set of panels keeps a task offering the same things at every width.
- **A form below 1100px is the desktop's form in a sheet.** Its fields stay editable while it
  saves, as the desktop's do, where the drawing locks them; save refusing a second press is
  what stops a double write. Save stays "save" when a new tag is typed, the one word that
  changes at 1100px: the tag field already says saving creates it, and a bar 320px wide has
  no room for the tag's name beside the heading.
- **Swiping the day leaves pinch zoom alone.** The drawing gives the day `touch-action: pan-y`,
  which also stops two fingers from zooming it; the code adds `pinch-zoom`. The slide takes
  the 200ms duration token rather than the drawing's 220ms.
- **A notice's ✕ is not offered while it is busy.** "Restoring…" ends when the work does, and
  if the server refuses, the refusal needs a notice to land in.
- **The plan's review opens beside the week only from 1640px.** The drawing puts its 440px
  panel beside the week from 1100px and shares what is left among the seven columns: 101px
  each at 1280px, 76px at 1100px, where Sunday's header spills out of its column even at 100%
  text. From 1640px the columns keep their 155px floor beside the panel: 1617px measured, and
  a scrollbar's width on top. Below it the review takes the page, as it does below 1100px,
  with each step's day and what the plan adds to every day it touches. The week never scrolls
  sideways beside the panel. Gabriel's reason: all seven days are always on screen, so a
  change the plan makes is never on a day out of view.
- **Kept steps are numbered 1 to n in the order shown, and a discarded step is named by its
  title.** The drawing numbers a discarded step by its position in the model's answer, which
  collides with a kept step's number. "after step N" and a refused commit count the same way
  (decided on 2026-11-22).
- **The count line has no "came back":** "6 kept · 3 discarded". No row keeps how many steps
  the model's answer held.
- **Reading the plan again after a commit lost a race says nothing of its own.** The drawing
  says "Read again. Every step still has its time.", which the read cannot promise: it does
  not look for tasks booked since (ADR-0059). The steps as read are the answer.
- **A step's time is `14:25 – 14:55`, spaced,** as every range is in the one vocabulary. The
  drawing writes the plan's ranges unspaced.
- **A plan being made says when it was asked, not when it started.** The drawing has "It
  started at 14:21"; a request's read carries only when it was asked (ADR-0058), so it says
  "Asked at 14:20, for 14 days. Plans usually take under a minute."
- **A refused request says when to ask again in one sentence, read from its `Retry-After`.**
  "You can ask again at 14:43.", with the day when it is not today: "You can ask again on Sun
  1 Nov, at 00:00." The drawing names the day past ten hours, and words a month's allowance
  apart, "They come back on Sunday 1 November.", which is the wrong day west of UTC: the month
  turns in UTC (ADR-0044), on the evening before there.
- **A failed request stays "didn’t work" on the Plan button until something newer happens:**
  a request sent or a plan written. The drawing clears it when "Ask for it again" is pressed,
  which nothing on the server records, so a reload would bring it back.
- **A step's fields are a task's.** The duration reads like `2h30`, from 1m to 24h, which is
  what the server takes from a person (ADR-0032, ADR-0037), rather than minutes from 15 to the
  preferred block, which bound only what the model proposes. The start is a day of the plan's
  and a time typed in 24-hour form, as a task's edit takes it, and a step with no time starts
  with the time empty rather than a free minute guessed for it. A step becomes a task, and
  should not change its words on the way.
- **The start's hint says the rules the server holds for a step:** "Not before now: 14:20
  today, and clear of your tasks and the plan’s other steps." The drawing adds "between 07:00
  and 23:00, on a five-minute mark", which the server holds for what the planner proposes and
  not for a step the person places (ADR-0030).
- **A removed step's notice offers "undo", with Ctrl+Z,** as a deleted task's does.
- **Steps sent to next week say where they went in the added step's words:** "1 step placed
  next week, at Mon 26, 07:00.", and "from" for more than one. When none found room, it says
  so, "The step found no room next week either.", where the drawing has a dash.
- **"Write it myself" is offered on every refusal that spares the model:** the hour's and
  the day's limits as well as the month's allowance, the paused month and the breaker. The
  drawing offers it on the last three. The screen cannot tell the allowance's 429 from a
  limit's without reading its sentence, and none of them reads a plan written by hand
  (ADR-0047), which is the way through each of them.
- **A plan written by hand is named before its first step goes.** "What it’s for" is asked for
  at the first Add, "Write what the plan is for.", with focus on it, and is text from then on,
  as "You asked" is. The drawing keeps the field open and lets it stay empty. The API takes the
  name when it makes the plan, refuses an empty one and does not rename it, and the plan is
  made with its first step (decided on 2026-11-22).
- **A step written by hand waits for nothing:** it has no "after step N". The API adds a step
  without prerequisites (ADR-0047), and the drawing's second step by hand reads "after step 1".
- **An approved plan's page offers "Ask for a new plan" and "Write it myself".** The drawing's
  page has no way out to another plan, and the screen opens on the approved plan while any of
  its tasks is open, so the form would be out of reach until every one was done. An approved
  plan does not stand in the way of another (ADR-0033).
- **A task made by a plan says "from your plan", with no step number,** and leads to the page
  of the plan it came from, which need not be the one the Plan button counts. A task keeps
  only its plan; the number would need a column and a migration (decided on 2026-11-22).
- **"Show the week", after Approve, opens the week where it was,** this week or today below
  1100px, rather than on the first task's day. A plan starts today, so its first task is in
  the week that opens.
- **Signing out waits for the server, and says so when it did not happen.** "Signing out…"
  stays until the server has ended the session. A sign-out that did not happen leaves the person
  signed in, with "Couldn’t reach the server." or "The server didn’t sign this browser out.",
  then "You’re still signed in here.", under the button that was pressed. The drawing has no
  such state. Only the server can clear the cookie that
  signs the browser back in on a reload, so a page saying "You’re signed out of this browser"
  before it answered could be wrong (decided on 2026-11-23).
- **The usable day's two times are a task's fields,** typed in 24-hour form and read the way a
  task's start is, with "Use 24-hour time, like 14:30." for one that is not a time. The drawing
  uses the platform's time field, which shows "07:00 AM" in a browser set to American English,
  against the 24-hour times everywhere else on screen; it loses the wheel a phone would open
  (decided on 2026-11-23).
- **Save sends only the parts that changed,** so a part changed on another device meanwhile is
  left as it is there. The server judges the window it leaves, with the stored other end, as it
  does any change.
- **The block takes only digits, and an empty one goes as 0,** so the sentence that answers it
  is the server's, "A block lasts from 15 minutes to 4 hours.", and not one written for the
  screen.
- **The Menu stays open while it signs out.** The drawing closes it at once, which leaves
  "Signing out…" and a sign-out that failed with nowhere to be said on the week.
- **Two lines that ran past the edge at 200% text are held inside it:**
  - the late completion line on a phone, made to wrap;
  - the day field when a plan's step is edited at 320px, which a select cannot wrap: it
    shrinks to the row instead, and its longest option is clipped.
