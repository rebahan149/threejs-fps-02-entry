// input.js — keyboard and mouse for the human player. Held keys live in a Set,
// mouse movement accumulates into dx/dy that player.js consumes once a frame,
// and one-shot actions (reload, buy, weapon slots, interact) are delivered
// through the onAction callback main.js registers.

export const Input = {
  keys: new Set(),
  dx: 0, dy: 0,
  firing: false,
  aiming: false, // right mouse held (DMR scope)
  locked: false,
  onAction: null, // (code) => {}
  onLockChange: null, // (locked) => {}
};

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyB', 'KeyE', 'KeyG',
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Tab',
]);

export function attachInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      Input.keys.add(e.code);
      if (Input.onAction) Input.onAction(e.code, true);
    }
  });
  window.addEventListener('keyup', (e) => {
    Input.keys.delete(e.code);
    if (Input.onAction) Input.onAction(e.code, false);
  });
  window.addEventListener('blur', () => { Input.keys.clear(); Input.firing = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (!Input.locked) return;
    if (e.button === 0) Input.firing = true;
    if (e.button === 2) Input.aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) Input.firing = false;
    if (e.button === 2) Input.aiming = false;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('mousemove', (e) => {
    if (!Input.locked) return;
    Input.dx += e.movementX || 0;
    Input.dy += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    Input.locked = document.pointerLockElement === canvas;
    if (!Input.locked) { Input.firing = false; Input.aiming = false; Input.keys.clear(); }
    if (Input.onLockChange) Input.onLockChange(Input.locked);
  });
}

export function requestLock(canvas) {
  canvas.requestPointerLock();
}

export function held(code) { return Input.keys.has(code); }
