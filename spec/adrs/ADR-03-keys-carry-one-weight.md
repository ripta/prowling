# ADR-03: Keys carry one weight, and consequential ones are never shared

**Status:** accepted
**Date:** 2026-09-15

## Context

The key map resolves a press against the focused region, so one key can mean different things in different places. `q`
took that further than the rest. In the header, the description, and the timeline it quit the app. In the detail pane
it closed the pane, which is the pager idiom.

Closing the pane also moves the focus back to the timeline. So the press after the one that closed it resolved against
the timeline instead, and `q` meant quit again. Two presses dismissed the pane and left the app. A reader who presses a
dismiss key twice, because the first press appeared to do nothing, or because the pane was one of several things they
were closing, loses the session.

The pane names the key on its own status bar, which read `esc/q close`. Nothing on that bar said the second press was a
different key entirely.

The viewer is read-only today, so the cost of that is a relaunch. It will not stay read-only. Approving, commenting, and
merging are the obvious next things a pull request view does, and each is visible outside the terminal and not
reversible from inside it. A key map that lets a repeated press escalate is a worse problem with those in it.

## Decision

Every action the key map can produce carries a weight:

1. **Movement.** Focus and the timeline cursor. Changes nothing but where the reader is.
2. **View state.** What a region draws. Reversible with the same key.
3. **Mode.** Entering and leaving the detail pane. Reversible with the key the mode names.
4. **Leaving.** Ending the session.
5. **Writing.** Anything that reaches GitHub. None exist yet.

Weights 1 through 3 are reversible, stay inside the app, and are invisible from outside it. Weights 4 and 5 are not.
That is the line, and no key crosses it.

A key bound to a reversible action is bound to reversible actions everywhere, or to nothing. A key bound to leaving or
writing is bound to that alone, in every region, and shares with nothing. `q` leaves. `esc` dismisses. Neither takes on
the other's job anywhere, so `q` now means nothing inside the detail pane.

A press never reaches past what the first press did. That follows from the rule rather than needing its own mechanism.
A reversible key repeats a reversible action. A leaving key has already left.

A write key, when one is needed, is chosen from keys bound to nothing and follows the same rule. It does not double as
a dismissal, a toggle, or a movement key in any region.

## Rationale

The surprise is not that `q` had two meanings. `enter` has several, and nobody is surprised by them, because each one
acts on what the cursor is sitting on and each is undone by a key the resulting screen names. The surprise is that one
of `q`'s meanings was reversible and the other ended the session, and that the reader crossed between them without
doing anything but pressing the same key again.

Weighting by consequence is what makes that statable as a rule. A per-key judgement about whether a particular overload
is confusing is the same kind of judgement that let `c` and `d` disagree about focus, and it gives a later key no
guidance at all.

The pager idiom is a real loss. `q` closing a pager is decades old, and readers reach for it. It is worth giving up
because the idiom assumes the pager is the program. Here the pane is one screen inside a session, and the key that ends
the pager and the key that ends the session cannot be the same one without reintroducing exactly this bug.

Exit stays a single unguarded press. A confirmation prompt would guard a cheap mistake at the cost of a press on every
intentional exit, and it adds a modal state of its own. The guard belongs with the actions that need one, and those do
not exist yet.

## Consequences

Positive. No sequence of presses reaches quit except one that starts with `q`. The detail pane's hints read `esc close`
and offer no key that would end the session. When write actions arrive, the rule for choosing their keys is already
written, and the audit is a table lookup rather than a fresh argument.

Negative. `q` in the detail pane does nothing, and a reader with pager habits will press it and see no response before
reading the hint bar. Leaving from inside the pane takes `esc` then `q`, or ctrl-c.

The rule constrains later keys more than later regions. A region is free to bind whatever reversible keys it wants. An
action heavier than a mode costs a key that nothing else may use, and there are not many single letters left.

Ctrl-C is unaffected. It leaves from everywhere including the pane, it is bound to nothing else, and it is a chord
rather than a letter, so no habit of repeating a letter reaches it.

## Alternatives Considered

Make `q` quit from the detail pane too, so it means exit with no exception anywhere. Simplest reading of the rule, and
repeats are harmless under it because the first press already left. Rejected because it turns the pager habit into a
loaded gun. The reader who presses `q` to dismiss a pane loses the session on the first press rather than the second,
which is worse than what was reported.

Ignore a repeated press within some interval of the state change it caused. Fixes the reported sequence without
touching the key map. Rejected because it makes the safety a timing property. The same two presses spaced further apart
still quit, and the rule cannot be read off the key map.

Confirm before quitting. Guards the mistake wherever it comes from, and a repeated `q` is inert at the prompt.
Rejected for now because it charges every intentional exit for a mistake that costs a relaunch. It becomes worth
revisiting when a key can write, and that is where the guard belongs.

Keep `q` on both jobs and rename the hint so the pane reads `q close (again to quit)`. Rejected because it documents
the hazard instead of removing it, and the documentation is on the screen the reader is leaving.

## References

- ADR-02: the detail pane is a mode rather than a region, and its enter and leave keys move focus. This narrows which
  keys those are, from `esc` or `q` to `esc` alone. The focus rule itself is untouched.
- PRW-001 (originating proposal). Its Decision Log records the region-aware key map on 2026-09-14.
</content>
