/* =====================================================================
 * ZEITFOLGE v0.2 — language core (pure: parser + evaluator)
 * No DOM, no rendering. Runs in the browser (window.Zeitfolge) and in
 * Node (module.exports), so the same code powers the playground, the
 * tests, and — later — any host that embeds it (a Lambda, a CLI).
 *
 * Design thesis: there are TWO kinds of time, and every time bug comes
 * from smearing them together:
 *
 *   ABSOLUTE time — instants on the physical timeline. One number,
 *     milliseconds since the UTC epoch. All storage and all arithmetic
 *     happen here. An instant has no timezone; it just IS.
 *   CIVIL time — "2026-07-17 10:00", "Friday at 10". Wall-clock fields
 *     that mean nothing until a timezone projects them onto the
 *     timeline. Humans read and write ONLY civil time.
 *
 * The language holds them apart with one statement:
 *
 *   timezone = Europe/Vienna
 *
 * That is a LENS, not a conversion: every civil literal after it is read
 * through that zone into UTC, and every result is shown back through it.
 * Change the lens and the instants hold still.
 *
 * The IANA timezone database ships inside every JS engine via `Intl` —
 * that is the ONE piece of time machinery we refuse to hand-roll.
 *
 * v0.1 — instants and the two countdown verbs:
 *   timezone = <IANA zone>      the lens (defaults to UTC)
 *   <name> = <civil literal>    bind an instant (stored as UTC epoch ms)
 *   until / since <instant>     how long to / from it?
 * v0.2 — INTERVALS: stretches of the timeline as first-class values.
 *   Forced by the credit-blocks problem: overlapping purchased blocks
 *   with different expiries, hand-decomposed into non-overlapping
 *   sub-blocks to reason about. Now the language does the decomposing.
 *     a = 2026-01-10 .. 2026-04-09    an interval — half-open [start,end)
 *                                     underneath; a bare END date means
 *                                     "through that day"
 *     credits = a, b                  a COLLECTION — members keep their
 *                                     names (what `partition` reports)
 *     a & b   a - b   a | b           the algebra — intersect, subtract,
 *                                     union (| merges and forgets names)
 *     partition credits               the credit-blocks verb: the set,
 *                                     cut at every boundary, each piece
 *                                     knowing who covers it
 *     days of x                       civil days TOUCHED, through the lens
 *     length of x                     absolute duration — a DST night is
 *                                     23 hours long yet touches 2 days
 * v0.3 — SLIDING WINDOWS. Forced by the Schengen 90/180 rule: at most 90
 *   days inside the zone in ANY trailing 180-day window. That is a
 *   windowed aggregation — SQL's OVER clause, for the timeline:
 *     days of trips & last 180 days        today's usage — `last N days`
 *                                          is just an interval; it
 *                                          composes with the algebra
 *     rolling days of trips in 180 days limit 90
 *                                          the whole story: the usage
 *                                          series day by day, the limit,
 *                                          each trip's high-water mark
 *   Also: a line ending in an operator (, & | - ..) continues on the
 *   next line, so a real trip list reads like data.
 * v0.4 — SLOTS. Forced by the scheduling problem (the Calendly clone):
 *   availability minus bookings is free time — the v0.2 algebra — but a
 *   booking page needs it chopped into offerable pieces:
 *     free = blocks - booked
 *     slots of free every 30 minutes
 *   Slots walk the merged coverage; a remainder too short for a slot is
 *   dropped (and reported). Sub-day steps are ABSOLUTE time — a slot is
 *   30 real minutes even across a DST jump.
 * v0.5 — LOAD: the embedding story. The facts move OUTSIDE the program:
 *     blocks = load "blocks"
 *   resolved from evaluate(src, {data}) — a Lambda's request payload,
 *   the playground's data panel, or a test fixture; the same script runs
 *   unchanged in all three. Data shapes: a string or number is an
 *   instant ("2026-07-20 13:00" read through the lens; a trailing Z
 *   means UTC regardless; a number is epoch ms). A two-element array is
 *   one interval (bare end date gets the through-rule). An array of
 *   pairs — or of {start, end, name} objects — is a set. `load` is an
 *   expression, so it composes: slots of load "blocks" every 30 minutes.
 *   The desugarer freezes loaded values into literals: a desugared
 *   program must mean the same thing with the data gone.
 * v0.6 — RECURRENCE + SELECTORS: the scheduling engine completes.
 *     hours = every weekday 09:00 .. 17:00
 *   A rule is a THIRD value type: an unbounded civil generator. It is
 *   not a set — it extends forever both ways — so it must be BOUNDED
 *   before the algebra touches it:
 *     rule & interval        materialized over that span
 *     set - rule             the span is finite, so this works
 *     next 3 of rule         anchored at now
 *     first 3 of set         sets have a first; a bare rule does not
 *   A rule KEEPS the lens at its definition: a Vienna Monday stays a
 *   Vienna Monday whatever lens comes later, and its occurrences are
 *   wall-clock true — 09:00..17:00 is 8 wall hours even on a 23-hour
 *   DST day. Which yields the honest desugar limit: instants dissolve
 *   into UTC, a rule CANNOT — recurrence is irreducibly civil, so the
 *   UTC view re-aims the lens just around it.
 * v0.7 — COVERAGE DEPTH + show. Forced by a real credit-blocks question:
 *   "where is the latest stretch where only ONE block is active — the
 *   safe place to start again?" partition computes depth but couldn't
 *   select by it:
 *     alone in credits          the depth-1 regions, each knowing WHO
 *     shared in credits         the depth-2+ regions (the burn zones)
 *     last 3 of x               first/next/last — the selector completes
 *     show <intervals>          the interrogation verb: is it there, where
 *   So the question is: show last 1 of alone in credits
 * v0.9 — PROVENANCE: every member carries a SET of labels, and the
 *   algebra composes them honestly. The principle it enforces: the
 *   language owns time semantics, the HOST owns domain semantics —
 *   quantities (1000 credits) stay out; instead, names travel through
 *   the algebra so the caller can join answers back to its own data:
 *     block1 & block2          one stretch, labels [block1, block2]
 *     shared in credits        the overlaps, each naming its parents
 *     blocks | extras          coverage merged, ancestry kept
 *   A binding labels only the unlabeled (it fills a void, it doesn't
 *   stack), subtraction keeps the survivor's labels, and cuts fall
 *   where the label-set changes — then same-label neighbors re-fuse.
 * v0.8 — DURATIONS: instant arithmetic, with the split stated.
 *     go_to_airport = flight - 3 hours
 *   A duration is a fourth value type, and it carries the thesis:
 *   minutes/hours are ABSOLUTE time; days/weeks are CIVIL steps through
 *   the lens. Across a DST night, flight - 24 hours and flight - 1 day
 *   are DIFFERENT instants — here that difference is spelled, not
 *   smeared. Durations bind to names (buffer = 3 hours) and apply to
 *   instants with + and -; shifting whole intervals is not defined yet.
 *   Instants now desugar to their resolved UTC literal always — which
 *   freezes `now` and day-arithmetic at evaluation time, as it must.
 * Planned (see LANGUAGE.md): quantities on intervals (1000 credits).
 * ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Zeitfolge = api;
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

const VERSION = "0.10";
const MS = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 };

/* ---------------------------------------------------------------------
 * Timezone machinery — Intl is the only timezone database we use.
 * ------------------------------------------------------------------- */
const fmtCache = new Map();
function zoneFormatter(zone) {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(zone, f);
  }
  return f;
}

function isValidZone(zone) {
  try { zoneFormatter(zone); return true; } catch (e) { return false; }
}

// project an instant into a zone's wall-clock fields
function epochToCivil(ms, zone) {
  const parts = zoneFormatter(zone).formatToParts(ms);
  const f = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = parseInt(p.value, 10);
  return { y: f.year, mo: f.month, d: f.day, h: f.hour, mi: f.minute, s: f.second };
}

// a zone's UTC offset (ms) at a given instant — derived, never tabulated
function zoneOffset(ms, zone) {
  const f = epochToCivil(ms, zone);
  return Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s) - Math.floor(ms / 1000) * 1000;
}

/* Project wall-clock fields THROUGH a zone onto the timeline. The
 * dangerous direction: DST makes some wall times ambiguous and others
 * nonexistent. We iterate; inside a spring-forward gap the iteration
 * oscillates and we take the PRE-transition offset, shifting the phantom
 * time forward past the gap (02:30 that never happened reads as 03:30).
 * Ambiguous fall-back times resolve to the LATER instant. Both rules are
 * pinned by tests; the evaluator warns on a failed round trip. */
function civilToEpoch(f, zone) {
  const asUTC = Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s);
  let ms = asUTC, seen = [];
  for (let i = 0; i < 4; i++) {
    const off = zoneOffset(ms, zone);
    seen.push(off);
    const next = asUTC - off;
    if (next === ms) return ms;
    ms = next;
  }
  return asUTC - Math.min(...seen);   // gap: pre-transition offset → shift forward
}

/* ---------------------------------------------------------------------
 * Formatting — every instant is shown through a zone, never raw.
 * ------------------------------------------------------------------- */
const pad2 = (n) => String(n).padStart(2, "0");

function formatCivil(f, opts) {
  const secs = f.s !== 0 || (opts && opts.seconds);
  return `${f.y}-${pad2(f.mo)}-${pad2(f.d)} ${pad2(f.h)}:${pad2(f.mi)}` + (secs ? `:${pad2(f.s)}` : "");
}

function formatOffset(offMs) {
  const sign = offMs < 0 ? "-" : "+", a = Math.abs(offMs);
  return `UTC${sign}${pad2(Math.floor(a / MS.hour))}:${pad2(Math.floor((a % MS.hour) / MS.minute))}`;
}

// "2026-07-17 10:00 Europe/Vienna (UTC+02:00)"
function formatInstant(ms, zone) {
  return `${formatCivil(epochToCivil(ms, zone))} ${zone} (${formatOffset(zoneOffset(ms, zone))})`;
}

/* ---------------------------------------------------------------------
 * Durations — a span of ABSOLUTE time (ms), broken into d/h/m/s for
 * humans. Deliberately no months or years: those are civil units of
 * varying length and belong to a calendar-aware verb, not subtraction.
 * ------------------------------------------------------------------- */
function breakdown(ms) {
  const sign = ms < 0 ? -1 : 1, a = Math.abs(ms);
  return {
    sign, ms: a,
    days:    Math.floor(a / MS.day),
    hours:   Math.floor((a % MS.day) / MS.hour),
    minutes: Math.floor((a % MS.hour) / MS.minute),
    seconds: Math.floor((a % MS.minute) / MS.second),
  };
}

// "4 days 19 hours 23 minutes 8 seconds" — starts at the first non-zero
// unit, keeps every unit after it (a zero in the middle is information).
function formatDuration(bd) {
  const units = [["day", bd.days], ["hour", bd.hours], ["minute", bd.minutes], ["second", bd.seconds]];
  while (units.length > 1 && units[0][1] === 0) units.shift();
  return units.map(([u, n]) => `${n} ${u}${n === 1 ? "" : "s"}`).join(" ");
}

/* ---------------------------------------------------------------------
 * The interval algebra — pure functions on MEMBERS: {start, end,
 * labels}. Half-open [start, end) throughout: adjacent intervals meet
 * without overlapping, and lengths add. A SET is an ordered list of
 * members; the order is the stacking order in the visualization.
 * `labels` is PROVENANCE — a set of names saying where the time came
 * from. The algebra composes it honestly: & and | union the parents'
 * labels, - keeps the survivor's, the depth filters report it. Cuts
 * fall where the label-set changes; same-label neighbors re-fuse.
 * ------------------------------------------------------------------- */
const uniqLabels = (arr) => [...new Set(arr)].sort();
const sameLabels = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// the union COVERAGE of members: sorted, disjoint stretches, each
// carrying the union of its constituents' labels
function mergedCoverage(members) {
  const sorted = [...members].sort((a, b) => a.start - b.start);
  const out = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m.start <= last.end) {
      last.end = Math.max(last.end, m.end);
      last.labels = uniqLabels(last.labels.concat(m.labels));
    } else out.push({ start: m.start, end: m.end, labels: uniqLabels(m.labels) });
  }
  return out;
}

/* A & B — the time covered by both, labeled by BOTH parents. Each piece
 * is cut where B's covering members change (so the labels are exact,
 * not smeared along the piece), then same-label neighbors re-fuse. */
function intersectSets(a, b) {
  const out = [];
  for (const m of a) {
    const cuts = new Set([m.start, m.end]);
    for (const x of b) {
      if (x.start > m.start && x.start < m.end) cuts.add(x.start);
      if (x.end > m.start && x.end < m.end) cuts.add(x.end);
    }
    const cs = [...cuts].sort((p, q) => p - q);
    let prev = null;
    for (let i = 0; i < cs.length - 1; i++) {
      const lo = cs[i], hi = cs[i + 1];
      const covering = b.filter((x) => x.start <= lo && x.end >= hi);
      if (!covering.length) { prev = null; continue; }
      const labels = uniqLabels(m.labels.concat(covering.flatMap((x) => x.labels)));
      if (prev && prev.end === lo && sameLabels(prev.labels, labels)) prev.end = hi;
      else { prev = { start: lo, end: hi, labels }; out.push(prev); }
    }
  }
  return out;
}

// A - B — B's coverage cut out of each member of A; a member may split
// into several pieces, all keeping its labels (the remover leaves no name)
function subtractSets(a, b) {
  const cov = mergedCoverage(b);
  const out = [];
  for (const m of a) {
    let pieces = [{ start: m.start, end: m.end }];
    for (const c of cov) {
      const next = [];
      for (const p of pieces) {
        if (c.end <= p.start || c.start >= p.end) { next.push(p); continue; }
        if (c.start > p.start) next.push({ start: p.start, end: c.start });
        if (c.end < p.end) next.push({ start: c.end, end: p.end });
      }
      pieces = next;
    }
    for (const p of pieces) out.push({ start: p.start, end: p.end, labels: uniqLabels(m.labels) });
  }
  return out;
}

// a member's display handle: its labels, or a positional fallback
const handleOf = (m, members) => m.labels.length ? m.labels : ["#" + (members.indexOf(m) + 1)];

/* PARTITION — the credit-blocks verb. Cut the timeline at every member
 * boundary; each resulting segment knows exactly which members cover it.
 * This is the decomposition you otherwise hand-build: overlapping blocks
 * become non-overlapping sub-blocks you can safely count over. */
function partitionSet(members, zone) {
  const cuts = [...new Set(members.flatMap((m) => [m.start, m.end]))].sort((x, y) => x - y);
  const segments = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const lo = cuts[i], hi = cuts[i + 1];
    const covering = members.filter((m) => m.start <= lo && m.end >= hi);
    if (covering.length)
      segments.push({ start: lo, end: hi, covers: uniqLabels(covering.flatMap((m) => handleOf(m, members))),
                      days: daysTouched([{ start: lo, end: hi }], zone), lengthMs: hi - lo });
  }
  return segments;
}

/* COVERAGE DEPTH — the regions where exactly one member is active
 * (alone: the safe ground between overlaps, each stretch keeping its
 * lone member's labels) or where two or more are (shared: the burn
 * zones, each naming ALL its parents — the labels the caller joins
 * back to its own data). Same cuts as partition, then a filter, then
 * contiguous same-label stretches re-fuse. */
function depthRegions(members, wantAlone) {
  const cuts = [...new Set(members.flatMap((m) => [m.start, m.end]))].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const lo = cuts[i], hi = cuts[i + 1];
    const covering = members.filter((m) => m.start <= lo && m.end >= hi);
    if (wantAlone ? covering.length !== 1 : covering.length < 2) continue;
    const labels = uniqLabels(covering.flatMap((m) => m.labels));
    const prev = out[out.length - 1];
    if (prev && prev.end === lo && sameLabels(prev.labels, labels)) prev.end = hi;
    else out.push({ start: lo, end: hi, labels });
  }
  return out;
}

/* Civil days TOUCHED by a set's coverage, through a lens. A partial day
 * counts (arrive at 23:00, that day still counts — ask Schengen). Two
 * pieces of the same civil day count ONCE: this is a set of dates, not a
 * sum of spans. Contrast `length`, which is absolute ms and doesn't care
 * what the calendar says. */
function daysTouched(members, zone) {
  const dayIndex = (f) => Date.UTC(f.y, f.mo - 1, f.d) / MS.day;
  let total = 0, prevLast = -Infinity;
  for (const c of mergedCoverage(members)) {
    let d0 = dayIndex(epochToCivil(c.start, zone));
    const d1 = dayIndex(epochToCivil(c.end - 1, zone));   // end is exclusive
    d0 = Math.max(d0, prevLast + 1);                       // same civil day counted once
    if (d1 >= d0) { total += d1 - d0 + 1; prevLast = d1; }
  }
  return total;
}

function coverageMs(members) {
  return mergedCoverage(members).reduce((sum, c) => sum + (c.end - c.start), 0);
}

/* SLOTS — chop coverage into offerable pieces. Walks the MERGED coverage
 * (overlapping members would otherwise offer the same time twice), emits
 * consecutive step-sized slots from each stretch's start, and drops any
 * remainder too short for a full slot. Slots are ABSOLUTE time: a
 * 30-minute slot is 30 real minutes, whatever the wall clock does. */
const SLOTS_CAP = 2000;   // slots; beyond this the list is truncated (a warning is emitted)

function sliceSlots(members, stepMs) {
  const slots = [];
  let truncated = false, droppedMs = 0;
  for (const c of mergedCoverage(members)) {
    let t = c.start;
    while (t + stepMs <= c.end && !truncated) {
      if (slots.length >= SLOTS_CAP) { truncated = true; break; }
      slots.push({ start: t, end: t + stepMs, labels: c.labels });
      t += stepMs;
    }
    droppedMs += c.end - t;
  }
  return { slots, truncated, droppedMs };
}

/* ---------------------------------------------------------------------
 * Civil-day arithmetic — stepping by CALENDAR days, not 86,400,000 ms.
 * Fields are stepped in pure calendar space (Date.UTC normalizes the
 * overflow), then projected through the lens; a window that straddles a
 * DST change is 180 civil days regardless of its length in hours.
 * ------------------------------------------------------------------- */
function addDaysF(f, n) {
  const p = new Date(Date.UTC(f.y, f.mo - 1, f.d + n));
  return { y: p.getUTCFullYear(), mo: p.getUTCMonth() + 1, d: p.getUTCDate(), h: 0, mi: 0, s: 0 };
}
const dayOnly = (f) => ({ y: f.y, mo: f.mo, d: f.d, h: 0, mi: 0, s: 0 });

// the trailing n-civil-day window ENDING ON the day holding `ms`
// (inclusive of that whole day — Schengen counts today)
function windowEndingOn(ms, n, zone) {
  const f = dayOnly(epochToCivil(ms, zone));
  return { start: civilToEpoch(addDaysF(f, -(n - 1)), zone), end: civilToEpoch(addDaysF(f, 1), zone), labels: [] };
}

/* ---------------------------------------------------------------------
 * RECURRENCE — a rule is {days, startMin, endMin, zone, text}: which
 * civil days it fires on, the wall-clock window, and the lens it was
 * DEFINED under (a rule keeps its zone; "Monday" is meaningless without
 * one). Occurrences are generated day by day in the rule's own zone, so
 * they are wall-clock true across DST. endMin <= startMin (or a full
 * day) spills to the next civil day — `every day 22:00 .. 02:00` works.
 * ------------------------------------------------------------------- */
const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const RULE_CAP = 4000;   // civil days scanned per materialization (~11 years)

function ruleOccurrence(rule, df) {   // the occurrence starting on civil day df, or null
  const dow = new Date(Date.UTC(df.y, df.mo - 1, df.d)).getUTCDay();
  if (!rule.days.includes(dow)) return null;
  const start = civilToEpoch({ ...df, h: Math.floor(rule.startMin / 60), mi: rule.startMin % 60, s: 0 }, rule.zone);
  const spill = rule.endMin <= rule.startMin || rule.endMin >= 1440 ? 1 : 0;
  const em = rule.endMin % 1440;
  const end = civilToEpoch({ ...addDaysF(df, spill), h: Math.floor(em / 60), mi: em % 60, s: 0 }, rule.zone);
  return { start, end, labels: [] };
}

// every occurrence overlapping [fromMs, toMs) — how `rule & set` and
// `set - rule` bound a rule to a finite span
function ruleOccurrences(rule, fromMs, toMs) {
  const members = [];
  const f0 = addDaysF(dayOnly(epochToCivil(fromMs, rule.zone)), -1);   // -1: catch an overnight spill-in
  for (let i = 0; i < RULE_CAP; i++) {
    const df = addDaysF(f0, i);
    if (civilToEpoch(df, rule.zone) >= toMs) return { members, truncated: false };
    const o = ruleOccurrence(rule, df);
    if (o && o.end > fromMs && o.start < toMs) members.push(o);
  }
  return { members, truncated: true };
}

// the next n occurrences still ahead (end > now) — how `next n of rule`
// bounds a rule without an interval in sight
function ruleNext(rule, n, nowMs) {
  const members = [];
  const f0 = addDaysF(dayOnly(epochToCivil(nowMs, rule.zone)), -1);
  for (let i = 0; i < RULE_CAP && members.length < n; i++) {
    const o = ruleOccurrence(rule, addDaysF(f0, i));
    if (o && o.end > nowMs) members.push(o);
  }
  return { members, truncated: members.length < n };
}

/* ROLLING — the windowed aggregation. For every civil day from the first
 * covered day to the last covered day plus one full window (so the decay
 * back to zero is part of the answer), the value is: civil days of the
 * set's coverage falling inside the trailing n-day window ending on that
 * day. perMember records each member's high-water mark — the value on
 * its own last day, which for Schengen is "used at the end of the trip". */
const ROLLING_CAP = 2000;   // points; beyond this the series is truncated (a warning is emitted)

function rollingDays(members, n, zone) {
  const cov = mergedCoverage(members);
  if (!cov.length) return { series: [], perMember: [], max: 0, truncated: false };
  const first = dayOnly(epochToCivil(cov[0].start, zone));
  const lastMs = cov[cov.length - 1].end - 1;
  const valueOn = (dayMs) => daysTouched(intersectSets(members, [windowEndingOn(dayMs, n, zone)]), zone);

  const series = [];
  let truncated = false, max = 0;
  const endF = addDaysF(dayOnly(epochToCivil(lastMs, zone)), n);
  const endIndex = Date.UTC(endF.y, endF.mo - 1, endF.d) / MS.day;
  for (let i = 0; ; i++) {
    if (i >= ROLLING_CAP) { truncated = true; break; }
    const f = addDaysF(first, i);
    if (Date.UTC(f.y, f.mo - 1, f.d) / MS.day > endIndex) break;
    const ms = civilToEpoch(f, zone);
    const value = valueOn(ms);
    if (value > max) max = value;
    series.push({ ms, value });
  }

  const perMember = members.map((m) => ({
    labels: m.labels, start: m.start, end: m.end,
    days: daysTouched([m], zone),
    atEnd: valueOn(m.end - 1),
  }));
  return { series, perMember, max, truncated };
}

/* ---------------------------------------------------------------------
 * EXPRESSIONS — the right-hand side of a binding and the argument of the
 * measuring verbs. Values are typed: an INSTANT (epoch ms) or a SET of
 * members. Precedence, loosest to tightest:
 *
 *   ,   collect (keep names — the form partition wants)
 *   |   union (merge coverage, forget names)
 *   -   subtract
 *   &   intersect
 *   ..  make an interval from two instants
 *
 * The one civil-time subtlety: a bare date (no time) on the RIGHT of
 * `..` means THROUGH that day — `01-01 .. 01-03` is three days, the way
 * a human states a trip. On the left (and everywhere else) a bare date
 * is the start of that day. The desugared view resolves this away.
 * ------------------------------------------------------------------- */
const LITERAL = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const LIT_SCAN = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/;

function tokenize(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    const rest = s.slice(i);
    let m;
    if ((m = rest.match(LIT_SCAN))) {
      toks.push({ kind: "lit", text: m[0], hasTime: /[ T]\d{1,2}:/.test(m[0]) });
      i += m[0].length;
    } else if (rest.startsWith("..")) { toks.push({ kind: ".." }); i += 2; }
    else if (s[i] === '"') {
      const j = s.indexOf('"', i + 1);
      if (j < 0) return { error: `unterminated string: ${clip(rest)}` };
      toks.push({ kind: "str", text: s.slice(i + 1, j) }); i = j + 1;
    }
    else if ("&|,+-()".includes(s[i])) { toks.push({ kind: s[i] }); i += 1; }
    else if ((m = rest.match(/^\d+/))) { toks.push({ kind: "num", text: m[0] }); i += m[0].length; }
    else if ((m = rest.match(/^[A-Za-z_]\w*/))) { toks.push({ kind: "name", text: m[0] }); i += m[0].length; }
    else return { error: `can't read "${clip(rest)}"` };
  }
  return { toks };
}

function clip(s) { return s.length > 40 ? s.slice(0, 40) + "…" : s; }

/* ---------------------------------------------------------------------
 * PARSER + EVALUATOR — line-based, tolerant; collects {errors, warnings}
 * with line numbers. A program is a SCRIPT, read top to bottom: the lens
 * applies to the statements below it, and a name must be bound before it
 * is used. evaluate(src, {now}) — `now` is injectable, so a program is a
 * pure function of (source, now).
 * ------------------------------------------------------------------- */
const RESERVED = new Set(["timezone", "until", "since", "now", "days", "length", "of", "partition",
                          "last", "in", "limit", "rolling", "day", "slots", "every", "load",
                          "first", "next", "alone", "shared", "show"]);

function evaluate(src, opts) {
  opts = opts || {};
  const now = opts.now != null ? opts.now : Date.now();
  const data = opts.data || null;
  const errors = [], warnings = [];
  const err  = (ln, msg) => errors.push({ line: ln, msg });
  const warn = (ln, msg) => warnings.push({ line: ln, msg });

  const bindings = Object.create(null);   // name -> { type:'instant'|'set', ms?, members?, zone, line }
  const statements = [], queries = [];
  let zone = "UTC";                        // the lens — UTC until a timezone statement

  // civil literal -> instant, with the DST-gap warning. Reads through the
  // lens unless a zone is forced (loaded data with a trailing Z is UTC).
  function parseLiteral(text, ln, z) {
    z = z || zone;
    const m = text.match(LITERAL);
    if (!m) return null;
    const f = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
    const probe = new Date(Date.UTC(f.y, f.mo - 1, f.d));
    if (probe.getUTCMonth() + 1 !== f.mo || probe.getUTCDate() !== f.d)
      { err(ln, `"${text}" is not a real calendar date`); return null; }
    if (f.h > 23 || f.mi > 59 || f.s > 59)
      { err(ln, `"${text}" is not a real time of day`); return null; }
    const ms = civilToEpoch(f, z);
    const back = epochToCivil(ms, z);
    if (back.h !== f.h || back.mi !== f.mi || back.d !== f.d)
      warn(ln, `${pad2(f.h)}:${pad2(f.mi)} doesn't exist in ${z} on ${f.y}-${pad2(f.mo)}-${pad2(f.d)} (clocks jump forward) — reading it as ${pad2(back.h)}:${pad2(back.mi)}`);
    return { ms, f };
  }

  // "through that day": a bare END date extends to the next civil midnight
  function endOfDay(f, z) {
    const p = new Date(Date.UTC(f.y, f.mo - 1, f.d + 1));   // Date.UTC normalizes the overflow
    return civilToEpoch({ y: p.getUTCFullYear(), mo: p.getUTCMonth() + 1, d: p.getUTCDate(), h: 0, mi: 0, s: 0 }, z || zone);
  }

  /* ---- loaded data -> values (the embedding boundary) ----
   * a string/number is an instant; [a, b] is one interval; an array of
   * pairs or {start, end, name} objects is a set. Strings are civil text
   * read through the lens; a trailing Z means UTC regardless. A pair's
   * bare end date gets the through-rule, like `..` in source. */
  function dataInstant(v, ln, key) {
    if (typeof v === "number" && Number.isFinite(v)) return { ms: v, f: null, z: "UTC", bareDate: false };
    if (typeof v !== "string") { err(ln, `data "${key}": can't read ${JSON.stringify(v)} as a time`); return null; }
    const utc = /Z$/.test(v), text = v.replace(/Z$/, "").trim();
    const p = parseLiteral(text, ln, utc ? "UTC" : undefined);
    if (!p) { if (!LITERAL.test(text)) err(ln, `data "${key}": can't read "${v}" as a time — want e.g. "2026-07-20 13:00" (add Z for UTC)`); return null; }
    return { ms: p.ms, f: p.f, z: utc ? "UTC" : zone, bareDate: !/[ T]\d/.test(text) };
  }

  function dataInterval(v, ln, key) {
    const pair = Array.isArray(v) ? { start: v[0], end: v[1], labels: [] }
               : (v && typeof v === "object") ? { start: v.start, end: v.end, labels: v.name ? [String(v.name)] : [] }
               : null;
    if (!pair || pair.start == null || pair.end == null)
      { err(ln, `data "${key}": an interval is ["start", "end"] or {start, end, name}`); return null; }
    const s = dataInstant(pair.start, ln, key);
    if (!s) return null;
    const e = dataInstant(pair.end, ln, key);
    if (!e) return null;
    const end = e.bareDate ? endOfDay(e.f, e.z) : e.ms;
    if (end <= s.ms) { err(ln, `data "${key}": an interval must end after it starts`); return null; }
    return { start: s.ms, end, labels: pair.labels };
  }

  function loadValue(key, ln) {
    if (!data || !(key in data)) {
      err(ln, `no data named "${key}" — provide it via evaluate(src, {data}) or the data panel`);
      return null;
    }
    const v = data[key];
    if (typeof v === "string" || typeof v === "number") {
      const p = dataInstant(v, ln, key);
      return p && { t: "inst", ms: p.ms };
    }
    if (Array.isArray(v)) {
      // [a, b] of scalars is ONE interval; otherwise each entry is one
      const isPair = v.length === 2 && v.every((x) => typeof x === "string" || typeof x === "number");
      const entries = isPair ? [v] : v;
      const members = [];
      for (const entry of entries) {
        const m = dataInterval(entry, ln, key);
        if (!m) return null;
        members.push(m);
      }
      return { t: "set", members };
    }
    err(ln, `data "${key}": want a time, ["start", "end"], or a list of those`);
    return null;
  }

  /* recursive-descent expression parser; returns
   * { t:'inst', ms } | { t:'set', members } | null (error already logged).
   * Every lit token gets .ms stamped for the desugarer. */
  function parseExpr(text, ln) {
    const tk = tokenize(text);
    if (tk.error) { err(ln, tk.error); return null; }
    const toks = tk.toks;
    let pos = 0;
    const peek = () => toks[pos];
    const fail = (msg) => { err(ln, msg); return null; };

    function primary() {
      const t = peek();
      if (!t) return fail(`expression ends too soon — after "${clip(text)}"`);
      if (t.kind === "(") {
        pos++;
        if (peek() && peek().kind === ")") { pos++; return { t: "set", members: [] }; }   // () — the empty set
        const v = collect();
        if (!v) return null;
        if (!peek() || peek().kind !== ")") return fail(`missing ")"`);
        pos++;
        return v;
      }
      if (t.kind === "lit") {
        pos++;
        const p = parseLiteral(t.text, ln);
        if (!p) return null;
        t.ms = p.ms; t.f = p.f;
        return { t: "inst", ms: p.ms, litTok: t };
      }
      if (t.kind === "name" && t.text === "load") {
        // load "key" — external data, resolved at evaluation time. The
        // desugarer freezes the result into literals: a desugared
        // program must mean the same thing with the data gone.
        pos++;
        const kTok = peek();
        if (!kTok || kTok.kind !== "str") return fail(`load wants a quoted name — e.g. load "blocks"`);
        pos++;
        const v = loadValue(kTok.text, ln);
        if (!v) return null;
        t.resolvedLoad = v; kTok.skip = true;
        return v.t === "set" ? { t: "set", members: v.members.map((m) => ({ ...m })) } : v;
      }
      if (t.kind === "name" && t.text === "last") {
        // `last 180 days` — the trailing window ending today (inclusive),
        // counted in CIVIL days through the lens. Just an interval, so it
        // composes: trips & last 180 days.
        pos++;
        const nTok = peek();
        if (!nTok || nTok.kind !== "num") return fail(`last wants a count — e.g. last 180 days`);
        pos++;
        const uTok = peek();
        if (!uTok || uTok.kind !== "name" || !/^days?$/.test(uTok.text)) return fail(`last ${nTok.text} … what? — only days for now (e.g. last 180 days)`);
        pos++;
        const n = parseInt(nTok.text, 10);
        if (n < 1) return fail(`last wants a positive number of days`);
        const w = windowEndingOn(now, n, zone);
        t.resolved = w; nTok.skip = uTok.skip = true;   // the desugarer emits the resolved interval
        return { t: "set", members: [{ ...w }] };
      }
      if (t.kind === "num") {
        // <n> <unit> — a DURATION, and it carries the thesis: minutes
        // and hours are absolute time; days and weeks are civil steps
        // through the lens. flight - 24 hours and flight - 1 day differ
        // across a DST night, and here that difference is spelled.
        pos++;
        const u = peek();
        const unit = u && u.kind === "name" ? u.text : null;
        const n = parseInt(t.text, 10);
        if (/^(seconds?|minutes?|min|hours?)$/.test(unit || "")) {
          pos++;
          const per = unit[0] === "s" ? MS.second : unit[0] === "m" ? MS.minute : MS.hour;
          return { t: "dur", ms: n * per, days: 0 };
        }
        if (/^(days?|weeks?)$/.test(unit || "")) {
          pos++;
          return { t: "dur", ms: 0, days: unit[0] === "w" ? n * 7 : n };
        }
        return fail(`a bare number isn't a value — did you mean ${t.text} hours, ${t.text} minutes, or ${t.text} days?`);
      }
      if (t.kind === "name") {
        pos++;
        if (t.text === "now") { t.ms = now; return { t: "inst", ms: now }; }
        if (t.text === "every") return fail(`a recurrence is its own statement — e.g. hours = every weekday 09:00 .. 17:00`);
        const b = bindings[t.text];
        if (!b) return fail(`"${t.text}" is not bound — bind it first, e.g. ${t.text} = 2026-07-17 10:00`);
        return b.type === "instant" ? { t: "inst", ms: b.ms }
             : b.type === "rule" ? { t: "rule", rule: b.rule }
             : b.type === "duration" ? { t: "dur", ...b.dur }
             : { t: "set", members: b.members.map((m) => ({ ...m })) };
      }
      return fail(`unexpected "${t.kind}" in expression`);
    }

    // instant ± duration: the ms part is absolute; the days part steps
    // the CALENDAR through the current lens, wall clock preserved (a
    // step into a DST gap shifts forward, like any civil projection)
    function applyDur(ms, dur, sign) {
      let out = ms + sign * dur.ms;
      if (dur.days) {
        const f = epochToCivil(out, zone);
        const p = new Date(Date.UTC(f.y, f.mo - 1, f.d + sign * dur.days));
        out = civilToEpoch({ y: p.getUTCFullYear(), mo: p.getUTCMonth() + 1, d: p.getUTCDate(), h: f.h, mi: f.mi, s: f.s }, zone);
      }
      return out;
    }

    const unbounded = (op) =>
      fail(`"${op}" can't take an unbounded recurrence — bound it first: rule & <interval>, <set> - rule, or next <n> of rule`);

    // materialize a rule over the span of a finite set
    function boundRule(ruleV, setV) {
      const cov = mergedCoverage(setV.members);
      if (!cov.length) return [];
      const r = ruleOccurrences(ruleV.rule, cov[0].start, cov[cov.length - 1].end);
      if (r.truncated) warn(ln, `recurrence truncated after ${RULE_CAP} days`);
      return r.members;
    }

    function range() {   // <instant> .. <instant>  → a one-member set
      const a = primary();
      if (!a) return null;
      if (!peek() || peek().kind !== "..") return a;
      pos++;
      const b = primary();
      if (!b) return null;
      if (a.t !== "inst" || b.t !== "inst") return fail(`".." wants an instant on each side`);
      let end = b.ms;
      if (b.litTok && !b.litTok.hasTime) {          // bare end date: THROUGH that day
        end = endOfDay(b.litTok.f);
        b.litTok.ms = end;                          // the desugarer shows the resolved end
      }
      if (end <= a.ms) return fail(`an interval must end after it starts`);
      return { t: "set", members: [{ start: a.ms, end, labels: [] }] };
    }

    const wantSets = (op, a, b) =>
      a.t === "set" && b.t === "set" ? [a.members, b.members]
        : (fail(`"${op}" works on intervals — an instant like a date has no width (make one with ..)`), null);

    function intersect() {   // & bounds a rule: the other side's span is the bound
      let a = range();
      while (a && peek() && peek().kind === "&") {
        pos++;
        const b = range();
        if (!b) return null;
        if (a.t === "rule" && b.t === "rule") return fail(`"&" of two recurrences is still unbounded — bound one side first`);
        if (a.t === "inst" || b.t === "inst") return fail(`"&" works on intervals — an instant like a date has no width (make one with ..)`);
        if (a.t === "rule") a = { t: "set", members: boundRule(a, b) };        // b is a set here
        else if (b.t === "rule") b = { t: "set", members: boundRule(b, a) };
        a = { t: "set", members: intersectSets(a.members, b.members) };
      }
      return a;
    }

    function subtract() {   // - is set-minus OR instant arithmetic; + is arithmetic only
      let a = intersect();
      while (a && peek() && (peek().kind === "-" || peek().kind === "+")) {
        const op = peek().kind;
        pos++;
        const b = intersect();
        if (!b) return null;
        if (b.t === "dur") {                     // instant ± duration
          if (a.t !== "inst") return fail(`"${op} <duration>" works on an instant — shifting whole intervals isn't defined (yet)`);
          a = { t: "inst", ms: applyDur(a.ms, b, op === "+" ? 1 : -1) };
          continue;
        }
        if (op === "+") return fail(`"+" adds a duration to an instant — e.g. flight + 3 hours (sets combine with | or ,)`);
        if (a.t === "rule") return unbounded("-");
        if (a.t !== "set") return fail(`"-" works on intervals — an instant like a date has no width (make one with ..)`);
        const bm = b.t === "rule" ? boundRule(b, a) : b.t === "set" ? b.members : null;
        if (bm === null) return fail(`"-" works on intervals — an instant like a date has no width (make one with ..)`);
        a = { t: "set", members: subtractSets(a.members, bm) };
      }
      return a;
    }

    function union() {
      let a = subtract();
      while (a && peek() && peek().kind === "|") {
        pos++;
        const b = subtract();
        if (!b) return null;
        if (a.t === "rule" || b.t === "rule") return unbounded("|");
        const ab = wantSets("|", a, b);
        if (!ab) return null;
        a = { t: "set", members: mergedCoverage(ab[0].concat(ab[1])) };
      }
      return a;
    }

    // first/next/last <n> of X — take a finite bite. `next` is anchored
    // at now (end > now). A rule has a next but no first or last — it
    // extends forever both ways. Resolutions are frozen for desugar.
    // (`last 3 of x` is a selector; `last 3 days` stays a window — the
    // word after the count decides.)
    // alone in X / shared in X — the coverage-depth filters.
    // All of these read like English: the operand is EVERYTHING to
    // their right (so `alone in a, b` filters the whole collection);
    // parenthesize to stop them early.
    function selector() {
      const t = peek();
      if (t && t.kind === "name" && (t.text === "alone" || t.text === "shared")) {
        pos++;
        const inTok = peek();
        if (!inTok || inTok.kind !== "name" || inTok.text !== "in") return fail(`${t.text} … in what? — e.g. ${t.text} in credits`);
        pos++;
        const v = collect();
        if (!v) return null;
        if (v.t === "rule") return fail(`${t.text} in wants a finite set — bound the recurrence first`);
        if (v.t !== "set") return fail(`${t.text} in wants intervals — an instant has no coverage`);
        return { t: "set", members: depthRegions(v.members, t.text === "alone") };
      }
      const isSel = t && t.kind === "name" &&
        (t.text === "first" || t.text === "next" ||
         (t.text === "last" && toks[pos + 1] && toks[pos + 1].kind === "num" &&
          toks[pos + 2] && toks[pos + 2].kind === "name" && toks[pos + 2].text === "of"));
      if (!isSel) return union();
      const startIdx = pos;
      pos++;
      const nTok = peek();
      if (!nTok || nTok.kind !== "num") return fail(`${t.text} wants a count — e.g. ${t.text} 3 of mondays`);
      pos++;
      const n = parseInt(nTok.text, 10);
      if (n < 1) return fail(`${t.text} wants a positive count`);
      const ofTok = peek();
      if (!ofTok || ofTok.kind !== "name" || ofTok.text !== "of") return fail(`${t.text} ${n} … of what? — e.g. ${t.text} ${n} of mondays`);
      pos++;
      const v = collect();
      if (!v) return null;
      let members;
      if (v.t === "rule") {
        if (t.text !== "next") return fail(`a recurrence has no ${t.text} — it extends forever; use next ${n} of, or bound it with &`);
        const r = ruleNext(v.rule, n, now);
        if (r.truncated) warn(ln, `only ${r.members.length} occurrence(s) within ${RULE_CAP} days`);
        members = r.members;
      } else if (v.t === "set") {
        const sorted = [...v.members].sort((x, y) => x.start - y.start);
        members = t.text === "next" ? sorted.filter((m) => m.end > now).slice(0, n)
                : t.text === "last" ? sorted.slice(-n)
                : sorted.slice(0, n);
      } else return fail(`${t.text} ${n} of wants intervals or a recurrence`);
      t.resolvedLoad = { t: "set", members };                       // freeze for the UTC view
      for (let i = startIdx + 1; i < pos; i++) toks[i].skip = true;
      return { t: "set", members: members.map((m) => ({ ...m })) };
    }

    function collect() {   // the loosest: build a collection, names intact
      let a = selector();
      while (a && peek() && peek().kind === ",") {
        pos++;
        const b = selector();
        if (!b) return null;
        if (a.t === "rule" || b.t === "rule") return unbounded(",");
        const ab = wantSets(",", a, b);
        if (!ab) return null;
        a = { t: "set", members: ab[0].concat(ab[1]) };
      }
      return a;
    }

    const v = collect();
    if (v && peek()) return fail(`unexpected "${peek().kind === "name" || peek().kind === "lit" ? peek().text : peek().kind}" after expression`);
    return v && { ...v, toks };
  }

  // the argument of until/since — must come out an instant
  function resolveInstant(text, ln) {
    const v = parseExpr(text, ln);
    if (!v) return null;
    if (v.t === "rule") { err(ln, `"${clip(text)}" is a recurrence — until/since want one instant (try next 1 of it, then name the result)`); return null; }
    if (v.t === "dur") { err(ln, `"${clip(text)}" is a duration — anchor it to an instant, e.g. until now + ${text.trim()}`); return null; }
    if (v.t !== "inst") { err(ln, `"${clip(text)}" is an interval — until/since want an instant (a name, "now", or a date)`); return null; }
    return { ms: v.ms, label: /^[A-Za-z_]\w*$|^now$/.test(text.trim()) ? text.trim() : text.trim(), toks: v.toks };
  }

  // the argument of the measuring verbs — must come out a finite set
  function resolveSet(text, ln, verb) {
    const v = parseExpr(text, ln);
    if (!v) return null;
    if (v.t === "rule") { err(ln, `${verb} wants a finite set — bound the recurrence first (rule & <interval>, or next <n> of rule)`); return null; }
    if (v.t === "dur") { err(ln, `${verb} wants intervals — a duration has no position; anchor it to an instant first`); return null; }
    if (v.t !== "set") { err(ln, `${verb} wants a stretch of time — make one with .. (e.g. 2026-01-01 .. 2026-01-05)`); return null; }
    return v;
  }

  // logical lines: a line ending in an operator continues on the next —
  // so a real trip list can be written one interval per line
  const raw = String(src).split("\n").map((l, i) => ({ ln: i + 1, text: l.replace(/#.*$/, "").trim() }));
  const lines = [];
  for (const r of raw) {
    const prev = lines[lines.length - 1];
    if (prev && /[,&|]$|\.\.$|(^|[\s(])-$/.test(prev.text)) prev.text += " " + r.text;
    else if (r.text !== "") lines.push({ ln: r.ln, text: r.text });
  }

  for (const { ln, text } of lines) {

    let m;
    // timezone = Europe/Vienna — re-aim the lens for the lines below
    if ((m = text.match(/^timezone\s*=\s*(.+)$/))) {
      const z = m[1].trim();
      if (!isValidZone(z)) { err(ln, `"${z}" is not an IANA timezone — want e.g. Europe/Vienna, America/New_York, UTC`); continue; }
      zone = z;
      statements.push({ kind: "timezone", zone: z, line: ln });

    // until / since — the countdown verbs
    } else if ((m = text.match(/^(until|since)\b\s*(.*)$/))) {
      const kind = m[1], target = resolveInstant(m[2].trim(), ln);
      if (!target) continue;
      const diff = kind === "until" ? target.ms - now : now - target.ms;
      const q = { kind, label: target.label, targetMs: target.ms, zone, line: ln,
                  diffMs: diff, passed: diff < 0, breakdown: breakdown(diff), toks: target.toks };
      queries.push(q); statements.push(q);

    // now — the bare present, read through the lens in force. No operand:
    // it is "until"/"since" with the target dropped, so what's left is
    // just a clock. Stack a few under different lenses and you have a
    // world clock — the same instant, many wall times.
    } else if (/^now$/.test(text)) {
      const q = { kind: "now", ms: now, zone, line: ln };
      queries.push(q); statements.push(q);

    // rolling days of X in N days [limit M] — the windowed aggregation:
    // for every civil day, the usage inside the trailing N-day window
    } else if ((m = text.match(/^rolling\s+days\s+of\s+(.+?)\s+in\s+(\d+)\s+days?(?:\s+limit\s+(\d+))?\s*$/))) {
      const v = resolveSet(m[1].trim(), ln, "rolling days of");
      if (!v) continue;
      const windowDays = parseInt(m[2], 10), limit = m[3] != null ? parseInt(m[3], 10) : null;
      if (windowDays < 1) { err(ln, `the window must be at least 1 day`); continue; }
      const r = rollingDays(v.members, windowDays, zone);
      if (r.truncated) warn(ln, `rolling series truncated at ${ROLLING_CAP} days`);
      const q = { kind: "rolling", expr: m[1].trim(), members: v.members, windowDays, limit,
                  zone, line: ln, toks: v.toks, ...r };
      queries.push(q); statements.push(q);

    } else if (/^rolling\b/.test(text)) {
      err(ln, `rolling needs the full form: rolling days of <intervals> in <n> days [limit <m>]`);

    // slots of X every N minutes — chop free time into offerable pieces
    } else if ((m = text.match(/^slots\s+of\s+(.+?)\s+every\s+(\d+)\s+(minutes?|min|hours?)\s*$/))) {
      const v = resolveSet(m[1].trim(), ln, "slots of");
      if (!v) continue;
      const n = parseInt(m[2], 10);
      if (n < 1) { err(ln, `a slot must be at least 1 ${m[3].startsWith("h") ? "hour" : "minute"} long`); continue; }
      const stepMs = n * (m[3].startsWith("h") ? MS.hour : MS.minute);
      const r = sliceSlots(v.members, stepMs);
      if (r.truncated) warn(ln, `slot list truncated at ${SLOTS_CAP}`);
      const q = { kind: "slots", expr: m[1].trim(), stepMs, every: `${n} ${m[3]}`,
                  members: v.members, zone, line: ln, toks: v.toks, ...r };
      queries.push(q); statements.push(q);

    } else if (/^slots\b/.test(text)) {
      err(ln, `slots needs the full form: slots of <intervals> every <n> minutes`);

    // show — the interrogation verb: is it there, and where?
    } else if ((m = text.match(/^show\b\s*(.*)$/))) {
      const v = resolveSet(m[1].trim(), ln, "show");
      if (!v) continue;
      const q = { kind: "show", expr: m[1].trim(), members: v.members, zone, line: ln, toks: v.toks };
      queries.push(q); statements.push(q);

    // days of / length of — the two measures (civil vs absolute)
    } else if ((m = text.match(/^(days|length)\s+of\b\s*(.*)$/))) {
      const kind = m[1], v = resolveSet(m[2].trim(), ln, `${kind} of`);
      if (!v) continue;
      const q = { kind, expr: m[2].trim(), members: v.members, zone, line: ln, toks: v.toks,
                  days: daysTouched(v.members, zone), breakdown: breakdown(coverageMs(v.members)) };
      queries.push(q); statements.push(q);

    // partition — cut at every boundary; who covers each piece?
    } else if ((m = text.match(/^partition\b\s*(.*)$/))) {
      const v = resolveSet(m[1].trim(), ln, "partition");
      if (!v) continue;
      const q = { kind: "partition", expr: m[1].trim(), members: v.members, zone, line: ln, toks: v.toks,
                  segments: partitionSet(v.members, zone) };
      queries.push(q); statements.push(q);

    // <name> = every <days> [HH:MM .. HH:MM] — define a recurrence.
    // A rule is its own statement (not an expression), and it KEEPS the
    // lens in force here: a Vienna Monday stays a Vienna Monday.
    } else if ((m = text.match(/^([A-Za-z_]\w*)\s*=\s*every\s+([a-z]+)(?:\s+(\d{1,2}):(\d{2})\s*\.\.\s*(\d{1,2}):(\d{2}))?\s*$/))) {
      const name = m[1], word = m[2];
      if (RESERVED.has(name)) { err(ln, `"${name}" is a reserved word`); continue; }
      const days = word === "day" ? [0, 1, 2, 3, 4, 5, 6]
                 : word === "weekday" ? [1, 2, 3, 4, 5]
                 : word in DOW ? [DOW[word]] : null;
      if (!days) { err(ln, `every what? — day, weekday, or monday…sunday (got "${word}")`); continue; }
      let startMin = 0, endMin = 1440;   // no times: the whole civil day
      if (m[3] != null) {
        const h1 = +m[3], m1 = +m[4], h2 = +m[5], m2 = +m[6];
        if (h1 > 23 || m1 > 59 || h2 > 23 || m2 > 59) { err(ln, `"${text.slice(text.indexOf("every"))}" is not a real time of day`); continue; }
        startMin = h1 * 60 + m1; endMin = h2 * 60 + m2;
        if (startMin === endMin) { err(ln, `a recurrence window must have width — ${m[3]}:${m[4]} .. ${m[5]}:${m[6]} is empty`); continue; }
        // endMin < startMin spills past midnight: every day 22:00 .. 02:00
      }
      if (bindings[name]) warn(ln, `"${name}" rebound; using the new value`);
      const rule = { days, startMin, endMin, zone, text: m[0].slice(m[0].indexOf("every")) };
      bindings[name] = { type: "rule", rule, zone, line: ln };
      statements.push({ kind: "bindrule", name, rule, zone, line: ln });

    // <name> = <expression> — bind an instant or a set
    } else if ((m = text.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/))) {
      const name = m[1];
      if (RESERVED.has(name)) { err(ln, `"${name}" is a reserved word`); continue; }
      const v = parseExpr(m[2].trim(), ln);
      if (!v) continue;
      if (bindings[name]) warn(ln, `"${name}" rebound; using the new value`);
      if (v.t === "inst") {
        bindings[name] = { type: "instant", ms: v.ms, zone, line: ln };
        statements.push({ kind: "bind", name, valueType: "instant", ms: v.ms, zone, line: ln, toks: v.toks });
      } else if (v.t === "dur") {
        bindings[name] = { type: "duration", dur: { ms: v.ms, days: v.days }, zone, line: ln };
        statements.push({ kind: "bind", name, valueType: "duration", zone, line: ln, toks: v.toks });
      } else if (v.t === "rule") {
        // an alias: the rule travels whole, its own zone intact
        bindings[name] = { type: "rule", rule: v.rule, zone: v.rule.zone, line: ln };
        statements.push({ kind: "bindrule", name, rule: v.rule, zone: v.rule.zone, line: ln });
      } else {
        // a binding labels only the unlabeled — it fills a void, it
        // doesn't stack on inherited provenance
        const members = v.members.map((mm) => ({ ...mm, labels: mm.labels.length ? mm.labels : [name] }));
        bindings[name] = { type: "set", members, zone, line: ln };
        statements.push({ kind: "bind", name, valueType: "set", members, zone, line: ln, toks: v.toks });
      }

    } else {
      err(ln, `unrecognized statement (expected 'timezone =', '<name> =', 'until', 'since', 'days of', 'length of', or 'partition'): "${clip(text)}"`);
    }
  }

  return { statements, bindings, queries, errors, warnings, now, zone };
}

/* ---------------------------------------------------------------------
 * DESUGAR — re-emit a program with the lens removed: one `timezone =
 * UTC` at the top, every civil literal rewritten to its UTC wall time
 * (bare "through" dates resolved to their exclusive end). The output is
 * valid Zeitfolge source resolving to IDENTICAL instants and extents —
 * proof that the timezone is a lens on presentation, not part of the
 * data.
 * ------------------------------------------------------------------- */
function rebuildToks(toks) {
  let out = "";
  const ivl = (m) => `${formatCivil(epochToCivil(m.start, "UTC"))} .. ${formatCivil(epochToCivil(m.end, "UTC"))}`;
  for (const t of toks) {
    if (t.skip) continue;   // consumed by a `last N days` or a load — the resolution speaks for it
    const text = t.resolvedLoad
                 ? (t.resolvedLoad.t === "inst" ? formatCivil(epochToCivil(t.resolvedLoad.ms, "UTC"))
                    : t.resolvedLoad.members.length === 1 ? ivl(t.resolvedLoad.members[0])
                    : `(${t.resolvedLoad.members.map(ivl).join(", ")})`)   // () when empty — the empty set
               : t.resolved ? ivl(t.resolved)
               : t.kind === "lit" ? formatCivil(epochToCivil(t.ms, "UTC"))
               : t.kind === "name" || t.kind === "num" ? t.text : t.kind;
    const glue = out === "" || ",)".includes(t.kind) || out.endsWith("(") ? "" : " ";
    out += glue + text;
  }
  return out;
}

function desugar(program) {
  const out = ["# desugared — the lens removed: every instant at its UTC wall time", "timezone = UTC", ""];
  for (const st of program.statements) {
    if (st.kind === "timezone") continue;   // the lens dissolves
    const hadLit = st.toks && st.toks.some((t) => t.kind === "lit");
    const note = hadLit && st.zone !== "UTC" ? `   # was written in ${st.zone}` : "";
    if (st.kind === "bindrule") {
      // the honest limit: an instant dissolves into UTC, a rule cannot —
      // "Monday" is civil all the way down, so the lens is re-aimed
      // around it instead of removed
      if (st.zone !== "UTC") {
        out.push(`timezone = ${st.zone}   # a rule is irreducibly civil — its lens can only be named`);
        out.push(`${st.name} = ${st.rule.text}`);
        out.push(`timezone = UTC`);
      } else out.push(`${st.name} = ${st.rule.text}`);
    }
    // an instant always desugars to its RESOLVED UTC literal — this is
    // what freezes `now` and civil day-arithmetic at evaluation time
    else if (st.kind === "bind" && st.valueType === "instant")
      out.push(`${st.name} = ${formatCivil(epochToCivil(st.ms, "UTC"))}${st.zone !== "UTC" ? `   # was written in ${st.zone}` : ""}`);
    else if (st.kind === "bind") out.push(`${st.name} = ${rebuildToks(st.toks)}${note}`);
    else if (st.kind === "until" || st.kind === "since")
      out.push(`${st.kind} ${formatCivil(epochToCivil(st.targetMs, "UTC"))}${/^[A-Za-z_]/.test(st.label) ? `   # was: ${st.label}` : note}`);
    else if (st.kind === "days" || st.kind === "length") out.push(`${st.kind} of ${rebuildToks(st.toks)}${note}`);
    else if (st.kind === "partition") out.push(`partition ${rebuildToks(st.toks)}${note}`);
    else if (st.kind === "rolling")
      out.push(`rolling days of ${rebuildToks(st.toks)} in ${st.windowDays} days${st.limit != null ? ` limit ${st.limit}` : ""}${note}`);
    else if (st.kind === "slots")
      out.push(`slots of ${rebuildToks(st.toks)} every ${st.every}${note}`);
    else if (st.kind === "show") out.push(`show ${rebuildToks(st.toks)}${note}`);
    // a clock cannot be frozen to a literal — the language has no verb to
    // display a bare instant — so it stays `now`, but under the UTC lens.
    // A stack of world-clock lines collapses here to identical `now`s:
    // proof they were always one instant, only differently presented.
    else if (st.kind === "now") out.push(`now${st.zone !== "UTC" ? `   # was read in ${st.zone}` : ""}`);
  }
  return out.join("\n");
}

return { VERSION, MS, evaluate, desugar,
         epochToCivil, civilToEpoch, zoneOffset, isValidZone,
         mergedCoverage, intersectSets, subtractSets, partitionSet, depthRegions, daysTouched, coverageMs,
         windowEndingOn, rollingDays, sliceSlots, ruleOccurrences, ruleNext,
         breakdown, formatDuration, formatCivil, formatInstant, formatOffset };
});
