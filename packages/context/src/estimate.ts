export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateSession(messages: { content: string }[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateTokens(message.content);
  }
  return total;
}
