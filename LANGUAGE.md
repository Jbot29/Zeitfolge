# Zeitfolge — language spec v0.10

A small, code-first language for working with time — asking questions about
it, and doing algebra on stretches of it. The same source is the data, the
answer, and the diagram. Designed to be legible to a human at a glance and
to a language model in full.

Its one governing idea: **keep separate what every time library smears
together.** There are two kinds of time —

- **Absolute time** — instants on the physical timeline. One number:
  milliseconds since the UTC epoch. All storage and all arithmetic live
  here. An instant has no timezone; it just *is*.
- **Civil time** — `2026-07-17 10:00`, "Friday at 10". Wall-clock fields
  that mean nothing until a timezone projects them onto the timeline. A
  civil day is not 86,400 seconds (DST days are 23 or 25 hours). Humans
  read and write *only* civil time.

Nearly every time bug is one of these masquerading as the other. Zeitfolge
holds them apart with a single statement — the **lens**:

```
timezone = Europe/Vienna
```

Every civil literal after that line is read through the lens into a UTC
instant; every answer is shown back through it. The lens is presentation
and interpretation — it is never part of the data. The playground's **UTC
view** proves this: it re-emits any program with the lens removed (every
civil literal rewritten to its UTC wall time), and the result is valid
source resolving to identical instants and extents.

The timezone database is the one piece of machinery we refuse to hand-roll:
`Intl` ships the full IANA database in every JS engine, so `zeitfolge.js`
has zero dependencies.

This is a working draft. Scope is deliberately tiny and grows only when a
real example forces it — never speculatively. v0.1 was forced by the
countdown timer; v0.2 by the credit-blocks problem; v0.3 by the Schengen
90/180 rule; v0.4 by the booking page (the Calendly clone's core); v0.5 by
embedding — the same script running in a playground, a test, and a Lambda;
v0.6 by recurring availability — "every weekday, nine to five"; v0.7 by
the safe-restart question — "where is the latest stretch where only one
credit block is active?"; v0.8 by `go_to_airport = flight - 3 hours`;
v0.9 by embedding again — "the overlap should say which blocks it came
from, so the caller can join the answer back to its own data"; v0.10 by
the remote worker's wall — "what time is it, right now, for everyone?"

## Try it live

Open `index.html` in a browser — no server, no network needed (the open…
button loads any `.zf` file from disk either way). `./serve.sh` starts a
local http server, which additionally enables `?script=<path>` URLs for
loading and sharing scripts. Edit the source on the left; the answers
re-run on the right, ticking live. The pure core (`zeitfolge.js`) has no
DOM, so it runs in Node too, and the same code is exercised by the
playground and the tests (`node --test`).

---

## Program structure

One statement per line, read **top to bottom** (a Zeitfolge program is a
script, not a set of facts: the lens applies to the lines below it, and a
name must be bound before it is used). `#` starts a comment. Blank lines
are ignored. The parser is tolerant — it collects errors and warnings with
line numbers and keeps going.

```
timezone = <IANA zone>        aim the lens (default: UTC)
<name> = <expression>         bind a value — an instant or a set of intervals
<name> = every <days> [HH:MM .. HH:MM]
                              define a recurrence (its own statement form)
now                           what time is it, right now, through the lens?
until <instant>               how long from now until it?
since <instant>               how long from it until now?
days of <intervals>           civil days touched, through the lens
length of <intervals>         absolute duration of the coverage
partition <intervals>         cut at every boundary — who covers each piece?
rolling days of <intervals> in <n> days [limit <m>]
                              the windowed aggregation, day by day
slots of <intervals> every <n> minutes|hours
                              chop coverage into offerable pieces
show <intervals>              the interrogation verb: is it there, and where?
```

A line ending in an operator (`,` `&` `|` `-` `..`) **continues on the
next line**, so a real trip list reads like data:

```
trips = 2025-12-15 .. 2025-12-23,
        2026-03-27 .. 2026-05-11
```

## now — a clock, and a world clock

`now` on its own line is the smallest verb: no operand, it just reads the
present instant through the lens in force and shows it as a live-ticking
clock. It is `until` with the target dropped — take away *how long until
the target* and what remains is *what time it is*.

The point of a verb this small is stacking it under different lenses:

```
timezone = Europe/Vienna
now                              # home

timezone = America/New_York
now                              # the team

timezone = Asia/Tokyo
now                              # already tomorrow
```

Three clocks, three wall times, **one instant** — the page is a world
clock. The UTC view makes the claim literal: because there is no verb to
display a bare instant literal, `now` cannot be frozen the way an instant
binding is; instead every line collapses to an identical `now` under the
single `timezone = UTC` at the top — visible proof they were the same
moment all along, only differently presented.

Deliberately narrow: only the bare keyword, only the present. Letting *any*
instant render as a clock (so a bound `standup` on its own line shows its
wall time) is a natural next step, left until an example asks for it.

## Values

Three types, one timeline:

- **instant** — a point. Written as a civil literal, read through the lens.
- **interval** — a stretch, `[start, end)` half-open underneath: adjacent
  intervals meet without overlapping, and lengths add.
- **set** — an ordered list of intervals, each carrying **labels**: a set
  of names saying where the time came from. A single interval is a set of
  one. Binding a set labels any *unlabeled* members with the binding's
  name (it fills a void — it never stacks on inherited provenance) — so
  after `block1 = 2026-01-10 .. 2026-04-09`, that stretch *knows* it is
  block1, and everything downstream can say so.

### Provenance through the algebra

The language owns time semantics; the **host owns domain semantics**.
There are no quantities (credits, prices) in Zeitfolge — instead, labels
travel through every operation so the caller can join answers back to its
own data:

| operation | labels of the result |
|---|---|
| `a & b` | union of both parents' — that time came from both |
| `a \| b` | union of everything merged (same-label pieces stay one label) |
| `a - b` | the survivor's; the remover leaves no name |
| `alone in x` | the lone member's |
| `shared in x` | **all** covering members' — the overlap names its parents |
| `partition x` | per segment, in `covers` |
| `slots of x` | the free stretch each slot was cut from |

Intersection cuts where the covering labels *change* (so labels are
exact, never smeared along a piece), and contiguous same-label stretches
re-fuse. In loaded data, `{start, end, name}` seeds the labels. The
embedding round trip: named ranges in → `[{start, end, labels: [...]}]`
out → the host joins `labels` to whatever it knows (credits, people,
prices) that the language deliberately doesn't.

## Civil literals

```
2026-07-17                    midnight, through the lens
2026-07-17 10:00
2026-07-17 10:00:30
```

(`T` is accepted in place of the space.) A literal is validated as a real
calendar date and time — `2026-02-30` and `25:00` are errors, not
wraparounds.

### DST edges (pinned by tests)

- **Nonexistent times** (spring-forward gap): `02:30` on a night the clocks
  jump `02:00 → 03:00` reads as `03:30` — shifted forward past the gap —
  with a **warning**.
- **Ambiguous times** (fall-back repeat): a wall time that happens twice
  resolves to the **later** instant, silently (for now).

## Expressions

The right-hand side of a binding and the argument of the measuring verbs.
Precedence, loosest to tightest (parentheses group):

| op | meaning | provenance |
|---|---|---|
| `,` | **collect** — concatenate sets | labels kept, members distinct |
| `\|` | **union** — merge coverage | labels of everything merged |
| `-` | **subtract** — cut B out of A | A's labels; a member may split into pieces |
| `&` | **intersect** — clip A to B | union of both parents' labels |
| `..` | make an interval from two instants | starts unlabeled; a binding names it |

Also at the tightest level: `load "key"` (external data — see Embedding),
`last <n> days` (see Windows), `()` (the empty set — no bookings yet is a
fact, not an error), and parentheses for grouping. Between `,` and `|`
sit the selectors `first <n> of` and `next <n> of` (see Recurrence).

### `..` and the through-rule

A bare date (no time) on the **right** of `..` means *through that day*:

```
trip = 2026-03-27 .. 2026-05-11                    # includes May 11 — 46 days, as a human states a trip
slot = 2026-05-11 10:00 .. 2026-05-11 12:00        # with explicit times: exactly 2 hours
```

`2026-01-01 .. 2026-01-03` is three days; `2026-01-01 .. 2026-01-03 00:00`
is exactly two. `2026-01-01 .. 2026-01-01` is a valid one-day trip. On the
left (and everywhere else) a bare date is the start of its day. The UTC
view resolves the through-rule away — the exclusive end is what's real.

An interval must end after it starts; `..` wants an instant on each side;
the set operators want intervals on both sides (an instant has no width).

## The two measures

**`days of x`** counts **civil days touched** by x's coverage, through the
lens at that line. A partial day counts (arrive at 23:00 — that day still
counts; ask Schengen). Two pieces of the same civil day count **once**:
it's a set of dates, not a sum of spans. Overlapping members count once —
coverage, not bookkeeping.

**`length of x`** is the **absolute duration** of the coverage, as
days/hours/minutes/seconds of physical time.

They disagree, and that disagreement is the whole point:

```
timezone = Europe/Vienna
x = 2026-03-28 12:00 .. 2026-03-29 12:00
days of x        # 2  — touches two calendar days
length of x      # 23 hours — the clocks jumped that night
```

Durations deliberately have **no months or years**: those are civil units
of varying length and belong to a later, calendar-aware verb.

## partition

The credit-blocks verb. Cut the timeline at every member boundary; each
resulting segment knows exactly which members cover it (by name), how many
civil days it touches, and how long it is. Uncovered gaps are skipped.

```
block1 = 2026-01-10 .. 2026-04-09      # a 90-day block of credits
block2 = 2026-02-15 .. 2026-06-15      # bought mid-block, different expiry
partition block1, block2
#  → 2026-01-10 → 2026-02-15    36 days   block1
#    2026-02-15 → 2026-04-10    54 days   block1 + block2
#    2026-04-10 → 2026-06-16    67 days   block2
```

This is the decomposition you otherwise hand-build before you can answer
anything about overlapping blocks — which credits are live when, what
expires first, what a day of usage draws from.

## Windows

**`last <n> days`** is an expression: the trailing window of n civil days
ending **today, inclusive** (Schengen counts today), through the lens. It
is just an interval, so it composes with the whole algebra:

```
days of trips & last 180 days          # Schengen days used as of right now
```

It is resolved at evaluation time — the UTC view freezes it into an
explicit interval, because a desugared program must mean the same thing
tomorrow.

**`rolling days of <x> in <n> days [limit <m>]`** is the windowed
aggregation — SQL's OVER clause for the timeline. For every civil day from
the first covered day to the last covered day *plus one full window* (the
decay back to zero is part of the answer), the value is the civil days of
x's coverage inside the trailing n-day window ending on that day. The
optional `limit` draws the law on the chart and grades each member's
high-water mark (the value on its own last day — "used at the end of the
trip"):

```
timezone = Europe/Vienna

trips = 2025-12-15 .. 2025-12-23,
        2026-03-27 .. 2026-05-11,
        2026-07-03 .. 2026-07-08,
        2026-07-17 .. 2026-08-10

rolling days of trips in 180 days limit 90
#  → a usage curve over 419 days; per trip: at end 9, 55, 52, 77 of 90
```

Windows are counted in **civil days through the lens** — a window that
straddles a DST change is still exactly n calendar days. The series is
capped at 2000 points (with a warning) to keep the playground honest.

## slots

The booking-page verb. Availability and bookings are **separate facts** —
policy vs events — and free time is derived, never stored:

```
timezone = Europe/Vienna

blocks = 2026-07-20 12:00 .. 2026-07-20 15:00,
         2026-07-21 09:00 .. 2026-07-21 13:00
booked = 2026-07-20 13:00 .. 2026-07-20 13:30

free = blocks - booked
slots of free every 30 minutes         # → 12:00 12:30 13:30 14:00 14:30 · 09:00 …
```

`slots of` walks the **merged coverage** (overlapping members never offer
the same time twice) and emits consecutive step-sized slots from the start
of each free stretch; a remainder too short for a full slot is dropped and
reported (`droppedMs`). Slots are **absolute time** — a 30-minute slot is
30 real minutes, whatever the wall clock does. Steps are `minutes` or
`hours`; grid-snapping (slots at :00/:30 regardless of where free time
starts) is deliberately not built yet — the simple rule until a real
booking page complains. The list is capped at 2000 (with a warning).

When someone accepts a slot, the host appends one interval to the booked
set and re-runs the program — the script itself never mutates anything; it
is a pure function of (source, data, now).

## Recurrence and selectors

```
hours = every weekday 09:00 .. 17:00
lunch = every day 12:00 .. 13:00
mondays = every monday                    # no times: the whole civil day
night = every day 22:00 .. 02:00          # spills past midnight
```

A **rule** is a third kind of value: an unbounded civil generator — every
weekday, forever, in both directions. It is defined by its own statement
form (`every day | weekday | monday…sunday`, with an optional wall-clock
window), and it **keeps the lens in force at its definition**: a Vienna
Monday stays a Vienna Monday whatever lens comes later. Its occurrences
are wall-clock true — `09:00 .. 17:00` is 8 wall hours even on the
23-hour DST day (pinned by tests).

Because a rule is unbounded, the algebra refuses it until it is
**bounded** — three ways in:

```
hours & 2026-07-13 .. 2026-07-19      # materialized over that span
week - lunch                          # set - rule: the finite side is the bound
next 5 of hours                       # the next 5 occurrences, anchored at now
```

Everything else (`rule | x`, `rule , x`, `rule - x`, `rule & rule`,
`days of rule`, …) is an error with a hint, not a silent explosion.

The **selectors** — `first <n> of x`, `next <n> of x` — take a finite bite
of anything: `next` keeps what is still ahead (end > now, so an ongoing
occurrence counts), `first` takes from the start. A set has a first; a
bare rule does not (it extends backwards forever), so `first n of rule`
is an error that tells you to use `next` or `&`. Selector results are
frozen in the UTC view, like `last n days` and `load`.

The whole scheduling engine, in five lines:

```
hours = every weekday 09:00 .. 17:00
lunch = every day 12:00 .. 13:00
week = next 5 of hours
free = week - lunch - load "booked"
slots of free every 30 minutes
```

**The honest desugar limit:** an instant dissolves into UTC; a rule
cannot. "Monday, nine to five" is civil all the way down — there is no
UTC fact under it, only an infinite family of them. So the UTC view
re-aims the lens *just around* rule definitions instead of removing it.
That asymmetry is the two-kinds-of-time thesis, stated by the desugarer.

## Coverage depth — alone and shared

`partition` computes how deeply each moment is covered; the depth filters
*select* by it:

```
alone in credits          the depth-1 regions — the safe ground between
                          overlaps; each stretch keeps the NAME of its
                          lone member, so it knows who is alone there
shared in credits         the depth-2+ regions — the burn zones, for any
                          number of members, not just pairwise &
```

Both return ordinary sets, so everything composes. The question that
forced this version is one line:

```
show last 1 of alone in credits       # the latest safe place to restart
```

`last <n> of` completes the selector family (`first` from the start,
`next` ahead of now, `last` from the end — and `last 3 of x` vs
`last 3 days` is decided by the word after the count). A rule has a
`next` but no `first` or `last`: it extends forever both ways.

Selectors and depth filters read like English, so their operand is
**everything to their right** — `alone in a, b` filters the whole
collection; parenthesize to stop them early. Contiguous same-name
stretches fuse (a cut that didn't change the answer shouldn't show in
it), and an empty result is a valid answer — `show` says "none", which is
the *if* in "if it exists".

`show <intervals>` is the plain interrogation verb: the stretches drawn
as strips plus a listing with dates, day counts, and names.

## Durations and instant arithmetic

```
go_to_airport = flight - 3 hours
checkin = flight + 45 minutes
buffer = 3 hours                       # durations bind to names
until flight - buffer
```

A duration (`<n> seconds|minutes|hours|days|weeks`) is a fourth value
type, and it carries the language's thesis one more time:

- **minutes / hours / seconds are absolute time** — `- 3 hours` is
  10,800 real seconds, whatever the wall clock does.
- **days / weeks are civil steps** — `- 1 day` is *the same wall time,
  one calendar day earlier*, through the lens at that line.

Across a DST night these disagree, and the disagreement is the point
(pinned by tests): with the clocks jumping forward on 2026-03-29,

```
timezone = Europe/Vienna
x = 2026-03-29 12:00
x - 1 day             # 2026-03-28 12:00 — same wall time yesterday
x - 24 hours          # 2026-03-28 11:00 — 24 real hours earlier
```

`+`/`-` with a duration works on **instants only**; shifting or
shrinking whole intervals is deliberately undefined until an example
forces a meaning. A civil step landing in a DST gap shifts forward, like
any civil projection. And because day steps depend on the lens, the UTC
view now emits every instant as its **resolved UTC literal** — which also
freezes `now` at evaluation time, as a reproducible desugar must.

## Embedding — `load`

The facts can live outside the program. `load "key"` is an **expression**
(it composes anywhere a set or instant can appear), resolved from the data
the host passes in:

```js
const Z = require("./zeitfolge.js");
const out = Z.evaluate(source, { now: Date.now(), data: JSON.parse(payload) });
// out.queries[n] → { kind, days | breakdown | segments | slots, ... }
```

The same script runs unchanged against the playground's data panel, a test
fixture (`examples/*.json` sits beside `examples/*.zf`), or a Lambda's
request payload. A program is a pure function of `(source, data, now)`.

Data shapes:

| JSON | value |
|---|---|
| `"2026-07-20 13:00"` | an instant, read **through the lens** at the load line |
| `"2026-07-20 13:00Z"` | an instant in UTC, whatever the lens says |
| `1784732400000` | an instant, epoch milliseconds |
| `["2026-01-10", "2026-04-09"]` | one interval (a bare end date gets the through-rule) |
| `[[s, e], [s, e], …]` | a set; `[]` is the valid empty set |
| `[{ "start": s, "end": e, "name": "trip1" }, …]` | a set with named members |

Anonymous loaded members take the binding's name, like any set. The
booking flow: the host stores `blocks` and `booked` as JSON; accepting a
slot appends one pair to `booked` and re-runs — the script never mutates
anything. The **UTC view freezes loaded values into literals**: a
desugared program must mean the same thing with the data gone.

---

## Roadmap — where this is going

Each stage is forced by a real problem, in ramp order:

- **Quantities — deliberately rejected** (v0.9). Amounts on intervals
  would import domain semantics (units, allocation policy) that aren't
  time semantics. The decision: labels travel through the algebra, and
  the *host* joins them to its own quantities. Revisit only if a real
  example can't be served that way.
- **Richer recurrence, when examples force it.** Exceptions (`except`
  holidays), month rules (first Monday of the month), `rule & rule`,
  date-anchored selectors (`next 3 after <instant>`). Each waits for a
  real scheduling need — recurrence is where scope creep goes to feast,
  which is why v0.6 shipped only days-of-week and wall-clock windows.
