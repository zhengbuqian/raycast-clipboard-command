import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  getSession,
  runInSession,
  stopSession,
  SessionOptions,
  SessionState,
} from "../src/session-client";

const daemonPath = path.resolve("assets/session-daemon.cjs");

async function waitFor(
  options: SessionOptions,
  predicate: (state: SessionState | null) => boolean,
  ms = 3000,
) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const state = await getSession(options);
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for session state");
}

test("keeps cwd and variables, survives client disconnect, and expires only after idle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "raycast-command-test-"));
  const options = { directory: path.join(root, "session"), daemonPath };
  const daemon = spawn(
    process.execPath,
    [daemonPath, options.directory, "500"],
    { stdio: "ignore" },
  );
  try {
    await waitFor(options, (state) => state !== null);
    await writeFile(path.join(root, "a"), "file content");

    const first = await runInSession(
      options,
      `cd '${root}'\nRCC_TEST_VAR=kept`,
    );
    assert.equal(first.running, true);
    const firstDone = await waitFor(
      options,
      (state) => state?.run?.id === first.run?.id && state?.running === false,
    );
    assert.equal(firstDone?.run?.exitCode, 0);
    assert.equal(firstDone?.cwd, await realpath(root));

    const second = await runInSession(
      options,
      "mv a b\nprintf '%s|' \"$RCC_TEST_VAR\"\ncat b",
    );
    const secondDone = await waitFor(
      options,
      (state) => state?.run?.id === second.run?.id && state?.running === false,
    );
    assert.equal(secondDone?.run?.exitCode, 0);
    assert.equal(secondDone?.run?.stdout.text, "kept|file content");
    assert.equal(secondDone?.run?.stderr.text, "");
    assert.equal(secondDone?.cwd, await realpath(root));

    const long = await runInSession(options, "sleep 0.7\nprintf 'done'");
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal((await getSession(options))?.running, true);
    const longDone = await waitFor(
      options,
      (state) => state?.run?.id === long.run?.id && state?.running === false,
    );
    assert.equal(longDone?.run?.stdout.text, "done");
    assert.ok(longDone?.expiresAt && longDone.expiresAt > Date.now());
    await waitFor(options, (state) => state === null, 2500);
  } finally {
    daemon.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
});

test("stop and shell exit reset the session before the next command", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "raycast-command-test-"));
  const options = { directory: path.join(root, "session"), daemonPath };
  const daemon = spawn(
    process.execPath,
    [daemonPath, options.directory, "1000"],
    { stdio: "ignore" },
  );
  try {
    await waitFor(options, (state) => state !== null);
    const long = await runInSession(options, "sleep 10");
    await assert.rejects(
      runInSession(options, "echo second"),
      /already running/,
    );
    await stopSession(options);
    const stopped = await waitFor(
      options,
      (state) => state?.run?.id === long.run?.id && state?.running === false,
    );
    assert.equal(stopped?.run?.error, "Stopped by user");

    const exit = await runInSession(options, "exit 4");
    const exited = await waitFor(
      options,
      (state) => state?.run?.id === exit.run?.id && state?.running === false,
    );
    assert.match(exited?.run?.error || "", /Shell exited/);

    const next = await runInSession(options, "pwd -P");
    const nextDone = await waitFor(
      options,
      (state) => state?.run?.id === next.run?.id && state?.running === false,
    );
    assert.equal(nextDone?.run?.exitCode, 0);
    assert.equal(nextDone?.run?.stdout.text.trim(), homedir());
  } finally {
    daemon.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
});

test("starts on demand and isolates output and exit status across runs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "raycast-command-test-"));
  const options: SessionOptions = {
    directory: path.join(root, "session"),
    daemonPath,
    idleMs: 500,
  };
  try {
    assert.equal(await getSession(options), null);
    const first = await runInSession(
      options,
      "printf 'first out'\nprintf 'first err' >&2\nexit_status=7\nreturn $exit_status",
    );
    const firstDone = await waitFor(
      options,
      (state) => state?.run?.id === first.run?.id && state?.running === false,
    );
    assert.equal(firstDone?.run?.exitCode, 7);
    assert.equal(firstDone?.run?.stdout.text, "first out");
    assert.equal(firstDone?.run?.stderr.text, "first err");

    const second = await runInSession(options, "printf 'second out'");
    const secondDone = await waitFor(
      options,
      (state) => state?.run?.id === second.run?.id && state?.running === false,
    );
    assert.equal(secondDone?.run?.exitCode, 0);
    assert.equal(secondDone?.run?.stdout.text, "second out");
    assert.equal(secondDone?.run?.stderr.text, "");
    assert.ok(secondDone?.expiresAt && secondDone.expiresAt > Date.now());
    await waitFor(options, (state) => state === null, 2500);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
