import type { Flows, Rule } from './schema.js';

const MAP_RULES: Rule[] = [
  {
    name: 'migrations',
    paths: [
      '**/migrations/**',
      '**/alembic/versions/**',
      '**/db/migrate/**',
      '**/database/migrations/**',
      '**/drizzle/**',
    ],
  },
  {
    name: 'orm-schema',
    paths: [
      '**/prisma/schema.prisma',
      '**/models.py',
      '**/models/**',
      '**/entities/**',
      '**/*.entity.ts',
      '**/app/models/**',
    ],
  },
  {
    name: 'infrastructure',
    // No bare charts/** or templates/**: UI chart components and non-Helm templates live there too.
    paths: [
      '**/*.tf',
      '**/*.tofu',
      '**/*.tf.json',
      '**/*.tfvars',
      '**/*.tfvars.json',
      '**/terragrunt.hcl',
      '**/Chart.yaml',
      '**/values.yaml',
      '**/values-*.yaml',
      '**/charts/**/*.yaml',
      '**/charts/**/*.tpl',
      '**/helm/**/*.yaml',
      '**/helm/**/*.tpl',
      '**/kustomization.yaml',
      '**/kustomization.yml',
      '**/k8s/**/*.yaml',
      '**/k8s/**/*.yml',
      '**/kubernetes/**/*.yaml',
      '**/kubernetes/**/*.yml',
    ],
  },
  {
    name: 'related-files',
    when: 'more than 2 changed files depend on each other',
  },
];

const FLOW_WHEN: Record<Exclude<Flows, 'request'>, string> = {
  auto: 'the change adds or alters behaviour with at least 2 decisions or edge cases a reader would want to see',
  always: 'the change adds or alters any behaviour with at least one decision',
};

export function builtinRules(flows: Flows): Rule[] {
  if (flows === 'request') return MAP_RULES;
  return [...MAP_RULES, { name: 'behaviour-flow', diagram: 'flow', when: FLOW_WHEN[flows], output: 'auto' }];
}
