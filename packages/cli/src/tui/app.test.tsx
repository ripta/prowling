import { type CapturedFrame, RGBA, rgbToHex } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { act } from "react";

import { fetchPullRequest, parsePullRequestRef, type PullRequest, withReplay } from "@prowling/core";

import { createFileRecorder } from "../recorder";
import { FIXTURES_DIR, readManifest } from "../record-fixtures";

import { App } from "./app";
import { DARK, LIGHT, type Palette } from "./theme";

const loaded = new Map<string, Promise<PullRequest>>();

function fixture(name: string): Promise<PullRequest> {
  let pending = loaded.get(name);

  if (pending === undefined) {
    pending = readManifest().then((manifest) => {
      const entry = manifest.find((candidate) => candidate.name === name);

      if (entry === undefined) {
        throw new Error(`no manifest entry named ${name}`);
      }

      return fetchPullRequest(withReplay(createFileRecorder(join(FIXTURES_DIR, name))), parsePullRequestRef(entry.ref));
    });

    loaded.set(name, pending);
  }

  return pending;
}

let destroy: (() => void) | undefined;

// Tearing the renderer down unmounts the tree, and React wants that update owned by a test.
afterEach(async () => {
  const teardown = destroy;
  destroy = undefined;

  await act(async () => {
    teardown?.();
  });
});

type Screen = {
  draw: () => string;
  press: (key: string) => Promise<void>;
  // Several presses delivered before a render, which is what holding a key down does. React batches
  // them into one pass, so a handler that is only correct once per render shows up here.
  hold: (key: string, times: number) => Promise<void>;
  // An actual arrow escape sequence. `press` sends its argument as literal characters, so a name
  // like "down" arrives as four keystrokes and scrolls nothing.
  arrow: (direction: "up" | "down") => Promise<void>;
  tab: () => Promise<void>;
  escape: () => Promise<void>;
};

// The timeline takes the rows the regions above it leave, so a test that wants to read more than a
// couple of its rows asks for a taller terminal.
const TALL = 60;

// The markdown renderable parses off the first frame and fills its text blocks after. Capturing
// without waiting reads blank rows where the prose goes, and only fenced code is drawn synchronously
// enough to survive it. So every frame this harness returns is taken after the parse has landed.
//
// How long that takes is load-dependent, so waiting a fixed span raced whenever the suite was busy.
// The harness redraws until two frames come out identical instead. Stability alone is not enough of
// a signal: the rows are blank before the parse starts, and blank is as steady as parsed. So a floor
// rules out a frame the parse has not reached yet, and the stability check covers a parse slower
// than the floor.
//
// Only a mount hands the renderable content it has not parsed before, so only a mount pays the
// floor. A key press redraws what is already parsed, and waiting out the floor on every one of them
// cost more than the whole suite.
const PARSE_SLICE_MS = 25;
const MOUNT_FLOOR_SLICES = 4;
const PRESS_FLOOR_SLICES = 1;
const PARSE_SLICES = 40;

type Renderer = Awaited<ReturnType<typeof testRender>>;

// Redraws until the frame comes out the same twice, so a capture taken after this reads the parsed
// content rather than the blank rows it leaves behind.
async function renderUntilStable(setup: Renderer, floor: number): Promise<void> {
  let previous = "";

  for (let slice = 0; slice < PARSE_SLICES; slice += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PARSE_SLICE_MS));
    });

    await setup.renderOnce();

    const drawn = setup.captureCharFrame();

    if (slice >= floor && drawn === previous) {
      return;
    }

    previous = drawn;
  }
}

async function mount(
  pullRequest: PullRequest,
  collapsedRows = 8,
  height = 40,
  onQuit: (code: number) => void = () => {},
): Promise<Screen> {
  const setup = await testRender(<App pullRequest={pullRequest} onQuit={onQuit} collapsedRows={collapsedRows} />, {
    width: 100,
    height,
  });

  destroy = () => setup.renderer.destroy();

  // A key press updates the React tree, so the test owns it the same way the teardown does.
  const settle = async (send: () => void, floor = PRESS_FLOOR_SLICES): Promise<void> => {
    await act(async () => {
      send();
    });

    await renderUntilStable(setup, floor);
  };

  await settle(() => {}, MOUNT_FLOOR_SLICES);

  return {
    draw: () => setup.captureCharFrame(),
    press: (key) => settle(() => setup.mockInput.pressKey(key)),
    hold: (key, times) =>
      settle(() => {
        for (let step = 0; step < times; step += 1) {
          setup.mockInput.pressKey(key);
        }
      }),
    arrow: (direction) => settle(() => setup.mockInput.pressArrow(direction)),
    tab: () => settle(() => setup.mockInput.pressTab()),
    escape: () => settle(() => setup.mockInput.pressEscape()),
  };
}

async function frame(pullRequest: PullRequest, collapsedRows = 8): Promise<string> {
  const screen = await mount(pullRequest, collapsedRows);

  return screen.draw();
}

async function timelineFrame(pullRequest: PullRequest): Promise<string> {
  const screen = await mount(pullRequest, 8, TALL);

  return screen.draw();
}

// Tab walks header, description, timeline.
async function onTimeline(pullRequest: PullRequest, onQuit?: (code: number) => void): Promise<Screen> {
  const screen = await mount(pullRequest, 8, TALL, onQuit);

  await screen.tab();
  await screen.tab();

  return screen;
}

describe("the state header", () => {
  // The count line is the whole check region until the reader asks for more. Twenty-one rows drawn
  // by default took a third of the viewport from the timeline.
  test("shows the decision, the threads, the reviewers, and the check counts alone", async () => {
    const drawn = await frame(await fixture("cli-cli-14429"));

    expect(drawn).toContain("APPROVED");
    expect(drawn).toContain("@niik");
    expect(drawn).toContain("21  10 stale · 11 passing");
    expect(drawn).toContain("state (collapsed, c to expand)");
    expect(drawn).not.toContain("build (macos-latest)");
  });

  // Nothing on this pull request needs acting on, so the cycle skips the attention state rather
  // than spending a press on a list that would draw nothing.
  test("c opens the full list when nothing needs attention, and closes it again", async () => {
    const screen = await mount(await fixture("cli-cli-14429"));

    await screen.press("c");

    expect(screen.draw()).toContain("build (macos-latest)");
    expect(screen.draw()).toContain("state (all, c to collapse)");

    await screen.press("c");

    expect(screen.draw()).not.toContain("build (macos-latest)");
  });

  // With something to act on, the cycle stops at the attention state first. It draws the failure
  // alone, so the row that matters is not sitting under twenty that do not.
  test("c stops at what needs attention before showing everything", async () => {
    const screen = await mount(withFailure(await fixture("cli-cli-14429"), "CodeQL"));

    await screen.press("c");

    expect(screen.draw()).toContain("state (attention, c for all)");
    expect(screen.draw()).toContain("CodeQL");
    expect(screen.draw()).not.toContain("build (macos-latest)");

    await screen.press("c");

    expect(screen.draw()).toContain("state (all, c to collapse)");
    expect(screen.draw()).toContain("build (macos-latest)");

    await screen.press("c");

    expect(screen.draw()).not.toContain("CodeQL");
  });

  test("marks a stale check with the revision it last ran on", async () => {
    const screen = await mount(await fixture("cli-cli-14429"));

    await screen.press("c");

    expect(screen.draw()).toContain("dc6221e, 1 back");
  });

  test("says so when a pull request has no checks", async () => {
    const drawn = await frame(await fixture("rust-lang-rust-137944"));

    expect(drawn).toContain("CHANGES_REQUESTED");
    expect(drawn).toContain("CONFLICTING");
    expect(drawn).toContain("checks   none");
  });
});

describe("the description", () => {
  test("clips to the given rows and says which key opens the rest", async () => {
    const pullRequest = await fixture("cli-cli-14354");
    const drawn = await frame(pullRequest, 8);

    expect(drawn).toContain("description (collapsed, d to expand)");
    expect(drawn).not.toContain("How did you test this change?");
  });

  test("d opens the rest, and the title then says which key closes it", async () => {
    const screen = await mount(await fixture("cli-cli-14354"), 8, TALL);

    await screen.press("d");

    expect(screen.draw()).toContain("description (expanded, d to collapse)");
    expect(screen.draw()).toContain("How did you test this change?");

    await screen.press("d");

    expect(screen.draw()).toContain("description (collapsed, d to expand)");
  });

  // Expansion ran through a state updater that moved the focus as a side effect. React runs that
  // updater once per queued press, so an even number of presses landed back on collapsed with the
  // focus moved anyway. The region then looked untouched and the movement keys were gone.
  test("d leaves the focus where it was, however many presses arrive at once", async () => {
    const screen = await mount(await fixture("cli-cli-14354"));

    await screen.hold("d", 2);

    expect(screen.draw()).toContain("description (collapsed, d to expand)");

    // The focus starts on the header, which puts the timeline two stops away. One stop reaches it
    // only if the description took the focus.
    await screen.tab();
    expect(screen.draw()).not.toContain("jk move");

    await screen.tab();
    expect(screen.draw()).toContain("jk move");
  });

  // `scrollY` is a constructor option with no setter, so a box built for the collapsed state has no
  // scroll range however the prop changes afterwards. The arrows then did nothing in a region whose
  // whole point is reading past the fold.
  test("the expanded description scrolls, and collapsing returns it to the top", async () => {
    const screen = await mount(await fixture("cli-cli-14354"), 8, TALL);

    await screen.tab();
    await screen.press("d");

    expect(screen.draw()).toContain("Depends on #14320.");

    await screen.arrow("down");
    await screen.arrow("down");

    expect(screen.draw()).not.toContain("Depends on #14320.");

    await screen.press("d");

    expect(screen.draw()).toContain("Depends on #14320.");
  });

  // The scroll range is there while collapsed too, so the bar would draw over a column the prose
  // needs. Hiding it is what keeps the collapsed region the width it reads at.
  test("keeps the collapsed region free of a scrollbar", async () => {
    const screen = await mount(await fixture("cli-cli-14354"), 8, TALL);
    const line = "a user account, so running";

    expect(screen.draw()).toContain(line);

    await screen.tab();
    await screen.press("d");

    expect(screen.draw()).not.toContain(line);

    await screen.press("d");

    expect(screen.draw()).toContain(line);
  });

  // What `bodyText` dropped. GitHub's flattening runs the paragraphs together and takes the heading
  // marker with the break above it, so the region read as one wall of prose.
  test("keeps the paragraph breaks and headings the web view shows", async () => {
    const pullRequest = await fixture("cli-cli-14354");
    const drawn = await frame(pullRequest, 8);
    const rows = drawn.split("\n").map((row) => row.replaceAll("│", "").trim());
    const heading = rows.indexOf("Description");

    expect(heading).toBeGreaterThan(0);
    expect(rows[heading - 1]).toBe("");
    expect(rows[heading + 1]).toBe("");
  });

  // A line that wraps claims rows the count never budgeted for, and the rows it overflows into get
  // drawn over. The result reads as two descriptions interleaved character by character.
  test("gives every collapsed line its own row, whatever its length", async () => {
    const pullRequest = await fixture("rust-lang-rust-137944");
    const drawn = await frame(pullRequest, 8);
    const first = pullRequest.bodyText.split("\n").find((line) => line.trim() !== "") ?? "";

    expect(first.length).toBeGreaterThan(100);
    expect(drawn).toContain(first.slice(0, 60));
  });

  test("shows a placeholder rather than an empty box", async () => {
    const pullRequest = await fixture("cli-cli-14349");
    const drawn = await frame({ ...pullRequest, body: "", bodyText: "" });

    expect(drawn).toContain("no description");
  });
});

describe("the timeline", () => {
  test("groups under revisions, naming the head, the pusher, and what it carried", async () => {
    const drawn = await timelineFrame(await fixture("cli-cli-14429"));

    expect(drawn).toContain("98cb293");
    expect(drawn).toContain("a9d9d84");
    expect(drawn).toContain("williammartin");
    expect(drawn).toContain("4 revisions");
  });

  // The last push usually lands after the last review, so the newest revision holds nothing on most
  // pull requests. Opening there opened on a bare row.
  test("opens the newest revision holding conversation and leaves the rest closed", async () => {
    const drawn = await timelineFrame(await fixture("cli-cli-14429"));

    expect(drawn).toContain("▾ dc6221e");
    expect(drawn).toContain("▸ 98cb293");
  });

  test("says how many items a revision holds before it is opened", async () => {
    const drawn = await timelineFrame(await fixture("cli-cli-14429"));

    expect(drawn).toContain("▸ 98cb293  09-11 12:17  williammartin  1 commit  1 item");
  });

  // A commit produces no entry, so a row saying "1 commit" and nothing else promised content that
  // opening it never showed. Two of this pull request's four revisions hold nothing.
  test("draws no glyph on a revision nobody commented on", async () => {
    const drawn = await timelineFrame(await fixture("cli-cli-14429"));

    expect(drawn).toContain("  a9d9d84  09-11 15:45  williammartin  1 commit");
    expect(drawn).not.toContain("▾ a9d9d84");
    expect(drawn).not.toContain("▸ a9d9d84");
    expect(drawn).not.toContain("▸ 26fc6d4");
  });

  test("says which push was a force-push", async () => {
    const drawn = await timelineFrame(await fixture("cli-cli-14349"));

    expect(drawn).toContain("force-push");
  });

  // Checks belong to the state header alone. Answering a check question here too read as a second
  // and contradictory answer to the one the header already gives per name.
  test("puts no check in the revision, however many ran on it", async () => {
    const drawn = await timelineFrame(await fixture("cli-cli-14429"));

    expect(drawn).not.toContain("✓ checks");
    expect(drawn).not.toContain("⚠ CodeQL");
  });

  test("opens a revision holding an unresolved thread, and says how many", async () => {
    const drawn = await timelineFrame(await fixture("cli-cli-14354"));

    expect(drawn).toContain("1 unresolved thread");
    expect(drawn).toContain("acceptance/user_capability_test.go:56");
    expect(drawn).toContain("unresolved, 1 reply");
  });

  test("renders reviews alongside the threads they arrived with", async () => {
    const drawn = await timelineFrame(await fixture("cli-cli-14354"));

    expect(drawn).toContain("● @babakks  APPROVED");
    expect(drawn).toContain("◆ @babakks");
  });

  // The placement decision: an issue comment reads in the revision it was written against, among
  // the code feedback, rather than in a section of its own.
  test("puts issue comments inline in the revision they fall in", async () => {
    const drawn = await timelineFrame(await fixture("rust-lang-rust-137944"));

    expect(drawn).toContain("◇ @bors");
    expect(drawn).toContain("◇ @rust-timer");
  });

  test("reports what it is holding off screen", async () => {
    const drawn = await timelineFrame(await fixture("rust-lang-rust-137944"));

    expect(drawn).toContain("66 revisions");
    expect(drawn).toMatch(/↑ \d+/);
  });
});

describe("moving around the timeline", () => {
  test("tab reaches it, and the hints say what it does", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14429"));

    expect(screen.draw()).toContain("jk move");
    expect(screen.draw()).toContain("np revision");
    expect(screen.draw()).toContain("▎▾ dc6221e");
  });

  test("j walks down into the items and k walks back out", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14354"));

    expect(screen.draw()).toContain("▎▾ 6dc60bf");

    await screen.press("j");
    expect(screen.draw()).toContain("▎  ◆ @copilot-pull-request-reviewer");

    await screen.press("k");
    expect(screen.draw()).toContain("▎▾ 6dc60bf");

    await screen.press("k");
    expect(screen.draw()).toContain("▎  f6e0d8f");
  });

  test("p moves to the revision before, and n comes back", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14429"));

    await screen.press("p");
    expect(screen.draw()).toContain("▎  26fc6d4");

    await screen.press("n");
    expect(screen.draw()).toContain("▎▾ dc6221e");
  });

  // Movement ran off the cursor the render closed over, and a held key batches its presses into one
  // render. Three arriving together moved the cursor a single revision.
  test("p moves once per press, however many arrive at once", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14354"));

    await screen.hold("p", 3);

    expect(screen.draw()).toContain("▎  4c88a2e");
  });

  test("enter opens the revision under the cursor and closes it again", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14429"));

    await screen.press("p");
    await screen.press("p");
    expect(screen.draw()).toContain("▎▸ 98cb293");

    await screen.press("\r");
    expect(screen.draw()).toContain("▎▾ 98cb293");

    await screen.press("\r");
    expect(screen.draw()).toContain("▎▸ 98cb293");
  });

  // The fallback the activate key takes when the cursor is on a revision rather than an item. A
  // revision holding nothing has no fold, so the key leaves the frame exactly as it found it.
  test("enter on a revision holding nothing leaves the frame alone", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14429"));

    await screen.press("p");

    const before = screen.draw();
    expect(before).toContain("▎  26fc6d4");

    await screen.press("\r");

    expect(screen.draw()).toBe(before);
  });

  // Expanding a revision sitting at the bottom edge drew every item it holds below the fold. The
  // glyph flipped, the footer's count moved, and nothing else on screen changed.
  test("expanding a revision at the bottom of the window brings its items into view", async () => {
    const screen = await onTimeline(await fixture("rust-lang-rust-137944"));

    await screen.press("\r");
    await onBottomRowHoldingItems(screen);
    await screen.press("\r");

    const rows = timelineRows(screen.draw());
    const at = rows.findIndex((row) => row.includes("▎"));

    expect(rows[at]).toContain("▾");
    expect(rows[at + 1]).toMatch(/[●◆◇] @/);
  });
});

// The timeline's own rows, between its border and its footer.
function timelineRows(frame: string): string[] {
  const rows = frame.split("\n");
  const top = rows.findIndex((row) => row.includes("─ timeline "));
  const footer = rows.findIndex((row) => row.includes(" revisions"));

  return rows.slice(top + 1, footer).map((row) => row.replaceAll("│", "").trimEnd());
}

// Walks the cursor down to a revision holding items that the window has drawn on its last row. That
// is the position where expanding has nowhere on screen to put what it opens.
async function onBottomRowHoldingItems(screen: Screen): Promise<void> {
  for (let step = 0; step < 80; step += 1) {
    const rows = timelineRows(screen.draw());
    const at = rows.findIndex((row) => row.includes("▎"));

    if (at === rows.length - 1 && / \d+ items?\b/.test(rows[at] ?? "")) {
      return;
    }

    await screen.press("n");
  }

  throw new Error("the cursor never reached a bottom row holding items");
}

// Walks the cursor down until the row it sits on matches, so a test says which item it wants rather
// than how many rows away the fixture happens to put it. The cursor starts on the revision the view
// opens on, and that revision's items run below it.
async function onRow(screen: Screen, match: string): Promise<void> {
  for (let step = 0; step < 40; step += 1) {
    if (screen.draw().includes(`▎  ${match}`)) {
      return;
    }

    await screen.press("j");
  }

  throw new Error(`no row matching ${match} under the cursor after 40 rows`);
}

describe("the detail pane", () => {
  test("enter opens the item under the cursor, and esc closes back to the timeline", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14354"));

    await onRow(screen, "◆ @babakks");
    await screen.press("\r");

    expect(screen.draw()).toContain("detail");
    expect(screen.draw()).toContain("esc close");

    await screen.escape();

    expect(screen.draw()).toContain("timeline");
    expect(screen.draw()).toContain("jk move");
  });

  // The pane used to close on q, which left the quit binding sitting behind it. The second press
  // then took the app down. Each press here gets its own render, which is what a reader pressing the
  // key again after seeing nothing happen does.
  test("q neither closes the pane nor leaves the app, however many times it is pressed", async () => {
    let left: number | undefined;
    const screen = await onTimeline(await fixture("cli-cli-14354"), (code) => {
      left = code;
    });

    await onRow(screen, "◆ @babakks");
    await screen.press("\r");

    for (let press = 0; press < 4; press += 1) {
      await screen.press("q");
    }

    expect(left).toBeUndefined();
    expect(screen.draw()).toContain("esc close");
  });

  test("renders the body it was opened on, keeping the shape bodyText drops", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14354"));

    await onRow(screen, "◆ @babakks");
    await screen.press("\r");

    const drawn = screen.draw();

    expect(drawn).toContain("◆ @babakks  acceptance/user_capability_test.go:56  unresolved, 1 reply");
    expect(drawn).toContain("# directive1:");
    expect(drawn).toContain("# rest of the file");
  });

  // Asserts on prose rather than on the fence. A fence draws on the frame the pane mounts on and the
  // prose waits on the highlight, so a fence-only assertion passes against a pane the renderer never
  // filled. That is what the first version of this test did.
  test("renders the prose around the fence, not just the fence", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14354"));

    await onRow(screen, "◆ @babakks");
    await screen.press("\r");

    expect(screen.draw()).toContain("nitpick:");
  });

  // The activate key opens whatever the cursor is on and only falls back to the group when there is
  // nothing there to open. Every item is openable, so it leaves the revision behind it alone.
  test("enter on an item opens the pane rather than closing its revision", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14429"));

    await screen.press("j");
    await screen.press("\r");

    expect(screen.draw()).toContain("esc close");

    await screen.escape();

    expect(screen.draw()).toContain("▎  ● @BagToad");
    expect(screen.draw()).toContain("▾ dc6221e");
  });
});

describe("leaving the app", () => {
  test("q quits from a region that is on screen", async () => {
    let left: number | undefined;
    const screen = await onTimeline(await fixture("cli-cli-14429"), (code) => {
      left = code;
    });

    await screen.press("q");

    expect(left).toBe(0);
  });
});

describe("the palette", () => {
  test("draws in the light foreground when the terminal reports a light background", async () => {
    const frame = await spans(await fixture("cli-cli-14429"), LIGHT);

    expect(fgOf(frame, "Fix remote branch deletion")).toBe(hex(LIGHT.text));
    expect(fgOf(frame, "APPROVED")).toBe(hex(LIGHT.ok));
  });

  test("draws in the dark foreground with no palette given", async () => {
    const frame = await spans(await fixture("cli-cli-14429"));

    expect(fgOf(frame, "Fix remote branch deletion")).toBe(hex(DARK.text));
  });

  // The markdown renderable does not inherit the foreground around it. Unregistered token styles
  // fall back to its own, which are built for a dark background and vanish on a light one.
  test("draws the description through the palette on either background", async () => {
    const light = await spans(await fixture("cli-cli-14354"), LIGHT);

    expect(fgOf(light, "Depends on #14320")).toBe(hex(LIGHT.text));
    expect(fgOf(light, "GitHub App installation tokens")).toBe(hex(LIGHT.text));
    expect(fgOf(light, "Description")).toBe(hex(LIGHT.text));

    const dark = await spans(await fixture("cli-cli-14354"), DARK);

    expect(fgOf(dark, "Depends on #14320")).toBe(hex(DARK.text));
  });
});

// The character frame carries no color, so a palette assertion reads the spans instead. Resolving
// happens in the component that draws the row, which makes what the span carries the only evidence
// the choice reached it.
async function spans(pullRequest: PullRequest, palette?: Palette): Promise<CapturedFrame> {
  const setup = await testRender(<App pullRequest={pullRequest} onQuit={() => {}} palette={palette} />, {
    width: 100,
    height: 40,
  });

  destroy = () => setup.renderer.destroy();

  await renderUntilStable(setup, MOUNT_FLOOR_SLICES);

  return setup.captureSpans();
}

function fgOf(frame: CapturedFrame, text: string): string {
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(text)) {
        return rgbToHex(span.fg);
      }
    }
  }

  throw new Error(`no span holding ${text}`);
}

// Both sides of the comparison go through the same conversion, so the assertion turns on the color
// rather than on how either side spells it.
function hex(color: string): string {
  return rgbToHex(RGBA.fromHex(color));
}

// The fixtures all pass their checks, so a failure has to be made. Flipping one conclusion leaves
// everything else about the recording alone.
function withFailure(pullRequest: PullRequest, name: string): PullRequest {
  return {
    ...pullRequest,
    commits: pullRequest.commits.map((commit) => ({
      ...commit,
      checkSuites: commit.checkSuites.map((suite) => ({
        ...suite,
        checks: suite.checks.map((check) =>
          check.name === name ? { ...check, conclusion: "FAILURE" as const } : check,
        ),
      })),
    })),
  };
}
