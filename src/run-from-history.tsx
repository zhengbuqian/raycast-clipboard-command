import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  List,
  Toast,
  environment,
  showToast,
} from "@raycast/api";
import { homedir } from "node:os";
import path from "node:path";
import { useEffect, useState } from "react";
import { Entry, visibleEntries } from "./entry-selection";
import {
  getSession,
  runInSession,
  SessionOptions,
  SessionRun,
  SessionState,
  stopSession,
} from "./session-client";

const sessionOptions: SessionOptions = {
  directory: path.join(
    homedir(),
    "Library",
    "Application Support",
    "raycast-clipboard-command",
  ),
  daemonPath: path.join(environment.assetsPath, "session-daemon.cjs"),
};

function codeBlock(text: string, language = "") {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(text.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function outputMarkdown(run: SessionRun) {
  const stdout = run.stdout.text;
  const stderr = run.stderr.text;
  const truncation =
    run.stdout.truncated || run.stderr.truncated
      ? "_Output truncated at 256,000 bytes per stream._"
      : "";
  if (
    run.status === "done" &&
    run.exitCode === 0 &&
    !run.error &&
    !run.signal
  ) {
    return [
      stdout ? codeBlock(stdout) : "_Completed_",
      stderr ? `**Standard error**\n\n${codeBlock(stderr)}` : "",
      truncation,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const status =
    run.status === "running"
      ? "Running…"
      : run.error ||
        (run.signal ? `Stopped (${run.signal})` : `Exit code: ${run.exitCode}`);
  return [
    codeBlock(run.command, "sh"),
    `**${status}**`,
    stdout ? codeBlock(stdout) : "",
    stderr ? `**Standard error**\n\n${codeBlock(stderr)}` : "",
    truncation,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export default function RunFromHistory() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [searchText, setSearchText] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [session, setSession] = useState<SessionState | null>(null);
  const [sessionError, setSessionError] = useState<string>();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let mounted = true;
    let polling = false;
    async function refresh() {
      if (polling) return;
      polling = true;
      try {
        const state = await getSession(sessionOptions);
        if (mounted) {
          setSession(state);
          setSessionError(undefined);
          setNow(Date.now());
        }
      } catch (cause) {
        if (mounted)
          setSessionError(
            cause instanceof Error ? cause.message : String(cause),
          );
      } finally {
        polling = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  async function start(entry: Entry) {
    if (session?.running) return;
    try {
      const state = await runInSession(sessionOptions, entry.text);
      setSession(state);
      setSelectedItemId(String(entry.offset));
    } catch (cause) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not run command",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  async function stop() {
    try {
      setSession(await stopSession(sessionOptions));
    } catch (cause) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not stop command",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  async function loadHistory() {
    setLoading(true);
    setError(undefined);
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, offset) =>
          Clipboard.readText({ offset }),
        ),
      );
      const available = results.flatMap((result, offset): Entry[] => {
        if (result.status !== "fulfilled" || !result.value?.trim()) return [];
        return [{ offset, text: result.value }];
      });
      setEntries(available);
      if (results.every((result) => result.status === "rejected")) {
        setError("Raycast could not read clipboard history.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  const shownEntries = visibleEntries(entries, searchText, loading);
  const lastRun = session?.run;
  if (
    lastRun &&
    !shownEntries.some((entry) => entry.text === lastRun.command)
  ) {
    shownEntries.push({ offset: -2, text: lastRun.command });
  }
  const navigationTitle = session?.sessionId
    ? `Shell: ${session.cwd} · ${session.running ? "Running" : `${Math.max(0, Math.ceil(((session.expiresAt || now) - now) / 1000))}s left`}`
    : "Shell: no active session";

  return (
    <List
      isLoading={loading}
      isShowingDetail
      navigationTitle={navigationTitle}
      filtering={false}
      searchText={searchText}
      onSearchTextChange={(text) => {
        setSearchText(text);
        setSelectedItemId(undefined);
      }}
      selectedItemId={selectedItemId}
      onSelectionChange={(id) => setSelectedItemId(id ?? undefined)}
      searchBarPlaceholder="Search history or type a command"
    >
      {shownEntries.length === 0 && !loading && (
        <List.EmptyView
          title={sessionError ?? error ?? "No recent text entries"}
          description="Copy a shell command, then reopen this command."
          actions={
            <ActionPanel>
              <Action
                title="Refresh History"
                icon={Icon.ArrowClockwise}
                onAction={loadHistory}
              />
            </ActionPanel>
          }
        />
      )}
      {shownEntries.map((entry) => {
        const summary = entry.text.replace(/\s+/g, " ").trim();
        const isCurrentRun = lastRun?.command === entry.text;
        const isTyped = entry.offset === -1;
        const isSession = entry.offset === -2;
        return (
          <List.Item
            key={entry.offset}
            id={String(entry.offset)}
            title={
              isTyped
                ? "Run Typed Command"
                : isSession
                  ? "Last Session Command"
                  : summary.slice(0, 100)
            }
            subtitle={
              isTyped || isSession
                ? summary.slice(0, 100)
                : `History ${entry.offset + 1}`
            }
            icon={Icon.Terminal}
            keywords={[entry.text]}
            detail={
              <List.Item.Detail
                markdown={
                  isCurrentRun
                    ? outputMarkdown(lastRun)
                    : codeBlock(entry.text, "sh")
                }
                isLoading={isCurrentRun && session?.running}
              />
            }
            actions={
              <ActionPanel>
                {!session?.running && (
                  <Action
                    title="Run as Command"
                    icon={Icon.Play}
                    onAction={() => void start(entry)}
                  />
                )}
                {!session?.running && Boolean(searchText.trim()) && (
                  <Action
                    title="Run Typed Command"
                    icon={Icon.Terminal}
                    shortcut={{ modifiers: ["cmd"], key: "return" }}
                    onAction={() =>
                      void start({ offset: -1, text: searchText })
                    }
                  />
                )}
                {session?.running && (
                  <Action
                    title="Stop Command"
                    icon={Icon.Stop}
                    onAction={() => void stop()}
                  />
                )}
                {isCurrentRun && lastRun.stdout.text && (
                  <Action
                    title="Copy Standard Output"
                    icon={Icon.Clipboard}
                    onAction={() => {
                      void Clipboard.copy(lastRun.stdout.text).catch((cause) =>
                        showToast({
                          style: Toast.Style.Failure,
                          title: "Could not copy output",
                          message:
                            cause instanceof Error
                              ? cause.message
                              : String(cause),
                        }),
                      );
                    }}
                  />
                )}
                <Action
                  title="Refresh History"
                  icon={Icon.ArrowClockwise}
                  onAction={loadHistory}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
