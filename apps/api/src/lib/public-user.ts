import { users } from '@sigmagit/db';

// Explicit projection: never serialize credentials or private profile settings.
export const publicUserColumns = {
  id: users.id,
  username: users.username,
  name: users.name,
  avatarUrl: users.avatarUrl,
};
