const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const directory = process.argv[2];
const idleMs = Number(process.argv[3] || 30_000);
const socketPath = path.join(directory, "session.sock");
const maxOutputBytes = 256_000;
if (!directory || !Number.isFinite(idleMs) || idleMs <= 0) process.exit(2);

fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
fs.chmodSync(directory, 0o700);

let shell;
let sessionId;
let cwd;
let current;
let lastRun;
let runDirectory;
let expiresAt;
let expiryTimer;
let controlBuffer = "";
let shuttingDown = false;

function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function stopProcessGroup(signal = "SIGTERM") {
  if (!shell?.pid || shell.exitCode !== null || shell.signalCode !== null) return;
  try {
    process.kill(-shell.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function clearExpiry() {
  clearTimeout(expiryTimer);
  expiryTimer = undefined;
  expiresAt = undefined;
}

function scheduleExpiry() {
  clearExpiry();
  expiresAt = Date.now() + idleMs;
  expiryTimer = setTimeout(shutdown, idleMs);
}

function removeRunDirectory() {
  if (runDirectory) fs.rmSync(runDirectory, { recursive: true, force: true });
  runDirectory = undefined;
}

function finish(result) {
  if (!current) return;
  lastRun = { ...current, status: "done", ...result };
  current = undefined;
  if (!shuttingDown) scheduleExpiry();
}

function handleControl(text) {
  controlBuffer += text;
  for (let newline = controlBuffer.indexOf("\n"); newline >= 0; newline = controlBuffer.indexOf("\n")) {
    const line = controlBuffer.slice(0, newline);
    controlBuffer = controlBuffer.slice(newline + 1);
    if (!current || !line.startsWith(current.marker + ":")) continue;
    const fields = line.slice(current.marker.length + 1);
    const separator = fields.indexOf(":");
    if (separator < 0) continue;
    const exitCode = Number(fields.slice(0, separator));
    cwd = fields.slice(separator + 1);
    finish({ exitCode, signal: null });
  }
}

function startShell() {
  if (shell) return;
  clearExpiry();
  sessionId = randomUUID();
  cwd = os.homedir();
  controlBuffer = "";
  const process = spawn("/bin/zsh", ["-l"], {
    cwd,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  shell = process;
  process.stdout.setEncoding("utf8");
  process.stdout.on("data", handleControl);
  process.stderr.resume();
  process.on("error", (error) => {
    if (current) finish({ exitCode: null, signal: null, error: error.message });
    if (shell === process) shell = undefined;
    scheduleExpiry();
  });
  process.on("close", (exitCode, signal) => {
    if (current) {
      finish({
        exitCode: null,
        signal,
        error: current.stopping ? "Stopped by user" : `Shell exited before command completed (${signal || exitCode})`,
      });
    }
    if (shell === process) shell = undefined;
    cwd = undefined;
    sessionId = undefined;
    if (!shuttingDown) scheduleExpiry();
  });
}

function readOutput(file) {
  if (!file) return { text: "", truncated: false };
  try {
    const size = fs.statSync(file).size;
    const descriptor = fs.openSync(file, "r");
    try {
      const data = Buffer.alloc(Math.min(size, maxOutputBytes));
      const length = fs.readSync(descriptor, data, 0, data.length, 0);
      return { text: data.subarray(0, length).toString("utf8"), truncated: size > maxOutputBytes };
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if (error.code === "ENOENT") return { text: "", truncated: false };
    throw error;
  }
}

function snapshot() {
  const run = current || lastRun;
  return {
    sessionId: shell ? sessionId : null,
    cwd: shell ? cwd : null,
    running: Boolean(current),
    expiresAt: current ? null : expiresAt || null,
    run: run
      ? {
          id: run.id,
          command: run.command,
          status: current ? "running" : "done",
          stdout: readOutput(run.stdoutPath),
          stderr: readOutput(run.stderrPath),
          exitCode: current ? null : run.exitCode,
          signal: current ? null : run.signal,
          error: current ? undefined : run.error,
        }
      : null,
  };
}

function startCommand(command) {
  if (current) throw new Error("A command is already running");
  if (typeof command !== "string" || !command.trim()) throw new Error("Command is empty");
  clearExpiry();
  removeRunDirectory();
  runDirectory = fs.mkdtempSync(path.join(directory, "run-"));
  fs.chmodSync(runDirectory, 0o700);
  const scriptPath = path.join(runDirectory, "command.zsh");
  const stdoutPath = path.join(runDirectory, "stdout");
  const stderrPath = path.join(runDirectory, "stderr");
  fs.writeFileSync(scriptPath, command, { mode: 0o600 });
  fs.writeFileSync(stdoutPath, "", { mode: 0o600 });
  fs.writeFileSync(stderrPath, "", { mode: 0o600 });
  if (!shell) startShell();
  const id = randomUUID();
  const marker = `__RCC_DONE_${id}__`;
  current = { id, marker, command, stdoutPath, stderrPath, stopping: false };
  lastRun = undefined;
  const instructions = [
    `builtin source ${quote(scriptPath)} </dev/null >${quote(stdoutPath)} 2>${quote(stderrPath)}`,
    "__rcc_exit_code=$?",
    `builtin print -r -- ${quote(marker + ":")}$__rcc_exit_code:$(builtin pwd -P)`,
    "",
  ].join("\n");
  shell.stdin.write(instructions);
  return snapshot();
}

function shutdown() {
  if (shuttingDown || current) return;
  shuttingDown = true;
  clearExpiry();
  stopProcessGroup();
  server.close();
  try {
    fs.unlinkSync(socketPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  removeRunDirectory();
  process.exit(0);
}

const server = net.createServer((connection) => {
  let input = "";
  connection.setEncoding("utf8");
  connection.on("data", (chunk) => {
    input += chunk;
    if (input.length > 2_000_000) return connection.destroy();
    const newline = input.indexOf("\n");
    if (newline < 0) return;
    const line = input.slice(0, newline);
    input = "";
    try {
      const request = JSON.parse(line);
      let state;
      switch (request.type) {
        case "status":
          state = snapshot();
          break;
        case "run":
          state = startCommand(request.command);
          break;
        case "stop":
          if (current) {
            current.stopping = true;
            stopProcessGroup();
          }
          state = snapshot();
          break;
        default:
          throw new Error("Unknown request");
      }
      connection.end(JSON.stringify({ ok: true, state }) + "\n");
    } catch (error) {
      connection.end(JSON.stringify({ ok: false, error: error.message }) + "\n");
    }
  });
});

server.on("error", (error) => {
  if (error.code !== "EADDRINUSE") throw error;
  const probe = net.connect(socketPath);
  probe.once("connect", () => {
    probe.end();
    process.exit(0);
  });
  probe.once("error", () => {
    fs.unlinkSync(socketPath);
    server.listen(socketPath);
  });
});
server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
process.on("SIGTERM", () => {
  if (current) {
    current.stopping = true;
    stopProcessGroup();
    current = undefined;
  }
  shutdown();
});
