import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleEntries } from "../src/entry-selection";

const history = [
  { offset: 0, text: "echo ready" },
  { offset: 1, text: "printf 'long command tail'" },
];

test("matching history remains first while typed input is available", () => {
  assert.deepEqual(visibleEntries(history, "COMMAND TAIL", false), [
    history[1],
    { offset: -1, text: "COMMAND TAIL" },
  ]);
});

test("no match offers the unchanged search text as a command", () => {
  assert.deepEqual(visibleEntries(history, "  ls -la\n", false), [
    { offset: -1, text: "  ls -la\n" },
  ]);
});

test("blank text and loading state never offer a typed command", () => {
  assert.deepEqual(visibleEntries([], "  \n", false), []);
  assert.deepEqual(visibleEntries([], "ls", true), []);
});
