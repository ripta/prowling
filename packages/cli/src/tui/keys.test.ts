import { describe, expect, test } from "bun:test";

import { type Key, resolveAction } from "./keys";

function key(name: string, modifiers: Omit<Key, "name"> = {}): Key {
  return { name, ...modifiers };
}

describe("claimed keys", () => {
  test("q and ctrl-c quit", () => {
    expect(resolveAction(key("q"))).toBe("quit");
    expect(resolveAction(key("c", { ctrl: true }))).toBe("quit");
  });

  test("d toggles the description", () => {
    expect(resolveAction(key("d"))).toBe("toggle-description");
  });

  test("tab moves focus, and shift sends it back", () => {
    expect(resolveAction(key("tab"))).toBe("focus-next");
    expect(resolveAction(key("tab", { shift: true }))).toBe("focus-prev");
  });

  test("enter and space activate", () => {
    expect(resolveAction(key("return"))).toBe("activate");
    expect(resolveAction(key("enter"))).toBe("activate");
    expect(resolveAction(key("space"))).toBe("activate");
  });
});

describe("keys that reach the focused region", () => {
  // A scrollbox scrolls with these once it has focus. Claiming one here would take that away.
  const scrolling = ["up", "down", "left", "right", "j", "k", "h", "l", "pageup", "pagedown", "home", "end"];

  test.each(scrolling)("%s is left alone", (name) => {
    expect(resolveAction(key(name))).toBeUndefined();
  });

  test("an unbound letter is left alone", () => {
    expect(resolveAction(key("z"))).toBeUndefined();
  });

  test("a modifier makes a bound key someone else's, except ctrl-c", () => {
    expect(resolveAction(key("d", { ctrl: true }))).toBeUndefined();
    expect(resolveAction(key("q", { ctrl: true }))).toBeUndefined();
  });
});
