import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { useToast } from '../components/Toast';
import { ActionRow, Banner, Button, EmptyState, Input, Panel, Select, Switch, Toolbar } from '../components/ui/Primitives';
import { Bell, CheckCircle2, Clock, Mail, Settings } from '../components/ui/Icons';

const TYPES = [
  ['new_critical_issue', 'Critical issues'],
  ['new_vulnerability', 'Vulnerabilities'],
  ['index_ready', 'Index ready'],
  ['index_failed', 'Index failed'],
  ['pr_review_ready', 'PR review ready'],
  ['proposal_shared', 'Proposal shared'],
  ['tour_shared', 'Tour shared'],
  ['webhook_paused', 'Webhook paused'],
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export default function NotificationSettings() {
  const { session } = useAuth();
  const toast = useToast();
  const [preferences, setPreferences] = useState(null);
  const [draft, setDraft] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const token = session?.access_token;

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl('/api/preferences/notifications'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load notification preferences');
      setPreferences(data);
      setDraft(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => JSON.stringify(preferences) !== JSON.stringify(draft), [preferences, draft]);

  const patch = (updates) => setDraft((prev) => ({ ...prev, ...updates }));
  const patchType = (type, channel, value) => {
    setDraft((prev) => ({
      ...prev,
      per_type_json: {
        ...(prev?.per_type_json || {}),
        [type]: {
          ...(prev?.per_type_json?.[type] || {}),
          [channel]: value,
        },
      },
    }));
  };

  const save = async () => {
    if (!token || !draft) return;
    setIsSaving(true);
    try {
      const res = await fetch(apiUrl('/api/preferences/notifications'), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save notification preferences');
      setPreferences(data);
      setDraft(data);
      toast.success('Notification preferences saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="min-h-screen p-6 text-surface-300">Loading notification settings...</div>;
  if (error) return <div className="min-h-screen p-6"><Banner tone="danger">{error}</Banner></div>;
  if (!draft) return <EmptyState icon={Bell} title="No preferences available" />;

  return (
    <div className="min-h-screen p-4 text-white sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-surface-500">Settings</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Notification Preferences</h1>
        </div>
        <ActionRow>
          <Button variant="outline" onClick={() => setDraft(preferences)} disabled={!dirty || isSaving}>Reset</Button>
          <Button variant="primary" icon={CheckCircle2} onClick={save} loading={isSaving} disabled={!dirty}>Save</Button>
        </ActionRow>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Panel className="space-y-5">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-accent-soft" />
            <h2 className="text-base font-semibold text-surface-100">Delivery</h2>
          </div>
          <Toolbar className="justify-between rounded-lg border border-surface-800 bg-surface-950/60 p-3">
            <span className="flex items-center gap-2 text-sm text-surface-200"><Bell className="h-4 w-4" /> In-app</span>
            <Switch label="Toggle in-app notifications" checked={draft.in_app_enabled} onChange={(v) => patch({ in_app_enabled: v })} />
          </Toolbar>
          <Toolbar className="justify-between rounded-lg border border-surface-800 bg-surface-950/60 p-3">
            <span className="flex items-center gap-2 text-sm text-surface-200"><Mail className="h-4 w-4" /> Email</span>
            <Switch label="Toggle email notifications" checked={draft.email_enabled} onChange={(v) => patch({ email_enabled: v })} />
          </Toolbar>
          <Toolbar className="justify-between rounded-lg border border-surface-800 bg-surface-950/60 p-3">
            <span className="flex items-center gap-2 text-sm text-surface-200"><Clock className="h-4 w-4" /> Immediate critical email</span>
            <Switch label="Toggle immediate critical email" checked={draft.email_immediate_critical} onChange={(v) => patch({ email_immediate_critical: v })} />
          </Toolbar>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Digest Hour" value={draft.email_digest_hour} onChange={(e) => patch({ email_digest_hour: Number(e.target.value) })}>
              {HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
            </Select>
            <Input label="Timezone" value={draft.timezone || 'UTC'} onChange={(e) => patch({ timezone: e.target.value })} />
          </div>
        </Panel>

        <Panel padded={false} className="overflow-hidden">
          <div className="border-b border-surface-800 px-5 py-4">
            <h2 className="text-base font-semibold text-surface-100">Type Channels</h2>
          </div>
          <div className="divide-y divide-surface-800">
            {TYPES.map(([type, label]) => (
              <div key={type} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-3">
                <span className="min-w-0 text-sm text-surface-200">{label}</span>
                <Switch label={`${label} in-app`} checked={Boolean(draft.per_type_json?.[type]?.in_app)} onChange={(v) => patchType(type, 'in_app', v)} />
                <Switch label={`${label} email`} checked={Boolean(draft.per_type_json?.[type]?.email)} onChange={(v) => patchType(type, 'email', v)} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
