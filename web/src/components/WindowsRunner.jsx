import { useCallback, useEffect, useState } from 'react';
import {
  fetchGithubConfig,
  fetchGithubRun,
  fetchGithubRunLogs,
  fetchGithubRuns,
} from '../lib/api.js';
import { formatBytes, timeAgo } from '../lib/format.js';

const TONE = {
  queued: 'badge-queued',
  in_progress: 'badge-running',
  success: 'badge-success',
  failure: 'badge-failed',
  cancelled: 'badge-failed',
};

const tone = (state) => TONE[state] || 'badge-queued';

const stateLabel = ({ status, conclusion }) => {
  if (status !== 'completed') return status === 'queued' ? 'Queued' : 'Running';
  const text = conclusion ? conclusion.replace(/_/g, ' ') : 'completed';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export default function WindowsRunner() {
  const [config, setConfig] = useState(null);
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState('');
  const [openRunId, setOpenRunId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [logs, setLogs] = useState('');
  const [logsError, setLogsError] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);

  const canList = Boolean(config && config.configured && config.reachable);

  useEffect(() => {
    fetchGithubConfig()
      .then(setConfig)
      .catch(() => setConfig({ configured: false, hint: 'GitHub configuration could not be read.' }));
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const next = await fetchGithubRuns();
      setRuns(next);
      setError('');
      return next;
    } catch (err) {
      setError(err.message);
      return [];
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    try {
      setDetail(await fetchGithubRun(id));
      setDetailError('');
    } catch (err) {
      setDetailError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!canList) return undefined;

    let cancelled = false;
    let timer;

    const tick = async () => {
      const next = await loadRuns();
      if (cancelled) return;
      const live = next.some((run) => run.status !== 'completed');
      if (live && openRunId) await loadDetail(openRunId);
      if (!cancelled) timer = setTimeout(tick, live ? 6000 : 30000);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canList, loadRuns, loadDetail, openRunId]);

  const toggleRun = async (id) => {
    if (openRunId === id) {
      setOpenRunId(null);
      setDetail(null);
      setLogs('');
      setLogsError('');
      return;
    }
    setOpenRunId(id);
    setDetail(null);
    setDetailError('');
    setLogs('');
    setLogsError('');
    await loadDetail(id);
  };

  const showLogs = async (id) => {
    setLoadingLogs(true);
    setLogsError('');
    try {
      setLogs(await fetchGithubRunLogs(id));
    } catch (err) {
      setLogsError(err.message);
    } finally {
      setLoadingLogs(false);
    }
  };

  return (
    <section className="card">
      <div className="workspace-head">
        <h2 className="card-title">Real runner machines</h2>
        <span className="summary-hint">GitHub Actions · live logs</span>
      </div>
      <p className="card-hint">
        Every run below executed on a genuine GitHub-hosted machine, with its real operating system,
        file system and shell. A <code>windows-latest</code> job is real Windows with PowerShell and
        <code>cmd</code>, so its output is what your project does on Windows — not an emulated desktop.
      </p>

      {config && config.reachable && !config.workflowPresent ? (
        <p className="notice notice-info">
          New dispatches need <code>.github/workflows/desktop-build.yml</code> in {config.owner}/
          {config.repo}; the runs below are still real output from that repository&apos;s machines.
        </p>
      ) : config && config.hint ? (
        <p className="notice notice-info">{config.hint}</p>
      ) : null}

      {error ? <p className="notice notice-error">{error}</p> : null}

      {canList && !runs.length && !error ? (
        <p className="empty">
          No runs yet — start a build above and the real machine output appears here.
        </p>
      ) : null}

      {runs.length ? (
        <div className="table-wrap">
          <table className="builds-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>State</th>
                <th className="runner-branch">Branch</th>
                <th className="runner-when">When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className={run.id === openRunId ? 'row-selected' : undefined}>
                  <td>
                    <div className="row-name">{run.title || run.name}</div>
                    <div className="row-id mono">#{run.id}</div>
                  </td>
                  <td>
                    <span className={`badge ${tone(run.status === 'completed' ? run.conclusion : run.status)}`}>
                      <span className="badge-dot" />
                      {stateLabel(run)}
                    </span>
                  </td>
                  <td className="mono runner-branch">{run.branch || '—'}</td>
                  <td className="mono runner-when">{timeAgo(Date.parse(run.createdAt))}</td>
                  <td className="row-actions">
                    <button type="button" className="ghost" onClick={() => toggleRun(run.id)}>
                      {run.id === openRunId ? 'Hide' : 'Inspect'}
                    </button>
                    <a className="link runner-gh" href={run.htmlUrl} target="_blank" rel="noreferrer">
                      GitHub
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {openRunId ? (
        <div className="runner-detail">
          {detailError ? <p className="notice notice-error">{detailError}</p> : null}
          {!detail && !detailError ? <p className="card-hint">Loading the run…</p> : null}

          {detail
            ? detail.jobs.map((job) => (
                <div key={job.id} className="runner-job">
                  <div className="detail-meta">
                    <span className={`badge ${tone(job.status === 'completed' ? job.conclusion : job.status)}`}>
                      <span className="badge-dot" />
                      {stateLabel(job)}
                    </span>
                    <strong>{job.name}</strong>
                    {job.labels.length ? (
                      <span className="mono">{job.labels.join(' · ')}</span>
                    ) : job.runner ? (
                      <span className="mono">{job.runner}</span>
                    ) : null}
                  </div>
                  <ol className="runner-steps">
                    {job.steps.map((step) => (
                      <li
                        key={step.number}
                        className={`runner-step runner-step-${step.conclusion || step.status}`}
                      >
                        <span>{step.name}</span>
                        <span className="runner-step-state">{step.conclusion || step.status}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))
            : null}

          {detail ? (
            <div className="detail-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => showLogs(openRunId)}
                disabled={loadingLogs}
              >
                {loadingLogs ? 'Loading log…' : 'Show run log'}
              </button>
              <a className="ghost-link" href={detail.run.htmlUrl} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            </div>
          ) : null}

          {detail && detail.artifacts.length ? (
            <p className="runner-artifacts">
              {detail.artifacts.map((artifact) => (
                <a key={artifact.id} className="link" href={artifact.downloadUrl}>
                  {artifact.name} ({formatBytes(artifact.sizeInBytes)})
                </a>
              ))}
            </p>
          ) : null}

          {logsError ? <p className="notice notice-error">{logsError}</p> : null}
          {logs ? <pre className="console">{logs}</pre> : null}
        </div>
      ) : null}
    </section>
  );
}
