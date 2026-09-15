import { type ZoxEvent, zoxEventSchema } from "@zox/contracts";

export function parseSseBlock(block: string): ZoxEvent | undefined {
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }
  if (!data) return undefined;
  return zoxEventSchema.parse(JSON.parse(data));
}

export async function* iterateSse(response: Response): AsyncIterable<ZoxEvent> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSseBlock(part.trim());
      if (event) yield event;
    }
    if (done) break;
  }
}
