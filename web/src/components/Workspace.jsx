import { useEffect, useState } from 'react';
import {
  buildWorkspace,
  createWorkspaceFolder,
  deleteWorkspacePath,
  fetchWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
} from '../lib/api.js';

const STARTER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My app</title>
  </head>
  <body>
    <h1>Hello from my workspace</h1>
  </body>
</html>
`;

export default function Workspace({ onBuilt }) {
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState(null);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState(null);
  const [newPath, setNewPath] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const open = async (filePath) => {
    try {
      const content = await readWorkspaceFile(filePath);
      setCurrentPath(filePath);
      setDraft(content);
      setMessage(null);
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    }
  };

  const refresh = async () => {
    try {
      setFiles(await fetchWorkspace());
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const create = async (event) => {
    event.preventDefault();
    const value = newPath.trim();
    if (!value) return;

    setBusy(true);
    try {
      if (mode === 'folder') {
        await createWorkspaceFolder(value);
        await refresh();
        setMessage({ kind: 'ok', text: `Folder "${value}" created.` });
      } else {
        await writeWorkspaceFile(value, /\.html?$/i.test(value) ? STARTER_HTML : '');
        await refresh();
        await open(value);
        setMessage({ kind: 'ok', text: `File "${value}" created.` });
      }
      setNewPath('');
      setMode(null);
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!currentPath) return;
    setBusy(true);
    try {
      await writeWorkspaceFile(currentPath, draft);
      await refresh();
      setMessage({ kind: 'ok', text: `Saved ${currentPath}` });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entryPath) => {
    setBusy(true);
    try {
      await deleteWorkspacePath(entryPath);
      if (currentPath && (currentPath === entryPath || currentPath.startsWith(`${entryPath}/`))) {
        setCurrentPath(null);
        setDraft('');
      }
      await refresh();
      setMessage({ kind: 'ok', text: `Deleted ${entryPath}` });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const build = async () => {
    setBusy(true);
    try {
      const build = await buildWorkspace(name);
      onBuilt(build);
      setMessage({ kind: 'ok', text: `Build "${build.name}" queued.` });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="workspace-head">
        <div>
          <h2 className="card-title">Workspace</h2>
          <p className="card-hint">Create folders and files, edit them, then build the project.</p>
        </div>
        <div className="workspace-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setMode('file');
              setNewPath('');
            }}
          >
            New file
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setMode('folder');
              setNewPath('');
            }}
          >
            New folder
          </button>
        </div>
      </div>

      {mode ? (
        <form className="inline-create" onSubmit={create}>
          <input
            autoFocus
            value={newPath}
            onChange={(event) => setNewPath(event.target.value)}
            placeholder={mode === 'folder' ? 'src/components' : 'src/index.html'}
            aria-label={mode === 'folder' ? 'New folder path' : 'New file path'}
          />
          <button className="primary" type="submit" disabled={busy || !newPath.trim()}>
            {mode === 'folder' ? 'Create folder' : 'Create file'}
          </button>
          <button type="button" className="ghost" onClick={() => setMode(null)}>
            Cancel
          </button>
        </form>
      ) : null}

      <div className="workspace-body">
        <div className="tree-pane">
          {files.length === 0 ? (
            <p className="empty">No files yet.</p>
          ) : (
            <ul className="file-tree">
              {files.map((entry) => {
                const depth = entry.path.split('/').length - 1;
                const label = entry.path.split('/').pop();
                return (
                  <li key={entry.path} style={{ paddingLeft: depth * 14 }}>
                    <button
                      type="button"
                      className={`tree-item ${entry.type === 'file' && currentPath === entry.path ? 'tree-active' : ''}`}
                      onClick={() => (entry.type === 'file' ? open(entry.path) : undefined)}
                      title={entry.path}
                    >
                      <span className="tree-icon">{entry.type === 'dir' ? '▣' : '▢'}</span>
                      <span className="tree-name">{label}</span>
                    </button>
                    <button
                      type="button"
                      className="tree-delete"
                      aria-label={`Delete ${entry.path}`}
                      onClick={() => remove(entry.path)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="editor-pane">
          {currentPath ? (
            <>
              <div className="editor-head">
                <span className="mono">{currentPath}</span>
                <button type="button" className="primary" onClick={save} disabled={busy}>
                  Save
                </button>
              </div>
              <textarea
                className="editor"
                value={draft}
                spellCheck={false}
                onChange={(event) => setDraft(event.target.value)}
              />
            </>
          ) : (
            <p className="empty">Select a file to edit it, or create a new one.</p>
          )}
        </div>
      </div>

      <div className="new-build-row">
        <label className="field">
          <span>Build name</span>
          <input
            value={name}
            maxLength={120}
            placeholder="workspace build"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="primary build-button"
          onClick={build}
          disabled={busy}
        >
          Build workspace
        </button>
      </div>

      {message ? <p className={`notice notice-${message.kind}`}>{message.text}</p> : null}
    </section>
  );
}
