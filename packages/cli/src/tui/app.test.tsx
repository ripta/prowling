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
  tab: () => Promise<void>;
};

// The timeline takes the rows the regions above it leave, so a test that wants to read more than a
// couple of its rows asks for a taller terminal.
const TALL = 60;

// The markdown renderable parses off the first frame and fills its text blocks after. Capturing
// without waiting reads blank rows where the prose goes, and only fenced code is drawn synchronously
// enough to survive it. So every frame this harness returns is taken after the parse has landed.
const PARSE_MS = 50;

async function mount(pullRequest: PullRequest, collapsedRows = 8, height = 40): Promise<Screen> {
  const setup = await testRender(<App pullRequest={pullRequest} onQuit={() => {}} collapsedRows={collapsedRows} />, {
    width: 100,
    height,
  });

  destroy = () => setup.renderer.destroy();

  // A key press updates the React tree, so the test owns it the same way the teardown does.
  const settle = async (send: () => void): Promise<void> => {
    await act(async () => {
      send();
      await new Promise((resolve) => setTimeout(resolve, PARSE_MS));
    });

    await setup.renderOnce();
  };

  await settle(() => {});

  return {
    draw: () => setup.captureCharFrame(),
    press: (key) => settle(() => setup.mockInput.pressKey(key)),
    tab: () => settle(() => setup.mockInput.pressTab()),
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
async function onTimeline(pullRequest: PullRequest): Promise<Screen> {
  const screen = await mount(pullRequest, 8, TALL);

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
    expect(drawn).not.toContain("build (macos-latest)");
  });

  // Nothing on this pull request needs acting on, so the cycle skips the attention state rather
  // than spending a press on a list that would draw nothing.
  test("c opens the full list when nothing needs attention, and closes it again", async () => {
    const screen = await mount(await fixture("cli-cli-14429"));

    await screen.press("c");

    expect(screen.draw()).toContain("build (macos-latest)");
    expect(screen.draw()).toContain("[all]");

    await screen.press("c");

    expect(screen.draw()).not.toContain("build (macos-latest)");
  });

  // With something to act on, the cycle stops at the attention state first. It draws the failure
  // alone, so the row that matters is not sitting under twenty that do not.
  test("c stops at what needs attention before showing everything", async () => {
    const screen = await mount(withFailure(await fixture("cli-cli-14429"), "CodeQL"));

    await screen.press("c");

    expect(screen.draw()).toContain("[attention]");
    expect(screen.draw()).toContain("CodeQL");
    expect(screen.draw()).not.toContain("build (macos-latest)");

    await screen.press("c");

    expect(screen.draw()).toContain("[all]");
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

    expect(drawn).toContain("… d to expand");
    expect(drawn).not.toContain("How did you test this change?");
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

  test("opens the newest revision and leaves the rest closed", async () => {
    const drawn = await timelineFrame(await fixture("cli-cli-14429"));

    expect(drawn).toContain("▾ a9d9d84");
    expect(drawn).toContain("▸ 98cb293");
    expect(drawn).toContain("▸ dc6221e");
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
    expect(screen.draw()).toContain("▎▾ a9d9d84");
  });

  test("k walks back through the items and j returns", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14354"));

    await screen.press("k");
    expect(screen.draw()).toContain("▎  ● @babakks  APPROVED");

    await screen.press("j");
    expect(screen.draw()).toContain("▎▾ 7901e7e");
  });

  test("p moves to the revision before, and n comes back", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14429"));

    await screen.press("p");
    expect(screen.draw()).toContain("▎▸ dc6221e");

    await screen.press("n");
    expect(screen.draw()).toContain("▎▾ a9d9d84");
  });

  test("enter opens the revision under the cursor and closes it again", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14429"));

    await screen.press("p");
    await screen.press("\r");
    expect(screen.draw()).toContain("▎▾ dc6221e");

    await screen.press("\r");
    expect(screen.draw()).toContain("▎▸ dc6221e");
  });

  // Closing a revision takes its items away, so a cursor left inside one would point at a row that
  // no longer exists.
  test("closing a revision from inside it brings the cursor back to its header", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14429"));

    await screen.press("j");
    await screen.press("\r");

    expect(screen.draw()).toContain("▎▸ a9d9d84");
  });
});

// Walks the cursor up until it is sitting on a row the pane can open, so a test says which item it
// wants rather than how many rows away the fixture happens to put it. The cursor starts on the
// newest revision, which is the last one, so everything else is above it.
async function onEntry(screen: Screen, glyph: string): Promise<void> {
  for (let step = 0; step < 40; step += 1) {
    if (screen.draw().includes(`▎  ${glyph} `)) {
      return;
    }

    await screen.press("k");
  }

  throw new Error(`no ${glyph} row under the cursor after 40 rows`);
}

describe("the detail pane", () => {
  // Closing is driven with q here rather than esc. The mock input delivers no escape the hook can
  // see, so the esc binding is covered in the key map's own test instead.
  test("enter opens the item under the cursor, and q closes back to the timeline", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14354"));

    await onEntry(screen, "◆");
    await screen.press("\r");

    expect(screen.draw()).toContain("detail");
    expect(screen.draw()).toContain("esc/q close");

    await screen.press("q");

    expect(screen.draw()).toContain("timeline");
    expect(screen.draw()).toContain("jk move");
  });

  test("renders the body it was opened on, keeping the shape bodyText drops", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14354"));

    await onEntry(screen, "◆");
    await screen.press("\r");

    const drawn = screen.draw();

    expect(drawn).toContain("◆ @babakks  acceptance/user_capability_test.go:56  unresolved, 1 reply");
    expect(drawn).toContain("# directive1:");
    expect(drawn).toContain("# rest of the file");
  });

  // The pane opens on a key press, so its body reaches the renderable after the first frame. The
  // renderable parses that content and never asks for the redraw that would show it, so everything
  // but the fenced block draws blank. The description does not hit this: its content is there from
  // the first frame.
  //
  // Reproduced with `<markdown>` alone, so it is not this view's layout. A forced second render
  // pass does flush it, which is the shape a fix would take.
  test.todo("renders the prose around the fence, not just the fence", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14354"));

    await onEntry(screen, "◆");
    await screen.press("\r");

    expect(screen.draw()).toContain("nitpick:");
  });

  // A checks entry counts runs and holds no prose, so the key falls back to closing the group.
  test("enter on a checks row closes its revision instead of opening a pane", async () => {
    const screen = await onTimeline(await fixture("cli-cli-14429"));

    await screen.press("j");
    await screen.press("\r");

    expect(screen.draw()).toContain("▎▸ a9d9d84");
    expect(screen.draw()).not.toContain("esc/q close");
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

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, PARSE_MS));
  });
  await setup.renderOnce();

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
