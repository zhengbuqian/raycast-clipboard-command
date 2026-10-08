import { spawn } from "node:child_process";
import { mkdir, chmod } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export type SessionRun = {
  id: string;
  command: string;
  status: "running" | "done";
  stdout: { text: string; truncated: boolean };
  stderr: { text: string; truncated: boolean };
  exitCode: number | null;
  signal: string | null;
  error?: string;
};

export type SessionState = {
  sessionId: string | null;
  cwd: string | null;
  running: boolean;
  expiresAt: number | null;
  run: SessionRun | null;
};

export type SessionOptions = {
  directory: string;
  daemonPath: string;
  idleMs?: number;
};

async function request(
  options: SessionOptions,
  message: object,
): Promise<SessionState> {
  return new Promise((resolve, reject) => {
    const connection = net.connect(
      path.join(options.directory, "session.sock"),
    );
    let received = "";
    connection.setEncoding("utf8");
    connection.setTimeout(3000, () =>
      connection.destroy(new Error("Session request timed out")),
    );
    connection.once("error", reject);
    connection.once("connect", () =>
      connection.write(JSON.stringify(message) + "\n"),
    );
    connection.on("data", (chunk) => {
      received += chunk;
      const newline = received.indexOf("\n");
      if (newline < 0) return;
      connection.end();
      try {
        const response = JSON.parse(received.slice(0, newline));
        if (!response.ok) return reject(new Error(response.error));
        resolve(response.state as SessionState);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function getSession(
  options: SessionOptions,
): Promise<SessionState | null> {
  try {
    return await request(options, { type: "status" });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ECONNREFUSED"
    ) {
      return null;
    }
    throw error;
  }
}

export async function runInSession(
  options: SessionOptions,
  command: string,
): Promise<SessionState> {
  if (!command.trim()) throw new Error("Command is empty");
  if (!(await getSession(options))) {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    await chmod(options.directory, 0o700);
    const daemon = spawn(
      process.execPath,
      [options.daemonPath, options.directory, String(options.idleMs ?? 30_000)],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    daemon.unref();
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await getSession(options)) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error("Could not start the background shell session");
  }
  return request(options, { type: "run", command });
}

export async function stopSession(
  options: SessionOptions,
): Promise<SessionState | null> {
  if (!(await getSession(options))) return null;
  return request(options, { type: "stop" });
}
