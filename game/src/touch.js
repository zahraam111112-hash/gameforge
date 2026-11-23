// On-screen controls for phones. Built as DOM so the canvas stays pure pixels.
export function attachTouchControls(root, input) {
  if (!('ontouchstart' in globalThis)) return;
  const bar = document.createElement('div');
  bar.id = 'touchbar';
  bar.innerHTML = `
    <div class="tgroup tleft">
      <button data-touch="left" aria-label="left">◀</button>
      <button data-touch="right" aria-label="right">▶</button>
    </div>
    <div class="tgroup tright">
      <button data-touch="attack" aria-label="attack">J</button>
      <button data-touch="dash" aria-label="dash">K</button>
      <button data-touch="jump" aria-label="jump">⤒</button>
    </div>`;
  root.appendChild(bar);
  input.bindTouch(bar);
}
