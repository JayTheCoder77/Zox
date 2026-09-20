import { Box, Text, useInput } from "ink";
import { toolInvocationSummary } from "./format.ts";

export function PermissionDialog(props: {
  kind?: "tool" | "prompt";
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  onRespond: (approved: boolean) => void;
}) {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") props.onRespond(true);
    if (key === "n") props.onRespond(false);
  });

  const promptAsk = props.kind === "prompt";
  const summary = promptAsk
    ? "Submit this prompt anyway?"
    : toolInvocationSummary(
        props.toolName ?? "tool",
        props.toolArguments ?? {},
      );

  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color="yellow">
        Permission required
      </Text>
      <Text>{summary}</Text>
      <Text dimColor>
        {promptAsk ? "Submit anyway? [y/n]" : "Allow? [y/n]"}
      </Text>
    </Box>
  );
}
