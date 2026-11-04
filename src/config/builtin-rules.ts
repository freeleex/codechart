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

/** Lockfiles and generated files: a change summary's map need not show them. */
export const GENERATED_PATHS = [
  '**/package-lock.json',
  '**/npm-shrinkwrap.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lock',
  '**/bun.lockb',
  '**/Cargo.lock',
  '**/Gemfile.lock',
  '**/poetry.lock',
  '**/uv.lock',
  '**/Pipfile.lock',
  '**/composer.lock',
  '**/go.sum',
  '**/mix.lock',
  '**/pubspec.lock',
  '**/Podfile.lock',
  '**/packages.lock.json',
  '**/flake.lock',
  '**/.terraform.lock.hcl',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.js.map',
  '**/*.css.map',
  '**/__snapshots__/**',
  '**/*.snap',
  '**/*_pb2.py',
  '**/*_pb2_grpc.py',
  '**/*.pb.go',
  '**/*.generated.*',
  '**/*.g.dart',
];

const FLOW_WHEN: Record<Exclude<Flows, 'request'>, string> = {
  auto: 'the change adds or alters behaviour with at least 2 decisions or edge cases a reader would want to see',
  always: 'the change adds or alters any behaviour with at least one decision',
};

export function builtinRules(flows: Flows): Rule[] {
  if (flows === 'request') return MAP_RULES;
  return [...MAP_RULES, { name: 'behaviour-flow', diagram: 'flow', when: FLOW_WHEN[flows], output: 'auto' }];
}
