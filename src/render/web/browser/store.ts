// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.

// Storage can be blocked (file://, privacy modes); the page then just forgets its settings.
export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered
  }
}
