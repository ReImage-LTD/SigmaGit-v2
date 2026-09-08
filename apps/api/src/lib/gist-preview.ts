import { gistFiles } from '@sigmagit/db';
import { sql } from 'drizzle-orm';

export const GIST_PREVIEW_CHARACTERS = 512;

/** Truncate inside PostgreSQL so full file bodies never cross the database connection. */
export const gistFilePreviewColumns = {
  id: gistFiles.id,
  gistId: gistFiles.gistId,
  filename: gistFiles.filename,
  language: gistFiles.language,
  size: gistFiles.size,
  createdAt: gistFiles.createdAt,
  updatedAt: gistFiles.updatedAt,
  preview: sql<string>`left(${gistFiles.content}, ${GIST_PREVIEW_CHARACTERS})`,
};
