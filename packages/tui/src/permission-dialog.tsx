import { Box, Text, useInput } from "ink";
import { toolInvocationSummary } from "./format.ts";

export function PermissionDialog(props: {
  toolName: string;
  toolArguments?: Record<string, unknown>;
  onRespond: (approved: boolean) => void;
}) {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") props.onRespond(true);
    if (key === "n") props.onRespond(false);
  });

  const summary = toolInvocationSummary(
    props.toolName,
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
      <Text dimColor>Allow? [y/n]</Text>
    </Box>
  );
}
