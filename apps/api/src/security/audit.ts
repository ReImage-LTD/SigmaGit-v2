/**
 * Structured security audit events. Never log secrets, tokens, or passwords.
 */

export type SecurityAuditAction =
  | 'auth.login_success'
  | 'auth.login_failure'
  | 'auth.password_change'
  | 'auth.password_reset'
  | 'auth.email_change'
  | 'auth.email_verified'
  | 'auth.account_delete'
  | 'auth.api_key_create'
  | 'auth.api_key_revoke'
  | 'auth.role_change'
  | 'repo.visibility_change'
  | 'repo.ownership_change'
  | 'repo.collaborator_add'
  | 'repo.collaborator_remove'
  | 'org.member_add'
  | 'org.member_remove'
  | 'org.role_change'
  | 'webhook.create'
  | 'webhook.update'
  | 'webhook.delete'
  | 'runner.register'
  | 'runner.remove'
  | 'migration.create'
  | 'migration.cancel'
  | 'admin.action'
  | 'install.complete';

export interface SecurityAuditEvent {
  action: SecurityAuditAction;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  outcome: 'success' | 'failure' | 'denied';
  ip?: string | null;
  meta?: Record<string, string | number | boolean | null | undefined>;
  requestId?: string | null;
}

function sanitizeMeta(
  meta?: SecurityAuditEvent['meta']
): Record<string, string | number | boolean | null> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  const blocked = /password|token|secret|authorization|cookie|credential|ssh|key/i;
  for (const [k, v] of Object.entries(meta)) {
    if (blocked.test(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export function logSecurityEvent(event: SecurityAuditEvent): void {
  const line = {
    type: 'security_audit',
    ts: new Date().toISOString(),
    action: event.action,
    actorId: event.actorId ?? null,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    outcome: event.outcome,
    ip: event.ip ?? null,
    requestId: event.requestId ?? null,
    meta: sanitizeMeta(event.meta) ?? null,
  };
  console.info(JSON.stringify(line));
}
