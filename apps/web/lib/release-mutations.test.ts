import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCreateRelease,
  useDeleteRelease,
  usePublishRelease,
  useUpdateRelease,
} from '../../../packages/hooks/src/releases';

const { invalidateQueries } = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries }),
  useMutation: (options: unknown) => options,
}));
vi.mock('../../../packages/hooks/src/context', () => ({ useApi: () => ({}) }));

beforeEach(() => invalidateQueries.mockClear());

describe('release mutation cache updates', () => {
  for (const [name, hook, detail] of [
    ['create', useCreateRelease, false],
    ['update', useUpdateRelease, true],
    ['delete', useDeleteRelease, false],
    ['publish', usePublishRelease, true],
  ] as const) {
    it(`invalidates the affected release queries after ${name}`, () => {
      const options = hook() as unknown as {
        onSuccess: (
          result: unknown,
          variables: { owner: string; repo: string; id: string },
        ) => void;
      };
      expect(() =>
        options.onSuccess({}, { owner: 'alice', repo: 'project', id: 'release-id' }),
      ).not.toThrow();
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['releases', 'alice', 'project'],
      });
      if (name !== 'update') {
        expect(invalidateQueries).toHaveBeenCalledWith({
          queryKey: ['repository', 'alice', 'project'],
        });
      }
      if (detail) {
        expect(invalidateQueries).toHaveBeenCalledWith({
          queryKey: ['release', 'alice', 'project', 'release-id'],
        });
      }
    });
  }
});
