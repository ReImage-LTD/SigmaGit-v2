/** Match only the protocol routes mounted by routes/git-protocol.ts. */
export function isGitProtocolPath(path: string): boolean {
  return /^\/[^/]+\/[^/]+\/(?:info\/refs|git-upload-pack|git-receive-pack)$/.test(path);
}

export function isGitReceivePath(path: string): boolean {
  return isGitProtocolPath(path) && path.endsWith('/git-receive-pack');
}

export function isHealthPath(path: string): boolean {
  return path === '/health' || path === '/api/health' || path === '/api/status';
}
