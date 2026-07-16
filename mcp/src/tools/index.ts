import { z } from 'zod';
import { whoamiHandler, whoamiSchema } from './whoami.js';
import { listClientsHandler, listClientsSchema } from './clients.js';
import {
  generateClientStatementHandler,
  generateClientStatementSchema,
} from './reports.js';

export type ToolKind = 'read' | 'write';

export interface ToolDef<S extends z.ZodTypeAny> {
  schema: S;
  handler: (args: z.infer<S>, ctx: { user: { id: string; jwt: string } }) => Promise<unknown>;
  kind: ToolKind;
  description: string;
}

// Deliberately minimal: the Telegram agent does ONE job — client statements.
// The full tool set (clients/products/transactions/payments CRUD) still lives
// in ./clients.ts, ./transactions.ts, ./payments.ts, ./products.ts,
// ./invoices.ts and can be re-registered here once statements are rock solid.
export const tools = {
  whoami: {
    schema: whoamiSchema,
    handler: whoamiHandler,
    kind: 'read' as const,
    description: 'Return the authenticated Supabase user info.',
  },
  list_clients: {
    schema: listClientsSchema,
    handler: listClientsHandler,
    kind: 'read' as const,
    description: 'List clients. Optional query substring matches name/phone (Arabic≈Latin fuzzy).',
  },
  generate_client_statement: {
    schema: generateClientStatementSchema,
    handler: generateClientStatementHandler,
    kind: 'read' as const,
    description: 'Generate a PDF statement for a client. Returns short-lived signed URL.',
  },
} satisfies Record<string, ToolDef<z.ZodTypeAny>>;

export type ToolName = keyof typeof tools;

/** Tool names that mutate ERP data (bot confirmation gate). Empty for now. */
export const WRITE_TOOL_NAMES = new Set(
  (Object.entries(tools) as [ToolName, ToolDef<z.ZodTypeAny>][])
    .filter(([, def]) => def.kind === 'write')
    .map(([name]) => name),
);
