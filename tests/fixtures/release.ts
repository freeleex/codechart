// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests edit fields freely
export const release = (): Record<string, any> => ({
  diagram: 'release',
  title: 'What is new in Shop 2.0',
  version: '2.0.0',
  date: '2026-11-09',
  since: '1.4.0',
  summary: 'Customers can get money back faster, and managers approve large refunds.',
  sections: [
    {
      id: 'refunds',
      title: 'Faster refunds',
      change: 'new',
      summary: 'Support agents give back part of a payment without asking a manager first.',
      pr: 41,
      journeys: [
        {
          id: 'J1',
          name: 'Support agent gives back part of a payment',
          who: 'Support agent',
          now: [{ text: 'Customer asks for money back' }, { text: 'Agent passes it to a manager', change: 'removed' }],
          after: [{ text: 'Customer asks for money back' }, { text: 'Agent enters the amount and a reason', change: 'new' }],
          evidence: 'checked',
        },
        { id: 'J2', name: 'Money reaches the customer', now: [{ text: 'Every refund waits for the nightly run' }], after: [{ text: 'Card refunds are sent straight away', change: 'new' }], evidence: 'reading' },
      ],
      rules: [{ id: 'R1', name: 'Manager approval', after: 'A refund above 100 euros waits for the agent\'s manager.', evidence: 'reading' }],
      questions: [{ id: 'Q1', about: 'R1', text: 'What happens when an agent has no manager?', kind: 'unhandled' }],
    },
    {
      id: 'window',
      title: 'Shorter refund window',
      change: 'changed',
      summary: 'Monthly plans have 14 days to ask for a refund instead of 30.',
      rules: [{ id: 'R2', name: 'Refund window', before: 'Up to 30 days after paying.', after: 'Up to 14 days after paying.', exceptions: ['Annual plans keep 30 days.'], evidence: 'checked' }],
      data: [{ id: 'D1', name: 'Refund reason', what: 'Why each refund was given and who approved it', why: 'So finance can review refunds later', evidence: 'reading' }],
    },
    { id: 'emails', title: 'Receipts open again', change: 'fixed', summary: 'Receipt emails no longer end up in the spam folder.' },
  ],
});
