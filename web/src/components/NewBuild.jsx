import { useRef, useState } from 'react';
import { createBuild } from '../lib/api.js';
import { formatBytes } from '../lib/format.js';

export default function NewBuild({ onCreated }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState(null);

  const pick = (nextFile) => {
    if (!nextFile) return;
    if (!/\.zip$/i.test(nextFile.name)) {
      setMessage({ kind: 'error', text: 'Only .zip archives are supported.' });
      return;
    }
    setFile(nextFile);
    setName((current) => current || nextFile.name.replace(/\.zip$/i, ''));
    setMessage(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!file || busy) return;

    setBusy(true);
    setMessage({ kind: 'info', text: 'Uploading archive…' });
    try {
      const build = await createBuild(file, name);
      setMessage({ kind: 'ok', text: `Build "${build.name}" queued.` });
      setFile(null);
      setName('');
      if (inputRef.current) inputRef.current.value = '';
      onCreated(build);
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card new-build" onSubmit={submit}>
      <h2 className="card-title">New build</h2>

      <div
        className={`dropzone ${dragActive ? 'dropzone-active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          pick(event.dataTransfer.files && event.dataTransfer.files[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => pick(event.target.files && event.target.files[0])}
          hidden
        />
        <button
          type="button"
          className="dropzone-button"
          onClick={() => inputRef.current && inputRef.current.click()}
        >
          {file ? file.name : 'Choose a .zip'}
        </button>
        <span className="dropzone-meta">
          {file
            ? `${formatBytes(file.size)} · click to choose another archive`
            : 'Drop your project archive here, or click to browse (max 50 MB)'}
        </span>
      </div>

      <div className="new-build-row">
        <label className="field">
          <span>Build name</span>
          <input
            value={name}
            maxLength={120}
            placeholder="my-app"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="primary build-button" type="submit" disabled={!file || busy}>
          {busy ? 'Starting…' : 'Build'}
        </button>
      </div>

      {message ? <p className={`notice notice-${message.kind}`}>{message.text}</p> : null}
    </form>
  );
}
