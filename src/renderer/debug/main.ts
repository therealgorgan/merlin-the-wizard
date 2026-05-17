import { ANIMATIONS, type AnimationName } from '@shared/animations';

const grid = document.getElementById('animation-grid')!;
const filterInput = document.getElementById('filter') as HTMLInputElement;
const showBtn = document.getElementById('btn-show')!;
const hideBtn = document.getElementById('btn-hide')!;

const buttons: HTMLButtonElement[] = [];

function trigger(name: AnimationName): void {
  if (!window.debugApi) {
    console.warn('debugApi not exposed by preload');
    return;
  }
  window.debugApi.play(name);
}

for (const name of ANIMATIONS) {
  const btn = document.createElement('button');
  btn.textContent = name;
  btn.dataset.name = name;
  btn.addEventListener('click', () => trigger(name));
  grid.appendChild(btn);
  buttons.push(btn);
}

filterInput.addEventListener('input', () => {
  const q = filterInput.value.trim().toLowerCase();
  for (const b of buttons) {
    const n = (b.dataset.name ?? '').toLowerCase();
    b.classList.toggle('hidden', q.length > 0 && !n.includes(q));
  }
});

showBtn.addEventListener('click', () => window.debugApi?.show());
hideBtn.addEventListener('click', () => window.debugApi?.hide());
