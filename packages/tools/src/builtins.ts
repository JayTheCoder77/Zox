import { bashTool } from "./bash.ts";
import { editTool } from "./edit.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { lsTool } from "./ls.ts";
import { readTool } from "./read.ts";
import type { ZoxTool } from "./types.ts";
import { writeTool } from "./write.ts";

export function createBuiltinTools(): ZoxTool[] {
  return [readTool, writeTool, editTool, bashTool, grepTool, globTool, lsTool];
}
