import { useEffect, useRef, useState } from 'react';
import StatusBadge from './StatusBadge.jsx';
import { artifactUrl, fetchBuild, fetchLogs } from '../lib/api.js';
import { formatBytes, formatDuration, formatTime, isActive } from '../lib/format.js';

export default function BuildDetail({ id, onClose }) {
  const [build, setBuild] = useState(null);
  const [logs, setLogs] = useState('');
  const [error, setError] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const [nextBuild, logPayload] = await Promise.all([fetchBuild(id), fetchLogs(id)]);
        if (cancelled) return;
        setBuild(nextBuild);
        setLogs(logPayload.logs || '');
        setError('');
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };

    tick();
    const timer = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <section className="card detail">
      <div className="detail-head">
        <div>
          <h2 className="card-title">{build ? build.name : 'Build'}</h2>
          <div className="detail-meta">
            {build ? (
              <>
                <StatusBadge status={build.status} />
                <span>
                  {build.status === 'queued'
                    ? 'waiting for the runner'
                    : build.status === 'running'
                      ? 'running now'
                      : `${formatDuration(build.durationMs)} · finished ${formatTime(build.finishedAt)}`}
                </span>
              </>
            ) : (
              'Loading build…'
            )}
          </div>
        </div>
        <div className="detail-actions">
          {build && build.artifact ? (
            <a className="primary" href={artifactUrl(build.id)}>
              Download artifact
            </a>
          ) : null}
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {error ? <p className="notice notice-error">{error}</p> : null}
      {build && build.errorSummary ? (
        <p className="notice notice-error">{build.errorSummary}</p>
      ) : null}

      <pre className="console" ref={logRef}>
        {logs || 'Waiting for output…'}
      </pre>

      {build && build.artifact ? (
        <p className="detail-foot">
          {build.artifact.name} · {formatBytes(build.artifact.size)} · {build.artifact.files} files
        </p>
      ) : null}

      {build && isActive(build.status) ? (
        <p className="detail-foot">Logs refresh automatically while the build runs.</p>
      ) : null}
    </section>
  );
}
