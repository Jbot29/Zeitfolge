# Zeitfolge

An experiment: a tiny language for time — SQL is to relational data what
this wants to be to instants, durations, and (soon) intervals. UTC on the
inside, civil time as a declared lens, answers with a visualization out of
the box.

See [LANGUAGE.md](LANGUAGE.md) for the spec and roadmap.

![Time Screenshot\(./screenshot1.png)

## Running

Open `index.html` in a browser — fully self-contained, no server, no
network, no dependencies. The **open…** button loads any `.zf` file from
disk either way. Running `./serve.sh` (or `npm run serve`) serves it over
http, which additionally enables loading scripts by URL:

```
http://localhost:8000/?script=examples/booking-load.zf&data=examples/booking-load.json
```

## Layout

| path | what |
|---|---|
| `zeitfolge.js` | the language core — pure JS, no dependencies, no DOM; the part that embeds anywhere (browser, Node, a Lambda) |
| `index.html` | the playground: editor · UTC view · live-ticking answers |
| `examples/*.zf` | example programs; also regression fixtures for the tests |
| `examples/*.json` | external data for a same-named example — what a host passes to `evaluate(src, {data})` |
| `tests/zeitfolge.test.js` | test suite (`node --test`, no dependencies) |
| `LANGUAGE.md` | the spec, one version per forcing example |
| `serve.sh` | tiny local http server, for `?script=` URLs |

## Tests

```sh
npm test
```

Time is dangerous, so the suite pins the sharp edges by name: DST gaps and
ambiguities, a 23-hour "day" across a spring-forward night, the same wall
time landing on two instants through two lenses. `evaluate(source, {now})`
takes `now` as an argument, so every test is deterministic.

## A taste

```
timezone = Europe/Vienna

flight = 2026-07-17 10:00
until flight                  # → 4 days 19 hours 23 minutes — live, with a timeline strip

block1 = 2026-01-10 .. 2026-04-09      # a 90-day block of credits
block2 = 2026-02-15 .. 2026-06-15      # bought mid-block, different expiry
partition block1, block2               # → the non-overlapping pieces, drawn stacked:
                                       #   36 days block1 · 54 days both · 67 days block2

//remote call
timezone = Europe/Vienna
standup = 2026-07-13 09:30
until standup

timezone = America/New_York
demo = 2026-07-13 09:30      # same wall time, six hours later in absolute time
until demo


days of trips & last 180 days          # Schengen days used as of right now
rolling days of trips in 180 days limit 90    # the whole usage curve, charted, with the law drawn on
```
