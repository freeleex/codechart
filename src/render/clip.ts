const MAX_CHARS = 300;

// A minified or generated line would otherwise land whole in the HTML.
export const clip = (l: string) => (l.length > MAX_CHARS ? `${l.slice(0, MAX_CHARS)}…` : l);
