# How the swipe controls got here

Every version of the swipe controls, oldest first, and why each change was made. The details of each part are in
[CONTROLS.md](CONTROLS.md) and [MATCH-MY-THUMB.md](MATCH-MY-THUMB.md); this file is the story.

## The standard lean, version by version

The pad reads a swipe as up, down, left or right by which of four **aims** it is nearest to. Each aim can lean
a few degrees off straight, because a thumb swings from its base: a quick flick of the left thumb curves
clockwise (left drifts up, right drifts down). The **standard lean** is what every player gets until they run
Match my thumb (`DEFAULT_TILT` in `src/swipe.ts`). A right thumb gets the mirror image: the same number of
degrees, anticlockwise.

| Version | Standard lean (left thumb / right thumb) | In use | Where it came from |
|---|---|---|---|
| 1 | 15° clockwise / 15° anticlockwise | November 2026, from the first touch controls | Claude's middle course, chosen on simulated thumbs (`experiments/stroke-reading.ts`): almost no cost for a straight thumb, and most errors gone for one that leans. Kept in the code as `FIRST_TILT`. |
| 2 | 2° clockwise / 2° anticlockwise | 16 November 2026, one afternoon | The owner's own thumb. Match my thumb with his left thumb chose **One lean** (all 8 test swipes right, the closest 30° from a border, against 19° for the old standard), and he said it felt really good. It became the standard for both thumbs, with no switch of its own (his call). His phone keeps it as his own match. |
| 3 | 8° clockwise / 8° anticlockwise | 16 November 2026, briefly | Asked for "the ultimate setting", Claude compared leans of 2°, 6°, 8°, 10° and 15° on simulated thumbs (table below) and the owner said to use the best. 8° costs a straight thumb like his almost nothing and about halves the mistakes of a thumb that curves, compared with 2°; 15° helps strongly curving thumbs most but costs straight ones more and is worst for a thumb that curves the other way. |
| 4 | **5° clockwise / 5° anticlockwise** | From 16 November 2026 | The owner's pick, between his own 2° and 8°. Measured on simulated thumbs (resting / straight after touching down): straight 0.0% / 0.3% wrong, curving 20° 0.1% / 2.5%, curving 30° 4.3% / 8.3% (8°: 2.4% / 6.2%; 2°: 6.9% / 14.3%), curving 10° the other way 0.5% / 2.3%. |

The run that set version 2 measured these leans in his swipes: left 5°, right 6°, up 9°, down −8°, spread 14°:
close to straight overall (about 3°). One lean uses three quarters of the overall lean, rounded (`tiltFor` in
`src/teach.ts`), which gives 2°.

**Will the right thumb be the same?** As a mirror image, roughly. The two thumbs swing from opposite corners, so
they lean opposite ways by about the same amount; that is why the right thumb's standard is the left's mirrored.
It is not exact (most people's other thumb is less practised), so a right-thumb player should run Match my thumb
once.

### What changed in the numbers

From `experiments/stroke-reading.ts` (made-up thumbs, so a guide, not a measurement of anyone's hand). Share of
strokes read the wrong way:

| The thumb leans | Lean 2° (now) | Lean 15° (before) |
|---|---|---|
| Resting thumb, robot moving: 0° | 0.0% | 0.4% |
| 15° | 0.1% | 0.0% |
| 30° | 7.9% | 1.0% |
| 40° | 28.8% | 4.4% |
| Straight after touching down: 0° | 0.1% | 2.4% |
| 15° | 1.5% | 0.1% |
| 30° | 11.5% | 2.1% |
| 40° | 33.1% | 8.1% |

Version 3 compared more leans (share of strokes read wrong; resting thumb, then straight after touching down):

| The thumb leans | 2° | 6° | 8° | 10° | 15° |
|---|---|---|---|---|---|
| −10° (the other way) | 0.3% / 0.9% | 0.9% / 2.1% | 1.0% / 3.7% | 1.8% / 4.3% | 4.3% / 9.1% |
| 0° | 0.0% / 0.2% | 0.0% / 0.3% | 0.1% / 0.6% | 0.1% / 0.5% | 0.2% / 1.7% |
| 10° | 0.0% / 0.4% | 0.0% / 0.1% | 0.0% / 0.1% | 0.0% / 0.3% | 0.0% / 0.3% |
| 20° | 0.9% / 3.2% | 0.5% / 1.5% | 0.3% / 0.9% | 0.1% / 0.7% | 0.0% / 0.7% |
| 30° | 6.9% / 14.3% | 3.9% / 8.2% | 2.4% / 6.2% | 1.7% / 4.2% | 0.3% / 2.0% |

So 2° suits a thumb that swipes close to straight, like the owner's, and is clearly worse than 15° for a thumb
whose quick swipes lean 30° or more; 8° sits between, giving up little anywhere. Such a player should run Match my thumb (Settings › Controls › My thumb),
which measures their lean and keeps whichever setting reads their swipes best. If friends find the standard
reads them wrongly, that is the number to look at again.

## Everything else, in order

1. **First touch controls** (November 2026). A see-through swipe pad on the left and B above A on the right.
   Swipe from wherever the thumb is; keep it down to keep moving; lift to stop. The robot stops where you let go.
2. **Whole-tile stepping** (the robot always finishing its tile) was tried and rejected: it felt like the robot
   ignored you. `stepAssist` still exists in `sim.ts`, switched off, with no setting.
3. **A quiet zone** round a resting thumb (`QUIET`, 30 px): small movements, slow drift and the bounce back
   after a swipe are ignored, so the robot does not stutter.
4. **The standard 15° lean** and **Match my thumb version 1**: twelve prompted swipes measure one lean for all
   four directions. Play-tested on a phone and worked well. Kept on the branch `match-my-thumb-v1` and in
   [MATCH-MY-THUMB-V1.md](MATCH-MY-THUMB-V1.md); never delete it.
5. **Match my thumb version 2**: twelve swipes to learn, eight more to test. It offers Before, One lean, and A lean
   per direction, and keeps the one that reads the test swipes best. Branch `match-my-thumb-v2`.
6. **A choice of swipe length** was tried and removed; the length is fixed.
7. **Right-thumb steering**: the whole layout mirrored, the standard lean mirrored, and each thumb keeps its own
   match.
8. **Turning**: a turn takes the next opening ahead and never doubles back past one by more than half a tile; the
   robot looks the way it was asked at once, and sets off from a standstill toward a block's side only after
   the direction has been held for 0.15 s (`LOOK_TICKS`).
9. **Settings › Controls shows the lean of the match in use** (16 November 2026), so a setting that feels right
   can be written down. That is how version 2 of the standard lean was found.
10. **Standard lean version 2** (16 November 2026): 2°, above.
11. **Standard lean version 3** (16 November 2026): 8°, above.
12. **Standard lean version 4** (16 November 2026): 5°, the owner's pick, above.
