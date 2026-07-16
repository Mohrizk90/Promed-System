import { z } from 'zod';
import { whoamiHandler, whoamiSchema } from './whoami.js';
import {
  listClientsHandler,
  getClientHandler,
  listClientsSchema,
  getClientSchema,
} from './clients.js';
import {
  listInvoicesHandler,
  getClientTransactionHandler,
  listInvoicesSchema,
  getClientTransactionSchema,
} from './invoices.js';
import {
  generateClientStatementHandler,
  generateInvoiceHandler,
  generateClientStatementSchema,
  generateInvoiceSchema,
} from './reports.js';

export type ToolKind = 'read' | 'write';

export interface ToolDef<S extends z.ZodTypeAny> {
  schema: S;
  handler: (args: z.infer<S>, ctx: { user: { id: string; jwt: string } }) => Promise<unknown>;
  kind: ToolKind;
  description: string;
}

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
    description: 'List clients. Optional query substring matches name/phone.',
  },
  get_client: {
    schema: getClientSchema,
    handler: getClientHandler,
    kind: 'read' as const,
    description: 'Get a client by id with recent transactions.',
  },
  list_invoices: {
    schema: listInvoicesSchema,
    handler: listInvoicesHandler,
    kind: 'read' as const,
    description: 'List invoiced client transactions.',
  },
  get_client_transaction: {
    schema: getClientTransactionSchema,
    handler: getClientTransactionHandler,
    kind: 'read' as const,
    description: 'Get a single client transaction with payments.',
  },
  generate_client_statement: {
    schema: generateClientStatementSchema,
    handler: generateClientStatementHandler,
    kind: 'read' as const,
    description: 'Generate a PDF statement for a client. Returns short-lived signed URL.',
  },
  generate_invoice: {
    schema: generateInvoiceSchema,
    handler: generateInvoiceHandler,
    kind: 'read' as const,
    description: 'Generate a PDF invoice. Returns short-lived signed URL.',
  },
} satisfies Record<string, ToolDef<z.ZodTypeAny>>;

export type ToolName = keyof typeof tools;
