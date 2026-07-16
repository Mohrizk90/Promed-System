import { adminClient } from './supabase/userClient.js';

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
  try {
    await adminClient().from('bot_audit_log').insert({
      telegram_chat_id: entry.telegramChatId,
      user_id: entry.userId,
      tool_name: entry.toolName,
      args_json: entry.args as any,
      result_status: entry.resultStatus,
      error_text: entry.errorText,
      latency_ms: entry.latencyMs,
      source: 'mcp',
    });
  } catch (err) {
    console.error('audit write failed', err);
  }
}
