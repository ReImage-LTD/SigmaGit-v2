/**
 * Centralized gist read authorization.
 * Secret gists are only visible to their owner (404 for everyone else).
 */

export type GistLike = {
  id: string;
  ownerId: string;
  visibility: string;
};

export type GistAccessUser = { id: string } | null | undefined;

/**
 * Whether the user may read the gist (and its forks, stars, comments, files).
 * Returns false for missing gists and for secret gists the user does not own.
 */
export function canReadGist(gist: GistLike | null | undefined, user: GistAccessUser): boolean {
  if (!gist) return false;
  if (gist.visibility === 'secret') {
    return Boolean(user?.id && user.id === gist.ownerId);
  }
  // public
  return true;
}

/**
 * Whether the user may modify the gist (owner only).
 */
export function canWriteGist(gist: GistLike | null | undefined, user: GistAccessUser): boolean {
  if (!gist || !user?.id) return false;
  return user.id === gist.ownerId;
}
