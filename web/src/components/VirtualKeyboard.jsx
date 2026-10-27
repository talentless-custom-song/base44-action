import { useState } from 'react';
import { KEYSYMS, charToKeysym } from '../lib/keysyms.js';

// Mobile-friendly key rows. Single characters are typed through the keysym map,
// the named entries go straight to the remote desktop.
const ROWS = [
  ['Escape', 'Tab', 'Backspace', 'Delete'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'Enter'],
  ['Shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'Shift'],
  ['CapsLock', 'Control', 'Meta', 'Alt', ' ', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'],
];

const LABELS = {
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: 'Del',
  Enter: 'Enter',
  Shift: 'Shift',
  Control: 'Ctrl',
  Meta: 'Win',
  Alt: 'Alt',
  CapsLock: 'Caps',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowRight: '→',
  ' ': 'Space',
};

const MODIFIERS = {
  Shift: 'shift',
  Control: 'ctrl',
  Meta: 'meta',
  Alt: 'alt',
  CapsLock: 'caps',
};

export default function VirtualKeyboard({ onSend, onType, native }) {
  const [mods, setMods] = useState({ shift: false, ctrl: false, alt: false, meta: false, caps: false });

  const releaseModifiers = () => {
    const pressed = [];
    if (mods.shift) pressed.push(KEYSYMS.Shift);
    if (mods.ctrl) pressed.push(KEYSYMS.Control);
    if (mods.alt) pressed.push(KEYSYMS.Alt);
    if (mods.meta) pressed.push(KEYSYMS.Meta);
    return pressed;
  };

  const emit = (keysym, needsShift) => {
    const held = releaseModifiers();
    if (needsShift && !mods.shift) held.unshift(KEYSYMS.Shift);
    held.forEach((key) => onSend(key, true));
    onSend(keysym, true);
    onSend(keysym, false);
    [...held].reverse().forEach((key) => onSend(key, false));
    setMods({ shift: false, ctrl: false, alt: false, meta: false, caps: mods.caps });
  };

  const press = (token) => {
    const modifier = MODIFIERS[token];
    if (modifier) {
      setMods((current) => ({ ...current, [modifier]: !current[modifier] }));
      return;
    }
    if (token.length === 1) {
      const letter = /[a-zA-Z]/.test(token);
      const character = letter
        ? mods.shift !== mods.caps
          ? token.toUpperCase()
          : token.toLowerCase()
        : token;
      const mapped = charToKeysym(character, letter ? false : mods.shift);
      if (mapped) emit(mapped.keysym, mapped.shift);
      return;
    }
    const keysym = KEYSYMS[token];
    if (keysym) emit(keysym, false);
  };

  // The phone's own keyboard: every typed character and named key is forwarded
  // as a VNC key event, so no layout has to be mirrored.
  const nativeChange = (event) => {
    const text = event.target.value;
    for (const character of text) onType(character);
  };

  const nativeKey = (event) => {
    const keysym = KEYSYMS[event.key];
    if (keysym) {
      event.preventDefault();
      onSend(keysym, true);
      onSend(keysym, false);
    }
  };

  return (
    <div className="vk">
      <div className="vk-rows">
        {ROWS.map((row, index) => (
          <div className="vk-row" key={`row-${index}`}>
            {row.map((token, position) => {
              const active = MODIFIERS[token] ? mods[MODIFIERS[token]] : false;
              return (
                <button
                  key={`${token}-${index}-${position}`}
                  type="button"
                  className={`vk-key${active ? ' vk-on' : ''}${token.length > 1 ? ' vk-wide' : ''}`}
                  onClick={() => press(token)}
                  aria-pressed={MODIFIERS[token] ? active : undefined}
                >
                  {LABELS[token] || token}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {native ? (
        <label className="vk-native">
          <span>Phone keyboard</span>
          <input
            value=""
            onChange={nativeChange}
            onKeyDown={nativeKey}
            placeholder="Tap here to type with your phone keyboard"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
      ) : null}
    </div>
  );
}
