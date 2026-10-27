import { isActive } from '../lib/format.js';

export default function StatsBar({ builds }) {
  const stats = [
    { label: 'Total builds', value: builds.length, tone: '' },
    { label: 'Success', value: builds.filter((b) => b.status === 'success').length, tone: 'ok' },
    { label: 'Failed', value: builds.filter((b) => b.status === 'failed').length, tone: 'bad' },
    { label: 'In progress', value: builds.filter((b) => isActive(b.status)).length, tone: 'run' },
  ];

  return (
    <section className="stats">
      {stats.map((stat) => (
        <div key={stat.label} className={`stat ${stat.tone ? `stat-${stat.tone}` : ''}`}>
          <span className="stat-value">{stat.value}</span>
          <span className="stat-label">{stat.label}</span>
        </div>
      ))}
    </section>
  );
}
