import { Text } from "ink";
import type { StatusBarInput } from "./format.ts";
import { formatStatus } from "./format.ts";

export function StatusBar(props: StatusBarInput) {
  return <Text dimColor>{formatStatus(props)}</Text>;
}
