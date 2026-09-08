import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useApi } from './context';

export function useUserPackages(username: string, options?: { enabled?: boolean }) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ['packages', username, 'pages'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.packages.listForUser(username, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => ({ packages: data.pages.flatMap((page) => page.packages) }),
    enabled: (options?.enabled ?? true) && !!username,
  });
}

export function usePackageTags(username: string, image: string, options?: { enabled?: boolean }) {
  const api = useApi();
  return useQuery({
    queryKey: ['packages', username, image, 'tags'],
    queryFn: () => api.packages.getTags(username, image),
    enabled: (options?.enabled ?? true) && !!username && !!image,
  });
}
