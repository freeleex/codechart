const OWN_SERVER: Record<string, string> = { gh: 'github.com', glab: 'gitlab.com' };

const TOKEN_VARIABLES = new Set(['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN']);

/** The environment gh or glab runs with for `server`: no token variables for a host other than github.com or gitlab.com, so a look-alike origin never receives them. */
export function toolEnv(command: string, server: string | undefined, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (server === undefined || server === OWN_SERVER[command]) return env;
  return Object.fromEntries(Object.entries(env).filter(([name]) => !TOKEN_VARIABLES.has(name.toUpperCase())));
}
