/* Merlin landing page — small bits of behavior:
   - Typing speech bubble that cycles taglines
   - Optional cursor sparkle trail (toggled by Tweaks)
*/

(function () {
  const taglines = [
    "Greetings, traveler.",
    "I see your code. It compiles, mostly.",
    "Ask me anything. Even Clippy-shaped questions.",
    "I missed 2009. Did anything interesting happen?",
    "Bring your own brain.",
    "✦ ready to assist ✦"
  ];

  const target = document.getElementById('bubble-text');
  if (!target) return;

  let idx = 0;
  let charIdx = 0;
  let phase = 'typing'; // typing | pausing | erasing
  let timer;

  function tick() {
    const current = taglines[idx];
    if (phase === 'typing') {
      charIdx++;
      target.textContent = current.slice(0, charIdx);
      if (charIdx >= current.length) {
        phase = 'pausing';
        timer = setTimeout(tick, 2400);
        return;
      }
      timer = setTimeout(tick, 45 + Math.random() * 40);
    } else if (phase === 'pausing') {
      phase = 'erasing';
      timer = setTimeout(tick, 30);
    } else if (phase === 'erasing') {
      charIdx--;
      target.textContent = current.slice(0, charIdx);
      if (charIdx <= 0) {
        idx = (idx + 1) % taglines.length;
        phase = 'typing';
        timer = setTimeout(tick, 400);
        return;
      }
      timer = setTimeout(tick, 22);
    }
  }
  tick();

  // ---- Cursor sparkle trail (off by default; toggled by Tweaks) ----
  let trailEnabled = false;
  let lastTrail = 0;
  document.addEventListener('mousemove', (e) => {
    if (!trailEnabled) return;
    const now = performance.now();
    if (now - lastTrail < 50) return;
    lastTrail = now;
    const d = document.createElement('div');
    d.className = 'trail-dot';
    d.style.left = (e.clientX - 3) + 'px';
    d.style.top  = (e.clientY - 3) + 'px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 800);
  });

  window.__merlinSetTrail = (on) => { trailEnabled = !!on; };
})();
