import { render } from "ink";
import { ZoxApp, type ZoxAppProps } from "./app.tsx";

export { type TranscriptEntry, ZoxApp, type ZoxAppProps } from "./app.tsx";
export { foldTool, formatStatus, type StatusBarInput } from "./format.ts";
export { PermissionDialog } from "./permission-dialog.tsx";
export { StatusBar } from "./status-bar.tsx";

export async function runZoxApp(props: ZoxAppProps): Promise<void> {
  const { waitUntilExit } = render(<ZoxApp {...props} />);
  await waitUntilExit();
}
