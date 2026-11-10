// Runs in the generated release page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
const exItems = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-item]')];

const exAnswered = (card: HTMLElement): boolean => !!card.querySelector('[data-verdict][aria-pressed="true"]');
const exRejected = (card: HTMLElement): boolean => !!card.querySelector('[data-verdict="no"][aria-pressed="true"]');

/** Items still marked "Agent's reading" that have neither a Yes nor a No. */
const exLeft = (): number => exItems().filter((c) => c.querySelector('.confirm') && !exAnswered(c)).length;

function exLabel(btn: HTMLButtonElement): void {
  const left = exLeft();
  const items = `${left} ${left === 1 ? 'item' : 'items'}`;
  btn.disabled = left > 0;
  btn.textContent = left ? `Confirm ${items} to export` : 'Export release';
  btn.title = left ? `Say Yes or No on the ${items} marked "Agent's reading" first` : 'Opens your browser\'s print window: choose "Save as PDF"';
}

/** The printed view: the body class turns the print styles on, and what the owner rejected is left out, with any group that empties. */
function exMark(on: boolean): void {
  document.body.classList.toggle('exporting', on);
  exItems().forEach((c) => c.classList.toggle('rejected', on && exRejected(c)));
  document.querySelectorAll<HTMLElement>('[data-group]').forEach((g) => g.classList.toggle('rejected', on && [...g.querySelectorAll<HTMLElement>('[data-item]')].every(exRejected)));
}

/** The release page's Export button: enabled once every reading has a Yes or No, then prints the page in its export view. */
export function initExport(): void {
  const btn = document.getElementById('export') as HTMLButtonElement | null;
  if (!btn) return;
  // Registered after the business page's own click handler, so the Yes and No buttons are up to date by now.
  window.addEventListener('click', () => exLabel(btn));
  btn.addEventListener('click', () => {
    if (exLeft()) return;
    exMark(true);
    window.print();
  });
  window.addEventListener('afterprint', () => exMark(false));
  exLabel(btn);
}
