import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeJsonFile(
  filePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
