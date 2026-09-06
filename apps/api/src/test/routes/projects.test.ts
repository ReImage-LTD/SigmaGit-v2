import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import projectRoutes from '../../routes/projects';
import { db } from '@sigmagit/db';

afterEach(() => mock.restore());

describe('project read authorization', () => {
  for (const visibility of ['private', 'public']) {
    it(`authorizes ${visibility} repository projects before loading columns`, async () => {
      spyOn(db.query.projects, 'findFirst').mockResolvedValue({
        id: 'project',
        repositoryId: 'repo',
      } as Awaited<ReturnType<typeof db.query.projects.findFirst>>);
      spyOn(db.query.repositories, 'findFirst').mockResolvedValue({
        id: 'repo',
        ownerId: 'owner',
        visibility,
      } as Awaited<ReturnType<typeof db.query.repositories.findFirst>>);
      const select = spyOn(db, 'select').mockImplementation((() => {
        const builder = {
          from: () => builder,
          where: () => builder,
          orderBy: () => Promise.resolve([]),
        };
        return builder;
      }) as unknown as typeof db.select);
      const response = await projectRoutes.request('/api/projects/project');
      expect(response.status).toBe(visibility === 'public' ? 200 : 404);
      expect(select).toHaveBeenCalledTimes(visibility === 'public' ? 1 : 0);
    });
  }
});
