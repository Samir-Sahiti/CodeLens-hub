/**
 * src/components/SettingsPanel.jsx
 *
 * Extracted from inline SettingsPanel in RepoView.jsx.
 * Handles auto-sync toggle and webhook URL generation.
 */
import { useState } from 'react';
import { apiUrl } from '../lib/api';
import { RefreshCw, Copy, Check, Zap, Webhook } from './ui/Icons';
import { Banner, Button, EmptyState, Panel, Switch } from './ui/Primitives';

export default function SettingsPanel({ repo, session, onRepoUpdated }) {
  const [autoSync,     setAutoSync]     = useState(repo?.auto_sync_enabled ?? false);
  const [isSaving,     setIsSaving]     = useState(false);
  const [webhookInfo,  setWebhookInfo]  = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied,       setCopied]       = useState('');

  const isGitHub = repo?.source === 'github';

  const handleAutoSyncToggle = async () => {
    const next = !autoSync;
    setIsSaving(true);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repo.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ auto_sync_enabled: next }),
      });
      if (!res.ok) throw new Error('Failed to update setting');
      setAutoSync(next);
      onRepoUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateWebhook = async () => {
    setIsGenerating(true);
    setWebhookInfo(null);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repo.id}/webhook`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to generate webhook');
      const data = await res.json();
      setWebhookInfo(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch { /* ignore */ }
  };

  if (!isGitHub) {
    return (
      <EmptyState
        icon={Webhook}
        title="Auto-sync is unavailable"
        description="Webhook auto-sync is only available for repositories connected through GitHub."
        className="h-auto min-h-[30rem] xl:h-[calc(100vh-12rem)]"
      />
    );
  }

  return (
    <div
      className="max-w-2xl space-y-5"
      style={{ animation: 'slideUp 200ms ease both' }}
    >
      {/* Auto-sync toggle */}
      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <Zap className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white">Auto-sync on push</h3>
              <p className="mt-1 text-sm text-gray-400 leading-relaxed">
                Automatically re-index this repository whenever a push is made to the default branch via GitHub webhook.
              </p>
            </div>
          </div>
          <Switch checked={autoSync} disabled={isSaving} label="Toggle auto-sync" onChange={handleAutoSyncToggle} />
        </div>
        {autoSync && (
          <p className="mt-3 text-xs text-indigo-400 sm:pl-12">
            Auto-sync is enabled. Make sure a webhook is configured in your GitHub repository settings below.
          </p>
        )}
      </Panel>

      {/* Webhook URL generation */}
      <Panel>
        <div className="flex items-start gap-3 mb-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-800 border border-gray-700">
            <RefreshCw className="h-4 w-4 text-gray-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white">Webhook configuration</h3>
            <p className="mt-1 text-sm text-gray-400 leading-relaxed">
              Generate a webhook URL and secret to configure in your GitHub repository settings
              (Settings → Webhooks → Add webhook). Set the content type to{' '}
              <code className="rounded bg-gray-800 px-1 py-0.5 text-xs text-gray-200">application/json</code>{' '}
              and select the <strong className="text-gray-300">Push</strong> event only.
            </p>
          </div>
        </div>

        <Button
          onClick={handleGenerateWebhook}
          disabled={isGenerating}
          loading={isGenerating}
          icon={RefreshCw}
        >
          {isGenerating ? 'Generating...' : 'Generate webhook URL'}
        </Button>

        {webhookInfo && (
          <div className="mt-4 space-y-4" style={{ animation: 'slideUp 200ms ease both' }}>
            <Banner tone="warning">Save the secret now. It will not be shown again, and generating a new one invalidates the previous secret.</Banner>

            {[
              { label: 'Webhook URL', value: webhookInfo.webhookUrl, key: 'url' },
              { label: 'Secret',      value: webhookInfo.secret,     key: 'secret' },
            ].map(({ label, value, key }) => (
              <div key={key}>
                <p className="mb-1.5 text-xs uppercase tracking-widest text-gray-500">{label}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="flex-1 overflow-auto rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 font-mono text-xs text-gray-200 break-all">
                    {value}
                  </code>
                  <Button
                    onClick={() => handleCopy(value, key)}
                    size="sm"
                    variant="outline"
                    icon={copied === key ? Check : Copy}
                  >
                    {copied === key ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
