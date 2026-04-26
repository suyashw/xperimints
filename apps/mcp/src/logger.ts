/**
 * stdio MCP servers MUST NOT write anything to stdout that isn't a JSON-RPC
 * frame — a stray `console.log` will corrupt the protocol stream and the
 * client will disconnect. Everything diagnostic goes to stderr instead.
 */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function fmt(level: string, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const tail = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] xperi-mcp ${level} ${msg}${tail}\n`;
}

export const stderrLogger: Logger = {
  info: (msg, meta) => process.stderr.write(fmt('info', msg, meta)),
  warn: (msg, meta) => process.stderr.write(fmt('warn', msg, meta)),
  error: (msg, meta) => process.stderr.write(fmt('error', msg, meta)),
};
