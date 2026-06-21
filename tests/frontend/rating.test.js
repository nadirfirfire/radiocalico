/**
 * @jest-environment jsdom
 *
 * Front-end tests for the shared rating/format helpers in public/rating.js.
 */
const { escapeHtml, fmtTime, nextVote, ratingHtml } = require('../../public/rating.js');

describe('escapeHtml', () => {
  test('escapes HTML-significant characters', () => {
    expect(escapeHtml('<script>alert("x")&\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;'
    );
  });

  test('handles null/undefined as empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('leaves plain text unchanged', () => {
    expect(escapeHtml('Fleetwood Mac')).toBe('Fleetwood Mac');
  });
});

describe('fmtTime', () => {
  test.each([
    [0, '0:00'],
    [5, '0:05'],
    [65, '1:05'],
    [600, '10:00'],
    [3661, '61:01'],
  ])('formats %i seconds as %s', (secs, expected) => {
    expect(fmtTime(secs)).toBe(expected);
  });

  test('clamps non-finite / negative input to 0:00', () => {
    expect(fmtTime(NaN)).toBe('0:00');
    expect(fmtTime(-10)).toBe('0:00');
    expect(fmtTime(Infinity)).toBe('0:00');
  });
});

describe('nextVote (toggle logic)', () => {
  test('clicking a new value selects it', () => {
    expect(nextVote(0, 1)).toBe(1);
    expect(nextVote(0, -1)).toBe(-1);
  });

  test('clicking the current value retracts it (0)', () => {
    expect(nextVote(1, 1)).toBe(0);
    expect(nextVote(-1, -1)).toBe(0);
  });

  test('switching sides selects the new side', () => {
    expect(nextVote(1, -1)).toBe(-1);
    expect(nextVote(-1, 1)).toBe(1);
  });

  test('treats undefined current as no vote', () => {
    expect(nextVote(undefined, 1)).toBe(1);
  });
});

describe('ratingHtml', () => {
  // Parse the returned markup so we can assert on the actual DOM.
  function parse(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
  }

  test('renders the up/down counts', () => {
    const el = parse(ratingHtml({ id: 1, thumbs_up: 7, thumbs_down: 3 }, 0));
    const counts = [...el.querySelectorAll('.rate-count')].map((n) => n.textContent);
    expect(counts).toEqual(['7', '3']);
  });

  test('defaults missing counts to 0', () => {
    const el = parse(ratingHtml({ id: 1 }, 0));
    const counts = [...el.querySelectorAll('.rate-count')].map((n) => n.textContent);
    expect(counts).toEqual(['0', '0']);
  });

  test('marks the up button active when mine = 1', () => {
    const el = parse(ratingHtml({ id: 1, thumbs_up: 1, thumbs_down: 0 }, 1));
    const up = el.querySelector('.rate-btn.up');
    const down = el.querySelector('.rate-btn.down');
    expect(up.classList.contains('active')).toBe(true);
    expect(up.getAttribute('aria-pressed')).toBe('true');
    expect(down.classList.contains('active')).toBe(false);
  });

  test('marks the down button active when mine = -1', () => {
    const el = parse(ratingHtml({ id: 1 }, -1));
    expect(el.querySelector('.rate-btn.down').classList.contains('active')).toBe(true);
    expect(el.querySelector('.rate-btn.up').classList.contains('active')).toBe(false);
  });

  test('neither button active when mine = 0', () => {
    const el = parse(ratingHtml({ id: 1 }, 0));
    expect(el.querySelectorAll('.rate-btn.active')).toHaveLength(0);
  });

  test('buttons carry the data-rate / data-value attributes used by the click handler', () => {
    const el = parse(ratingHtml({ id: 1 }, 0));
    const values = [...el.querySelectorAll('[data-rate]')].map((b) => b.getAttribute('data-value'));
    expect(values).toEqual(['1', '-1']);
  });
});
