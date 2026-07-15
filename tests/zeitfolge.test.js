"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Z = require("../zeitfolge.js");

// A fixed "now" makes every program a pure function of (source, now):
// 2026-07-12 12:00:00 UTC.
const NOW = Date.UTC(2026, 6, 12, 12, 0, 0);

function run(src, now = NOW) {
  const out = Z.evaluate(src, { now });
  assert.deepEqual(out.errors, [], "expected no errors");
  return out;
}
const errorsOf = (src) => Z.evaluate(src, { now: NOW }).errors.map((e) => e.msg);

/* ------------------------------------------------------------ binding */

test("a bare date binds midnight UTC when no timezone is set", () => {
  const out = run("d = 2026-07-17");
  assert.equal(out.bindings.d.ms, Date.UTC(2026, 6, 17));
});

test("the lens: the same literal through two zones lands on two instants", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "a = 2026-07-17 10:00",
    "timezone = America/New_York",
    "b = 2026-07-17 10:00",
  ].join("\n"));
  assert.equal(out.bindings.a.ms, Date.UTC(2026, 6, 17, 8));    // CEST is UTC+2
  assert.equal(out.bindings.b.ms, Date.UTC(2026, 6, 17, 14));   // EDT is UTC-4
});

test("winter vs summer: the lens knows DST", () => {
  const out = run("timezone = Europe/Vienna\nw = 2026-01-15 12:00\ns = 2026-07-15 12:00");
  assert.equal(out.bindings.w.ms, Date.UTC(2026, 0, 15, 11));   // CET  +1
  assert.equal(out.bindings.s.ms, Date.UTC(2026, 6, 15, 10));   // CEST +2
});

test("seconds in a literal are honored", () => {
  const out = run("t = 2026-07-17 10:00:30");
  assert.equal(out.bindings.t.ms, Date.UTC(2026, 6, 17, 10, 0, 30));
});

test("rebinding warns and uses the new value", () => {
  const out = Z.evaluate("a = 2026-01-01\na = 2026-02-01", { now: NOW });
  assert.equal(out.warnings.length, 1);
  assert.equal(out.bindings.a.ms, Date.UTC(2026, 1, 1));
});

/* -------------------------------------------------- DST edge behavior */

test("spring-forward gap: the phantom time shifts forward, with a warning", () => {
  // EU clocks jump 02:00 -> 03:00 on 2026-03-29; 02:30 never happens.
  const out = Z.evaluate("timezone = Europe/Vienna\ng = 2026-03-29 02:30", { now: NOW });
  assert.equal(out.errors.length, 0);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0].msg, /doesn't exist/);
  assert.equal(out.bindings.g.ms, Date.UTC(2026, 2, 29, 1, 30)); // reads as 03:30 CEST
});

test("fall-back ambiguity: the repeated time resolves to the later instant", () => {
  // EU clocks fall 03:00 -> 02:00 on 2026-10-25; 02:30 happens twice.
  const out = run("timezone = Europe/Vienna\na = 2026-10-25 02:30");
  assert.equal(out.bindings.a.ms, Date.UTC(2026, 9, 25, 1, 30)); // second pass, CET +1
});

/* ---------------------------------------------------- until and since */

test("until: a bound instant, measured from the injected now", () => {
  const out = run("timezone = UTC\nflight = 2026-07-17 10:00\nuntil flight");
  const q = out.queries[0];
  assert.equal(q.diffMs, Date.UTC(2026, 6, 17, 10) - NOW);
  assert.deepEqual(q.breakdown, { sign: 1, ms: q.diffMs, days: 4, hours: 22, minutes: 0, seconds: 0 });
  assert.equal(q.passed, false);
});

test("until accepts a literal and `now` directly", () => {
  const out = run("until 2026-07-13 12:00\nuntil now");
  assert.equal(out.queries[0].diffMs, Z.MS.day);
  assert.equal(out.queries[1].diffMs, 0);
});

test("now: one instant, many lenses — same ms, wall time set by the lens", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "now",
    "timezone = America/New_York",
    "now",
    "timezone = Asia/Tokyo",
    "now",
  ].join("\n"));
  const clocks = out.queries.filter((q) => q.kind === "now");
  assert.equal(clocks.length, 3);
  // the same instant underneath — NOW, verbatim — regardless of lens
  assert.deepEqual(clocks.map((q) => q.ms), [NOW, NOW, NOW]);
  assert.deepEqual(clocks.map((q) => q.zone),
    ["Europe/Vienna", "America/New_York", "Asia/Tokyo"]);
  // but the lens sets the wall time: 12:00 UTC → 14 Vienna, 08 NY, 21 Tokyo
  assert.equal(Z.epochToCivil(clocks[0].ms, clocks[0].zone).h, 14);
  assert.equal(Z.epochToCivil(clocks[1].ms, clocks[1].zone).h, 8);
  assert.equal(Z.epochToCivil(clocks[2].ms, clocks[2].zone).h, 21);
});

test("desugar collapses a world clock to one instant: identical `now`s under UTC", () => {
  const out = run("timezone = Europe/Vienna\nnow\ntimezone = Asia/Tokyo\nnow");
  const sugarFree = Z.desugar(out);
  const nowLines = sugarFree.split("\n").filter((l) => l.startsWith("now"));
  assert.equal(nowLines.length, 2);
  // both re-read under the single UTC lens the desugarer declares up top
  assert.match(sugarFree, /^timezone = UTC$/m);
  // and running the desugared program is still error-free
  assert.deepEqual(Z.evaluate(sugarFree, { now: NOW }).errors, []);
});

test("since: elapsed time, and a future target counts as not yet passed", () => {
  const out = run("since 2026-07-12 11:00\nsince 2026-07-12 13:00");
  assert.equal(out.queries[0].diffMs, Z.MS.hour);
  assert.equal(out.queries[1].diffMs, -Z.MS.hour);
  assert.equal(out.queries[1].passed, true);
});

test("a query carries the lens in force at its line", () => {
  const out = run("timezone = Europe/Vienna\nuntil 2026-07-17 10:00\ntimezone = UTC\nuntil 2026-07-17 10:00");
  assert.equal(out.queries[0].zone, "Europe/Vienna");
  assert.equal(out.queries[1].zone, "UTC");
  assert.equal(out.queries[1].targetMs - out.queries[0].targetMs, 2 * Z.MS.hour);
});

test("countdown across a spring-forward night is 23 absolute hours", () => {
  const nowCET = Date.UTC(2026, 2, 28, 11);   // 12:00 CET on 2026-03-28
  const out = Z.evaluate("timezone = Europe/Vienna\nuntil 2026-03-29 12:00", { now: nowCET });
  assert.equal(out.queries[0].diffMs, 23 * Z.MS.hour);
});

/* --------------------------------------------------- intervals (v0.2) */

test("a bare END date means THROUGH that day; an explicit time does not", () => {
  const out = run("a = 2026-01-01 .. 2026-01-03\nb = 2026-01-01 .. 2026-01-03 00:00\ndays of a\ndays of b");
  assert.equal(out.bindings.a.members[0].end, Date.UTC(2026, 0, 4));   // exclusive end: Jan 4 midnight
  assert.equal(out.queries[0].days, 3);   // Jan 1, 2, 3 — the way a human states a trip
  assert.equal(out.queries[1].days, 2);   // Jan 1, 2 — [Jan 1, Jan 3) exactly as written
});

test("a one-day trip is a valid interval: date .. same date", () => {
  const out = run("d = 2026-01-01 .. 2026-01-01\ndays of d");
  assert.equal(out.queries[0].days, 1);
});

test("an interval must end after it starts", () => {
  assert.match(errorsOf("x = 2026-01-02 .. 2026-01-01")[0], /must end after it starts/);
});

test("interval endpoints go through the lens like any civil literal", () => {
  const out = run("timezone = Europe/Vienna\nx = 2026-07-01 10:00 .. 2026-07-01 12:00");
  assert.equal(out.bindings.x.members[0].start, Date.UTC(2026, 6, 1, 8));
  assert.equal(out.bindings.x.members[0].end, Date.UTC(2026, 6, 1, 10));
});

/* --------------------------------------------------------- the algebra */

const BLOCKS = [
  "block1 = 2026-01-10 .. 2026-04-09",   // a 90-day block
  "block2 = 2026-02-15 .. 2026-06-15",   // bought mid-block, different expiry
].join("\n");

test("& intersects labeling BOTH parents; | merges coverage keeping ancestry", () => {
  const out = run(BLOCKS + "\no = block1 & block2\nu = block1 | block2");
  assert.deepEqual(out.bindings.o.members, [{ start: Date.UTC(2026, 1, 15), end: Date.UTC(2026, 3, 10), labels: ["block1", "block2"] }]);
  assert.deepEqual(out.bindings.u.members, [{ start: Date.UTC(2026, 0, 10), end: Date.UTC(2026, 5, 16), labels: ["block1", "block2"] }]);
});

test("- can split a member; both pieces keep its name", () => {
  const out = run("a = 2026-01-01 .. 2026-01-10\nb = 2026-01-04 .. 2026-01-05\nc = a - b\ndays of c");
  assert.deepEqual(out.bindings.c.members, [
    { start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 4), labels: ["a"] },
    { start: Date.UTC(2026, 0, 6), end: Date.UTC(2026, 0, 11), labels: ["a"] },
  ]);
  assert.equal(out.queries[0].days, 8);   // 3 + 5, the hole not counted
});

test("`,` collects with names intact; operators demand intervals, not instants", () => {
  const out = run(BLOCKS + "\ncredits = block1, block2");
  assert.deepEqual(out.bindings.credits.members.map((m) => m.labels), [["block1"], ["block2"]]);
  assert.match(errorsOf("a = 2026-01-01 .. 2026-01-05\nx = a & 2026-01-03")[0], /works on intervals/);
});

test("parentheses group: (a | b) & c", () => {
  const out = run([
    "a = 2026-01-01 .. 2026-01-05",
    "b = 2026-01-10 .. 2026-01-15",
    "c = 2026-01-04 .. 2026-01-11",
    "x = (a | b) & c",
    "days of x",
  ].join("\n"));
  assert.equal(out.queries[0].days, 4);   // Jan 4-5 and Jan 10-11
});

/* ------------------------------------------------ partition — the verb */

test("partition: the credit-blocks decomposition, done by the language", () => {
  const out = run(BLOCKS + "\ncredits = block1, block2\npartition credits");
  const segs = out.queries[0].segments;
  assert.deepEqual(segs.map((s) => [s.covers.join("+"), s.days]), [
    ["block1", 36],           // Jan 10 – Feb 14: only the first block
    ["block1+block2", 54],    // Feb 15 – Apr 9: both live
    ["block2", 67],           // Apr 10 – Jun 15: only the second
  ]);
  assert.equal(segs[0].start, Date.UTC(2026, 0, 10));
  assert.equal(segs[2].end, Date.UTC(2026, 5, 16));
});

test("partition skips uncovered gaps between members", () => {
  const out = run("a = 2026-01-01 .. 2026-01-03\nb = 2026-01-10 .. 2026-01-12\npartition a, b");
  assert.deepEqual(out.queries[0].segments.map((s) => s.covers), [["a"], ["b"]]);
});

/* ------------------------------------------------- the two measures */

test("days of a set counts union coverage — overlap once, same day once", () => {
  const out = run(BLOCKS + "\ndays of block1, block2");
  assert.equal(out.queries[0].days, 157);   // 36 + 54 + 67, not 90 + 121
  const same = run("days of 2026-01-01 10:00 .. 2026-01-01 11:00, 2026-01-01 20:00 .. 2026-01-01 21:00");
  assert.equal(same.queries[0].days, 1);    // two pieces of one civil day
});

test("days vs length: a DST night is 23 hours long yet touches 2 days", () => {
  const src = "timezone = Europe/Vienna\nx = 2026-03-28 12:00 .. 2026-03-29 12:00\ndays of x\nlength of x";
  const out = run(src);
  assert.equal(out.queries[0].days, 2);
  assert.deepEqual(out.queries[1].breakdown.days, 0);
  assert.equal(out.queries[1].breakdown.hours, 23);
});

test("days are counted through the lens AT THE QUERY LINE", () => {
  const out = run([
    "a = 2026-01-01 20:00 .. 2026-01-02 02:00",   // bound with the UTC lens
    "days of a",                                    // UTC: touches Jan 1 and Jan 2
    "timezone = America/New_York",
    "days of a",                                    // NY: 15:00-21:00, all on Jan 1
  ].join("\n"));
  assert.equal(out.queries[0].days, 2);
  assert.equal(out.queries[1].days, 1);
});

test("measures reject instants with a hint", () => {
  assert.match(errorsOf("f = 2026-01-01\ndays of f")[0], /wants a stretch of time/);
  assert.match(errorsOf("partition 2026-01-01")[0], /wants a stretch of time/);
});

/* ------------------------------------- sliding windows (v0.3) */

test("`last N days`: the trailing window ending today, inclusive — just an interval", () => {
  // NOW is 2026-07-12 12:00 UTC, so last 3 days = Jul 10 00:00 .. Jul 13 00:00
  const out = run("x = 2026-07-09 .. 2026-07-11\ndays of x & last 3 days");
  assert.equal(out.queries[0].days, 2);   // Jul 10 and Jul 11
});

test("a line ending in an operator continues on the next line", () => {
  const out = run("a = 2026-01-01 .. 2026-01-02,\n    2026-01-05 .. 2026-01-06\ndays of a");
  assert.equal(out.queries[0].days, 4);
  assert.equal(out.bindings.a.members.length, 2);
});

test("rolling: series values, range, and the decay back to zero", () => {
  const out = run([
    "t1 = 2026-01-01 .. 2026-01-05",
    "t2 = 2026-02-01 .. 2026-02-10",
    "rolling days of t1, t2 in 30 days limit 9",
  ].join("\n"));
  const q = out.queries[0];
  assert.equal(q.windowDays, 30);
  assert.equal(q.limit, 9);
  const at = (mo, d) => q.series.find((p) => p.ms === Date.UTC(2026, mo - 1, d)).value;
  assert.equal(at(1, 5), 5);     // end of t1: all of t1 in window
  assert.equal(at(2, 1), 4);     // Jan 3-5 still in the 30-day window, plus Feb 1
  assert.equal(at(2, 10), 10);   // end of t2: t1 has aged out
  assert.equal(q.max, 10);
  assert.equal(q.series[0].ms, Date.UTC(2026, 0, 1));
  assert.equal(q.series[q.series.length - 1].ms, Date.UTC(2026, 2, 12));   // last day + one full window
  assert.equal(q.series[q.series.length - 1].value, 0);                     // the reset, part of the answer
});

test("rolling perMember: each member's high-water mark at its own last day", () => {
  const out = run([
    "t1 = 2026-01-01 .. 2026-01-05",
    "t2 = 2026-02-01 .. 2026-02-10",
    "rolling days of t1, t2 in 30 days",
  ].join("\n"));
  assert.deepEqual(out.queries[0].perMember.map((p) => [p.days, p.atEnd]), [[5, 5], [10, 10]]);
  assert.equal(out.queries[0].limit, null);
});

test("the schengen numbers: usage at the end of each trip (90/180)", () => {
  const out = run([
    "trips = 2025-12-15 .. 2025-12-23,",
    "        2026-03-27 .. 2026-05-11,",
    "        2026-07-03 .. 2026-07-08,",
    "        2026-07-17 .. 2026-08-10",
    "days of trips & last 180 days",
    "rolling days of trips in 180 days limit 90",
  ].join("\n"));
  assert.equal(out.queries[0].days, 52);   // used as of NOW (2026-07-12)
  assert.deepEqual(out.queries[1].perMember.map((p) => p.atEnd), [9, 55, 52, 77]);
  assert.equal(out.queries[1].max, 77);    // never over the limit
});

test("desugar freezes `last N days` at its evaluation instant", () => {
  const src = "days of 2026-07-01 .. 2026-07-20 & last 3 days";
  const a = run(src);
  assert.equal(a.queries[0].days, 3);   // Jul 10, 11, 12
  const later = NOW + 40 * Z.MS.day;
  assert.equal(run(src, later).queries[0].days, 0);                 // the live window moved on…
  assert.equal(run(Z.desugar(a), later).queries[0].days, 3);        // …the desugared one did not
});

test("rolling and last reject nonsense with hints", () => {
  assert.match(errorsOf("rolling days of 2026-01-01 .. 2026-01-05 in 0 days")[0], /at least 1 day/);
  assert.match(errorsOf("rolling days of stuff")[0], /full form/);
  assert.match(errorsOf("x = last 3 weeks")[0], /only days for now/);
  assert.match(errorsOf("last = 2026-01-01")[0], /reserved word/);
});

/* ------------------------------------------------- slots (v0.4) */

test("slots: free time chopped into offerable pieces", () => {
  const out = run([
    "blocks = 2026-07-20 12:00 .. 2026-07-20 15:00,",
    "         2026-07-21 09:00 .. 2026-07-21 13:00",
    "booked = 2026-07-20 13:00 .. 2026-07-20 13:30,",
    "         2026-07-21 09:30 .. 2026-07-21 10:30",
    "free = blocks - booked",
    "slots of free every 30 minutes",
  ].join("\n"));
  const q = out.queries[0];
  assert.equal(q.slots.length, 11);   // 2 + 3 on Monday, 1 + 5 on Tuesday
  assert.deepEqual([q.slots[0].start, q.slots[0].end],
                   [Date.UTC(2026, 6, 20, 12), Date.UTC(2026, 6, 20, 12, 30)]);
  assert.equal(q.slots[2].start, Date.UTC(2026, 6, 20, 13, 30));   // resumes after the booking
  assert.equal(q.stepMs, 30 * Z.MS.minute);
});

test("slots: a remainder too short for a slot is dropped and reported", () => {
  const out = run("slots of 2026-07-20 09:00 .. 2026-07-20 10:15 every 30 minutes");
  assert.equal(out.queries[0].slots.length, 2);
  assert.equal(out.queries[0].droppedMs, 15 * Z.MS.minute);
});

test("slots walk MERGED coverage — overlapping members never double-offer", () => {
  const out = run([
    "a = 2026-07-20 09:00 .. 2026-07-20 11:00",
    "b = 2026-07-20 10:00 .. 2026-07-20 12:00",
    "slots of a, b every 1 hour",
  ].join("\n"));
  assert.equal(out.queries[0].slots.length, 3);   // 09, 10, 11 — not five
});

test("slots reject nonsense with hints", () => {
  assert.match(errorsOf("f = 2026-01-01\nslots of f every 30 minutes")[0], /wants a stretch of time/);
  assert.match(errorsOf("slots of 2026-01-01 .. 2026-01-02 every 0 minutes")[0], /at least 1 minute/);
  assert.match(errorsOf("slots of stuff")[0], /full form/);
});

test("desugar survives slots: identical slot extents", () => {
  const src = "timezone = Europe/Vienna\nslots of 2026-07-20 12:00 .. 2026-07-20 14:00 every 30 minutes";
  const a = run(src);
  const b = run(Z.desugar(a));
  assert.deepEqual(b.queries[0].slots, a.queries[0].slots);
});

/* --------------------------------------------------- load (v0.5) */

const runData = (src, data, now = NOW) => {
  const out = Z.evaluate(src, { now, data });
  assert.deepEqual(out.errors, [], "expected no errors");
  return out;
};

test("load: a string is an instant through the lens; Z forces UTC; a number is epoch ms", () => {
  const out = runData([
    "timezone = Europe/Vienna",
    "a = load \"civil\"",
    "b = load \"zulu\"",
    "c = load \"epoch\"",
  ].join("\n"), {
    civil: "2026-07-17 10:00",
    zulu:  "2026-07-17 10:00Z",
    epoch: Date.UTC(2026, 6, 17, 10),
  });
  assert.equal(out.bindings.a.ms, Date.UTC(2026, 6, 17, 8));    // CEST +2, through the lens
  assert.equal(out.bindings.b.ms, Date.UTC(2026, 6, 17, 10));   // Z wins over the lens
  assert.equal(out.bindings.c.ms, Date.UTC(2026, 6, 17, 10));
});

test("load: a pair is one interval, with the through-rule on a bare end date", () => {
  const out = runData("t = load \"trip\"\ndays of t", { trip: ["2026-01-01", "2026-01-03"] });
  assert.equal(out.queries[0].days, 3);
});

test("load: a list of pairs (or {start, end, name} objects) is a set", () => {
  const out = runData("b = load \"blocks\"\npartition b", {
    blocks: [
      { start: "2026-07-20 12:00", end: "2026-07-20 15:00", name: "monday" },
      ["2026-07-21 09:00", "2026-07-21 13:00"],
    ],
  });
  assert.deepEqual(out.bindings.b.members.map((m) => m.labels), [["monday"], ["b"]]);   // anonymous ones take the binding name
});

test("load composes as an expression and an empty list is a valid set", () => {
  const out = runData("slots of load \"blocks\" - load \"booked\" every 1 hour", {
    blocks: [["2026-07-20 09:00", "2026-07-20 12:00"]],
    booked: [],
  });
  assert.equal(out.queries[0].slots.length, 3);
});

test("the full booking engine over external data", () => {
  const src = require("node:fs").readFileSync(path.join(__dirname, "..", "examples", "booking-load.zf"), "utf8");
  const data = JSON.parse(require("node:fs").readFileSync(path.join(__dirname, "..", "examples", "booking-load.json"), "utf8"));
  const out = runData(src, data);
  assert.equal(out.queries.find((q) => q.kind === "slots").slots.length, 11);
});

test("desugar freezes loaded data: the desugared program runs WITHOUT it", () => {
  const a = runData("timezone = Europe/Vienna\nb = load \"blocks\"\ndays of b",
                    { blocks: [["2026-07-20", "2026-07-22"], ["2026-08-01", "2026-08-02"]] });
  const b = run(Z.desugar(a));   // note: no data passed
  assert.deepEqual(b.bindings.b.members.map((m) => [m.start, m.end]),
                   a.bindings.b.members.map((m) => [m.start, m.end]));
  // extents are the guarantee; day COUNTS differ by lens (Vienna vs UTC) by design
});

test("load errors: missing data, missing key, malformed entries", () => {
  assert.match(Z.evaluate("b = load \"blocks\"", { now: NOW }).errors[0].msg, /no data named "blocks"/);
  assert.match(Z.evaluate("b = load \"nope\"", { now: NOW, data: { blocks: [] } }).errors[0].msg, /no data named "nope"/);
  assert.match(Z.evaluate("b = load \"x\"", { now: NOW, data: { x: [["bad", "worse"]] } }).errors[0].msg, /can't read "bad" as a time/);
  assert.match(Z.evaluate("b = load blocks", { now: NOW, data: {} }).errors[0].msg, /quoted name/);
});

/* -------------------------------------- recurrence + selectors (v0.6) */

test("next n of a rule: whole civil days through the rule's lens", () => {
  // NOW is Sunday 2026-07-12; Vienna is UTC+2 in July
  const out = run("timezone = Europe/Vienna\nmondays = every monday\nm = next 3 of mondays\ndays of m");
  const ms = out.bindings.m.members;
  assert.equal(ms.length, 3);
  assert.equal(ms[0].start, Date.UTC(2026, 6, 12, 22));   // Mon Jul 13 00:00 Vienna
  assert.equal(ms[0].end, Date.UTC(2026, 6, 13, 22));
  assert.equal(ms[2].start, Date.UTC(2026, 6, 26, 22));   // Mon Jul 27
  assert.equal(out.queries[0].days, 3);
});

test("a weekday rule bounded by & — wall-clock hours, five days", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "hours = every weekday 09:00 .. 17:00",
    "week = hours & 2026-07-13 .. 2026-07-19",
    "length of week",
  ].join("\n"));
  assert.equal(out.bindings.week.members.length, 5);      // Mon–Fri, the weekend skipped
  assert.equal(out.bindings.week.members[0].start, Date.UTC(2026, 6, 13, 7));   // 09:00 CEST
  assert.equal(out.queries[0].breakdown.ms, 40 * Z.MS.hour);
});

test("rules are wall-clock true across DST: 8 hours even on the 23-hour day", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "w = every day 09:00 .. 17:00",
    "x = w & 2026-03-28 .. 2026-03-30",
    "length of x", "days of x",
  ].join("\n"));
  assert.equal(out.queries[0].breakdown.ms, 24 * Z.MS.hour);   // 3 × 8 wall hours
  assert.equal(out.queries[1].days, 3);
});

test("a rule keeps the lens it was defined under", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "noon = every day 12:00 .. 13:00",
    "timezone = America/New_York",
    "x = noon & 2026-07-13 .. 2026-07-13",     // the interval reads through NY…
  ].join("\n"));
  assert.equal(out.bindings.x.members[0].start, Date.UTC(2026, 6, 13, 10));   // …the rule stays Vienna noon
});

test("set - rule: the finite side is the bound", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "hours = every weekday 09:00 .. 17:00",
    "lunch = every day 12:00 .. 13:00",
    "week = next 5 of hours",
    "length of week - lunch",
  ].join("\n"));
  assert.equal(out.queries[0].breakdown.ms, 35 * Z.MS.hour);   // 5 × (8 − 1)
});

test("an overnight rule spills past midnight", () => {
  const out = run("night = every day 22:00 .. 02:00\nlength of night & 2026-07-13 .. 2026-07-14");
  assert.equal(out.queries[0].breakdown.ms, 8 * Z.MS.hour);    // 2 + 4 + 2, clipped at the span edges
});

test("first/next n of a SET: sorted bites; next is anchored at now", () => {
  const src = [
    "trips = 2026-01-05 .. 2026-01-08,",       // long past NOW
    "        2026-07-10 .. 2026-07-14,",       // ongoing at NOW (Jul 12)
    "        2026-09-01 .. 2026-09-03",
    "days of first 2 of trips",
    "days of next 2 of trips",
  ].join("\n");
  const out = run(src);
  assert.equal(out.queries[0].days, 9);    // Jan trip (4) + July trip (5)
  assert.equal(out.queries[1].days, 8);    // ongoing July trip (5) + Sept trip (3)
});

test("unbounded recurrences are refused everywhere, with hints", () => {
  const pre = "r = every monday\ns = 2026-07-01 .. 2026-07-31\n";
  assert.match(errorsOf(pre + "days of r")[0], /finite set/);
  assert.match(errorsOf(pre + "x = r | s")[0], /unbounded/);
  assert.match(errorsOf(pre + "x = r - s")[0], /unbounded/);
  assert.match(errorsOf(pre + "r2 = every tuesday\nx = r & r2")[0], /still unbounded/);
  assert.match(errorsOf(pre + "x = first 2 of r")[0], /has no first/);
  assert.match(errorsOf(pre + "until r")[0], /recurrence/);
});

test("rule statement errors: bad day word, bad times, rules aren't expressions", () => {
  assert.match(errorsOf("x = every mondays")[0], /every what\?/);
  assert.match(errorsOf("x = every monday 25:00 .. 26:00")[0], /not a real time/);
  assert.match(errorsOf("x = every monday 09:00 .. 09:00")[0], /must have width/);
  assert.match(errorsOf("a = 2026-01-01 .. 2026-01-05\nx = a & every monday")[0], /its own statement/);
});

test("desugar: rules keep their zone (re-aimed lens); selectors freeze", () => {
  const src = [
    "timezone = Europe/Vienna",
    "hours = every weekday 09:00 .. 17:00",
    "lunch = every day 12:00 .. 13:00",
    "booked = 2026-07-13 10:00 .. 2026-07-13 11:30",
    "week = next 5 of hours",
    "free = week - lunch - booked",
    "slots of free every 30 minutes",
  ].join("\n");
  const a = run(src);
  const d = Z.desugar(a);
  assert.match(d, /timezone = Europe\/Vienna\s+# a rule is irreducibly civil/);
  const b = run(d);
  assert.deepEqual(b.bindings.week.members.map((m) => [m.start, m.end]),
                   a.bindings.week.members.map((m) => [m.start, m.end]));
  assert.deepEqual(b.queries[0].slots, a.queries[0].slots);
});

/* ----------------------------------- coverage depth + show (v0.7) */

const CREDITS = [
  "block1 = 2026-01-10 .. 2026-04-09",
  "block2 = 2026-02-15 .. 2026-06-15",
  "credits = block1, block2",
].join("\n");

test("alone in: the safe ground, each stretch naming its lone member", () => {
  const out = run(CREDITS + "\nsafe = alone in credits\nshow safe");
  assert.deepEqual(out.bindings.safe.members, [
    { start: Date.UTC(2026, 0, 10), end: Date.UTC(2026, 1, 15), labels: ["block1"] },
    { start: Date.UTC(2026, 3, 10), end: Date.UTC(2026, 5, 16), labels: ["block2"] },
  ]);
});

test("last 1 of alone in: THE question — the latest safe restart", () => {
  const out = run(CREDITS + "\nshow last 1 of alone in credits");
  assert.deepEqual(out.queries[0].members, [
    { start: Date.UTC(2026, 3, 10), end: Date.UTC(2026, 5, 16), labels: ["block2"] },
  ]);
});

test("shared in: the burn zones (any depth >= 2, not just pairwise)", () => {
  const out = run(CREDITS + "\nblock3 = 2026-03-01 .. 2026-03-10\ndays of shared in block1, block2, block3");
  assert.equal(out.queries[0].days, 54);   // Feb 15 – Apr 9; block3 inside it adds no new shared days
});

test("touching same-name regions fuse; different names stay separate", () => {
  // a's boundary inside its own alone ground would be a phantom cut
  const out = run([
    "a = 2026-01-01 .. 2026-01-10",
    "b = 2026-01-11 .. 2026-01-20",     // starts exactly where a ends (through-rule)
    "show alone in a, b",
  ].join("\n"));
  assert.deepEqual(out.queries[0].members.map((m) => m.labels), [["a"], ["b"]]);   // contiguous but NOT merged
});

test("alone in a set with no overlaps is the set itself; shared is empty — a valid answer", () => {
  const out = run("a = 2026-01-01 .. 2026-01-05\nb = 2026-02-01 .. 2026-02-05\nshow shared in a, b");
  assert.deepEqual(out.queries[0].members, []);   // "none" — the IF in "if it exists"
});

test("last n of selects the latest members; last n days is still the window", () => {
  const out = run([
    "trips = 2026-01-05 .. 2026-01-08,",
    "        2026-03-01 .. 2026-03-04,",
    "        2026-09-01 .. 2026-09-03",
    "days of last 2 of trips",
    "days of trips & last 190 days",       // both spellings of `last` in one program
  ].join("\n"));
  assert.equal(out.queries[0].days, 7);    // March (4) + September (3)
  assert.equal(out.queries[1].days, 8);    // Jan 5 (window starts Jan 4) + March, September not yet
});

test("depth filters and last-selector refuse the unbounded", () => {
  const pre = "r = every monday\n";
  assert.match(errorsOf(pre + "show alone in r")[0], /finite set/);
  assert.match(errorsOf(pre + "x = last 2 of r")[0], /has no last/);
  assert.match(errorsOf("x = alone credits")[0], /in what\?/);
});

test("desugar survives depth filters and show", () => {
  const a = run(CREDITS + "\nshow last 1 of alone in credits");
  const b = run(Z.desugar(a));
  assert.deepEqual(b.queries[0].members.map((m) => [m.start, m.end]),
                   a.queries[0].members.map((m) => [m.start, m.end]));
});

/* --------------------------------------------- durations (v0.8) */

test("instant - hours: absolute arithmetic, straight through the lens", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "flight = 2026-07-17 10:40",
    "go_to_airport = flight - 3 hours",
    "checkin = flight + 45 minutes",
  ].join("\n"));
  assert.equal(out.bindings.go_to_airport.ms, Date.UTC(2026, 6, 17, 5, 40));   // 07:40 Vienna
  assert.equal(out.bindings.checkin.ms, Date.UTC(2026, 6, 17, 9, 25));
});

test("THE split: - 1 day is a civil step, - 24 hours is absolute — they differ across DST", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "x = 2026-03-29 12:00",              // noon CEST, the day the clocks jumped
    "civil = x - 1 day",                 // same wall time yesterday
    "absolute = x - 24 hours",           // 24 real hours earlier
  ].join("\n"));
  assert.equal(out.bindings.civil.ms, Date.UTC(2026, 2, 28, 11));      // 12:00 CET
  assert.equal(out.bindings.absolute.ms, Date.UTC(2026, 2, 28, 10));   // 11:00 CET
  assert.equal(out.bindings.civil.ms - out.bindings.absolute.ms, Z.MS.hour);
});

test("arithmetic chains left to right: flight + 3 hours + 30 minutes + 30 minutes", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "flight = 2026-07-17 10:40",
    "in_amsterdam = flight + 3 hours + 30 minutes + 30 minutes",
    "mixed = flight - 1 day + 3 hours",            // civil step, then absolute — in order
  ].join("\n"));
  assert.equal(out.bindings.in_amsterdam.ms, Date.UTC(2026, 6, 17, 12, 40));   // 14:40 Vienna
  assert.equal(out.bindings.mixed.ms, Date.UTC(2026, 6, 16, 11, 40));
});

test("weeks are 7 civil days; durations bind to names and compose", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "x = 2026-03-31 12:00",
    "w = x - 1 week",                    // crosses the DST change, wall clock holds
    "buffer = 3 hours",
    "flight = 2026-07-17 10:40",
    "until flight - buffer",
  ].join("\n"));
  assert.equal(out.bindings.w.ms, Date.UTC(2026, 2, 24, 11));          // 12:00 CET
  assert.equal(out.queries[0].targetMs, Date.UTC(2026, 6, 17, 5, 40));
});

test("a rule can be aliased; the rule's own zone travels with it", () => {
  const out = run([
    "timezone = Europe/Vienna",
    "mondays = every monday",
    "timezone = UTC",
    "m = mondays",
    "x = next 1 of m",
  ].join("\n"));
  assert.equal(out.bindings.x.members[0].start, Date.UTC(2026, 6, 12, 22));   // Mon 00:00 Vienna
});

test("duration errors: bare numbers, shifting sets, misplaced durations", () => {
  assert.match(errorsOf("x = 3")[0], /bare number isn't a value/);
  assert.match(errorsOf("a = 2026-01-01 .. 2026-01-05\nx = a - 3 hours")[0], /works on an instant/);
  assert.match(errorsOf("a = 2026-01-01 .. 2026-01-05\nb = 2026-02-01 .. 2026-02-05\nx = a + b")[0], /adds a duration/);
  assert.match(errorsOf("until 3 hours")[0], /is a duration/);
  assert.match(errorsOf("days of 3 hours")[0], /has no position/);
});

test("desugar freezes day-arithmetic and now — resolved UTC literals", () => {
  const a = run([
    "timezone = Europe/Vienna",
    "x = 2026-03-29 12:00",
    "y = x - 1 day",                     // civil step: lens-dependent, so it must freeze
    "z = now",
    "until y",
  ].join("\n"));
  const b = run(Z.desugar(a), NOW + 40 * Z.MS.day);   // different now, UTC lens
  assert.equal(b.bindings.y.ms, a.bindings.y.ms);
  assert.equal(b.bindings.z.ms, a.bindings.z.ms);     // now froze at first evaluation
  assert.equal(b.queries[0].targetMs, a.queries[0].targetMs);
});

/* ---------------------------------------------- provenance (v0.9) */

test("shared in names ALL its parents — the array of labels for the caller", () => {
  const out = run(CREDITS + "\nshow shared in credits");
  assert.deepEqual(out.queries[0].members,
    [{ start: Date.UTC(2026, 1, 15), end: Date.UTC(2026, 3, 10), labels: ["block1", "block2"] }]);
});

test("the embedding round trip: named JSON in, ancestry out", () => {
  const out = Z.evaluate("blocks = load \"blocks\"\nshow shared in blocks\nshow alone in blocks", {
    now: NOW,
    data: { blocks: [
      { start: "2026-01-10", end: "2026-04-09", name: "block1" },
      { start: "2026-02-15", end: "2026-06-15", name: "block2" },
    ]},
  });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.queries[0].members[0].labels, ["block1", "block2"]);
  assert.deepEqual(out.queries[1].members.map((m) => m.labels), [["block1"], ["block2"]]);
});

test("intersect cuts where the covering labels change, then re-fuses", () => {
  // b1 and b2 tile a's middle: a & (b1, b2) has two label-distinct pieces
  const out = run([
    "a = 2026-01-01 .. 2026-01-31",
    "b1 = 2026-01-05 .. 2026-01-10",
    "b2 = 2026-01-11 .. 2026-01-20",
    "x = a & (b1, b2)",
  ].join("\n"));
  assert.deepEqual(out.bindings.x.members.map((m) => [m.start, m.end, m.labels]), [
    [Date.UTC(2026, 0, 5), Date.UTC(2026, 0, 11), ["a", "b1"]],
    [Date.UTC(2026, 0, 11), Date.UTC(2026, 0, 21), ["a", "b2"]],
  ]);
});

test("merging two pieces of the SAME block keeps a single label", () => {
  const out = run("a = 2026-01-01 .. 2026-01-05\nb = a, a\nu = a | a\nshow u");
  assert.deepEqual(out.bindings.u.members, [{ start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 6), labels: ["a"] }]);
});

test("subtraction keeps the survivor's labels; the remover leaves no name", () => {
  const out = run(CREDITS + "\nx = (block1 & block2) - 2026-03-01 .. 2026-03-05");
  assert.deepEqual(out.bindings.x.members.map((m) => m.labels),
                   [["block1", "block2"], ["block1", "block2"]]);
});

test("slots inherit the labels of the free stretch they were cut from", () => {
  const out = run([
    "monday = 2026-07-20 12:00 .. 2026-07-20 13:00",
    "slots of monday every 30 minutes",
  ].join("\n"));
  assert.deepEqual(out.queries[0].slots.map((s) => s.labels), [["monday"], ["monday"]]);
});

/* ------------------------------------------------------------- errors */

test("bad zone, unreal date, unreal time, unbound name, unknown statement", () => {
  assert.match(errorsOf("timezone = Europe Central")[0], /not an IANA timezone/);
  assert.match(errorsOf("d = 2026-02-30")[0], /not a real calendar date/);
  assert.match(errorsOf("d = 2026-07-17 25:00")[0], /not a real time of day/);
  assert.match(errorsOf("until flight")[0], /not bound/);
  assert.match(errorsOf("flight leaves friday")[0], /unrecognized statement/);
  assert.match(errorsOf("now = 2026-01-01")[0], /reserved word/);
});

test("errors carry line numbers", () => {
  const out = Z.evaluate("a = 2026-01-01\n\nnonsense here", { now: NOW });
  assert.equal(out.errors[0].line, 3);
});

test("comments and blank lines are ignored", () => {
  const out = run("# a comment\n\na = 2026-01-01   # trailing\n");
  assert.equal(Object.keys(out.bindings).length, 1);
});

/* ------------------------------------------------- duration formatting */

test("formatDuration starts at the first non-zero unit, keeps zeros after", () => {
  assert.equal(Z.formatDuration(Z.breakdown(4 * Z.MS.day + 19 * Z.MS.hour + 23 * Z.MS.minute + 8000)),
               "4 days 19 hours 23 minutes 8 seconds");
  assert.equal(Z.formatDuration(Z.breakdown(Z.MS.day + 5 * Z.MS.minute)),
               "1 day 0 hours 5 minutes 0 seconds");
  assert.equal(Z.formatDuration(Z.breakdown(42000)), "42 seconds");
  assert.equal(Z.formatDuration(Z.breakdown(0)), "0 seconds");
});

test("formatInstant shows civil time, zone, and offset", () => {
  const ms = Date.UTC(2026, 6, 17, 8);
  assert.equal(Z.formatInstant(ms, "Europe/Vienna"), "2026-07-17 10:00 Europe/Vienna (UTC+02:00)");
  assert.equal(Z.formatInstant(ms, "America/New_York"), "2026-07-17 04:00 America/New_York (UTC-04:00)");
});

/* ------------------------------------------------------------- desugar */

test("desugar re-emits valid source that resolves to identical instants", () => {
  const src = [
    "timezone = Europe/Vienna",
    "flight = 2026-07-17 10:00",
    "until flight",
    "timezone = America/New_York",
    "call = 2026-07-14 09:00",
    "until call",
    "since 2026-01-01",
  ].join("\n");
  const a = run(src);
  const b = run(Z.desugar(a));
  assert.equal(b.bindings.flight.ms, a.bindings.flight.ms);
  assert.equal(b.bindings.call.ms, a.bindings.call.ms);
  assert.deepEqual(b.queries.map((q) => q.targetMs), a.queries.map((q) => q.targetMs));
});

test("desugar survives intervals: through-dates resolved, extents identical", () => {
  const src = [
    "timezone = Europe/Vienna",
    "block1 = 2026-01-10 .. 2026-04-09",
    "block2 = 2026-02-15 .. 2026-06-15",
    "credits = block1, block2",
    "partition credits",
    "days of block1 & block2",
    "length of credits",
  ].join("\n");
  const a = run(src);
  const b = run(Z.desugar(a));
  assert.deepEqual(b.bindings.credits.members.map((m) => [m.start, m.end, m.labels]),
                   a.bindings.credits.members.map((m) => [m.start, m.end, m.labels]));
  const seg = (o) => o.queries[0].segments.map((s) => [s.start, s.end, s.covers.join("+")]);
  assert.deepEqual(seg(b), seg(a));
  // day counts differ by lens (Vienna vs UTC) by design; extents may not.
  assert.equal(b.queries[2].breakdown.ms, a.queries[2].breakdown.ms);
});

/* ------------------------------------------------- examples as fixtures */

test("every example evaluates without errors (a sibling .json is its data)", () => {
  const dir = path.join(__dirname, "..", "examples");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".zf"))) {
    const dataPath = path.join(dir, f.replace(/\.zf$/, ".json"));
    const data = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, "utf8")) : undefined;
    const out = Z.evaluate(fs.readFileSync(path.join(dir, f), "utf8"), { now: NOW, data });
    assert.deepEqual(out.errors, [], `${f} should have no errors`);
    assert.ok(out.queries.length > 0, `${f} should ask at least one question`);
  }
});
