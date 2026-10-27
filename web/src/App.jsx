import { useCallback, useEffect, useState } from 'react';
import StatsBar from './components/StatsBar.jsx';
import NewBuild from './components/NewBuild.jsx';
import BuildList from './components/BuildList.jsx';
import BuildDetail from './components/BuildDetail.jsx';
import { deleteBuild, fetchBuilds } from './lib/api.js';

export default function App() {
  const [builds, setBuilds] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setBuilds(await fetchBuilds());
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [load]);

  const handleCreated = (build) => {
    setBuilds((current) => [build, ...current]);
    setSelectedId(build.id);
  };

  const handleDelete = async (id) => {
    try {
      await deleteBuild(id);
      setBuilds((current) => current.filter((build) => build.id !== id));
      setSelectedId((current) => (current === id ? null : current));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">B</span>
          <div>
            <div className="brand-name">BuildHub</div>
            <div className="brand-sub">Build uploaded projects, get the artifact</div>
          </div>
        </div>
        <a className="ghost-link" href="/api/sample.zip">
          Download sample project
        </a>
      </header>

      <main className="content">
        {error ? (
          <div className="banner" role="alert">
            {error}
          </div>
        ) : null}

        <StatsBar builds={builds} />
        <NewBuild onCreated={handleCreated} />

        {selectedId ? (
          <BuildDetail id={selectedId} onClose={() => setSelectedId(null)} />
        ) : null}

        <BuildList
          builds={builds}
          loading={loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDelete={handleDelete}
        />
      </main>
    </div>
  );
}
