import { fileSlug } from '../output-path.js';

/** "v1.2.0-beta.1" and "1.2.0-beta.1" both give "1-2-0-beta-1". */
export const versionSlug = (version: string): string =>
  version
    .replace(/^v(?=\d)/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The file slug of a release page: the version leads, then `--` (a title slug never has one), so `check` can tell whether a release was already drawn even when the title starts with digits. */
export const releaseSlug = (version: string, title: string): string => `v${versionSlug(version)}--${fileSlug(title, 'release')}`;
