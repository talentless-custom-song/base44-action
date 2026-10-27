// X11 keysyms used by the VNC protocol for the virtual keyboard.
export const KEYSYMS = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Delete: 0xffff,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Shift: 0xffe1,
  Control: 0xffe3,
  Alt: 0xffe9,
  Meta: 0xffeb,
  CapsLock: 0xffe5,
  Context: 0xff67,
};

const SHIFTED = {
  '`': '~',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
};

// A keysym for one typed character: letters keep the shift modifier, every other
// character is sent as its own (already shifted) keysym.
export function charToKeysym(char, shifted) {
  if (!char) return null;
  if (/[a-zA-Z]/.test(char)) {
    const base = char.toLowerCase();
    return { keysym: base.charCodeAt(0), shift: shifted || char !== base };
  }
  const upper = SHIFTED[char];
  if (upper && !shifted) return { keysym: char.charCodeAt(0), shift: false };
  const lower = Object.keys(SHIFTED).find((base) => SHIFTED[base] === char);
  if (lower) return { keysym: lower.charCodeAt(0), shift: true };
  if (char === ' ') return { keysym: 0x20, shift: false };
  return { keysym: char.charCodeAt(0), shift: false };
}
