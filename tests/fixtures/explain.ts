// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests edit fields freely
export const explain = (): Record<string, any> => ({
  title: 'How billing works',
  kind: 'explain',
  nodes: [
    { id: 'api', label: 'POST /invoices', kind: 'endpoint', status: 'existing', layer: 'api', path: 'app/api.ts', match: 'export function createInvoice', summary: 'Creates an invoice and starts the charge.' },
    { id: 'billing', label: 'BillingService', kind: 'service', status: 'existing', layer: 'billing', path: 'app/billing.ts', match: 'class BillingService', notes: ['A zero total skips the charge.'] },
    { id: 'email', label: 'EmailService', kind: 'service', status: 'outside', layer: 'other areas', path: 'app/email.ts' },
    { id: 'stripe', label: 'Stripe API', kind: 'other', status: 'outside', layer: 'other areas' },
  ],
  edges: [
    { from: 'api', to: 'billing', label: 'create_invoice', kind: 'calls' },
    { from: 'billing', to: 'email', label: 'receipt', kind: 'calls' },
    { from: 'billing', to: 'stripe', label: 'charge', kind: 'calls' },
  ],
  gaps: ['refund job: not read'],
});

export const EXPLAIN_FILES: Record<string, string> = {
  'app/api.ts': 'export function createInvoice() {}\n',
  'app/billing.ts': 'export class BillingService {}\n',
  'app/email.ts': 'export class EmailService {}\n',
};

/** The billing map with two flows: one branches on a zero total, one sends the receipt. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests edit fields freely
export const withFlows = (): Record<string, any> => ({
  ...explain(),
  flows: [
    {
      id: 'create',
      title: 'Create an invoice',
      start: 'receive',
      steps: [
        { id: 'receive', label: 'Receive the request', status: 'existing', source: 'app/api.ts', match: 'createInvoice', box: 'api' },
        { id: 'zero', label: 'Is the total zero?', status: 'existing', source: 'app/billing.ts', match: 'BillingService', box: 'billing' },
        { id: 'skip', label: 'Skip the charge', status: 'existing', source: 'app/billing.ts', match: 'BillingService', box: 'billing' },
        { id: 'charge', label: 'Charge the card', status: 'existing', source: 'app/billing.ts', match: 'BillingService' },
      ],
      links: [
        { from: 'receive', to: 'zero' },
        { from: 'zero', to: 'skip', label: 'yes', source: 'app/billing.ts', match: 'BillingService' },
        { from: 'zero', to: 'charge', label: 'no', source: 'app/billing.ts', match: 'BillingService' },
      ],
      gaps: ['retries: not read'],
    },
    {
      id: 'receipt',
      title: 'Send the receipt',
      start: 'build',
      steps: [
        { id: 'build', label: 'Build the receipt', status: 'existing', source: 'app/billing.ts', match: 'BillingService', box: 'billing' },
        { id: 'mail', label: 'Email it', status: 'existing', source: 'app/email.ts', match: 'EmailService', box: 'email' },
      ],
      links: [{ from: 'build', to: 'mail' }],
    },
  ],
});
