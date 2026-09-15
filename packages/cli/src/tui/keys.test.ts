import { describe, expect, test } from "bun:test";

import { hintsFor, type Key, REGIONS, type RegionId, resolveAction } from "./keys";

function key(name: string, modifiers: Omit<Key, "name"> = {}): Key {
  return { name, ...modifiers };
}

const regions: RegionId[] = [...REGIONS];
const scrolling: RegionId[] = ["header", "description"];

describe("keys that mean the same everywhere", () => {
  test.each(regions)("in %s", (region) => {
    expect(resolveAction(key("q"), region)).toBe("quit");
    expect(resolveAction(key("c", { ctrl: true }), region)).toBe("quit");
    expect(resolveAction(key("d"), region)).toBe("toggle-description");
    expect(resolveAction(key("tab"), region)).toBe("focus-next");
    expect(resolveAction(key("tab", { shift: true }), region)).toBe("focus-prev");
    expect(resolveAction(key("return"), region)).toBe("activate");
    expect(resolveAction(key("enter"), region)).toBe("activate");
    expect(resolveAction(key("space"), region)).toBe("activate");
  });

  test("a modifier makes a bound key someone else's, except ctrl-c", () => {
    expect(resolveAction(key("d", { ctrl: true }), "header")).toBeUndefined();
    expect(resolveAction(key("q", { ctrl: true }), "timeline")).toBeUndefined();
  });
});

describe("keys that reach a focused scrollbox", () => {
  // A scrollbox scrolls with these once it has focus. Claiming one there would take that away.
  const claimed = ["up", "down", "left", "right", "j", "k", "h", "l", "pageup", "pagedown", "home", "end"];

  test.each(scrolling)("%s leaves them alone", (region) => {
    for (const name of claimed) {
      expect(resolveAction(key(name), region)).toBeUndefined();
    }
  });

  test.each(regions)("an unbound letter is left alone in %s", (region) => {
    expect(resolveAction(key("z"), region)).toBeUndefined();
  });
});

describe("the timeline cursor", () => {
  test("arrows and jk move between items", () => {
    expect(resolveAction(key("down"), "timeline")).toBe("item-next");
    expect(resolveAction(key("j"), "timeline")).toBe("item-next");
    expect(resolveAction(key("up"), "timeline")).toBe("item-prev");
    expect(resolveAction(key("k"), "timeline")).toBe("item-prev");
  });

  test("n and p jump between revisions", () => {
    expect(resolveAction(key("n"), "timeline")).toBe("revision-next");
    expect(resolveAction(key("p"), "timeline")).toBe("revision-prev");
  });

  test.each(scrolling)("those keys mean nothing in %s", (region) => {
    expect(resolveAction(key("n"), region)).toBeUndefined();
    expect(resolveAction(key("p"), region)).toBeUndefined();
  });
});

describe("hints", () => {
  test("the timeline advertises its cursor, and a scrollbox its scrolling", () => {
    expect(hintsFor("timeline").map((hint) => hint.keys)).toContain("jk");
    expect(hintsFor("header").map((hint) => hint.keys)).toContain("↑↓");
    expect(hintsFor("header").map((hint) => hint.keys)).not.toContain("jk");
  });

  test.each(regions)("%s always offers a way out", (region) => {
    const keys = hintsFor(region).map((hint) => hint.keys);

    expect(keys).toContain("q");
    expect(keys).toContain("tab");
  });
});
