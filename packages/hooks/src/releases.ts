import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "./context";

export function useReleases(owner: string, repo: string, includeDrafts = false) {
  const api = useApi();
  return useQuery({
    queryKey: ["releases", owner, repo, includeDrafts],
    queryFn: () => api.releases?.list(owner, repo, includeDrafts) ?? Promise.resolve({ releases: [], hasMore: false }),
    enabled: !!owner && !!repo,
  });
}

export function useLatestRelease(owner: string, repo: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["releases", owner, repo, "latest"],
    queryFn: () => api.releases?.getLatest?.(owner, repo) ?? Promise.resolve(undefined),
    enabled: !!owner && !!repo,
  });
}

export function useReleaseByTag(owner: string, repo: string, tag: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["releases", owner, repo, "tag", tag],
    queryFn: () => api.releases?.getByTag?.(owner, repo, tag) ?? Promise.resolve(undefined),
    enabled: !!owner && !!repo && !!tag,
  });
}

export function useRelease(owner: string, repo: string, id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["release", owner, repo, id],
    queryFn: () => api.releases?.get?.(owner, repo, id) ?? Promise.resolve(undefined),
    enabled: !!owner && !!repo && !!id,
  });
}

export function useCreateRelease() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { owner: string; repo: string; tagName: string; name: string; body: unknown; isDraft?: boolean; isPrerelease?: boolean; targetCommitish?: string }) =>
      api.releases?.create?.(data.owner, data.repo, data.tagName, data.name, data.body, data.isDraft, data.isPrerelease, data.targetCommitish) ?? Promise.resolve(undefined),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: ["releases", data.owner, data.repo] });
      queryClient.invalidateQueries({ queryKey: ["repository", data.owner, data.repo] });
    },
  });
}

export function useUpdateRelease() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { owner: string; repo: string; id: string; name?: string; body?: string; state?: "open" | "closed"; isDraft?: boolean }) =>
      api.releases?.update?.(data.owner, data.repo, data.id, { name: data.name, body: data.body, isDraft: data.isDraft }) ??
      Promise.resolve(undefined),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: ["release", data.owner, data.repo, data.id] });
      queryClient.invalidateQueries({ queryKey: ["releases", data.owner, data.repo] });
    },
  });
}

export function useDeleteRelease() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { owner: string; repo: string; id: string }) =>
      api.releases?.delete?.(data.owner, data.repo, data.id) ?? Promise.resolve({ success: false }),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: ["releases", data.owner, data.repo] });
      queryClient.invalidateQueries({ queryKey: ["repository", data.owner, data.repo] });
    },
  });
}

export function usePublishRelease() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { owner: string; repo: string; id: string }) =>
      api.releases?.publish?.(data.owner, data.repo, data.id) ?? Promise.resolve({ success: false }),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: ["release", data.owner, data.repo, data.id] });
      queryClient.invalidateQueries({ queryKey: ["releases", data.owner, data.repo] });
      queryClient.invalidateQueries({ queryKey: ["repository", data.owner, data.repo] });
    },
  });
}

export function useReleaseAssets(owner: string, repo: string, id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["release-assets", owner, repo, id],
    queryFn: () => api.releases?.getAssets?.(owner, repo, id) ?? Promise.resolve({ assets: [] }),
    enabled: !!owner && !!repo && !!id,
  });
}

export function useUploadReleaseAsset() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { owner: string; repo: string; id: string; file: File }) =>
      api.releases?.uploadAsset?.(data.owner, data.repo, data.id, data.file) ?? Promise.reject(new Error("Upload not available")),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["release-assets", variables.owner, variables.repo, variables.id] });
      queryClient.invalidateQueries({ queryKey: ["release", variables.owner, variables.repo, variables.id] });
      queryClient.invalidateQueries({ queryKey: ["releases", variables.owner, variables.repo] });
    },
  });
}

export function useDeleteReleaseAsset() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { owner: string; repo: string; id: string; assetId: string }) =>
      api.releases?.deleteAsset?.(data.owner, data.repo, data.id, data.assetId) ?? Promise.resolve({ success: false }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["release-assets", variables.owner, variables.repo, variables.id] });
      queryClient.invalidateQueries({ queryKey: ["release", variables.owner, variables.repo, variables.id] });
      queryClient.invalidateQueries({ queryKey: ["releases", variables.owner, variables.repo] });
    },
  });
}

