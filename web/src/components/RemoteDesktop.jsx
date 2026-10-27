import { useCallback, useEffect, useRef, useState } from 'react';
import VirtualKeyboard from './VirtualKeyboard.jsx';
import VirtualMouse from './VirtualMouse.jsx';
import { KEYSYMS, charToKeysym } from '../lib/keysyms.js';
import {
  REMOTE_PROFILES,
  loadProfileSettings,
  saveProfileSettings,
  toSocketUrl,
} from '../lib/remoteProfiles.js';

// VNC button masks, and the wheel "buttons" 4/5 the protocol uses for scrolling.
const BUTTONS = { left: 1, middle: 2, right: 4 };
const WHEEL = { up: 8, down: 16 };
const FALLBACK_SCREEN = { w: 1280, h: 800 };

const STATUS_LABEL = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Live',
  error: 'Failed',
};

const STATUS_BADGE = {
  idle: 'badge-queued',
  connecting: 'badge-running',
  connected: 'badge-success',
  error: 'badge-failed',
};

export default function RemoteDesktop() {
  const [profileId, setProfileId] = useState(REMOTE_PROFILES[0].id);
  const [settings, setSettings] = useState(() => loadProfileSettings(REMOTE_PROFILES[0].id));
  const [throughApp, setThroughApp] = useState(true);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [mouseOpen, setMouseOpen] = useState(false);

  const stageRef = useRef(null);
  const rfbRef = useRef(null);
  const cursorRef = useRef({ x: 0, y: 0 });

  const profile = REMOTE_PROFILES.find((item) => item.id === profileId) || REMOTE_PROFILES[0];
  const connected = status === 'connected';

  useEffect(() => {
    setSettings(loadProfileSettings(profileId));
    setKeyboardOpen(false);
    setMouseOpen(false);
  }, [profileId]);

  const updateSettings = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveProfileSettings(profileId, next);
  };

  const screenSize = () => {
    const rfb = rfbRef.current;
    if (rfb && rfb._fbWidth && rfb._fbHeight) return { w: rfb._fbWidth, h: rfb._fbHeight };
    const canvas = stageRef.current?.querySelector('canvas');
    if (canvas && canvas.width && canvas.height) return { w: canvas.width, h: canvas.height };
    return FALLBACK_SCREEN;
  };

  const disconnect = useCallback(() => {
    const rfb = rfbRef.current;
    rfbRef.current = null;
    if (rfb) {
      try {
        rfb.disconnect();
      } catch {
        /* already gone */
      }
    }
    if (stageRef.current) stageRef.current.replaceChildren();
  }, []);

  useEffect(() => disconnect, [disconnect]);

  const connect = async () => {
    const target = toSocketUrl(settings.url, { throughApp });
    if (!target) {
      setStatus('error');
      setMessage('Enter the ws:// or wss:// websockify URL of this Windows image first.');
      return;
    }

    disconnect();
    setStatus('connecting');
    setMessage('');
    try {
      const { default: RFB } = await import('@novnc/novnc');
      const rfb = new RFB(stageRef.current, target, {
        credentials: settings.password ? { password: settings.password } : undefined,
      });
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.background = '#070b10';
      rfbRef.current = rfb;

      rfb.addEventListener('connect', () => {
        const { w, h } = screenSize();
        cursorRef.current = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
        setStatus('connected');
      });
      rfb.addEventListener('disconnect', (event) => {
        if (rfbRef.current !== rfb) return;
        rfbRef.current = null;
        setStatus(event.detail?.clean ? 'idle' : 'error');
        if (!event.detail?.clean) setMessage('The Windows image closed the remote desktop connection.');
        setKeyboardOpen(false);
        setMouseOpen(false);
      });
      rfb.addEventListener('desktop-resize', () => {
        const { w, h } = screenSize();
        cursorRef.current = {
          x: Math.min(cursorRef.current.x, Math.max(w - 1, 0)),
          y: Math.min(cursorRef.current.y, Math.max(h - 1, 0)),
        };
      });
      rfb.addEventListener('securityfailure', (event) => {
        setStatus('error');
        setMessage(`The Windows image rejected the password: ${event.detail?.reason || 'security failure'}`);
      });
    } catch (err) {
      setStatus('error');
      setMessage(`Could not start the remote desktop: ${err.message}`);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (connected) disconnect();
    connect();
  };

  const sendKey = (keysym, down) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.sendKey(keysym, null, down);
  };

  const sendPointer = (mask) => {
    const rfb = rfbRef.current;
    if (!rfb || typeof rfb._sendMouse !== 'function') return;
    const { w, h } = screenSize();
    const { x, y } = cursorRef.current;
    cursorRef.current = {
      x: Math.min(Math.max(x, 0), Math.max(w - 1, 0)),
      y: Math.min(Math.max(y, 0), Math.max(h - 1, 0)),
    };
    // noVNC maps view pixels onto the framebuffer, so hand it our cursor in view space.
    const canvas = stageRef.current?.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    const scaleX = rect && canvas.width ? rect.width / canvas.width : 1;
    const scaleY = rect && canvas.height ? rect.height / canvas.height : 1;
    rfb._sendMouse(cursorRef.current.x * scaleX, cursorRef.current.y * scaleY, mask);
  };

  const move = (dx, dy) => {
    cursorRef.current = { x: cursorRef.current.x + dx, y: cursorRef.current.y + dy };
    sendPointer(0);
  };

  const click = (button) => {
    const mask = BUTTONS[button] || 1;
    sendPointer(mask);
    window.setTimeout(() => sendPointer(0), 80);
  };

  const scroll = (direction) => {
    const mask = WHEEL[direction];
    sendPointer(mask);
    window.setTimeout(() => sendPointer(0), 60);
  };

  const dragStart = () => sendPointer(BUTTONS.left);
  const dragEnd = () => sendPointer(0);

  const typeChar = (character) => {
    const mapped = charToKeysym(character, false);
    if (!mapped) return;
    if (mapped.shift) sendKey(KEYSYMS.Shift, true);
    sendKey(mapped.keysym, true);
    sendKey(mapped.keysym, false);
    if (mapped.shift) sendKey(KEYSYMS.Shift, false);
  };

  return (
    <section className="card remote-card">
      <div className="remote-head">
        <div>
          <h2 className="card-title">Remote desktop</h2>
          <p className="card-hint">
            Live VNC session to the Windows image you install on, driven by a virtual keyboard and mouse.
          </p>
        </div>
        <span className={`badge ${STATUS_BADGE[status]}`}>
          <span className="badge-dot" />
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="remote-profiles" role="group" aria-label="Windows image">
        {REMOTE_PROFILES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`profile-chip${item.id === profileId ? ' chip-active' : ''}`}
            onClick={() => setProfileId(item.id)}
            disabled={connected || status === 'connecting'}
            title={item.hint}
          >
            {item.label}
          </button>
        ))}
      </div>

      <form className="remote-connect" onSubmit={submit}>
        <label className="field remote-url">
          <span>{profile.label} endpoint</span>
          <input
            value={settings.url}
            onChange={(event) => updateSettings({ url: event.target.value })}
            placeholder="ws://192.168.1.20:6080/websockify"
            disabled={connected}
            spellCheck={false}
          />
        </label>
        <label className="field remote-pass">
          <span>Password</span>
          <input
            type="password"
            value={settings.password}
            onChange={(event) => updateSettings({ password: event.target.value })}
            placeholder="optional"
            disabled={connected}
          />
        </label>
        <button className="primary" type="submit" disabled={status === 'connecting'}>
          {connected ? 'Reconnect' : 'Connect'}
        </button>
        {connected || status === 'connecting' ? (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              disconnect();
              setStatus('idle');
              setMessage('');
            }}
          >
            Disconnect
          </button>
        ) : null}
      </form>

      <label className="remote-route">
        <input
          type="checkbox"
          checked={throughApp}
          onChange={(event) => setThroughApp(event.target.checked)}
          disabled={connected}
        />
        <span>
          Route through this app — needed for a <code>ws://</code> image on an https page
        </span>
      </label>

      {message ? <p className="notice notice-error">{message}</p> : null}

      <div className="remote-screen">
        <div className="remote-stage" ref={stageRef} />
        {connected ? null : (
          <div className="remote-placeholder">
            <strong>{profile.label}</strong>
            <span>
              Point this profile at the websockify endpoint of a Windows {profile.label.replace('Windows ', '')} machine,
              then connect.
            </span>
          </div>
        )}
      </div>

      <div className="remote-tools">
        <button
          type="button"
          className={`ghost${keyboardOpen ? ' tool-on' : ''}`}
          onClick={() => setKeyboardOpen((open) => !open)}
          disabled={!connected}
        >
          Virtual keyboard
        </button>
        <button
          type="button"
          className={`ghost${mouseOpen ? ' tool-on' : ''}`}
          onClick={() => setMouseOpen((open) => !open)}
          disabled={!connected}
        >
          Virtual mouse
        </button>
      </div>

      {connected && keyboardOpen ? <VirtualKeyboard onSend={sendKey} onType={typeChar} native /> : null}
      {connected && mouseOpen ? (
        <VirtualMouse
          onMove={move}
          onClick={click}
          onScroll={scroll}
          onDragStart={dragStart}
          onDragEnd={dragEnd}
        />
      ) : null}
    </section>
  );
}
