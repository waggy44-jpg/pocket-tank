# Upstream sync notes — mediacutlet/pocket-tank

Checked 2026-10-04 against upstream `bf0c6b8` (v0.3.1 alpha).

## What upstream is
C firmware + Python training pipeline for an ESP32-S3. The behaviour lives in
`common/` (C, ~1.2 MB of sources), shared unchanged between the PC simulator and
the firmware. `model/out/model_q4.bin` (7.4 MB, the real 14.3M-param 4-bit
weights) and `tokenizer.bin` are committed to the repo.

## Our state line vs theirs
Ours (`stateLine` in `parts/logic.js`):
```
zone <surface|mid|floor> hunger N energy N stress N curiosity N bold N social N
stage <name> trust N bored N food <> friend <> bubble <> reef <> cover <> light <> last <goal>
```

Theirs (`common/llm/advisor_core.c`, schema v4):
```
zone %d hunger %d energy %d stress %d curiosity %d bold %d social %d stage %s
trust %d bored %d food %s friend %s bubble %s reef %s wall %s last %s time %s
```

**Same vocabulary, same order, same seven goals** (`seek_food`, `follow_friend`,
`inspect_reef`, `visit_bubbles`, `explore`, `rest`, `dart_play`). Differences
that matter:

| Field | Upstream | Ours | Note |
|---|---|---|---|
| `zone` | 1–9 grid cell index | text band name | theirs is a 3x3 tank grid |
| `wall` | `near/far/clear` + clock dir | *absent* | we have no wall clock |
| `time` | `day`/`night` | `light on`/`light off` | same idea, different word |
| `cover` | *absent* | `yes`/`no` | our addition, derived from grass |
| drives | 0–9 ints | 0–10, not quantised | ours is a finer scale |
| traits | `bold`, `sociable`, `lazy` | same three | match |

Their schema also has a v3 (`shadow`) and a v2 (`fish <name>` prefix) — the
model was retrained across versions, so the *vocabulary itself* moves.

## What this means for a sync
**Do not merge upstream code.** Different language (C vs JS), different platform
(240 MHz microcontroller vs phone browser), and the weights are for a bare-metal
inference engine we cannot run.

**Do sync these, weekly:**
1. **The seven goals** — if upstream adds or renames one, add it to `GOALS` and
   give it a score in `scoreGoals` + a target in `targetFor`.
2. **New shop items / decorations / fish species** — the README's "Next" list
   is the roadmap.
3. **New gestures or mechanics** — e.g. a new tool, a new upkeep chore.
4. **Milestones/badges** — new firsts they add, add here.
5. **Behaviour changes worth mirroring** — e.g. the boredom drive (v4) which we
   already implement.
6. **Numeric constants** — anything that reads as a tuning value in their
   `common/*.c` (speeds, radii, thresholds) and makes sense on a phone.

## What we deliberately do NOT sync
- The model weights or the tokenizer (wrong platform)
- ESP32 hardware, display drivers, touch calibration, OTA, battery, audio codec
- The training pipeline (`model/*.py`) — no relevance to a phone
- Their UI layout — the tank is a phone screen, not a 1.8" AMOLED

## Routine
Check the upstream commit list weekly. If a commit touches `common/tank.c`,
`common/progression.c`, `common/llm/`, or the README's status list, read the
diff and judge whether it changes what a player observes. If it does, change
ours, run both test suites, push — GitHub Pages rebuilds automatically.