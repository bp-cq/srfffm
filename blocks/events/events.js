import { getLanguage } from '../../scripts/i18n.js';

const PAGE_SIZE = 14;

const LABELS = {
  de: {
    more: 'Zeig mehr',
    share: 'Hinzufügen und teilen',
    add: 'Zum Kalender hinzufügen',
  },
  en: {
    more: 'Show more',
    share: 'Add and share',
    add: 'Add to calendar',
  },
};

/**
 * Parses an ISO date or date-time; all-day dates are taken as local midnight.
 * @param {string} value ISO 8601 value
 * @returns {number} Milliseconds since the epoch
 */
function parseDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`).getTime() : Date.parse(value);
}

/**
 * Builds one list entry from an authored row
 * (cells: date, time, details, start/end).
 * @param {Element} row The block row
 * @param {object} labels Localised labels
 * @param {number} index Row index (for ids)
 * @returns {Element|null} The entry, or null if the event is over
 */
function buildEntry(row, labels, index) {
  const [date, time, details, meta] = [...row.children];
  const [start = '', end = ''] = [...(meta?.querySelectorAll('p') || [])].map((p) => p.textContent.trim());
  if (end && parseDate(end) <= Date.now()) return null;

  const li = document.createElement('li');
  li.className = 'events-entry';
  li.dataset.month = start.slice(0, 7);

  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'events-summary';
  summary.setAttribute('aria-expanded', 'false');
  const detailsId = `events-details-${index}`;
  summary.setAttribute('aria-controls', detailsId);

  const dateEl = document.createElement('span');
  dateEl.className = 'events-date';
  const [day, month, weekday] = [...(date?.querySelectorAll('p') || [])].map((p) => p.textContent.trim());
  dateEl.innerHTML = '<span class="events-day"></span><span class="events-labels"><span class="events-month"></span><span class="events-weekday"></span></span>';
  dateEl.querySelector('.events-day').textContent = day || '';
  dateEl.querySelector('.events-month').textContent = month || '';
  dateEl.querySelector('.events-weekday').textContent = weekday || '';

  const timeEl = document.createElement('span');
  timeEl.className = 'events-time';
  timeEl.textContent = time?.textContent.trim() || '';

  const heading = details?.querySelector('h1, h2, h3, h4, h5, h6');
  const titleEl = document.createElement('span');
  titleEl.className = 'events-title';
  titleEl.textContent = heading?.textContent.trim() || '';
  heading?.remove();
  summary.append(dateEl, timeEl, titleEl);

  const panel = document.createElement('div');
  panel.className = 'events-details';
  panel.id = detailsId;
  panel.hidden = true;
  const links = details?.querySelector('ul');
  links?.remove();
  if (details) panel.append(...details.childNodes);
  if (links) {
    const share = document.createElement('div');
    share.className = 'events-share';
    share.innerHTML = '<p class="events-share-title"></p><p class="events-share-label"></p>';
    share.querySelector('.events-share-title').textContent = labels.share;
    share.querySelector('.events-share-label').textContent = labels.add;
    links.className = 'events-links';
    links.querySelectorAll('a').forEach((a) => {
      a.className = '';
      a.target = '_blank';
      a.rel = 'noopener';
    });
    share.append(links);
    panel.append(share);
  }

  summary.addEventListener('click', () => {
    const open = summary.getAttribute('aria-expanded') !== 'true';
    summary.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
  });

  li.append(summary, panel);
  return li;
}

/**
 * Shows the next page of entries and marks month changes.
 * @param {Element} list The list
 * @param {Element} more The "show more" button
 * @param {number} count Number of entries to show
 */
function reveal(list, more, count) {
  const entries = [...list.children];
  entries.forEach((li, i) => {
    li.hidden = i >= count;
    li.classList.toggle('events-month-start', i > 0 && li.dataset.month !== entries[i - 1].dataset.month);
  });
  more.hidden = count >= entries.length;
}

/**
 * Upcoming events list, rendered from the calendar feed at preview time (json2html).
 * @param {Element} block The events block
 */
export default function decorate(block) {
  const labels = LABELS[getLanguage()];
  const list = document.createElement('ol');
  list.className = 'events-list';
  [...block.children].forEach((row, i) => {
    const entry = buildEntry(row, labels, i);
    if (entry) list.append(entry);
  });

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'events-more';
  more.textContent = labels.more;
  let shown = PAGE_SIZE;
  more.addEventListener('click', () => {
    shown += PAGE_SIZE;
    reveal(list, more, shown);
  });

  block.replaceChildren(list, more);
  reveal(list, more, shown);
}
