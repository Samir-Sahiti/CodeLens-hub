/**
 * src/components/SettingsPanel.jsx
 *
 * Extracted from inline SettingsPanel in RepoView.jsx.
 * Handles auto-sync toggle and webhook URL generation.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';
import { formatDate } from '../lib/constants';
import { useToast } from './Toast';
import { RefreshCw, Copy, Check, Zap, Webhook, MessageSquare, Terminal, Trash2 } from './ui/Icons';
import { Banner, Button, EmptyState, Panel, Select, Switch } from './ui/Primitives';

export default function SettingsPanel({ repo, session, onRepoUpdated }) {
  const [autoSync,     setAutoSync]     = useState(repo?.auto_sync_enabled ?? false);
  const [autoPublish,  setAutoPublish]  = useState(repo?.pr_review_auto_publish ?? true);
  const [blockSeverity, setBlockSeverity] = useState(repo?.pr_review_block_on_severity || 'critical');
  const [depStrategy,  setDepStrategy]  = useState(repo?.dependency_update_strategy || 'minimum_safe');
  const [depThreshold, setDepThreshold] = useState(repo?.dependency_batch_threshold ?? 3);
  const [depAutoPr,    setDepAutoPr]    = useState(repo?.dependency_auto_pr_enabled ?? false);
  const [isSaving,     setIsSaving]     = useState(false);
  const [webhookInfo,  setWebhookInfo]  = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied,       setCopied]       = useState('');
  const [ciTokens,     setCiTokens]     = useState([]);
  const [newCiToken,   setNewCiToken]   = useState(null);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const toast = useToast();

  const isGitHub = repo?.source === 'github';

  const fetchCiTokens = useCallback(async () => {
    if (!repo?.id || !session?.access_token) return;
    try {
      const res = await fetch(apiUrl(`/api/repos/${repo.id}/ci-tokens`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCiTokens(data.tokens || []);
    } catch { /* ignore */ }
  }, [repo?.id, session?.access_token]);

  useEffect(() => { fetchCiTokens(); }, [fetchCiTokens]);

  const handleGenerateCiToken = async () => {
    setIsGeneratingToken(true);
    setNewCiToken(null);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repo.id}/ci-tokens`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ name: 'CI token' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to generate CI token');
      setNewCiToken(data.token);
      await fetchCiTokens();
    } catch (err) {
      toast.error(err.message || 'Failed to generate CI token');
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const handleRevokeCiToken = async (tokenId) => {
    try {
      const res = await fetch(apiUrl(`/api/repos/${repo.id}/ci-tokens/${tokenId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to revoke token');
      setCiTokens((prev) => prev.map((t) => (t.id === tokenId ? { ...t, revoked_at: new Date().toISOString() } : t)));
      toast.success('CI token revoked');
    } catch (err) {
      toast.error(err.message || 'Failed to revoke token');
    }
  };

  useEffect(() => {
    setAutoSync(repo?.auto_sync_enabled ?? false);
    setAutoPublish(repo?.pr_review_auto_publish ?? true);
    setBlockSeverity(repo?.pr_review_block_on_severity || 'critical');
    setDepStrategy(repo?.dependency_update_strategy || 'minimum_safe');
    setDepThreshold(repo?.dependency_batch_threshold ?? 3);
    setDepAutoPr(repo?.dependency_auto_pr_enabled ?? false);
  }, [repo?.auto_sync_enabled, repo?.pr_review_auto_publish, repo?.pr_review_block_on_severity,
      repo?.dependency_update_strategy, repo?.dependency_batch_threshold, repo?.dependency_auto_pr_enabled]);

  const saveRepoSettings = async (updates) => {
    setIsSaving(true);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repo.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update setting');
      await onRepoUpdated?.();
      toast.success('Repository settings updated');
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Failed to update setting');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoSyncToggle = async () => {
    const next = !autoSync;
    setAutoSync(next);
    await saveRepoSettings({ auto_sync_enabled: next });
  };

  const handleAutoPublishToggle = async () => {
    const next = !autoPublish;
    setAutoPublish(next);
    await saveRepoSettings({ pr_review_auto_publish: next });
  };

  const handleBlockSeverityChange = async (event) => {
    const next = event.target.value;
    setBlockSeverity(next);
    await saveRepoSettings({ pr_review_block_on_severity: next });
  };

  const handleDepStrategyChange = async (event) => {
    const next = event.target.value;
    setDepStrategy(next);
    await saveRepoSettings({ dependency_update_strategy: next });
  };

  const handleDepThresholdChange = async (event) => {
    const raw = parseInt(event.target.value, 10);
    const next = isNaN(raw) ? 3 : Math.max(1, Math.min(20, raw));
    setDepThreshold(next);
    await saveRepoSettings({ dependency_batch_threshold: next });
  };

  const handleDepAutoPrToggle = async () => {
    const next = !depAutoPr;
    setDepAutoPr(next);
    await saveRepoSettings({ dependency_auto_pr_enabled: next });
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
      toast.error(err.message || 'Failed to generate webhook');
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

      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <MessageSquare className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white">Auto-publish PR reviews</h3>
              <p className="mt-1 text-sm text-gray-400 leading-relaxed">
                Automatically post CodeLens PR findings to GitHub after deterministic review completes.
              </p>
            </div>
          </div>
          <Switch checked={autoPublish} disabled={isSaving} label="Toggle auto-publish PR reviews" onChange={handleAutoPublishToggle} />
        </div>
        {!autoPublish && (
          <Banner tone="warning" className="mt-4">
            Auto-publish is disabled. PR findings will stay in CodeLens until you publish them manually.
          </Banner>
        )}
        <Select
          id="pr-review-block-severity"
          label="Request changes on"
          className="mt-4 sm:max-w-xs"
          value={blockSeverity}
          disabled={isSaving}
          onChange={handleBlockSeverityChange}
        >
          <option value="critical">Critical findings</option>
          <option value="high">High or critical findings</option>
        </Select>
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

      {/* CI Integration — per-repo API tokens (US-076) */}
      <Panel>
        <div className="flex items-start gap-3 mb-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 border border-violet-500/20">
            <Terminal className="h-4 w-4 text-violet-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white">CI Integration</h3>
            <p className="mt-1 text-sm text-gray-400 leading-relaxed">
              Generate a per-repo API token for the CodeLens GitHub Action so CI can run a PR
              review and report a status check. The token is scoped to this repository and shown once.
              See <code className="rounded bg-gray-800 px-1 py-0.5 text-xs text-gray-200">docs/ci-integration.md</code>.
            </p>
          </div>
        </div>

        <Button onClick={handleGenerateCiToken} disabled={isGeneratingToken} loading={isGeneratingToken} icon={Terminal}>
          {isGeneratingToken ? 'Generating...' : 'Generate token'}
        </Button>

        {newCiToken && (
          <div className="mt-4 space-y-2" style={{ animation: 'slideUp 200ms ease both' }}>
            <Banner tone="warning">Copy this token now — it will not be shown again.</Banner>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 overflow-auto rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 font-mono text-xs text-gray-200 break-all">
                {newCiToken}
              </code>
              <Button onClick={() => handleCopy(newCiToken, 'ci-token')} size="sm" variant="outline" icon={copied === 'ci-token' ? Check : Copy}>
                {copied === 'ci-token' ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}

        {ciTokens.length > 0 && (
          <div className="mt-5 space-y-2">
            <p className="text-xs uppercase tracking-widest text-gray-500">Existing tokens</p>
            {ciTokens.map((token) => (
              <div key={token.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className={`block truncate ${token.revoked_at ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{token.name || 'CI token'}</span>
                  <span className="text-xs text-gray-500">
                    Created {formatDate(token.created_at)}
                    {token.last_used_at ? ` · last used ${formatDate(token.last_used_at)}` : ' · never used'}
                    {token.revoked_at ? ' · revoked' : ''}
                  </span>
                </div>
                {!token.revoked_at && (
                  <Button onClick={() => handleRevokeCiToken(token.id)} size="sm" variant="outline" icon={Trash2}>
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Dependency Updates — US-084 */}
      <Panel>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">Dependency Updates</h3>
            <p className="mt-1 text-sm text-gray-400">
              Configure automatic batch fix PRs for vulnerable npm/yarn dependencies.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {/* Update strategy */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-300">Update strategy</p>
              <p className="text-xs text-gray-500 mt-0.5">Whether to target the minimum CVE-fixing version or the latest non-breaking version.</p>
            </div>
            <Select
              value={depStrategy}
              onChange={handleDepStrategyChange}
              disabled={isSaving}
              inputClassName="w-44"
            >
              <option value="minimum_safe">Minimum safe</option>
              <option value="latest_safe">Latest safe</option>
            </Select>
          </div>

          {/* Batch threshold */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-300">Batch threshold</p>
              <p className="text-xs text-gray-500 mt-0.5">Open a single batched PR when this many vulnerabilities are open (1–20).</p>
            </div>
            <input
              type="number"
              min={1}
              max={20}
              value={depThreshold}
              onChange={handleDepThresholdChange}
              disabled={isSaving}
              className="w-20 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white text-center outline-none focus:border-indigo-500 disabled:opacity-50"
            />
          </div>

          {/* Auto-PR toggle */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-300">Auto-PR on index</p>
              <p className="text-xs text-gray-500 mt-0.5">Automatically open a batch fix PR after each index when the threshold is met.</p>
            </div>
            <Switch
              checked={depAutoPr}
              onChange={handleDepAutoPrToggle}
              disabled={isSaving}
              label=""
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}
