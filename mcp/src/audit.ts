import { adminClient } from './supabase/userClient.js';
import { logger } from './logger.js';

export type AuditEntry = {
  telegramChatId: number | null;
  userId: string;
  toolName: string;
  args: unknown;
  resultStatus: 'ok' | 'error' | 'denied';
  errorText?: string;
  latencyMs: number;
  source: 'mcp';
};

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const { error } = await adminClient().from('bot_audit_log').insert({
    telegram_chat_id: entry.telegramChatId,
    user_id: entry.userId,
    tool_name: entry.toolName,
    args_json: entry.args as any,
    result_status: entry.resultStatus,
    error_text: entry.errorText,
    latency_ms: entry.latencyMs,
    source: 'mcp',
  });
  if (error) {
    // Don't throw — failing to write an audit row must never break the user's request.
    logger.error({ tool: entry.toolName, err: error.message }, 'audit write failed');
  }
}
