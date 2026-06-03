import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

let calls;

function createSupabaseMock(handlers = {}) {
  class Builder {
    constructor(table) {
      this.table = table;
      this.action = 'select';
      this.filters = [];
      this.orders = [];
      this.payload = null;
    }
    select(columns, options) { this.columns = columns; this.options = options; return this; }
    insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
    update(payload) { this.action = 'update'; this.payload = payload; return this; }
    eq(column, value) { this.filters.push({ op: 'eq', column, value }); return this; }
    gte(column, value) { this.filters.push({ op: 'gte', column, value }); return this; }
    in(column, value) { this.filters.push({ op: 'in', column, value }); return this; }
    contains(column, value) { this.filters.push({ op: 'contains', column, value }); return this; }
    order(column, opts) { this.orders.push({ column, opts }); return this; }
    range(from, to) { this.rangeFrom = from; this.rangeTo = to; return this; }
    maybeSingle() { this.mode = 'maybeSingle'; return this; }
    single() { this.mode = 'single'; return this; }
    then(resolve, reject) {
      const key = `${this.table}.${this.action}`;
      calls.push({ key, state: this });
      return Promise.resolve((handlers[key] || handlers[this.table] || (() => ({ data: [], error: null })))(this)).then(resolve, reject);
    }
  }
  return {
    from(table) { return new Builder(table); },
    rpc(name, payload) {
      calls.push({ key: `rpc.${name}`, state: { payload } });
      const handler = handlers[`rpc.${name}`];
      return Promise.resolve(handler ? handler(payload) : { data: true, error: null });
    },
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: 'user@example.com' } }, error: null })) } },
  };
}

function signSvix(secret, body, id = 'msg_1', timestamp = '1710000000') {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signature = crypto
    .createHmac('sha256', key)
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`), body]))
    .digest('base64');
  return { id, timestamp, signature: `v1,${signature}` };
}

beforeEach(() => {
  vi.resetModules();
  calls = [];
  delete globalThis.__CODELENS_SUPABASE_ADMIN__;
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from('test-webhook-secret').toString('base64')}`;
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'email-1' }) }));
});

describe('US-079 risk scoring', () => {
  it('computes exact severity, blast, churn caps and fallback', () => {
    const { buildReverseAdjacency, computeRiskComponents } = require('../src/services/riskScoring');
    const reverse = buildReverseAdjacency([
      { from_path: 'b.js', to_path: 'a.js' },
      { from_path: 'c.js', to_path: 'b.js' },
      { from_path: 'd.js', to_path: 'c.js' },
    ]);
    const scored = computeRiskComponents(
      { severity: 'critical', file_paths: ['a.js'] },
      { reverse, churnByPath: new Map([['a.js', 30]]), medianCommits30d: 10 },
    );
    expect(scored.severity_weight).toBe(4);
    expect(scored.blast_factor).toBeCloseTo(1 + Math.log10(3), 2);
    expect(scored.churn_factor).toBe(2);
    expect(scored.risk_score).toBeCloseTo(4 * scored.blast_factor * 2, 1);

    const fallback = computeRiskComponents(
      { severity: 'low', file_paths: ['missing.js'] },
      { reverse, churnByPath: new Map(), medianCommits30d: 0 },
    );
    expect(fallback.churn_factor).toBe(1);
  });

  it('orders agent risk query before applying the 50-row cap', async () => {
    globalThis.__CODELENS_SUPABASE_ADMIN__ = createSupabaseMock({
      analysis_issues: () => ({ data: [], error: null, count: 0 }),
      graph_edges: () => ({ data: [], error: null }),
      churn_metrics: () => ({ data: [], error: null }),
    });
    const { toolHandlers } = require('../src/services/agentTools');

    await toolHandlers.list_issues({ sort_by: 'risk' }, { repoId: 'repo-1', userId: 'user-1' });

    const issueCall = calls.find((call) => call.key === 'analysis_issues.select');
    expect(issueCall.state.orders[0]).toEqual({
      column: 'risk_score',
      opts: { ascending: false, nullsFirst: false },
    });
    expect(issueCall.state.rangeFrom).toBe(0);
    expect(issueCall.state.rangeTo).toBe(49);
  });
});

describe('US-078 notifications and email', () => {
  it('sends email-only critical notifications without inserting in-app rows', async () => {
    globalThis.__CODELENS_SUPABASE_ADMIN__ = createSupabaseMock({
      notification_preferences: (state) => {
        if (state.action === 'select') {
          return {
            data: {
              user_id: 'user-1',
              in_app_enabled: false,
              email_enabled: true,
              email_immediate_critical: true,
              per_type_json: { new_critical_issue: { in_app: false, email: true } },
              email_digest_hour: 9,
              timezone: 'UTC',
            },
            error: null,
          };
        }
        return { data: state.payload, error: null };
      },
      notifications: () => ({ data: [], error: null }),
    });
    const { enqueueNotification } = require('../src/services/notifications');

    const inserted = await enqueueNotification({
      user_ids: ['user-1'],
      type: 'new_critical_issue',
      severity: 'critical',
      payload: { message: 'Critical' },
    });

    expect(inserted).toBe(0);
    expect(calls.some((call) => call.key === 'notifications.insert')).toBe(false);
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });

  it('rejects unsigned Resend webhooks', async () => {
    const { handleResendWebhook } = require('../src/controllers/resendWebhookController');
    const res = { status: vi.fn(() => res), json: vi.fn() };

    await handleResendWebhook({ headers: {}, body: Buffer.from('{}') }, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('updates digest notification statuses from signed Resend bounces and emits required in-app notice', async () => {
    globalThis.__CODELENS_SUPABASE_ADMIN__ = createSupabaseMock({
      notifications: (state) => {
        if (state.action === 'select') return { count: 2, data: null, error: null };
        return { data: [{ id: 'notice-1', user_id: 'user-1', type: 'webhook_paused', severity: 'warning', payload_json: {}, created_at: new Date().toISOString() }], error: null };
      },
      notification_preferences: (state) => {
        if (state.action === 'select') {
          return {
            data: {
              user_id: 'user-1',
              in_app_enabled: false,
              email_enabled: true,
              email_immediate_critical: true,
              per_type_json: { webhook_paused: { in_app: true, email: true } },
              email_digest_hour: 9,
              timezone: 'UTC',
            },
            error: null,
          };
        }
        return { data: { user_id: 'user-1', ...state.payload }, error: null };
      },
    });
    const { handleResendWebhook } = require('../src/controllers/resendWebhookController');
    const body = Buffer.from(JSON.stringify({ type: 'email.bounced', data: { metadata: { user_id: 'user-1' } } }));
    const sig = signSvix(process.env.RESEND_WEBHOOK_SECRET, body);
    const res = { json: vi.fn(), status: vi.fn(() => res) };

    await handleResendWebhook({
      headers: {
        'svix-id': sig.id,
        'svix-timestamp': sig.timestamp,
        'svix-signature': sig.signature,
      },
      body,
    }, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(calls.some((call) => call.key === 'notifications.update'
      && call.state.payload.notification_email_status === 'hard_bounce')).toBe(true);
    expect(calls.some((call) => call.key === 'notification_preferences.update'
      && call.state.payload.email_enabled === false)).toBe(true);
    expect(calls.some((call) => call.key === 'notifications.insert')).toBe(true);
  });
});
