import type { ZoxEvent } from "@zox/contracts";
import type { createZoxClient } from "@zox/sdk";
import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useMemo, useRef, useState } from "react";
import { foldTool, formatToolExpanded } from "./format.ts";
import { PermissionDialog } from "./permission-dialog.tsx";
import { cycleSlashCompletion, parseSlash } from "./slash.ts";
import { executeSlash } from "./slash-actions.ts";
import { StatusBar } from "./status-bar.tsx";

type SessionHandle = Awaited<
  ReturnType<ReturnType<typeof createZoxClient>["sessions"]["create"]>
>;

type RunHandle = ReturnType<SessionHandle["send"]>;

export type TranscriptEntry =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      toolCallId: string;
      name: string;
      arguments?: Record<string, unknown>;
      ok?: boolean;
    }
  | { kind: "system"; id: string; text: string };

export type ZoxAppProps = {
  client: ReturnType<typeof createZoxClient>;
  session: SessionHandle;
  workspaceRoot: string;
  sessionDefaults: { agent?: string; model?: string };
};

function nextId(prefix: string, counter: { n: number }): string {
  counter.n += 1;
  return `${prefix}-${counter.n}`;
}

export function ZoxApp(props: ZoxAppProps) {
  const { exit } = useApp();
  const idCounter = useRef({ n: 0 });
  const [session, setSession] = useState(props.session);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(
    () => new Set(),
  );
  const [input, setInput] = useState("");
  const [slashCycleIndex, setSlashCycleIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<{
    requestId: string;
    toolName: string;
    toolArguments?: Record<string, unknown>;
    run: RunHandle;
  } | null>(null);
  const [status, setStatus] = useState({
    model: props.sessionDefaults.model ?? "default",
    agent: props.sessionDefaults.agent ?? "build",
    cwd: props.workspaceRoot,
    contextEstimated: 0,
    contextWindow: 128_000,
    contextWindowKnown: false,
    inputTokens: 0,
    outputTokens: 0,
    activeSkills: [] as string[],
  });

  const appendEntry = useCallback((entry: TranscriptEntry) => {
    setEntries((prev) => [...prev, entry]);
  }, []);

  const patchTool = useCallback(
    (toolCallId: string, patch: { ok?: boolean; name?: string }) => {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.kind === "tool" && entry.toolCallId === toolCallId
            ? { ...entry, ...patch }
            : entry,
        ),
      );
    },
    [],
  );

  const handleEvent = useCallback(
    async (event: ZoxEvent, run: RunHandle) => {
      if (event.type === "message.delta" && event.delta) {
        setEntries((prev) => {
          const last = prev[prev.length - 1];
          if (last?.kind === "assistant") {
            return prev.map((entry, index) =>
              index === prev.length - 1 && entry.kind === "assistant"
                ? { ...entry, text: entry.text + event.delta }
                : entry,
            );
          }
          const id = nextId("assistant", idCounter.current);
          return [...prev, { kind: "assistant", id, text: event.delta }];
        });
      }
      if (event.type === "tool.started") {
        appendEntry({
          kind: "tool",
          id: nextId("tool", idCounter.current),
          toolCallId: event.toolCallId,
          name: event.name,
          arguments: event.arguments,
        });
      }
      if (event.type === "tool.completed") {
        patchTool(event.toolCallId, { ok: event.ok, name: event.name });
      }
      if (event.type === "context.estimated") {
        setStatus((prev) => ({
          ...prev,
          contextEstimated: event.estimatedTokens,
          contextWindow: event.windowTokens,
          contextWindowKnown: event.windowKnown,
        }));
      }
      if (event.type === "usage.turn" || event.type === "usage.session") {
        setStatus((prev) => ({
          ...prev,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          model: event.type === "usage.turn" ? event.model : prev.model,
        }));
      }
      if (event.type === "tool.permission_required") {
        setPermission({
          requestId: event.requestId,
          toolName: event.name,
          toolArguments: event.arguments,
          run,
        });
      }
      if (event.type === "skills.changed") {
        setStatus((prev) => ({
          ...prev,
          activeSkills: event.active,
        }));
      }
      if (event.type === "error") {
        appendEntry({
          kind: "system",
          id: nextId("system", idCounter.current),
          text: event.message,
        });
      }
    },
    [appendEntry, patchTool],
  );

  const runTurn = useCallback(
    async (content: string) => {
      setBusy(true);
      appendEntry({
        kind: "user",
        id: nextId("user", idCounter.current),
        text: content,
      });
      const run = session.send(content);
      try {
        for await (const event of run.events()) {
          await handleEvent(event, run);
        }
        const names = await session.skills.active();
        setStatus((prev) => ({ ...prev, activeSkills: names }));
      } finally {
        setBusy(false);
      }
    },
    [appendEntry, handleEvent, session],
  );

  const submitInput = useCallback(async () => {
    const text = input.trimEnd();
    setInput("");
    setSlashCycleIndex(0);
    if (!text.trim()) return;

    const slash = parseSlash(text);
    if (slash) {
      let current = session;
      await executeSlash(slash, {
        client: props.client,
        getSession: () => current,
        setSession: (next) => {
          current = next;
          setSession(next);
          setEntries([]);
        },
        workspaceRoot: props.workspaceRoot,
        sessionDefaults: props.sessionDefaults,
        onOutput: (line) => {
          appendEntry({
            kind: "system",
            id: nextId("system", idCounter.current),
            text: line,
          });
        },
        onExit: () => exit(),
      });
      if (
        slash.name === "skill" ||
        slash.name === "skills" ||
        slash.name === "clear"
      ) {
        const names = await current.skills.active();
        setStatus((prev) => ({ ...prev, activeSkills: names }));
      }
      return;
    }

    await runTurn(text);
  }, [
    appendEntry,
    exit,
    input,
    props.client,
    props.sessionDefaults,
    props.workspaceRoot,
    runTurn,
    session,
  ]);

  useInput(
    (char, key) => {
      if (permission) return;
      if (busy) return;

      if (key.tab && input.startsWith("/")) {
        const { next, index } = cycleSlashCompletion(input, slashCycleIndex);
        setInput(next);
        setSlashCycleIndex(index);
        return;
      }

      if (key.return && key.shift) {
        setInput((prev) => `${prev}\n`);
        return;
      }

      if (key.return) {
        if (input.endsWith("\\")) {
          setInput((prev) => `${prev.slice(0, -1)}\n`);
          return;
        }
        void submitInput();
        return;
      }

      if (char === "o" && input === "") {
        setExpandedTools((prev) => {
          const tools = entries.filter((e) => e.kind === "tool");
          const last = tools[tools.length - 1];
          if (last?.kind !== "tool") return prev;
          const next = new Set(prev);
          if (next.has(last.toolCallId)) next.delete(last.toolCallId);
          else next.add(last.toolCallId);
          return next;
        });
        return;
      }

      if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      if (char && !key.ctrl && !key.meta) {
        setInput((prev) => prev + char);
      }
    },
    { isActive: !permission },
  );

  const transcript = useMemo(
    () =>
      entries.map((entry) => {
        if (entry.kind === "user") {
          return (
            <Text key={entry.id} color="cyan">
              {">"} {entry.text}
            </Text>
          );
        }
        if (entry.kind === "assistant") {
          return <Text key={entry.id}>{entry.text}</Text>;
        }
        if (entry.kind === "tool") {
          const folded = foldTool(entry.name, entry.ok, entry.arguments);
          const expanded = expandedTools.has(entry.toolCallId);
          return (
            <Box key={entry.id} flexDirection="column">
              <Text color="yellow" dimColor={entry.ok === false}>
                {folded}
              </Text>
              {expanded && entry.arguments ? (
                <Text dimColor wrap="wrap">
                  {formatToolExpanded(entry.name, entry.arguments)}
                </Text>
              ) : null}
            </Box>
          );
        }
        return (
          <Text key={entry.id} color="gray">
            {entry.text}
          </Text>
        );
      }),
    [entries, expandedTools],
  );

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {transcript}
      </Box>
      {permission ? (
        <PermissionDialog
          toolName={permission.toolName}
          toolArguments={permission.toolArguments}
          onRespond={(approved) => {
            const pending = permission;
            setPermission(null);
            void pending.run
              .respondPermission(pending.requestId, { approved })
              .catch((err: unknown) => {
                appendEntry({
                  kind: "system",
                  id: nextId("system", idCounter.current),
                  text: err instanceof Error ? err.message : String(err),
                });
              });
          }}
        />
      ) : null}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text>{input}</Text>
        <Text dimColor>{busy ? " …" : "█"}</Text>
      </Box>
      <StatusBar {...status} />
    </Box>
  );
}
