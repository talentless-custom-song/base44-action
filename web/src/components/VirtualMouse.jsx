import { useRef } from 'react';

// Trackpad for the remote desktop: drag moves the remote pointer, tap clicks,
// long-press holds the left button so items can be dragged inside Windows.
export default function VirtualMouse({ onMove, onClick, onScroll, onDragStart, onDragEnd }) {
  const gesture = useRef({ active: false, lastX: 0, lastY: 0, moved: false, dragging: false, timer: null });

  const clearTimer = () => {
    if (gesture.current.timer) {
      clearTimeout(gesture.current.timer);
      gesture.current.timer = null;
    }
  };

  const down = (event) => {
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    gesture.current = {
      active: true,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      dragging: false,
      timer: setTimeout(() => {
        gesture.current.dragging = true;
        onDragStart();
      }, 320),
    };
  };

  const move = (event) => {
    const state = gesture.current;
    if (!state.active) return;
    const dx = event.clientX - state.lastX;
    const dy = event.clientY - state.lastY;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    if (!state.moved && Math.abs(dx) + Math.abs(dy) > 2) {
      state.moved = true;
      clearTimer();
    }
    onMove(dx * 1.6, dy * 1.6);
  };

  const up = (event) => {
    const state = gesture.current;
    if (!state.active) return;
    state.active = false;
    clearTimer();
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* ignore */
    }
    if (state.dragging) onDragEnd();
    else if (!state.moved) onClick('left');
    state.dragging = false;
  };

  return (
    <div className="vm">
      <div
        className="vm-trackpad"
        role="application"
        aria-label="Virtual mouse trackpad"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <span>Drag to move · tap to click · long-press to drag</span>
      </div>
      <div className="vm-buttons">
        <button type="button" className="ghost" onClick={() => onClick('left')}>
          Left click
        </button>
        <button type="button" className="ghost" onClick={() => onClick('right')}>
          Right click
        </button>
        <button type="button" className="ghost" onClick={() => onScroll('up')}>
          Scroll ▲
        </button>
        <button type="button" className="ghost" onClick={() => onScroll('down')}>
          Scroll ▼
        </button>
      </div>
    </div>
  );
}
