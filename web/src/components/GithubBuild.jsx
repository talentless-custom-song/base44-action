import { useEffect, useState } from 'react';
import { dispatchGithubBuild, fetchGithubConfig } from '../lib/api.js';

export default function GithubBuild() {
  const [config, setConfig] = useState(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [target, setTarget] = useState('both');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetchGithubConfig()
      .then(setConfig)
      .catch(() => setConfig({ configured: false }));
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const out = await dispatchGithubBuild({
        sourceMode: 'repository',
        repoUrl,
        branch,
        buildTarget: target,
      });
      setResult({ kind: 'ok', text: out.message, url: out.actionsUrl });
    } catch (err) {
      setResult({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="card github-card">
      <summary>
        <span>Build from a GitHub repository</span>
        <span className="summary-hint">GitHub Actions · startBuild</span>
      </summary>

      {config && !config.configured ? (
        <p className="notice notice-info">
          Add <code>GITHUB_TOKEN</code>, <code>BUILDER_OWNER</code> and <code>BUILDER_REPO</code> to
          this app&apos;s secrets to dispatch the <code>desktop-build.yml</code> workflow.
        </p>
      ) : null}

      <form className="github-form" onSubmit={submit}>
        <label className="field">
          <span>Repository URL</span>
          <input
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/OWNER/electron-app"
          />
        </label>
        <label className="field">
          <span>Branch</span>
          <input value={branch} onChange={(event) => setBranch(event.target.value)} />
        </label>
        <label className="field">
          <span>Target</span>
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="both">Windows + Linux</option>
            <option value="windows">Windows</option>
            <option value="linux">Linux</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={busy || !repoUrl.trim()}>
          {busy ? 'Dispatching…' : 'Dispatch build'}
        </button>
      </form>

      {result ? (
        <p className={`notice notice-${result.kind}`}>
          {result.text}
          {result.url ? (
            <>
              {' '}
              <a href={result.url} target="_blank" rel="noreferrer">
                Open the run on GitHub
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </details>
  );
}
