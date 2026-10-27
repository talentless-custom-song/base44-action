import StatusBadge from './StatusBadge.jsx';
import { formatBytes, formatDuration, isActive, timeAgo } from '../lib/format.js';

export default function BuildList({ builds, loading, selectedId, onSelect, onDelete }) {
  return (
    <section className="card">
      <h2 className="card-title">Build history</h2>

      {builds.length === 0 ? (
        <p className="empty">
          {loading ? 'Loading builds…' : 'No builds yet — upload a .zip above and press Build.'}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="builds-table">
            <thead>
              <tr>
                <th>Build</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Artifact</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {builds.map((build) => (
                <tr key={build.id} className={build.id === selectedId ? 'row-selected' : ''}>
                  <td>
                    <button type="button" className="row-name" onClick={() => onSelect(build.id)}>
                      {build.name}
                    </button>
                    <div className="row-id">{build.id.slice(0, 8)}</div>
                  </td>
                  <td>
                    <StatusBadge status={build.status} />
                  </td>
                  <td className="mono">{build.startedAt ? timeAgo(build.startedAt) : '—'}</td>
                  <td className="mono">
                    {isActive(build.status) ? '…' : formatDuration(build.durationMs)}
                  </td>
                  <td>
                    {build.artifact ? (
                      <a className="download" href={`/api/builds/${build.id}/artifact`}>
                        {formatBytes(build.artifact.size)}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="row-actions">
                    <button type="button" className="link" onClick={() => onSelect(build.id)}>
                      Logs
                    </button>
                    <button
                      type="button"
                      className="link danger"
                      onClick={() => onDelete(build.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
