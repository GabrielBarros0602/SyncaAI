# The screens, as designed

Three self-contained HTML files from the second design round. They are the **specification**
for the front end, not source to be imported: the implementation is React with CSS Modules
(ADR notes in `docs/backlog.md`), and these are what it has to match.

| File | Screen |
|---|---|
| `week.html` | the week, in every state |
| `settings.html` | email, time zone, password, sign out |
| `confirm-address.html` | arriving from the verification link, in three states |

Open them in a browser. They are large because the fonts are inlined; nothing is fetched.

## What was decided in them, and why it matters when reading the code

**A task belongs to the day it begins on.** It is listed there, counted there, and the five
verbs act on it there. The day it runs into gets a dimmed band instead — the task named, where
it came from, one way back to the row that owns it, and no verbs. Repeating the row on both
days was the alternative: the count would say five tasks where there are three, and a delete
button would sit on half a task. The API side of this is already merged.

**The five verbs live in the opened row.** Three models were drawn — in the row, on the meta
line, in a bar at the foot — and this is the one chosen, for two reasons: at rest it shows
nothing at all, and it is the only one of the three with room for a note and a checklist.
Completing is promoted out of the set into a permanent box before the title, because it is the
frequent one and should not cost an opening.

**The big number is what is booked, not what is free.** Free has a floor at zero, so a
sixteen-hour day, a nineteen-hour day and a twenty-four-hour day all read `0m` at the same size.
Free moved to the line below, with its denominator: `3h free of 16h`.

**Plan against actual is on the row.** `done 15:00 · 1h30 of 3h · −1h30`, in the neutral ink.
Running past the estimate is information, not a failure — the accent stays for conflict,
capacity and error only.

## What is not in them

The AI layer. The only place it touches the screen is the offer to move something off a heavy
day, and today that is arithmetic over capacity the screen already has, not a model.
