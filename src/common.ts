import { z } from "zod";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Runs a tool body, turning thrown errors into MCP error results. */
export function run(fn: () => Promise<string>): Promise<ToolResult> {
  return fn().then(
    (text) => ({ content: [{ type: "text", text }] }),
    (err: Error) => ({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }),
  );
}

export const json = (value: unknown) => JSON.stringify(value, null, 1);

export const format = z.enum(["text", "json"]).default("text").describe("text: compact readable output (default). json: structured data.");

export const bodyLimit = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Truncate each post/comment body to this many characters in text output. 0 hides post bodies in listings.");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function truncate(text: string, limit?: number): string {
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, limit)}… [${text.length - limit} more chars]`;
}

export const indentText = (text: string, pad: string) => text.replace(/\n/g, `\n${pad}`);
