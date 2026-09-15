import { Box, Text, useInput } from "ink";

export function PermissionDialog(props: {
  toolName: string;
  onRespond: (approved: boolean) => void;
}) {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") props.onRespond(true);
    if (key === "n") props.onRespond(false);
  });

  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text bold color="yellow">
        Permission required
      </Text>
      <Text>
        Allow tool <Text bold>{props.toolName}</Text>? [y/n]
      </Text>
    </Box>
  );
}
