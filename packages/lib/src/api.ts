import type {
  ApiClient,
  BranchProtectionRule,
  Collaborator,
  CollaboratorPermission,
  Commit,
  CommitDiff,
  FileLastCommit,
  GitTag,
  Issue,
  IssueComment,
  IssueFilters,
  Label,
  Owner,
  PRComment,
  PRCount,
  PRDiff,
  PRFilters,
  PRReview,
  Package,
  PlatformStats,
  PublicUser,
  PullRequest,
  RepoInfo,
  RepoPageData,
  AdminRepository,
  Repository,
  RepositoryWebhook,
  RepositoryWithOwner,
  RepositoryWithStars,
  TreeResponse,
  UserPreferences,
  UserProfile,
  UserSummary,
  WebhookEvent,
  Release,
  ReleaseAsset,
  Gist,
  GistFile,
  GistComment,
  GistFork,
  RepositoryMigration,
  Organization,
  OrganizationMember,
  Team,
  TeamMember,
  TeamRepository,
  OrganizationInvitation,
  Notification,
  SearchResult,
  SearchResultType,
  Workflow,
  WorkflowRun,
  SearchResponse,
  WorkflowJob,
  WorkflowStep,
  Runner,
} from "@sigmagit/hooks";

export interface ApiClientConfig {
  baseUrl: string;
  getAuthHeaders: () => Promise<HeadersInit>;
  fetchOptions?: RequestInit;
}

import { setRateLimitCooldown } from "./query";

interface ListPageOptions { limit?: number; offset?: number }
function listPageQuery(options?: ListPageOptions): string {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.offset !== undefined) params.set('offset', String(options.offset));
  return params.toString();
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const { baseUrl, getAuthHeaders, fetchOptions = {} } = config;

  async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const fullUrl = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;
    const authHeaders = await getAuthHeaders();

    const res = await fetch(fullUrl, {
      ...fetchOptions,
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        ...fetchOptions.headers,
        ...options.headers,
      },
    });

    if (!res.ok) {
      if (res.status === 429) {
        setRateLimitCooldown();
        if (typeof window !== 'undefined') {
          window.location.href = '/rate-limited';
        }
      }
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed: ${res.status}`);
    }

    return res.json();
  }

  return {
    repositories: {
      create: (data: {
        name: string;
        description?: string;
        visibility: "public" | "private";
        organizationId?: string;
        license?:
          | "mit"
          | "apache-2.0"
          | "gpl-3.0"
          | "agpl-3.0"
          | "lgpl-3.0"
          | "mpl-2.0"
          | "bsd-3-clause"
          | "unlicense";
      }) =>
        apiFetch<Repository>("/api/repositories", {
          method: "POST",
          body: JSON.stringify(data),
        }),

      fork: (owner: string, name: string, data?: { name?: string; description?: string }) =>
        apiFetch<RepoInfo>(`/api/repositories/${owner}/${name}/fork`, {
          method: "POST",
          body: JSON.stringify(data || {}),
        }),

      getForks: (owner: string, name: string, limit = 20, offset = 0) =>
        apiFetch<{ forks: RepositoryWithOwner[] }>(
          `/api/repositories/${owner}/${name}/forks?limit=${limit}&offset=${offset}`
        ),

      get: (owner: string, name: string) => apiFetch<RepositoryWithOwner>(`/api/repositories/${owner}/${name}`),

      getWithStars: (owner: string, name: string) =>
        apiFetch<RepositoryWithOwner>(`/api/repositories/${owner}/${name}/with-stars`),

      getInfo: (owner: string, name: string) => apiFetch<RepoInfo>(`/api/repositories/${owner}/${name}/info`),

      getPageData: (owner: string, name: string) => apiFetch<RepoPageData>(`/api/repositories/${owner}/${name}/page-data`),

      getUserRepos: (username: string) => apiFetch<{ repos: RepositoryWithStars[] }>(`/api/repositories/user/${username}`),

      getPublic: (sortBy: "stars" | "updated" | "created" = "updated", limit = 20, offset = 0) =>
        apiFetch<{ repos: RepositoryWithStars[]; hasMore: boolean }>(
          `/api/repositories/public?sortBy=${sortBy}&limit=${limit}&offset=${offset}`
        ),

      update: (id: string, data: { name?: string; description?: string; visibility?: "public" | "private" }) =>
        apiFetch<Repository>(`/api/repositories/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${id}`, {
          method: "DELETE",
        }),

      toggleStar: (id: string) =>
        apiFetch<{ starred: boolean }>(`/api/repositories/${id}/star`, {
          method: "POST",
        }),

      isStarred: (id: string) => apiFetch<{ starred: boolean }>(`/api/repositories/${id}/is-starred`),

      getBranches: (owner: string, name: string) =>
        apiFetch<{ branches: string[] }>(`/api/repositories/${owner}/${name}/branches`),

      getTree: (owner: string, name: string, branch: string, path = "") =>
        apiFetch<TreeResponse>(
          `/api/repositories/${owner}/${name}/tree?branch=${branch}&path=${encodeURIComponent(path)}`
        ),

      getTreeCommits: (owner: string, name: string, branch: string, path = "") =>
        apiFetch<{ files: FileLastCommit[] }>(
          `/api/repositories/${owner}/${name}/tree-commits?branch=${branch}&path=${encodeURIComponent(path)}`
        ),

      getFile: (owner: string, name: string, branch: string, path: string) =>
        apiFetch<{ content: string; oid: string; path: string }>(
          `/api/repositories/${owner}/${name}/file?branch=${branch}&path=${encodeURIComponent(path)}`
        ),

      getCommits: (owner: string, name: string, branch: string, limit = 30, skip = 0) =>
        apiFetch<{ commits: Commit[]; hasMore: boolean }>(
          `/api/repositories/${owner}/${name}/commits?branch=${branch}&limit=${limit}&skip=${skip}`
        ),

      getCommitCount: (owner: string, name: string, branch: string) =>
        apiFetch<{ count: number }>(`/api/repositories/${owner}/${name}/commits/count?branch=${branch}`),

      getCommitDiff: (owner: string, name: string, oid: string) =>
        apiFetch<CommitDiff>(`/api/repositories/${owner}/${name}/commits/${oid}/diff`),

      getReadme: (owner: string, name: string, oid: string) =>
        apiFetch<{ content: string }>(`/api/repositories/${owner}/${name}/readme?oid=${oid}`),

      getReadmeOid: (owner: string, name: string, branch: string) =>
        apiFetch<{ readmeOid: string | null }>(`/api/repositories/${owner}/${name}/readme-oid?branch=${branch}`),

      createBranch: (owner: string, name: string, data: { branch: string; fromRef: string }) =>
        apiFetch<{ branch: string; oid: string }>(`/api/repositories/${owner}/${name}/branches`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      deleteBranch: (owner: string, name: string, branch: string) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${name}/branches/${encodeURIComponent(branch)}`, {
          method: "DELETE",
        }),

      setDefaultBranch: (owner: string, name: string, branch: string) =>
        apiFetch<{ defaultBranch: string }>(`/api/repositories/${owner}/${name}/default-branch`, {
          method: "PATCH",
          body: JSON.stringify({ branch }),
        }),

      commitFile: (
        owner: string,
        name: string,
        data: { branch: string; path: string; content?: string; message: string; delete?: boolean }
      ) =>
        apiFetch<{ success: boolean; commitOid: string }>(`/api/repositories/${owner}/${name}/file`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      getTags: (owner: string, name: string) =>
        apiFetch<{ tags: GitTag[] }>(`/api/repositories/${owner}/${name}/tags`),

      createTag: (owner: string, name: string, data: { name: string; ref: string; message?: string }) =>
        apiFetch<{ tag: string; oid: string }>(`/api/repositories/${owner}/${name}/tags`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      deleteTag: (owner: string, name: string, tag: string) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${name}/tags/${encodeURIComponent(tag)}`, {
          method: "DELETE",
        }),

      getCollaborators: (owner: string, name: string) =>
        apiFetch<{ collaborators: Collaborator[] }>(`/api/repositories/${owner}/${name}/collaborators`),

      addCollaborator: (owner: string, name: string, data: { username: string; permission?: CollaboratorPermission }) =>
        apiFetch<{ collaborator: Collaborator }>(`/api/repositories/${owner}/${name}/collaborators`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      updateCollaborator: (owner: string, name: string, userId: string, permission: CollaboratorPermission) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${name}/collaborators/${userId}`, {
          method: "PATCH",
          body: JSON.stringify({ permission }),
        }),

      removeCollaborator: (owner: string, name: string, userId: string) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${name}/collaborators/${userId}`, {
          method: "DELETE",
        }),

      getBranchProtectionRules: (owner: string, name: string) =>
        apiFetch<{ rules: BranchProtectionRule[] }>(`/api/repositories/${owner}/${name}/branch-protection`),

      createBranchProtectionRule: (
        owner: string,
        name: string,
        data: Omit<BranchProtectionRule, "id" | "repositoryId" | "createdAt" | "updatedAt">
      ) =>
        apiFetch<{ rule: BranchProtectionRule }>(`/api/repositories/${owner}/${name}/branch-protection`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      updateBranchProtectionRule: (
        owner: string,
        name: string,
        ruleId: string,
        data: Partial<Omit<BranchProtectionRule, "id" | "repositoryId" | "createdAt" | "updatedAt">>
      ) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${name}/branch-protection/${ruleId}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      deleteBranchProtectionRule: (owner: string, name: string, ruleId: string) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${name}/branch-protection/${ruleId}`, {
          method: "DELETE",
        }),

      getWebhooks: (owner: string, name: string) =>
        apiFetch<{ webhooks: RepositoryWebhook[] }>(`/api/repositories/${owner}/${name}/webhooks`),

      createWebhook: (
        owner: string,
        name: string,
        data: { url: string; secret?: string; events: WebhookEvent[]; active?: boolean; contentType?: "json" | "form" }
      ) =>
        apiFetch<{ webhook: RepositoryWebhook }>(`/api/repositories/${owner}/${name}/webhooks`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      updateWebhook: (
        owner: string,
        name: string,
        hookId: string,
        data: Partial<{ url: string; secret: string | null; events: WebhookEvent[]; active: boolean; contentType: "json" | "form" }>
      ) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${name}/webhooks/${hookId}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      deleteWebhook: (owner: string, name: string, hookId: string) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${name}/webhooks/${hookId}`, {
          method: "DELETE",
        }),
    },

    users: {
      resolve: (username: string) =>
        apiFetch<
          | { type: "user"; profile: UserProfile }
          | { type: "organization"; profile: Organization }
        >(`/api/users/${username}/resolve`),
      getProfile: (username: string) => apiFetch<UserProfile>(`/api/users/${username}/profile`),
      getProfileCounts: (username: string) =>
        apiFetch<{ repoCount: number; starredCount: number }>(`/api/users/${username}/profile-counts`),
      getSummary: () => apiFetch<UserSummary>(`/api/users/me/summary`),
      getPlatformStats: () => apiFetch<PlatformStats>("/api/stats/platform"),
      getStarred: (username: string) => apiFetch<{ repos: RepositoryWithStars[] }>(`/api/users/${username}/starred`),
      getAvatarByUsername: (username: string) => apiFetch<{ avatarUrl: string | null }>(`/api/users/${username}/avatar`),
      getPublic: (sortBy: "newest" | "oldest" = "newest", limit = 20, offset = 0) =>
        apiFetch<{ users: PublicUser[]; hasMore: boolean }>(
          `/api/users/public?sortBy=${sortBy}&limit=${limit}&offset=${offset}`
        ),
    },

    packages: {
      listForUser: (username: string) =>
        apiFetch<{ packages: Package[] }>(`/api/users/${encodeURIComponent(username)}/packages`),
      getTags: (username: string, image: string) =>
        apiFetch<{ name: string; tags: string[] }>(
          `/api/users/${encodeURIComponent(username)}/packages/${encodeURIComponent(image)}/tags`
        ),
    },

    settings: {
      getCurrentUser: () => apiFetch<{ user: UserProfile }>("/api/settings"),
      getWordWrap: () => apiFetch<{ wordWrap: boolean }>("/api/settings/word-wrap"),

      updateProfile: (data: {
        name?: string;
        username?: string;
        bio?: string;
        location?: string;
        website?: string;
        pronouns?: string;
        company?: string;
        gitEmail?: string;
        defaultRepositoryVisibility?: "public" | "private";
      }) =>
        apiFetch<{ success: boolean; username: string }>("/api/settings/profile", {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      updatePreferences: (data: Partial<UserPreferences>) =>
        apiFetch<{ success: boolean }>("/api/settings/preferences", {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      updateWordWrap: (data: { wordWrap: boolean }) =>
        apiFetch<{ success: boolean; wordWrap: boolean }>("/api/settings/word-wrap", {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      updateSocialLinks: (data: { github?: string; twitter?: string; linkedin?: string; custom?: string[] }) =>
        apiFetch<{ success: boolean }>("/api/settings/social-links", {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      updateEmail: (data: { email: string; password: string }) =>
        apiFetch<{ success: boolean }>("/api/settings/email", {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      updatePassword: (data: { currentPassword: string; newPassword: string }) =>
        apiFetch<{ success: boolean }>("/api/settings/password", {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      updateAvatar: (file: File) => {
        const formData = new FormData();
        formData.append("avatar", file);
        return apiFetch<{ success: boolean; avatarUrl: string }>("/api/settings/avatar", {
          method: "POST",
          body: formData,
          headers: {},
        });
      },

      deleteAvatar: () =>
        apiFetch<{ success: boolean; avatarUrl: string | null }>("/api/settings/avatar", {
          method: "DELETE",
        }),

      deleteAccount: (data: { password: string }) =>
        apiFetch<{ success: boolean }>("/api/settings/account", {
          method: "DELETE",
          body: JSON.stringify(data),
        }),
    },

    issues: {
      list: (owner: string, repo: string, filters?: IssueFilters) => {
        const params = new URLSearchParams();
        if (filters?.state) params.set("state", filters.state);
        if (filters?.label) params.set("label", filters.label);
        if (filters?.assignee) params.set("assignee", filters.assignee);
        if (filters?.limit) params.set("limit", String(filters.limit));
        if (filters?.offset) params.set("offset", String(filters.offset));
        const query = params.toString();
        return apiFetch<{ issues: Issue[]; hasMore: boolean }>(
          `/api/repositories/${owner}/${repo}/issues${query ? `?${query}` : ""}`
        );
      },

      get: (owner: string, repo: string, number: number) => apiFetch<Issue>(`/api/repositories/${owner}/${repo}/issues/${number}`),

      create: (owner: string, repo: string, data: { title: string; body?: string; labels?: string[]; assignees?: string[] }) =>
        apiFetch<Issue>(`/api/repositories/${owner}/${repo}/issues`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      update: (id: string, data: { title?: string; body?: string; state?: "open" | "closed"; locked?: boolean }) =>
        apiFetch<{ success: boolean }>(`/api/issues/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/issues/${id}`, {
          method: "DELETE",
        }),

      getCount: (owner: string, repo: string) =>
        apiFetch<{ open: number; closed: number }>(`/api/repositories/${owner}/${repo}/issues/count`),

      listLabels: (owner: string, repo: string) => apiFetch<{ labels: Label[] }>(`/api/repositories/${owner}/${repo}/labels`),

      createLabel: (owner: string, repo: string, data: { name: string; description?: string; color: string }) =>
        apiFetch<Label>(`/api/repositories/${owner}/${repo}/labels`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      updateLabel: (id: string, data: { name?: string; description?: string; color?: string }) =>
        apiFetch<Label>(`/api/labels/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      deleteLabel: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/labels/${id}`, {
          method: "DELETE",
        }),

      addLabels: (issueId: string, labels: string[]) =>
        apiFetch<{ success: boolean }>(`/api/issues/${issueId}/labels`, {
          method: "POST",
          body: JSON.stringify({ labels }),
        }),

      removeLabel: (issueId: string, labelId: string) =>
        apiFetch<{ success: boolean }>(`/api/issues/${issueId}/labels/${labelId}`, {
          method: "DELETE",
        }),

      addAssignees: (issueId: string, assignees: string[]) =>
        apiFetch<{ success: boolean }>(`/api/issues/${issueId}/assignees`, {
          method: "POST",
          body: JSON.stringify({ assignees }),
        }),

      removeAssignee: (issueId: string, userId: string) =>
        apiFetch<{ success: boolean }>(`/api/issues/${issueId}/assignees/${userId}`, {
          method: "DELETE",
        }),

      listComments: (issueId: string) => apiFetch<{ comments: IssueComment[] }>(`/api/issues/${issueId}/comments`),

      createComment: (issueId: string, body: string) =>
        apiFetch<IssueComment>(`/api/issues/${issueId}/comments`, {
          method: "POST",
          body: JSON.stringify({ body }),
        }),

      updateComment: (commentId: string, body: string) =>
        apiFetch<{ success: boolean }>(`/api/issues/comments/${commentId}`, {
          method: "PATCH",
          body: JSON.stringify({ body }),
        }),

      deleteComment: (commentId: string) =>
        apiFetch<{ success: boolean }>(`/api/issues/comments/${commentId}`, {
          method: "DELETE",
        }),

      toggleIssueReaction: (issueId: string, emoji: string) =>
        apiFetch<{ added: boolean }>(`/api/issues/${issueId}/reactions`, {
          method: "POST",
          body: JSON.stringify({ emoji }),
        }),

      toggleCommentReaction: (commentId: string, emoji: string) =>
        apiFetch<{ added: boolean }>(`/api/issues/comments/${commentId}/reactions`, {
          method: "POST",
          body: JSON.stringify({ emoji }),
        }),
    },

    pullRequests: {
      list: (owner: string, repo: string, filters?: PRFilters) => {
        const params = new URLSearchParams();
        if (filters?.state) params.set("state", filters.state);
        if (filters?.label) params.set("label", filters.label);
        if (filters?.assignee) params.set("assignee", filters.assignee);
        if (filters?.reviewer) params.set("reviewer", filters.reviewer);
        if (filters?.author) params.set("author", filters.author);
        if (filters?.limit) params.set("limit", String(filters.limit));
        if (filters?.offset) params.set("offset", String(filters.offset));
        const query = params.toString();
        return apiFetch<{ pullRequests: PullRequest[]; hasMore: boolean }>(
          `/api/repositories/${owner}/${repo}/pulls${query ? `?${query}` : ""}`
        );
      },

      get: (owner: string, repo: string, number: number) =>
        apiFetch<PullRequest>(`/api/repositories/${owner}/${repo}/pulls/${number}`),

      create: (
        owner: string,
        repo: string,
        data: {
          title: string;
          body?: string;
          headRepoOwner?: string;
          headRepoName?: string;
          headBranch: string;
          baseBranch?: string;
          labels?: string[];
          assignees?: string[];
          reviewers?: string[];
        }
      ) =>
        apiFetch<PullRequest>(`/api/repositories/${owner}/${repo}/pulls`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      update: (id: string, data: { title?: string; body?: string; state?: "open" | "closed" }) =>
        apiFetch<{ success: boolean }>(`/api/pulls/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/pulls/${id}`, {
          method: "DELETE",
        }),

      getCount: (owner: string, repo: string) =>
        apiFetch<PRCount>(`/api/repositories/${owner}/${repo}/pulls/count`),

      getDiff: (id: string) => apiFetch<PRDiff>(`/api/pulls/${id}/diff`),

      getCommits: (id: string, limit = 30, skip = 0) =>
        apiFetch<{ commits: Commit[]; hasMore: boolean }>(`/api/pulls/${id}/commits?limit=${limit}&skip=${skip}`),

      merge: (id: string, data?: { commitMessage?: string; mergeStrategy?: "merge" | "squash" | "rebase" }) =>
        apiFetch<{ success: boolean; mergeCommitOid: string }>(`/api/pulls/${id}/merge`, {
          method: "POST",
          body: JSON.stringify(data || {}),
        }),

      listReviews: (id: string) => apiFetch<{ reviews: PRReview[] }>(`/api/pulls/${id}/reviews`),

      submitReview: (id: string, data: { body?: string; state: "approved" | "changes_requested" | "commented" }) =>
        apiFetch<PRReview>(`/api/pulls/${id}/reviews`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      listComments: (id: string, options?: { groupByFile?: boolean; filePath?: string }) => {
        const params = new URLSearchParams();
        if (options?.groupByFile) params.set("groupByFile", "true");
        if (options?.filePath) params.set("filePath", options.filePath);
        const query = params.toString();
        return apiFetch<{ comments: PRComment[] }>(`/api/pulls/${id}/comments${query ? `?${query}` : ""}`);
      },

      createComment: (id: string, data: string | { body: string; filePath?: string; side?: "left" | "right"; lineNumber?: number; commitOid?: string; replyToId?: string }) => {
        const payload = typeof data === "string" ? { body: data } : data;
        return apiFetch<PRComment>(`/api/pulls/${id}/comments`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      },

      updateComment: (commentId: string, body: string) =>
        apiFetch<{ success: boolean }>(`/api/pulls/comments/${commentId}`, {
          method: "PATCH",
          body: JSON.stringify({ body }),
        }),

      deleteComment: (commentId: string) =>
        apiFetch<{ success: boolean }>(`/api/pulls/comments/${commentId}`, {
          method: "DELETE",
        }),

      addLabels: (id: string, labels: string[]) =>
        apiFetch<{ success: boolean }>(`/api/pulls/${id}/labels`, {
          method: "POST",
          body: JSON.stringify({ labels }),
        }),

      removeLabel: (id: string, labelId: string) =>
        apiFetch<{ success: boolean }>(`/api/pulls/${id}/labels/${labelId}`, {
          method: "DELETE",
        }),

      addAssignees: (id: string, assignees: string[]) =>
        apiFetch<{ success: boolean }>(`/api/pulls/${id}/assignees`, {
          method: "POST",
          body: JSON.stringify({ assignees }),
        }),

      removeAssignee: (id: string, userId: string) =>
        apiFetch<{ success: boolean }>(`/api/pulls/${id}/assignees/${userId}`, {
          method: "DELETE",
        }),

      addReviewers: (id: string, reviewers: string[]) =>
        apiFetch<{ success: boolean }>(`/api/pulls/${id}/reviewers`, {
          method: "POST",
          body: JSON.stringify({ reviewers }),
        }),

      removeReviewer: (id: string, userId: string) =>
        apiFetch<{ success: boolean }>(`/api/pulls/${id}/reviewers/${userId}`, {
          method: "DELETE",
        }),

      toggleReaction: (id: string, emoji: string) =>
        apiFetch<{ added: boolean }>(`/api/pulls/${id}/reactions`, {
          method: "POST",
          body: JSON.stringify({ emoji }),
        }),

      toggleCommentReaction: (commentId: string, emoji: string) =>
        apiFetch<{ added: boolean }>(`/api/pulls/comments/${commentId}/reactions`, {
          method: "POST",
          body: JSON.stringify({ emoji }),
        }),

      markReady: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/pulls/${id}/ready`, {
          method: "PATCH",
        }),

      convertToDraft: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/pulls/${id}/draft`, {
          method: "PATCH",
        }),
    },

    search: {
      query: (q: string, options?: { type?: string; limit?: number; offset?: number; signal?: AbortSignal }) => {
        const params = new URLSearchParams({ q });
        if (options?.type) params.set("type", options.type);
        if (options?.limit) params.set("limit", String(options.limit));
        if (options?.offset) params.set("offset", String(options.offset));
        return apiFetch<SearchResponse>(`/api/search?${params}`, { signal: options?.signal });
      },
    },

    notifications: {
      list: (options?: { limit?: number; offset?: number; cursor?: string; unreadOnly?: boolean }) => {
        const params = new URLSearchParams();
        if (options?.limit) params.set("limit", String(options.limit));
        if (options?.offset) params.set("offset", String(options.offset));
        if (options?.unreadOnly) params.set("unread", "true");
        if (options?.cursor) params.set("cursor", options.cursor);
        const query = params.toString();
        return apiFetch<any>(`/api/notifications${query ? `?${query}` : ""}`);
      },

      getUnreadCount: () => apiFetch<{ count: number }>(`/api/notifications/unread-count`),

      markRead: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/notifications/${id}/read`, {
          method: "PATCH",
        }),

      markAllRead: () =>
        apiFetch<{ success: boolean }>(`/api/notifications/mark-all-read`, {
          method: "POST",
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/notifications/${id}`, {
          method: "DELETE",
        }),
    },

    gists: {
      list: () => apiFetch<{ gists: Gist[]; hasMore: boolean }>("/api/gists"),

      getPublic: (limit = 20, offset = 0) =>
        apiFetch<{ gists: Gist[]; hasMore: boolean }>(`/api/gists/public?limit=${limit}&offset=${offset}`),

      get: (id: string) => apiFetch<Gist>(`/api/gists/${id}`),

      create: (data: unknown) =>
        apiFetch<Gist>("/api/gists", {
          method: "POST",
          body: JSON.stringify(data),
        }),

      update: (id: string, data: unknown) =>
        apiFetch<Gist>(`/api/gists/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/gists/${id}`, {
          method: "DELETE",
        }),

      getRevisions: (id: string) => apiFetch<{ revisions: unknown[] }>(`/api/gists/${id}/revisions`),

      toggleStar: (id: string) =>
        apiFetch<{ starred: boolean }>(`/api/gists/${id}/star`, {
          method: "POST",
        }),

      isStarred: (id: string) => apiFetch<{ starred: boolean }>(`/api/gists/${id}/star`),

      fork: (id: string) =>
        apiFetch<{ id: string }>(`/api/gists/${id}/fork`, {
          method: "POST",
        }),

      getForks: (id: string, limit = 20, offset = 0) =>
        apiFetch<{ forks: GistFork[]; hasMore: boolean }>(`/api/gists/${id}/forks?limit=${limit}&offset=${offset}`),

      getComments: (id: string, options?: ListPageOptions) => apiFetch<{ comments: GistComment[] }>(`/api/gists/${id}/comments?${listPageQuery(options)}`),

      createComment: (id: string, body: string) =>
        apiFetch<GistComment>(`/api/gists/${id}/comments`, {
          method: "POST",
          body: JSON.stringify({ body }),
        }),

      updateComment: (commentId: string, body: string) =>
        apiFetch<{ success: boolean }>(`/api/gists/comments/${commentId}`, {
          method: "PATCH",
          body: JSON.stringify({ body }),
        }),

      deleteComment: (commentId: string) =>
        apiFetch<{ success: boolean }>(`/api/gists/comments/${commentId}`, {
          method: "DELETE",
        }),

      getUserGists: (username: string, limit = 20, offset = 0) =>
        apiFetch<{ gists: Gist[]; hasMore: boolean }>(`/api/users/${username}/gists?limit=${limit}&offset=${offset}`),
    },

    releases: {
      list: (owner: string, repo: string, includeDrafts = false, options?: ListPageOptions) =>
        apiFetch<{ releases: Release[]; hasMore?: boolean }>(
          `/api/repositories/${owner}/${repo}/releases?draft=${includeDrafts}&${listPageQuery(options)}`
        ),

      getLatest: (owner: string, repo: string) =>
        apiFetch<Release & { assets: ReleaseAsset[] }>(`/api/repositories/${owner}/${repo}/releases/latest`),

      getByTag: (owner: string, repo: string, tag: string) =>
        apiFetch<Release & { assets?: ReleaseAsset[] }>(`/api/repositories/${owner}/${repo}/releases/tag/${tag}`),

      get: (owner: string, repo: string, id: string) =>
        apiFetch<Release>(`/api/repositories/${owner}/${repo}/releases/${id}`),

      create: (
        owner: string,
        repo: string,
        tagName: string,
        name: string,
        body: string,
        isDraft = false,
        isPrerelease = false,
        targetCommitish = "main"
      ) =>
        apiFetch<Release>(`/api/repositories/${owner}/${repo}/releases`, {
          method: "POST",
          body: JSON.stringify({ tagName, name, body, isDraft, isPrerelease, targetCommitish }),
        }),

      update: (owner: string, repo: string, id: string, data: { name?: string; body?: string; isDraft?: boolean }) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${repo}/releases/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      delete: (owner: string, repo: string, id: string) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${repo}/releases/${id}`, {
          method: "DELETE",
        }),

      publish: (owner: string, repo: string, id: string) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${repo}/releases/${id}/publish`, {
          method: "POST",
        }),

      getAssets: (owner: string, repo: string, id: string, options?: ListPageOptions) =>
        apiFetch<{ assets: ReleaseAsset[] }>(`/api/repositories/${owner}/${repo}/releases/${id}/assets?${listPageQuery(options)}`),

      uploadAsset: async (owner: string, repo: string, id: string, file: File) => {
        const formData = new FormData();
        formData.append("asset", file);
        const fullUrl = `${baseUrl}/api/repositories/${owner}/${repo}/releases/${id}/assets`;
        const authHeaders = await getAuthHeaders();
        const res = await fetch(fullUrl, {
          ...fetchOptions,
          method: "POST",
          headers: { ...authHeaders, ...(fetchOptions.headers as Record<string, string>) },
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || "Asset upload failed");
        }
        return res.json() as Promise<{ data: ReleaseAsset }>;
      },

      deleteAsset: (owner: string, repo: string, id: string, assetId: string) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${repo}/releases/${id}/assets/${assetId}`, {
          method: "DELETE",
        }),
    },

    migrations: {
      list: () => apiFetch<{ migrations: RepositoryMigration[]; hasMore?: boolean }>("/api/migrations"),

      get: (id: string) => apiFetch<RepositoryMigration>(`/api/migrations/${id}`),

      create: (data: unknown) =>
        apiFetch<RepositoryMigration>("/api/migrations", {
          method: "POST",
          body: JSON.stringify(data),
        }),

      cancel: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/migrations/${id}/cancel`, {
          method: "POST",
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/migrations/${id}`, {
          method: "DELETE",
        }),

      listGitHubRepos: (token: string) =>
        apiFetch<{ repos: Array<{ id: string; fullName: string; private: boolean; defaultBranch?: string; url: string }> }>(
          `/api/migrations/github/repos`,
          { headers: { "X-Provider-Token": token } }
        ),

      listGitLabRepos: (token: string, baseUrl?: string) => {
        const params = new URLSearchParams();
        if (baseUrl) params.set("baseUrl", baseUrl);
        const query = params.toString();
        return apiFetch<{ repos: Array<{ id: string; fullName: string; private: boolean; defaultBranch?: string; url: string }> }>(
          `/api/migrations/gitlab/repos${query ? `?${query}` : ""}`,
          { headers: { "X-Provider-Token": token } }
        );
      },

      listGiteaRepos: (token: string, baseUrl: string) =>
        apiFetch<{ repos: Array<{ id: string; fullName: string; private: boolean; defaultBranch?: string; url: string }> }>(
          `/api/migrations/gitea/repos?baseUrl=${encodeURIComponent(baseUrl)}`,
          { headers: { "X-Provider-Token": token } }
        ),

      listBitbucketRepos: (token: string) =>
        apiFetch<{ repos: Array<{ id: string; fullName: string; private: boolean; defaultBranch?: string; url: string }> }>(
          `/api/migrations/bitbucket/repos`,
          { headers: { "X-Provider-Token": token } }
        ),
    },

    reports: {
      submit: (data: {
        targetType: "user" | "repository" | "gist" | "organization";
        targetId: string;
        reason: string;
        description: string;
      }) =>
        apiFetch<{ data: unknown }>("/api/reports", {
          method: "POST",
          body: JSON.stringify(data),
        }),
    },

    dmca: {
      submit: (data: {
        targetType: "repository" | "gist";
        targetId: string;
        copyrightHolder: string;
        copyrightHolderEmail: string;
        copyrightHolderAddress: string;
        copyrightHolderPhone?: string | null;
        originalWorkDescription: string;
        originalWorkUrl?: string | null;
        infringingUrls: string;
        description: string;
        swornStatement: boolean;
        perjuryStatement: boolean;
        signature: string;
      }) =>
        apiFetch<{ data: unknown }>("/api/dmca", {
          method: "POST",
          body: JSON.stringify(data),
        }),
    },

    organizations: {
      list: async (options?: ListPageOptions) => {
        const data = await apiFetch<{
          organizations: Array<
            | Organization
            | {
                organization: Organization;
                role: "owner" | "admin" | "member";
                joinedAt: string;
              }
          >;
          hasMore?: boolean;
          nextOffset?: number | null;
        }>(`/api/user/organizations?${listPageQuery(options)}`);

        // Normalize API shape to a plain Organization[] for hook/UI consumers.
        const organizations = data.organizations.map((entry) =>
          "organization" in entry ? entry.organization : entry
        );

        return { organizations, hasMore: data.hasMore, nextOffset: data.nextOffset ?? null };
      },

      get: (org: string) => apiFetch<Organization>(`/api/organizations/${org}`),

      getMembers: (org: string, options?: ListPageOptions) => apiFetch<{ members: OrganizationMember[] }>(`/api/organizations/${org}/members?${listPageQuery(options)}`),

      getTeams: (org: string, options?: ListPageOptions) => apiFetch<{ teams: Team[] }>(`/api/organizations/${org}/teams?${listPageQuery(options)}`),

      getRepositories: (org: string) => apiFetch<{ repositories: Repository[] }>(`/api/organizations/${org}/repositories`),

      getInvitations: (org: string, options?: ListPageOptions) =>
        apiFetch<{ invitations: OrganizationInvitation[] }>(`/api/organizations/${org}/invitations?${listPageQuery(options)}`),

      create: (data: unknown) =>
        apiFetch<Organization>("/api/organizations", {
          method: "POST",
          body: JSON.stringify(data),
        }),

      update: (org: string, data: unknown) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      delete: (org: string) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}`, {
          method: "DELETE",
        }),

      updateMember: (org: string, username: string, data: unknown) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}/members/${username}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),

      removeMember: (org: string, username: string) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}/members/${username}`, {
          method: "DELETE",
        }),

      createTeam: (org: string, data: unknown) =>
        apiFetch<Team>(`/api/organizations/${org}/teams`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      deleteTeam: (org: string, team: string) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}`, {
          method: "DELETE",
        }),

      getTeam: (org: string, team: string) => apiFetch<Team>(`/api/organizations/${org}/teams/${team}`),

      addTeamMember: (org: string, team: string, data: unknown) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}/members`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),

      removeTeamMember: (org: string, team: string, username: string) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}/members/${username}`, {
          method: "DELETE",
        }),

      addTeamRepo: (org: string, team: string, repo: string, data: unknown) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}/repos/${repo}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),

      removeTeamRepo: (org: string, team: string, repo: string) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}/repos/${repo}`, {
          method: "DELETE",
        }),

      deleteTeamRepo: (org: string, team: string, repo: string) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}/repos/${repo}`, {
          method: "DELETE",
        }),

      sendInvitation: (org: string, data: unknown) =>
        apiFetch<OrganizationInvitation>(`/api/organizations/${org}/invitations`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      deleteInvitation: (org: string, id: string) =>
        apiFetch<{ success: boolean }>(`/api/organizations/${org}/invitations/${id}`, {
          method: "DELETE",
        }),

      acceptInvitation: (token: string) =>
        apiFetch<{ success: boolean }>(`/api/invitations/${token}/accept`, {
          method: "POST",
        }),
    },

    discussions: {
      list: (owner: string, repo: string, options?: { category?: string; limit?: number; offset?: number }) => {
        const params = new URLSearchParams();
        if (options?.category) params.set("category", options.category);
        if (options?.limit) params.set("limit", String(options.limit));
        if (options?.offset) params.set("offset", String(options.offset));
        const query = params.toString();
        return apiFetch<any>(`/api/repositories/${owner}/${repo}/discussions${query ? `?${query}` : ""}`);
      },

      get: (owner: string, repo: string, number: number) =>
        apiFetch<any>(`/api/repositories/${owner}/${repo}/discussions/${number}`),

      create: (owner: string, repo: string, data: { title: string; body: string; categoryId?: string }) =>
        apiFetch<any>(`/api/repositories/${owner}/${repo}/discussions`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      update: (id: string, data: { title?: string; body?: string; categoryId?: string }) =>
        apiFetch<{ success: boolean }>(`/api/discussions/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/discussions/${id}`, {
          method: "DELETE",
        }),

      getCategories: (owner: string, repo: string) =>
        apiFetch<any>(`/api/repositories/${owner}/${repo}/discussions/categories`),

      listComments: (discussionId: string) =>
        apiFetch<any>(`/api/discussions/${discussionId}/comments`),

      createComment: (discussionId: string, data: { body: string; parentId?: string }) =>
        apiFetch<any>(`/api/discussions/${discussionId}/comments`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      markAnswer: (commentId: string) =>
        apiFetch<{ success: boolean; isAnswer: boolean }>(`/api/discussions/comments/${commentId}/answer`, {
          method: "PATCH",
        }),

      toggleReaction: (discussionId: string, emoji: string) =>
        apiFetch<{ added: boolean }>(`/api/discussions/${discussionId}/reactions`, {
          method: "POST",
          body: JSON.stringify({ emoji }),
        }),

      toggleCommentReaction: (commentId: string, emoji: string) =>
        apiFetch<{ added: boolean }>(`/api/discussions/comments/${commentId}/reactions`, {
          method: "POST",
          body: JSON.stringify({ emoji }),
        }),
    },

    projects: {
      list: (owner: string, repo: string, options?: ListPageOptions) =>
        apiFetch<any>(`/api/repositories/${owner}/${repo}/projects?${listPageQuery(options)}`),

      get: (id: string) => apiFetch<any>(`/api/projects/${id}`),

      create: (owner: string, repo: string, data: { name: string; description?: string }) =>
        apiFetch<any>(`/api/repositories/${owner}/${repo}/projects`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      update: (id: string, data: { name?: string; description?: string }) =>
        apiFetch<{ success: boolean }>(`/api/projects/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/projects/${id}`, {
          method: "DELETE",
        }),

      addColumn: (projectId: string, name: string) =>
        apiFetch<any>(`/api/projects/${projectId}/columns`, {
          method: "POST",
          body: JSON.stringify({ name }),
        }),

      updateColumn: (columnId: string, data: { name?: string; position?: number }) =>
        apiFetch<{ success: boolean }>(`/api/projects/columns/${columnId}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      deleteColumn: (columnId: string) =>
        apiFetch<{ success: boolean }>(`/api/projects/columns/${columnId}`, {
          method: "DELETE",
        }),

      addItem: (projectId: string, data: { columnId: string; issueId?: string; pullRequestId?: string; noteContent?: string }) =>
        apiFetch<any>(`/api/projects/${projectId}/items`, {
          method: "POST",
          body: JSON.stringify(data),
        }),

      updateItem: (itemId: string, data: { columnId?: string; position?: number; noteContent?: string }) =>
        apiFetch<{ success: boolean }>(`/api/projects/items/${itemId}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      reorderItems: (items: { id: string; columnId: string; position: number }[]) =>
        apiFetch<{ success: boolean }>(`/api/projects/items/reorder`, {
          method: "POST",
          body: JSON.stringify({ items }),
        }),

      deleteItem: (itemId: string) =>
        apiFetch<{ success: boolean }>(`/api/projects/items/${itemId}`, {
          method: "DELETE",
        }),
    },

    admin: {
      getStats: () => apiFetch<any>("/api/admin/stats"),
      getSystemStats: () => apiFetch<any>("/api/admin/system-stats"),

      getUsers: (search = "", role?: string, limit = 20, offset = 0) =>
        apiFetch<{ users: any[]; hasMore: boolean }>(
          `/api/admin/users?search=${encodeURIComponent(search)}&role=${role || ""}&limit=${limit}&offset=${offset}`
        ),

      getUser: (id: string) => apiFetch<any>(`/api/admin/users/${id}`),

      updateUser: (id: string, data: { role?: string }) =>
        apiFetch<{ success: boolean }>(`/api/admin/users/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),

      deleteUser: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/admin/users/${id}`, {
          method: "DELETE",
        }),

      getRepositories: (search = "", visibility?: string, limit = 20, offset = 0) =>
        apiFetch<{ repositories: AdminRepository[]; hasMore: boolean }>(
          `/api/admin/repositories?search=${encodeURIComponent(search)}&visibility=${visibility || ""}&limit=${limit}&offset=${offset}`
        ),

      deleteRepository: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/admin/repositories/${id}`, {
          method: "DELETE",
        }),

      transferRepository: (id: string, newOwnerId: string) =>
        apiFetch<{ success: boolean }>(`/api/admin/repositories/${id}/transfer`, {
          method: "POST",
          body: JSON.stringify({ newOwnerId }),
        }),

      getGists: (search = "", visibility?: string, limit = 20, offset = 0) =>
        apiFetch<{ gists: any[]; hasMore: boolean }>(
          `/api/admin/gists?search=${encodeURIComponent(search)}&visibility=${visibility || ""}&limit=${limit}&offset=${offset}`
        ),

      deleteGist: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/admin/gists/${id}`, {
          method: "DELETE",
        }),

      getAuditLogs: (action?: string, targetType?: string, limit = 50, offset = 0) =>
        apiFetch<{ logs: any[]; hasMore: boolean }>(
          `/api/admin/audit-logs?action=${action || ""}&targetType=${targetType || ""}&limit=${limit}&offset=${offset}`
        ),

      getReportsCounts: () => apiFetch<{ pending: number }>("/api/admin/reports/counts"),
      getReports: (status?: string, targetType?: string, limit = 20, offset = 0) =>
        apiFetch<{ reports: any[]; hasMore: boolean }>(
          `/api/admin/reports?status=${status || ""}&targetType=${targetType || ""}&limit=${limit}&offset=${offset}`
        ),
      getReport: (id: string) => apiFetch<any>(`/api/admin/reports/${id}`),
      updateReport: (id: string, data: { status?: string; adminNotes?: string }) =>
        apiFetch<any>(`/api/admin/reports/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
      reportAction: (id: string, action: string) =>
        apiFetch<{ success: boolean; status?: string }>(`/api/admin/reports/${id}/actions`, {
          method: "POST",
          body: JSON.stringify({ action }),
        }),
      getDmcaCounts: () => apiFetch<{ pending: number }>("/api/admin/dmca/counts"),
      getDmcaRequests: (status?: string, limit = 20, offset = 0) =>
        apiFetch<{ requests: any[]; hasMore: boolean }>(
          `/api/admin/dmca?status=${status || ""}&limit=${limit}&offset=${offset}`
        ),
      getDmcaRequest: (id: string) => apiFetch<any>(`/api/admin/dmca/${id}`),
      updateDmcaRequest: (id: string, data: { status?: string; adminNotes?: string }) =>
        apiFetch<any>(`/api/admin/dmca/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
      dmcaAction: (id: string, action: string, reason?: string) =>
        apiFetch<{ success: boolean; status?: string }>(`/api/admin/dmca/${id}/actions`, {
          method: "POST",
          body: JSON.stringify({ action, reason }),
        }),

      getSettings: () => apiFetch<Record<string, unknown>>("/api/admin/settings"),

      updateSettings: (settings: Record<string, unknown>) =>
        apiFetch<{ success: boolean }>("/api/admin/settings", {
          method: "PATCH",
          body: JSON.stringify(settings),
        }),

      toggleMaintenance: (enabled: boolean) =>
        apiFetch<{ success: boolean }>("/api/admin/maintenance", {
          method: "POST",
          body: JSON.stringify({ enabled }),
        }),

      getUtilsPreview: () =>
        apiFetch<{
          emptyRepos: number;
          unactivatedAccounts: number;
          expiredSessions: number;
          expiredVerifications: number;
        }>("/api/admin/utils/preview"),
      cleanupEmptyRepos: () =>
        apiFetch<{ deleted: number }>("/api/admin/utils/cleanup-empty-repos", { method: "POST" }),
      cleanupUnactivatedAccounts: () =>
        apiFetch<{ deleted: number }>("/api/admin/utils/cleanup-unactivated-accounts", {
          method: "POST",
        }),
      cleanupExpiredSessions: () =>
        apiFetch<{ deleted: number }>("/api/admin/utils/cleanup-expired-sessions", {
          method: "POST",
        }),
      cleanupExpiredVerifications: () =>
        apiFetch<{ deleted: number }>("/api/admin/utils/cleanup-expired-verifications", {
          method: "POST",
        }),

      getOrganizations: (search = "", limit = 20, offset = 0) =>
        apiFetch<{ organizations: any[]; hasMore: boolean }>(
          `/api/admin/organizations?search=${encodeURIComponent(search)}&limit=${limit}&offset=${offset}`
        ),

      getOrganization: (id: string) => apiFetch<any>(`/api/admin/organizations/${id}`),

      deleteOrganization: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/admin/organizations/${id}`, {
          method: "DELETE",
        }),

      getIssues: (search = "", state?: string, limit = 20, offset = 0) =>
        apiFetch<{ issues: any[]; hasMore: boolean }>(
          `/api/admin/issues?search=${encodeURIComponent(search)}&state=${state || ""}&limit=${limit}&offset=${offset}`
        ),

      getAnalytics: (days = 30) =>
        apiFetch<{
          userGrowth: { date: string; count: number }[];
          repoGrowth: { date: string; count: number }[];
          activityByDay: { date: string; count: number }[];
        }>(`/api/admin/analytics?days=${days}`),

      getApplicationJobs: (openOnly?: boolean) =>
        apiFetch<{ jobs: any[] }>(
          `/api/admin/applications/jobs${openOnly === true ? "?open=true" : ""}`
        ),
      createApplicationJob: (data: {
        title: string;
        description: string;
        slug?: string;
        department?: string;
        location?: string;
        employmentType?: string;
      }) =>
        apiFetch<any>("/api/admin/applications/jobs", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      updateApplicationJob: (id: string, data: Record<string, unknown>) =>
        apiFetch<any>(`/api/admin/applications/jobs/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
      deleteApplicationJob: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/admin/applications/jobs/${id}`, {
          method: "DELETE",
        }),
      getApplications: (jobId?: string, status?: string, limit?: number, offset?: number) =>
        apiFetch<{ applications: any[]; hasMore: boolean }>(
          `/api/admin/applications/applications?jobId=${jobId || ""}&status=${status || ""}&limit=${limit ?? 20}&offset=${offset ?? 0}`
        ),
      getApplication: (id: string) =>
        apiFetch<any>(`/api/admin/applications/applications/${id}`),
      updateApplicationStatus: (id: string, status: string) =>
        apiFetch<any>(`/api/admin/applications/applications/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),

      releases: {
        list: (owner: string, repo: string, includeDrafts = false, options?: ListPageOptions) =>
          apiFetch<{ releases: Release[] }>(
            `/api/repositories/${owner}/${repo}/releases?draft=${includeDrafts}&${listPageQuery(options)}`
          ),

        getLatest: (owner: string, repo: string) =>
          apiFetch<Release & { assets: ReleaseAsset[] }>(`/api/repositories/${owner}/${repo}/releases/latest`),

        getByTag: (owner: string, repo: string, tag: string) =>
          apiFetch<Release & { assets: ReleaseAsset[] }>(`/api/repositories/${owner}/${repo}/releases/tag/${tag}`),

        get: (owner: string, repo: string, id: string) =>
          apiFetch<Release>(`/api/repositories/${owner}/${repo}/releases/${id}`),

        create: (owner: string, repo: string, data: unknown) =>
          apiFetch<{ data: Release }>(`/api/repositories/${owner}/${repo}/releases`, {
            method: "POST",
            body: JSON.stringify(data),
          }),

        update: (owner: string, repo: string, id: string, data: unknown) =>
          apiFetch<{ data: Release }>(`/api/repositories/${owner}/${repo}/releases/${id}`, {
            method: "PATCH",
            body: JSON.stringify(data),
          }),

        delete: (owner: string, repo: string, id: string) =>
          apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${repo}/releases/${id}`, {
            method: "DELETE",
          }),

        publish: (owner: string, repo: string, id: string) =>
          apiFetch<{ data: Release }>(`/api/repositories/${owner}/${repo}/releases/${id}/publish`, {
            method: "POST",
          }),

        getAssets: (owner: string, repo: string, id: string, options?: ListPageOptions) =>
          apiFetch<{ assets: ReleaseAsset[] }>(`/api/repositories/${owner}/${repo}/releases/${id}/assets?${listPageQuery(options)}`),

        uploadAsset: async (owner: string, repo: string, id: string, file: File) => {
          const formData = new FormData();
          formData.append("asset", file);
          const fullUrl = `${baseUrl}/api/repositories/${owner}/${repo}/releases/${id}/assets`;
          const authHeaders = await getAuthHeaders();
          const res = await fetch(fullUrl, {
            ...fetchOptions,
            method: "POST",
            headers: { ...authHeaders, ...(fetchOptions.headers as Record<string, string>) },
            body: formData,
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error((data as { error?: string }).error || "Asset upload failed");
          }
          return res.json() as Promise<{ data: ReleaseAsset }>;
        },

        deleteAsset: (owner: string, repo: string, id: string, assetId: string) =>
          apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${repo}/releases/${id}/assets/${assetId}`, {
            method: "DELETE",
          }),
      },

      gists: {
        list: () => apiFetch<{ gists: Gist[] }>("/api/gists"),

        getPublic: (limit = 20, offset = 0) =>
          apiFetch<{ gists: Gist[]; hasMore: boolean }>(`/api/gists/public?limit=${limit}&offset=${offset}`),

        get: (id: string) => apiFetch<Gist>(`/api/gists/${id}`),

        create: (data: unknown) =>
          apiFetch<Gist>("/api/gists", {
            method: "POST",
            body: JSON.stringify(data),
          }),

        update: (id: string, data: unknown) =>
          apiFetch<Gist>(`/api/gists/${id}`, {
            method: "PATCH",
            body: JSON.stringify(data),
          }),

        delete: (id: string) => {
          // Use POST /delete instead of DELETE to avoid CORS preflight.
          // A POST with no body and no custom headers is a "simple" CORS request —
          // no preflight OPTIONS is sent. Auth is via session cookie.
          const url = `${baseUrl.replace(/\/$/, "")}/api/gists/${id}/delete`;
          return fetch(url, { method: "POST", credentials: "include" }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error((data as any).error || `Request failed: ${res.status}`);
            }
            return res.json() as Promise<{ success: boolean }>;
          });
        },

        getRevisions: (id: string) =>
          apiFetch<{ revisions: unknown[] }>(`/api/gists/${id}/revisions`),

        toggleStar: (id: string) =>
          apiFetch<{ starred: boolean }>(`/api/gists/${id}/star`, {
            method: "POST",
          }),

        isStarred: (id: string) => apiFetch<{ starred: boolean }>(`/api/gists/${id}/star`),

        fork: (id: string) =>
          apiFetch<{ id: string }>(`/api/gists/${id}/fork`, {
            method: "POST",
          }),

        getForks: (id: string, limit = 20, offset = 0) =>
          apiFetch<{ forks: GistFork[]; hasMore: boolean }>(`/api/gists/${id}/forks?limit=${limit}&offset=${offset}`),

        getComments: (id: string, options?: ListPageOptions) => apiFetch<{ comments: GistComment[] }>(`/api/gists/${id}/comments?${listPageQuery(options)}`),

        createComment: (id: string, body: string) =>
          apiFetch<GistComment>(`/api/gists/${id}/comments`, {
            method: "POST",
            body: JSON.stringify({ body }),
          }),

        getUserGists: (username: string, limit = 20, offset = 0) =>
          apiFetch<{ gists: Gist[]; hasMore: boolean }>(`/api/users/${username}/gists?limit=${limit}&offset=${offset}`),
      },

      migrations: {
        list: () => apiFetch<{ migrations: RepositoryMigration[]; hasMore?: boolean }>("/api/migrations"),

        get: (id: string) => apiFetch<RepositoryMigration>(`/api/migrations/${id}`),

        create: (data: unknown) =>
          apiFetch<{ data: RepositoryMigration }>("/api/migrations", {
            method: "POST",
            body: JSON.stringify(data),
          }),

        cancel: (id: string) =>
          apiFetch<{ success: boolean }>(`/api/migrations/${id}/cancel`, {
            method: "POST",
          }),

        delete: (id: string) =>
          apiFetch<{ success: boolean }>(`/api/migrations/${id}`, {
            method: "DELETE",
          }),

        listGitHubRepos: (token: string) =>
          apiFetch<{ repos: Array<{ id: string; fullName: string; private: boolean; defaultBranch?: string; url: string }> }>(
            `/api/migrations/github/repos`,
            { headers: { "X-Provider-Token": token } }
          ),

        listGitLabRepos: (token: string, baseUrl?: string) => {
          const params = new URLSearchParams();
          if (baseUrl) params.set("baseUrl", baseUrl);
          const query = params.toString();
          return apiFetch<{ repos: Array<{ id: string; fullName: string; private: boolean; defaultBranch?: string; url: string }> }>(
            `/api/migrations/gitlab/repos${query ? `?${query}` : ""}`,
            { headers: { "X-Provider-Token": token } }
          );
        },

        listGiteaRepos: (token: string, baseUrl: string) =>
          apiFetch<{ repos: Array<{ id: string; fullName: string; private: boolean; defaultBranch?: string; url: string }> }>(
            `/api/migrations/gitea/repos?baseUrl=${encodeURIComponent(baseUrl)}`,
            { headers: { "X-Provider-Token": token } }
          ),

        listBitbucketRepos: (token: string) =>
          apiFetch<{ repos: Array<{ id: string; fullName: string; private: boolean; defaultBranch?: string; url: string }> }>(
            `/api/migrations/bitbucket/repos`,
            { headers: { "X-Provider-Token": token } }
          ),
      },

      organizations: {
        list: () => apiFetch<{ organizations: Organization[] }>("/api/organizations"),

        get: (org: string) => apiFetch<Organization>(`/api/organizations/${org}`),

        getMembers: (org: string, options?: ListPageOptions) => apiFetch<{ members: OrganizationMember[] }>(`/api/organizations/${org}/members?${listPageQuery(options)}`),

        getTeams: (org: string, options?: ListPageOptions) => apiFetch<{ teams: Team[] }>(`/api/organizations/${org}/teams?${listPageQuery(options)}`),

      getRepositories: (org: string) => apiFetch<{ repositories: (Repository & { owner: Owner })[] }>(`/api/organizations/${org}/repositories`),

        getInvitations: (org: string, options?: ListPageOptions) =>
          apiFetch<{ invitations: OrganizationInvitation[] }>(`/api/organizations/${org}/invitations?${listPageQuery(options)}`),

        create: (data: unknown) =>
          apiFetch<{ data: Organization }>("/api/organizations", {
            method: "POST",
            body: JSON.stringify(data),
          }),

        update: (org: string, data: unknown) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}`, {
            method: "PATCH",
            body: JSON.stringify(data),
          }),

        delete: (org: string) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}`, {
            method: "DELETE",
          }),

        updateMember: (org: string, username: string, data: unknown) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}/members/${username}`, {
            method: "PUT",
            body: JSON.stringify(data),
          }),

        removeMember: (org: string, username: string) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}/members/${username}`, {
            method: "DELETE",
          }),

        createTeam: (org: string, data: unknown) =>
          apiFetch<{ data: Team }>(`/api/organizations/${org}/teams`, {
            method: "POST",
            body: JSON.stringify(data),
          }),

        deleteTeam: (org: string, team: string) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}`, {
            method: "DELETE",
          }),

        getTeam: (org: string, team: string) => apiFetch<Team>(`/api/organizations/${org}/teams/${team}`),

        addTeamMember: (org: string, team: string, data: unknown) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}/members`, {
            method: "PUT",
            body: JSON.stringify(data),
          }),

        removeTeamMember: (org: string, team: string, username: string) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}/members/${username}`, {
            method: "DELETE",
          }),

        addTeamRepo: (org: string, team: string, repo: string, data: unknown) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}/repos/${repo}`, {
            method: "PUT",
            body: JSON.stringify(data),
          }),

        removeTeamRepo: (org: string, team: string, repo: string) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}/repos/${repo}`, {
            method: "DELETE",
          }),

        deleteTeamRepo: (org: string, team: string, repo: string) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}/teams/${team}/repos/${repo}`, {
            method: "DELETE",
          }),

        sendInvitation: (org: string, data: unknown) =>
          apiFetch<{ data: OrganizationInvitation }>(`/api/organizations/${org}/invitations`, {
            method: "POST",
            body: JSON.stringify(data),
          }),

        deleteInvitation: (org: string, id: string) =>
          apiFetch<{ success: boolean }>(`/api/organizations/${org}/invitations/${id}`, {
            method: "DELETE",
          }),

        acceptInvitation: (token: string) =>
          apiFetch<{ success: boolean }>(`/api/invitations/${token}/accept`, {
            method: "POST",
          }),
      },
    },

    workflows: {
      list: (owner: string, repo: string, options?: ListPageOptions) =>
        apiFetch<{ workflows: Workflow[] }>(`/api/repositories/${owner}/${repo}/workflows?${listPageQuery(options)}`),

      sync: (owner: string, repo: string) =>
        apiFetch<{ workflows: Workflow[] }>(`/api/repositories/${owner}/${repo}/workflows/sync`, {
          method: "POST",
        }),

      dispatch: (owner: string, repo: string, workflowId: string, data?: { ref?: string; inputs?: Record<string, string> }) =>
        apiFetch<{ runIds: string[] }>(`/api/repositories/${owner}/${repo}/workflows/${workflowId}/dispatch`, {
          method: "POST",
          body: JSON.stringify(data ?? {}),
        }),

      listRuns: (owner: string, repo: string, page = 1) =>
        apiFetch<{ runs: WorkflowRun[] }>(`/api/repositories/${owner}/${repo}/runs?page=${page}`),

      getRun: (owner: string, repo: string, runId: string) =>
        apiFetch<{ run: WorkflowRun; jobs: WorkflowJob[] }>(`/api/repositories/${owner}/${repo}/runs/${runId}`),

      getJobLogs: (owner: string, repo: string, runId: string, jobId: string) =>
        apiFetch<{ logs: string; steps: WorkflowStep[] }>(`/api/repositories/${owner}/${repo}/runs/${runId}/jobs/${jobId}/logs`),

      cancelRun: (owner: string, repo: string, runId: string) =>
        apiFetch<{ success: boolean }>(`/api/repositories/${owner}/${repo}/runs/${runId}/cancel`, {
          method: "POST",
        }),
    },

    runners: {
      list: () => apiFetch<{ runners: Runner[] }>("/api/runners"),

      remove: (runnerId: string) =>
        apiFetch<{ success: boolean }>(`/api/runners/${runnerId}`, { method: "DELETE" }),
    },
  };
}
