# ADR-02: Tab owns focus, and region shortcuts never move it

**Status:** accepted
**Date:** 2026-09-15

## Context

The view is a column of regions. The state header, the description, and the timeline each draw a focus ring. A detail
pane covers the timeline while it is open. Two of the regions are scrollboxes, and a scrollbox handles its own
scrolling once focused.

Two kinds of key act on a region. Tab and shift-tab walk the focus ring. A per-region shortcut changes what the region
draws. `c` cycles the check list through summary, attention, and all. `d` expands and collapses the description.

`d` also moved the focus. Expanding set the focus to the description so the scrollbox could be scrolled without a
further press. `c` did nothing of the kind. The two shortcuts disagreed about what a shortcut may do.

The move was written as a side effect inside a state updater:

```js
setExpanded((was) => {
  if (!was) {
    setFocus("description");
  }

  return !was;
});
```

React runs a state updater once per queued update, not once per press. Holding the key batches several presses into one
render. The updater then ran several times, and the focus moved on every run that saw a collapsed region.

Measured on `cli/cli#14354`. Two presses delivered before a render left the description collapsed and the focus on it.
Four and six behaved the same way. The region looked untouched, so the focus had apparently moved on its own, and the
movement keys were gone from wherever the reader actually was.

## Decision

Tab and shift-tab are the only keys that move focus.

A shortcut that expands, collapses, or cycles a region changes that region's state and nothing else. It never moves
focus. That holds on expansion and on collapse alike.

A key handler carries no side effects. A state updater computes the next state from the previous one and does nothing
else. Work a press needs beyond updating one piece of state belongs in the handler body, which runs once per press
whatever React does with the batch.

The detail pane is not an exception to the focus rule. It is a mode rather than a region. `enter` opens it and `esc` or
`q` closes it, and those keys move focus because entering and leaving a mode is the whole of what they do.

## Rationale

Focus is where the reader is. A shortcut that moves it takes the movement keys away from a region the reader chose, in
answer to a press that was about something else. On the timeline that meant the cursor itself. Pressing `d` to glance
at the description stopped `j` and `k` from working.

One rule covers every region. A region added later inherits it without a fresh decision. The alternative is a
per-region judgement about whether a shortcut has earned a focus move. That is how `c` and `d` came to disagree in the
first place.

Pure updaters are less a second rule than the reason this one was hard to see. A side effect in an updater fires once
per queued update rather than once per press. It stays invisible until someone holds the key down. The bug reached a
user report rather than a test because every test pressed the key once.

The cost is real and small. Expanding the description leaves a scrollbox the reader cannot scroll until they press tab.
The region names the key on its border. Tab is one press.

## Consequences

Positive. Focus changes only in answer to a key whose whole job is changing focus, so it is predictable from the keymap
alone. `c` and `d` now behave alike. Holding a toggle key is safe, because an even number of presses is a no-op again.
The key handler has no ordering hazards between the pieces of state it sets.

Negative. Reaching a scrollable description takes two presses, `d` then tab. A future region that is only useful once
focused pays the same toll.

The rule constrains what a later region may be. A region that genuinely needs focus on open has to become a mode with
its own enter and leave keys, the way the detail pane is. It cannot be a region whose shortcut grabs focus.

## Alternatives Considered

Move focus on expand and restore it on collapse. Symmetric, reversible, and idempotent across repeats, so it does fix
the reported bug. Rejected because it still moves the reader unasked. It also needs a remembered origin region, which
every future shortcut would then have to maintain.

Move focus on expand only, with the side effect hoisted out of the updater. This is the smallest change that makes
repeats harmless. Rejected because it leaves `c` and `d` disagreeing. That disagreement is what made the behavior
surprising; the batching only decided when the surprise arrived.

Give the description its own enter and leave keys, like the detail pane. Consistent with the rule, but it spends a
second key and a mode on a region that is on screen either way.

## References

- PRW-001 (originating proposal), sections "Long and empty descriptions" and "Layout gate"
