const node = (id: string) => ({ id, label: id.replace(/-/g, ' '), kind: 'other', status: 'changed', layer: 'app' });

export const TECH_IDS = ['refund-policy', 'subscription-model', 'refunds', 'approvals', 'refund-requests', 'email', 'instant-refunds-flag'];

export const TECH = { title: 'Refund rules', kind: 'summary', nodes: TECH_IDS.map(node), edges: [] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests edit fields freely
export const business = (): Record<string, any> => ({
  diagram: 'business',
  title: 'New refund rules',
  summary: 'Monthly plans now have 14 days to get a refund instead of 30. Large partial refunds wait for a manager.',
  journeys: [
    {
      id: 'J1',
      name: 'Support agent gives back part of a payment',
      who: 'Support agent',
      now: [{ text: 'Customer asks for money back' }, { text: 'Agent passes it to a manager', change: 'removed' }],
      after: [
        { text: 'Customer asks for money back' },
        { text: 'Agent enters the amount and a reason', change: 'new' },
        { text: 'Above €100: the manager gets an approval email', change: 'new' },
      ],
      links: ['refund-requests', 'approvals', 'email'],
      evidence: 'checked',
    },
    {
      id: 'J2',
      name: 'Money reaches the customer',
      now: [{ text: 'Every refund waits for the nightly run' }],
      after: [{ text: 'Paid by card with the switch on: money is sent straight away', change: 'new' }],
      links: ['instant-refunds-flag'],
      evidence: 'reading',
    },
  ],
  rules: [
    {
      id: 'R1',
      name: 'Refund window',
      before: 'A customer could get a refund up to 30 days after paying.',
      after: 'A customer can get a refund up to 14 days after paying (2.5 weeks for e.g. annual plans is not offered).',
      exceptions: ['Annual plans keep 30 days.'],
      links: ['refund-policy', 'subscription-model'],
      evidence: 'checked',
    },
    { id: 'R2', name: 'Manager approval', after: 'A refund above €100 waits for the agent\'s manager. Say "Refund now" only below that.', links: ['approvals'], evidence: 'reading' },
  ],
  data: [{ id: 'D1', name: 'Refund reason', what: 'Why each refund was given and who approved it', why: 'So finance can review refunds later', links: ['refunds'], evidence: 'checked' }],
  questions: [{ id: 'Q1', about: 'R2', text: 'What happens when an agent has no manager?', kind: 'unhandled' }],
});

export const EXPLAIN_TECH_IDS = ['api', 'billing', 'email', 'stripe', 'flow:create/zero', 'flow:create/skip'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests edit fields freely
export const businessExplain = (): Record<string, any> => ({
  diagram: 'business',
  kind: 'explain',
  title: 'How billing works',
  summary: 'Customers get an invoice and are charged by card. A receipt goes out by email.',
  journeys: [
    {
      id: 'J1',
      name: 'Customer is billed',
      who: 'Customer',
      steps: [{ text: 'An invoice is created' }, { text: 'The charge is skipped', if: 'the total is zero' }, { text: 'The card is charged' }],
      links: ['api', 'flow:create/zero'],
      evidence: 'checked',
    },
  ],
  rules: [{ id: 'R1', name: 'Free invoices', rule: 'An invoice of zero is never charged.', exceptions: ['A test account is charged a cent.'], links: ['billing', 'flow:create/skip'], evidence: 'reading' }],
  cases: [{ id: 'C1', situation: 'The card is declined', outcome: 'The invoice stays open and the customer is emailed.', links: ['stripe', 'email'], evidence: 'checked' }],
  data: [{ id: 'D1', name: 'Invoice', what: 'Amount, date and who paid', why: 'So finance can check the books', links: ['billing'], evidence: 'checked' }],
  questions: [{ id: 'Q1', about: 'C1', text: 'Is a declined card tried again?', kind: 'unhandled' }],
});
