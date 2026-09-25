import { getLanguage } from '../../scripts/i18n.js';

const INTERVAL = 8000;

const LABELS = {
  de: { prev: 'Zurück', next: 'Weiter', region: 'Diashow' },
  en: { prev: 'Previous', next: 'Next', region: 'Slideshow' },
};

const ARROW = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 41" aria-hidden="true"><path d="M20.3 40.8 0 20.5 20.3.2l.7.7L1.3 20.5 21 40.1z"/></svg>';

/**
 * Shows the slide with the given index.
 * @param {Element} block The slideshow block
 * @param {number} index The slide index (wraps around)
 */
function showSlide(block, index) {
  const slides = [...block.querySelectorAll('.slideshow-slide')];
  const next = (index + slides.length) % slides.length;
  slides.forEach((slide, i) => {
    const active = i === next;
    slide.classList.toggle('active', active);
    slide.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  block.dataset.activeSlide = next;
}

/**
 * Decorates the slideshow: each row is a slide with an image cell and a text cell.
 * @param {Element} block The slideshow block
 */
export default function decorate(block) {
  const labels = LABELS[getLanguage()];
  const slides = [...block.children];
  slides.forEach((row) => {
    row.classList.add('slideshow-slide');
    [...row.children].forEach((cell) => {
      if (cell.querySelector('picture') && !cell.textContent.trim()) {
        cell.classList.add('slideshow-image');
      } else if (cell.textContent.trim()) {
        cell.classList.add('slideshow-text');
      } else {
        cell.remove();
      }
    });
  });
  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', 'carousel');
  block.setAttribute('aria-label', labels.region);
  showSlide(block, 0);
  if (slides.length < 2) return;

  // the first image is the LCP candidate, the others can load later
  slides.slice(1).forEach((row) => row.querySelector('img')?.setAttribute('loading', 'lazy'));

  let timer;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const go = (step) => showSlide(block, Number(block.dataset.activeSlide) + step);
  const stop = () => clearInterval(timer);
  const start = () => {
    stop();
    if (!reducedMotion) timer = setInterval(() => go(1), INTERVAL);
  };

  ['prev', 'next'].forEach((dir) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `slideshow-${dir}`;
    button.setAttribute('aria-label', labels[dir]);
    button.innerHTML = ARROW;
    button.addEventListener('click', () => {
      go(dir === 'next' ? 1 : -1);
      start();
    });
    block.append(button);
  });

  block.addEventListener('mouseenter', stop);
  block.addEventListener('mouseleave', start);
  block.addEventListener('focusin', stop);
  block.addEventListener('focusout', start);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();
}
