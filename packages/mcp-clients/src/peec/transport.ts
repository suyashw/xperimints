import { z } from 'zod';

/**
 * The minimum surface a Peec MCP transport needs: invoke a named tool with
 * arbitrary JSON arguments, get back arbitrary JSON. The real implementation
 * (HTTP+SSE) lives behind this interface so the rest of the system never
 * couples to the wire protocol.
 */
export interface PeecTransport {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export class PeecMcpError extends Error {
  override readonly cause?: unknown;
  constructor(
    message: string,
    readonly toolName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'PeecMcpError';
    this.cause = cause;
  }
}

export interface TypedToolOptions<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  name: string;
  inputSchema: I;
  outputSchema: O;
  /** Idempotent reads can be retried; mutations cannot. */
  idempotent: boolean;
}

/**
 * Build a typed tool invoker around a transport. Validates input with Zod,
 * sends the call, and validates the response. Errors are wrapped with the
 * tool name so the caller knows which tool blew up.
 */
export function makeTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  transport: PeecTransport,
  opts: TypedToolOptions<I, O>,
): (input: z.input<I>) => Promise<z.output<O>> {
  return async (rawInput) => {
    const inputCheck = opts.inputSchema.safeParse(rawInput);
    if (!inputCheck.success) {
      throw new PeecMcpError(
        `Invalid input for ${opts.name}: ${formatZod(inputCheck.error)}`,
        opts.name,
        inputCheck.error,
      );
    }
    let raw: unknown;
    try {
      raw = await transport.callTool(opts.name, inputCheck.data as Record<string, unknown>);
    } catch (err) {
      throw new PeecMcpError(
        `Transport error in ${opts.name}: ${(err as Error).message}`,
        opts.name,
        err,
      );
    }
    const outputCheck = opts.outputSchema.safeParse(raw);
    if (!outputCheck.success) {
      throw new PeecMcpError(
        `Invalid output from ${opts.name}: ${formatZod(outputCheck.error)}`,
        opts.name,
        outputCheck.error,
      );
    }
    return outputCheck.data as z.output<O>;
  };
}

function formatZod(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}
