import { bashTool } from "./bash.ts";
import { editTool } from "./edit.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { lsTool } from "./ls.ts";
import { memorySearchTool } from "./memory_search.ts";
import { memoryWriteTool } from "./memory_write.ts";
import { readTool } from "./read.ts";
import { skillTool } from "./skill.ts";
import { todowriteTool } from "./todowrite.ts";
import type { ZoxTool } from "./types.ts";
import { webfetchTool } from "./webfetch.ts";
import { writeTool } from "./write.ts";

export function createBuiltinTools(): ZoxTool[] {
  return [
    readTool,
    writeTool,
    editTool,
    bashTool,
    grepTool,
    globTool,
    lsTool,
    skillTool,
    todowriteTool,
    webfetchTool,
    memorySearchTool,
    memoryWriteTool,
  ];
}
