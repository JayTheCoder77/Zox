import { editTool } from "./edit.ts";
import { readTool } from "./read.ts";
import type { ZoxTool } from "./types.ts";
import { writeTool } from "./write.ts";

export function createBuiltinTools(): ZoxTool[] {
  return [readTool, writeTool, editTool];
}
