// gigasnail — slime trail. tiny, dependency-free, respectful of reduced motion.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let last = 0;
  const hues = ['#9dff00', '#21e6d7', '#ff3ec8'];
  let i = 0;
  addEventListener('mousemove', e => {
    const now = performance.now();
    if (now - last < 40) return; // snail pace
    last = now;
    const d = document.createElement('div');
    d.className = 'slime';
    d.style.left = (e.clientX - 3) + 'px';
    d.style.top = (e.clientY + 6) + 'px';
    d.style.background = `radial-gradient(circle, ${hues[i = (i + 1) % 3]}, transparent 70%)`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1500);
  }, { passive: true });
})();

// the archives are corrupted. periodically, visibly.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const logo = document.querySelector('.logo');
  if (!logo) return;
  const orig = logo.innerHTML;
  const noise = '01▓▒░π§Ø×#@%&';
  const glitch = () => {
    if (Math.random() < 0.18) {
      logo.textContent = 'SINCE1992';
    } else {
      logo.textContent = [...logo.textContent]
        .map(c => (Math.random() < 0.45 ? noise[Math.floor(Math.random() * noise.length)] : c))
        .join('');
    }
    setTimeout(() => { logo.innerHTML = orig; }, 140 + Math.random() * 200);
    schedule();
  };
  const schedule = () => setTimeout(glitch, 60000 + Math.random() * 240000);
  schedule();
})();

// π
(() => {
  const pi = document.createElement('a');
  pi.className = 'pi';
  pi.href = '/ghost/';
  pi.textContent = 'π';
  pi.setAttribute('aria-label', 'π');
  document.body.appendChild(pi);
})();
