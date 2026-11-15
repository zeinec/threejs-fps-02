// game/src/input.js: pointer-lock mouse and keyboard input state.
export function createInput(canvas) {
  const input = {
    keys: new Set(), lookDX: 0, lookDY: 0, firing: false, locked: false,
    consumeLook() {
      const result = { dx: this.lookDX, dy: this.lookDY };
      this.lookDX = 0;
      this.lookDY = 0;
      return result;
    },
    isDown(code) { return this.keys.has(code); },
    attach() {
      if (this.attached) return;
      this.attached = true;
      document.addEventListener('pointerlockchange', onLockChange);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
    },
    detach() {
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      this.keys.clear();
      this.firing = false;
      this.locked = false;
      this.attached = false;
    },
    requestLock() {
      if (canvas.requestPointerLock) canvas.requestPointerLock();
    },
    attached: false
  };
  function onLockChange() { input.locked = document.pointerLockElement === canvas; }
  function onMouseMove(event) {
    if (!input.locked) return;
    input.lookDX += event.movementX || 0;
    input.lookDY += event.movementY || 0;
  }
  function onMouseDown(event) { if (event.button === 0) input.firing = true; }
  function onMouseUp(event) { if (event.button === 0) input.firing = false; }
  function onKeyDown(event) {
    input.keys.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) { input.keys.delete(event.code); }
  return input;
}
