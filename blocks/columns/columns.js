/**
 * Groups a button and a directly following icon image (the lotus next to "Mehr Info")
 * so they can be laid out side by side.
 * @param {Element} col The column cell
 */
function groupCallToAction(col) {
  col.querySelectorAll(':scope > .button-wrapper').forEach((button) => {
    const isIcon = (el) => el?.tagName === 'P' && el.querySelector('picture') && !el.textContent.trim();
    const icon = [button.nextElementSibling, button.previousElementSibling].find(isIcon);
    const cta = document.createElement('div');
    cta.className = 'columns-cta';
    button.before(cta);
    cta.append(button);
    if (icon) {
      icon.classList.add('columns-cta-icon');
      cta.append(icon);
    }
  });
}

/**
 * Full-bleed image rows keep the height the source shows them at (the image is imported
 * in that aspect ratio for a 720px wide column).
 * @param {Element} row The block row
 * @param {Element} img The cover image
 */
function setRowHeight(row, img) {
  const width = Number(img.getAttribute('width'));
  const height = Number(img.getAttribute('height'));
  if (width && height) row.style.setProperty('--row-height', `${Math.round((720 * height) / width)}px`);
}

export default function decorate(block) {
  const cols = [...block.firstElementChild.children];
  block.classList.add(`columns-${cols.length}-cols`);
  const cover = ['tiles', 'split', 'aside'].some((v) => block.classList.contains(v));

  // setup image columns
  [...block.children].forEach((row) => {
    [...row.children].forEach((col) => {
      const pics = col.querySelectorAll('picture');
      if (pics.length === 1 && !col.textContent.trim()) {
        // picture is only content in column
        col.classList.add('columns-img-col');
        if (cover) setRowHeight(row, col.querySelector('img'));
      } else if (pics.length && !col.textContent.trim()) {
        col.classList.add('columns-media-col');
      }
      // small decorative images (lotus icons) scale down on phones
      col.querySelectorAll('img').forEach((img) => {
        if (Number(img.getAttribute('width')) <= 180) img.classList.add('columns-icon');
      });
      groupCallToAction(col);
    });
  });
}
