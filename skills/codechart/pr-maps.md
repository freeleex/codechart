# Setting up PR maps

Only when the user asks for it ("set up codechart PR maps", "keep the map in my PRs current"). Never set this up on your own: it adds a CI file to their repo.

1. From the repo root, run `codechart setup-pr-maps` (no `--yes`). It changes nothing: it prints the file it would add (or the job it would append to `.gitlab-ci.yml`), the token it uses and what runs on each push.
2. Show the user that plan in full and ask whether to go ahead, and how:
   - write the file into their work tree, uncommitted (`codechart setup-pr-maps --yes`), for them to review and commit;
   - or open a pull/merge request with it (`codechart setup-pr-maps --yes --pr`, needs `gh` or `glab` signed in), which they merge to turn it on or close to say no.
3. Run what they chose. Never commit or push the file yourself unless they ask.
4. GitLab: the job needs a masked CI/CD variable `CODECHART_GITLAB_TOKEN`. Give the user the two links the command printed (create an access token with `api` scope, then add it under Settings > CI/CD > Variables). Never ask for the token or set it yourself.
5. Say what happens next: from then on, PR/MR descriptions you write for a mapped change get the map section (SKILL.md step 4), and CI redraws it on every push.

Output `PR maps are already set up`: tell the user, nothing to do. `can't tell whether … is GitHub or GitLab`: ask which, then add `--host github` or `--host gitlab`. `… already exists and is not codechart's`: show the message; the user sets it up by hand: https://github.com/freeleex/codechart/blob/main/docs/pr-maps.md#by-hand
