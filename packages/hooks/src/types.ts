export type Owner = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
};

export type Repository = {
  id: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  defaultBranch: string;
  ownerId: string;
  forkedFromId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ForkedFrom = {
  id: string;
  name: string;
  owner: Owner;
};

export type RepositoryWithOwner = Repository & {
  owner: Owner;
  starCount: number;
  starred: boolean;
  forkedFrom?: ForkedFrom | null;
  forkCount?: number;
};

export type RepositoryWithStars = Repository & {
  owner: Owner;
  starCount: number;
  forkedFrom?: ForkedFrom | null;
  forkCount?: number;
  /** When present, list response included viewer's star state to avoid N+1 isStarred calls */
  starredByViewer?: boolean;
};

/** Repository shape returned by admin list; includes owner slug/display for URLs and UI */
export type AdminRepository = Repository & {
  ownerUsername: string;
  ownerDisplayName: string;
};

export type FileEntry = {
  name: string;
  type: "blob" | "tree";
  oid: string;
  path: string;
};

export type FileLastCommit = {
  path: string;
  commitOid: string;
  message: string;
  authorName: string;
  timestamp: number;
};

export type RepoInfo = {
  repo: RepositoryWithOwner;
  isOwner: boolean;
};

export type TreeResponse = {
  files: FileEntry[];
  isEmpty: boolean;
  readmeOid?: string | null;
};

export type RepoPageData = {
  repo: RepositoryWithOwner;
  files: FileEntry[];
  isEmpty: boolean;
  branches: string[];
  readmeOid: string | null;
  isOwner: boolean;
};

export type Commit = {
  oid: string;
  message: string;
  author: {
    name: string;
    username?: string;
    userId?: string;
    avatarUrl?: string;
  };
  timestamp: number;
};

export type DiffHunkLine = {
  type: "context" | "addition" | "deletion";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffHunkLine[];
};

export type FileDiff = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  oldPath?: string;
};

export type DiffStats = {
  additions: number;
  deletions: number;
  filesChanged: number;
};

export type CommitDiff = {
  commit: Commit;
  parent: string | null;
  files: FileDiff[];
  stats: DiffStats;
};

export type UserPreferences = {
  emailNotifications?: boolean;
  theme?: "light" | "dark" | "system";
  language?: string;
  showEmail?: boolean;
  wordWrap?: boolean;
};

export type UserProfile = {
  id: string;
  name: string;
  username: string;
  email?: string;
  emailVerified?: boolean;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  pronouns: string | null;
  company?: string | null;
  lastActiveAt?: string | null;
  gitEmail?: string | null;
  defaultRepositoryVisibility?: "public" | "private";
  role?: "user" | "admin" | "moderator";
  preferences?: UserPreferences | null;
  socialLinks?: {
    github?: string;
    twitter?: string;
    linkedin?: string;
    custom?: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicUser = {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  repoCount: number;
};

export type UserSummary = {
  name: string;
  avatarUrl: string | null;
};

export type PlatformStats = {
  developers: number;
  repositories: number;
  organizations: number;
  uptimeSeconds: number;
  generatedAt: string;
};

export type Label = {
  id: string;
  name: string;
  description: string | null;
  color: string;
};

export type IssueAuthor = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
};

export type ReactionSummary = {
  emoji: string;
  count: number;
  reacted: boolean;
};

export type Issue = {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  locked: boolean;
  author: IssueAuthor;
  labels: Label[];
  assignees: IssueAuthor[];
  reactions: ReactionSummary[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedBy: IssueAuthor | null;
};

export type IssueComment = {
  id: string;
  body: string;
  author: IssueAuthor;
  reactions: ReactionSummary[];
  createdAt: string;
  updatedAt: string;
};

export type IssueFilters = {
  state?: "open" | "closed" | "all";
  label?: string;
  assignee?: string;
  limit?: number;
  offset?: number;
};

export type PRRepoInfo = {
  id: string;
  name: string;
  owner: Owner;
};

export type PRReview = {
  id: string;
  author: Owner;
  body: string | null;
  state: "approved" | "changes_requested" | "commented";
  commitOid: string;
  createdAt: string;
};

export type PullRequest = {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  author: Owner;
  headRepo: PRRepoInfo | null;
  headBranch: string;
  headOid: string;
  baseRepo: PRRepoInfo | null;
  baseBranch: string;
  baseOid: string;
  merged: boolean;
  mergedAt: string | null;
  mergedBy: Owner | null;
  mergeCommitOid: string | null;
  labels: Label[];
  assignees: Owner[];
  reviewers: Owner[];
  reviews: PRReview[];
  reactions: ReactionSummary[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedBy: Owner | null;
};

export type PRComment = {
  id: string;
  body: string;
  author: Owner;
  reactions: ReactionSummary[];
  filePath?: string | null;
  side?: "left" | "right" | null;
  lineNumber?: number | null;
  commitOid?: string | null;
  replyToId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InlineCommentData = {
  body: string;
  filePath: string;
  side: "left" | "right";
  lineNumber: number;
  commitOid?: string;
  replyToId?: string;
};

export type GroupedPRComments = {
  generalComments: PRComment[];
  inlineComments: Record<string, PRComment[]>;
};

export type PRFilters = {
  state?: "open" | "closed" | "merged" | "all";
  author?: string;
  assignee?: string;
  reviewer?: string;
  label?: string;
  limit?: number;
  offset?: number;
};

export type PRDiff = {
  files: FileDiff[];
  stats: DiffStats;
};

export type PRCount = {
  open: number;
  closed: number;
  merged: number;
};

// ─── Collaborator ────────────────────────────────────────────────────────────

export type CollaboratorPermission = "read" | "write" | "admin";

export type Collaborator = {
  user: Owner;
  permission: CollaboratorPermission;
  addedAt: string;
};

// ─── Branch Protection ───────────────────────────────────────────────────────

export type BranchProtectionRule = {
  id: string;
  repositoryId: string;
  pattern: string;
  requirePullRequest: boolean;
  requireApprovals: number;
  dismissStaleReviews: boolean;
  requireStatusChecks: boolean;
  requiredStatusChecks: string[];
  allowForcePush: boolean;
  allowDeletion: boolean;
  createdAt: string;
  updatedAt: string;
};

// ─── Git Tag ─────────────────────────────────────────────────────────────────

export type GitTag = {
  name: string;
  oid: string;
  targetOid: string;
  message?: string;
  taggerName?: string;
  taggerEmail?: string;
  timestamp?: number;
};

// ─── Repository Webhook ──────────────────────────────────────────────────────

export type WebhookEvent = "push" | "pull_request" | "issues" | "tag" | "branch";

export type RepositoryWebhook = {
  id: string;
  url: string;
  secret: string | null;
  events: WebhookEvent[];
  active: boolean;
  contentType: "json" | "form";
  createdAt: string;
  updatedAt: string;
};

// ─── Container registry (packages) ─────────────────────────────────────────

export type Package = {
  name: string;
  owner: string;
  tags: string[];
  updatedAt?: string;
};

export type Release = {
  id: string;
  repositoryId: string;
  authorId: string;
  tagName: string;
  name: string;
  body: string | null;
  isDraft: boolean;
  isPrerelease: boolean;
  targetCommitish: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReleaseAsset = {
  id: string;
  releaseId: string;
  name: string;
  label: string | null;
  contentType: string;
  size: number;
  downloadCount: number;
  storageKey: string;
  uploaderId: string;
  createdAt: string;
};

export type Gist = {
  id: string;
  ownerId: string;
  description: string | null;
  visibility: "public" | "secret";
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; name: string; username: string; avatarUrl: string | null };
  files?: GistFile[];
  stars?: number;
};

export type GistFile = {
  id: string;
  gistId: string;
  filename: string;
  content: string;
  language: string | null;
  size: number;
  createdAt: string;
  updatedAt: string;
};

export type GistComment = {
  id: string;
  gistId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author?: { id: string; name: string; username: string; avatarUrl: string | null };
};

export type GistFork = {
  id: string;
  gistId: string;
  forkedFromId: string;
  ownerId: string;
  createdAt: string;
  gist?: Gist;
  owner?: { id: string; name: string; username: string; avatarUrl: string | null };
  forkedFrom?: Gist;
};

export type RepositoryMigration = {
  id: string;
  repositoryId: string | null;
  userId: string;
  source: "github" | "gitlab" | "bitbucket" | "gitea" | "url";
  sourceUrl: string;
  sourceBaseUrl: string | null; // For self-hosted GitLab/Gitea
  sourceOwner: string | null;
  sourceRepo: string | null;
  status: "pending" | "cloning" | "importing" | "completed" | "failed";
  progress: number;
  errorMessage: string | null;
  options: {
    importIssues?: boolean;
    importPRs?: boolean;
    importWiki?: boolean;
    importLabels?: boolean;
    mirror?: boolean;
  };
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MigrationCredentials = {
  id: string;
  migrationId: string;
  authToken?: string;
  authType: "token" | "password" | "ssh_key";
  sshKey?: string;
  sshKeyPassphrase?: string;
  createdAt: string;
  updatedAt: string;
};

export type Organization = {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  avatarUrl: string | null;
  website: string | null;
  location: string | null;
  email: string | null;
  isVerified: boolean;
  billingEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationMember = {
  organizationId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
};

export type Team = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  permission: "read" | "write" | "admin";
  createdAt: string;
  updatedAt: string;
};

export type TeamMember = {
  teamId: string;
  userId: string;
  createdAt: string;
};

export type TeamRepository = {
  teamId: string;
  repositoryId: string;
  permission: "read" | "write" | "admin";
  createdAt: string;
};

export type OrganizationInvitation = {
  id: string;
  organizationId: string;
  email: string | null;
  userId: string | null;
  invitedById: string;
  role: "owner" | "admin" | "member";
  teamIds: string[];
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

export type ReportTargetType = "user" | "repository" | "gist" | "organization";
export type ReportReason = "spam" | "harassment" | "inappropriate" | "impersonation" | "other";
export type ReportStatus = "pending" | "reviewing" | "resolved" | "dismissed";

export type Report = {
  id: string;
  reporterId: string | null;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  description: string;
  status: ReportStatus;
  adminNotes: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reporterUsername?: string | null;
  reporterName?: string | null;
};

export type DmcaRequest = {
  id: string;
  requesterId: string | null;
  targetType: "repository" | "gist";
  targetId: string;
  copyrightHolder: string;
  copyrightHolderEmail: string;
  copyrightHolderAddress: string;
  copyrightHolderPhone: string | null;
  originalWorkDescription: string;
  originalWorkUrl: string | null;
  infringingUrls: string;
  description: string;
  swornStatement: boolean;
  perjuryStatement: boolean;
  signature: string;
  status: "pending" | "reviewing" | "approved" | "rejected" | "counter_filed";
  adminNotes: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requesterUsername?: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
};

export type ApiClient = {
  repositories: {
    create: (data: { name: string; description?: string; visibility: "public" | "private"; organizationId?: string }) => Promise<Repository>;
    fork: (owner: string, name: string, data?: { name?: string; description?: string }) => Promise<RepoInfo>;
    getForks: (owner: string, name: string, limit?: number, offset?: number) => Promise<{ forks: RepositoryWithOwner[] }>;
    get: (owner: string, name: string) => Promise<RepositoryWithOwner>;
    getWithStars: (owner: string, name: string) => Promise<RepositoryWithOwner>;
    getInfo: (owner: string, name: string) => Promise<RepoInfo>;
    getPageData: (owner: string, name: string) => Promise<RepoPageData>;
    getUserRepos: (username: string) => Promise<{ repos: RepositoryWithStars[] }>;
    getPublic: (sortBy: "stars" | "updated" | "created", limit: number, offset: number) => Promise<{ repos: RepositoryWithStars[]; hasMore: boolean }>;
    update: (id: string, data: { name?: string; description?: string; visibility?: "public" | "private" }) => Promise<Repository>;
    delete: (id: string) => Promise<{ success: boolean }>;
    toggleStar: (id: string) => Promise<{ starred: boolean }>;
    isStarred: (id: string) => Promise<{ starred: boolean }>;
    getBranches: (owner: string, name: string) => Promise<{ branches: string[] }>;
    createBranch: (owner: string, name: string, data: { branch: string; fromRef: string }) => Promise<{ branch: string; oid: string }>;
    deleteBranch: (owner: string, name: string, branch: string) => Promise<{ success: boolean }>;
    setDefaultBranch: (owner: string, name: string, branch: string) => Promise<{ defaultBranch: string }>;
    getTree: (owner: string, name: string, branch: string, path?: string) => Promise<TreeResponse>;
    getTreeCommits: (owner: string, name: string, branch: string, path?: string) => Promise<{ files: FileLastCommit[] }>;
    getFile: (owner: string, name: string, branch: string, path: string) => Promise<{ content: string; oid: string; path: string }>;
    commitFile: (owner: string, name: string, data: { branch: string; path: string; content?: string; message: string; delete?: boolean }) => Promise<{ success: boolean; commitOid: string }>;
    getCommits: (owner: string, name: string, branch: string, limit?: number, skip?: number) => Promise<{ commits: Commit[]; hasMore: boolean }>;
    getCommitCount: (owner: string, name: string, branch: string) => Promise<{ count: number }>;
    getCommitDiff: (owner: string, name: string, oid: string) => Promise<CommitDiff>;
    getReadme: (owner: string, name: string, oid: string) => Promise<{ content: string }>;
    getReadmeOid: (owner: string, name: string, branch: string) => Promise<{ readmeOid: string | null }>;
    getTags: (owner: string, name: string) => Promise<{ tags: GitTag[] }>;
    createTag: (owner: string, name: string, data: { name: string; ref: string; message?: string }) => Promise<{ tag: string; oid: string }>;
    deleteTag: (owner: string, name: string, tag: string) => Promise<{ success: boolean }>;
    getCollaborators: (owner: string, name: string) => Promise<{ collaborators: Collaborator[] }>;
    addCollaborator: (owner: string, name: string, data: { username: string; permission?: CollaboratorPermission }) => Promise<{ collaborator: Collaborator }>;
    updateCollaborator: (owner: string, name: string, userId: string, permission: CollaboratorPermission) => Promise<{ success: boolean }>;
    removeCollaborator: (owner: string, name: string, userId: string) => Promise<{ success: boolean }>;
    getBranchProtectionRules: (owner: string, name: string) => Promise<{ rules: BranchProtectionRule[] }>;
    createBranchProtectionRule: (owner: string, name: string, data: Omit<BranchProtectionRule, "id" | "repositoryId" | "createdAt" | "updatedAt">) => Promise<{ rule: BranchProtectionRule }>;
    updateBranchProtectionRule: (owner: string, name: string, ruleId: string, data: Partial<Omit<BranchProtectionRule, "id" | "repositoryId" | "createdAt" | "updatedAt">>) => Promise<{ success: boolean }>;
    deleteBranchProtectionRule: (owner: string, name: string, ruleId: string) => Promise<{ success: boolean }>;
    getWebhooks: (owner: string, name: string) => Promise<{ webhooks: RepositoryWebhook[] }>;
    createWebhook: (owner: string, name: string, data: { url: string; secret?: string; events: WebhookEvent[]; active?: boolean; contentType?: "json" | "form" }) => Promise<{ webhook: RepositoryWebhook }>;
    updateWebhook: (owner: string, name: string, hookId: string, data: Partial<{ url: string; secret: string | null; events: WebhookEvent[]; active: boolean; contentType: "json" | "form" }>) => Promise<{ success: boolean }>;
    deleteWebhook: (owner: string, name: string, hookId: string) => Promise<{ success: boolean }>;
  };
  users: {
    getProfile: (username: string) => Promise<UserProfile>;
    getSummary: () => Promise<UserSummary>;
    getPlatformStats: () => Promise<PlatformStats>;
    getStarred: (username: string) => Promise<{ repos: RepositoryWithStars[] }>;
    getAvatarByUsername: (username: string) => Promise<{ avatarUrl: string | null }>;
    getPublic: (sortBy: "newest" | "oldest", limit: number, offset: number) => Promise<{ users: PublicUser[]; hasMore: boolean }>;
  };
  packages: {
    listForUser: (username: string) => Promise<{ packages: Package[] }>;
    getTags: (username: string, image: string) => Promise<{ name: string; tags: string[] }>;
  };
  settings: {
    getCurrentUser: () => Promise<{ user: UserProfile }>;
    getWordWrap: () => Promise<{ wordWrap: boolean }>;
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
    }) => Promise<{ success: boolean; username?: string } | UserProfile>;
    updatePreferences: (data: Partial<UserPreferences>) => Promise<{ success: boolean }>;
    updateWordWrap: (data: { wordWrap: boolean }) => Promise<{ success: boolean; wordWrap: boolean }>;
    updateSocialLinks?: (data: { github?: string; twitter?: string; linkedin?: string; custom?: string[] }) => Promise<{ success: boolean }>;
    updateEmail: (data: { email: string; password: string }) => Promise<{ success: boolean } | UserProfile>;
    updatePassword?: (data: { currentPassword: string; newPassword: string }) => Promise<{ success: boolean }>;
    updateAvatar: (file: File) => Promise<{ success: boolean; avatarUrl: string }>;
    deleteAvatar: () => Promise<{ success: boolean; avatarUrl: string | null }>;
    deleteAccount: (data: { password: string }) => Promise<{ success: boolean }>;
  };
  issues: {
    list: (owner: string, repo: string, filters?: IssueFilters) => Promise<{ issues: Issue[]; hasMore: boolean }>;
    get: (owner: string, repo: string, number: number) => Promise<Issue>;
    create: (owner: string, repo: string, data: { title: string; body?: string; labels?: string[]; assignees?: string[] }) => Promise<Issue>;
    update: (id: string, data: { title?: string; body?: string; state?: "open" | "closed"; locked?: boolean }) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
    getCount: (owner: string, repo: string) => Promise<{ open: number; closed: number }>;
    listLabels: (owner: string, repo: string) => Promise<{ labels: Label[] }>;
    createLabel: (owner: string, repo: string, data: { name: string; description?: string; color: string }) => Promise<Label>;
    updateLabel: (id: string, data: { name?: string; description?: string; color?: string }) => Promise<Label>;
    deleteLabel: (id: string) => Promise<{ success: boolean }>;
    addLabels: (issueId: string, labels: string[]) => Promise<{ success: boolean }>;
    removeLabel: (issueId: string, labelId: string) => Promise<{ success: boolean }>;
    addAssignees: (issueId: string, assignees: string[]) => Promise<{ success: boolean }>;
    removeAssignee: (issueId: string, userId: string) => Promise<{ success: boolean }>;
    listComments: (issueId: string) => Promise<{ comments: IssueComment[] }>;
    createComment: (issueId: string, body: string) => Promise<IssueComment>;
    updateComment: (commentId: string, body: string) => Promise<{ success: boolean }>;
    deleteComment: (commentId: string) => Promise<{ success: boolean }>;
    toggleIssueReaction: (issueId: string, emoji: string) => Promise<{ added: boolean }>;
    toggleCommentReaction: (commentId: string, emoji: string) => Promise<{ added: boolean }>;
  };
  pullRequests: {
    list: (owner: string, repo: string, filters?: PRFilters) => Promise<{ pullRequests: PullRequest[]; hasMore: boolean }>;
    get: (owner: string, repo: string, number: number) => Promise<PullRequest>;
    create: (owner: string, repo: string, data: {
      title: string;
      body?: string;
      headRepoOwner?: string;
      headRepoName?: string;
      headBranch: string;
      baseBranch?: string;
      labels?: string[];
      assignees?: string[];
      reviewers?: string[];
    }) => Promise<PullRequest>;
    update: (id: string, data: { title?: string; body?: string; state?: "open" | "closed" }) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
    getCount: (owner: string, repo: string) => Promise<PRCount>;
    getDiff: (id: string) => Promise<PRDiff>;
    getCommits: (id: string, limit?: number, skip?: number) => Promise<{ commits: Commit[]; hasMore: boolean }>;
    merge: (id: string, data?: { commitMessage?: string; mergeStrategy?: "merge" | "squash" | "rebase" }) => Promise<{ success: boolean; mergeCommitOid: string }>;
    listReviews: (id: string) => Promise<{ reviews: PRReview[] }>;
    submitReview: (id: string, data: { body?: string; state: "approved" | "changes_requested" | "commented" }) => Promise<PRReview>;
    listComments: (id: string, options?: { groupByFile?: boolean; filePath?: string }) => Promise<{ comments: PRComment[] } | GroupedPRComments>;
    createComment: (id: string, data: string | InlineCommentData) => Promise<PRComment>;
    updateComment: (commentId: string, body: string) => Promise<{ success: boolean }>;
    deleteComment: (commentId: string) => Promise<{ success: boolean }>;
    addLabels: (id: string, labels: string[]) => Promise<{ success: boolean }>;
    removeLabel: (id: string, labelId: string) => Promise<{ success: boolean }>;
    addAssignees: (id: string, assignees: string[]) => Promise<{ success: boolean }>;
    removeAssignee: (id: string, userId: string) => Promise<{ success: boolean }>;
    addReviewers: (id: string, reviewers: string[]) => Promise<{ success: boolean }>;
    removeReviewer: (id: string, userId: string) => Promise<{ success: boolean }>;
    toggleReaction: (id: string, emoji: string) => Promise<{ added: boolean }>;
    toggleCommentReaction: (commentId: string, emoji: string) => Promise<{ added: boolean }>;
    markReady: (id: string) => Promise<{ success: boolean }>;
    convertToDraft: (id: string) => Promise<{ success: boolean }>;
  };
  search: {
    query: (q: string, options?: { type?: string; limit?: number; offset?: number; signal?: AbortSignal }) => Promise<SearchResponse>;
  };
  notifications: {
    list: (options?: { limit?: number; offset?: number; cursor?: string; unreadOnly?: boolean }) => Promise<{ notifications: Notification[]; hasMore: boolean; nextCursor: string | null }>;
    getUnreadCount: () => Promise<{ count: number }>;
    markRead: (id: string) => Promise<{ success: boolean }>;
    markAllRead: () => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };
  discussions: {
    list: (owner: string, repo: string, options?: { category?: string; limit?: number; offset?: number }) => Promise<{ discussions: Discussion[]; hasMore: boolean }>;
    get: (owner: string, repo: string, number: number) => Promise<Discussion>;
    create: (owner: string, repo: string, data: { title: string; body: string; categoryId?: string }) => Promise<Discussion>;
    update: (id: string, data: { title?: string; body?: string; categoryId?: string }) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
    getCategories: (owner: string, repo: string) => Promise<{ categories: DiscussionCategory[] }>;
    listComments: (discussionId: string) => Promise<{ comments: DiscussionComment[] }>;
    createComment: (discussionId: string, data: { body: string; parentId?: string }) => Promise<DiscussionComment>;
    markAnswer: (commentId: string) => Promise<{ success: boolean; isAnswer: boolean }>;
    toggleReaction: (discussionId: string, emoji: string) => Promise<{ added: boolean }>;
    toggleCommentReaction: (commentId: string, emoji: string) => Promise<{ added: boolean }>;
  };
  projects: {
    list: (owner: string, repo: string) => Promise<{ projects: ProjectListItem[] }>;
    get: (id: string) => Promise<Project>;
    create: (owner: string, repo: string, data: { name: string; description?: string }) => Promise<ProjectListItem>;
    update: (id: string, data: { name?: string; description?: string }) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
    addColumn: (projectId: string, name: string) => Promise<ProjectColumn>;
    updateColumn: (columnId: string, data: { name?: string; position?: number }) => Promise<{ success: boolean }>;
    deleteColumn: (columnId: string) => Promise<{ success: boolean }>;
    addItem: (projectId: string, data: { columnId: string; issueId?: string; pullRequestId?: string; noteContent?: string }) => Promise<ProjectItem>;
    updateItem: (itemId: string, data: { columnId?: string; position?: number; noteContent?: string }) => Promise<{ success: boolean }>;
    reorderItems: (items: { id: string; columnId: string; position: number }[]) => Promise<{ success: boolean }>;
    deleteItem: (itemId: string) => Promise<{ success: boolean }>;
  };
  releases: {
    list: (owner: string, repo: string, includeDrafts?: boolean) => Promise<{ releases: Release[]; hasMore?: boolean }>;
    getLatest: (owner: string, repo: string) => Promise<Release & { assets: ReleaseAsset[] }>;
    getByTag: (owner: string, repo: string, tag: string) => Promise<Release & { assets?: ReleaseAsset[] }>;
    get: (owner: string, repo: string, id: string) => Promise<Release>;
    create: (owner: string, repo: string, tagName: string, name: string, body: string, isDraft?: boolean, isPrerelease?: boolean, targetCommitish?: string) => Promise<Release>;
    update: (owner: string, repo: string, id: string, data: { name?: string; body?: string; isDraft?: boolean }) => Promise<{ success: boolean }>;
    delete: (owner: string, repo: string, id: string) => Promise<{ success: boolean }>;
    publish: (owner: string, repo: string, id: string) => Promise<{ success: boolean }>;
    getAssets: (owner: string, repo: string, id: string) => Promise<{ assets: ReleaseAsset[] }>;
    uploadAsset: (owner: string, repo: string, id: string, file: File) => Promise<{ data: ReleaseAsset }>;
    deleteAsset: (owner: string, repo: string, id: string, assetId: string) => Promise<{ success: boolean }>;
  };
  gists: {
    list: () => Promise<{ gists: Gist[]; hasMore: boolean }>;
    getPublic: (limit?: number, offset?: number) => Promise<{ gists: Gist[]; hasMore: boolean }>;
    get: (id: string) => Promise<Gist>;
    create: (data: unknown) => Promise<Gist>;
    update: (id: string, data: unknown) => Promise<Gist>;
    delete: (id: string) => Promise<{ success: boolean }>;
    getRevisions: (id: string) => Promise<{ revisions: unknown[] }>;
    toggleStar: (id: string) => Promise<{ starred: boolean }>;
    isStarred: (id: string) => Promise<{ starred: boolean }>;
    fork: (id: string) => Promise<{ id: string }>;
    getForks: (id: string, limit?: number, offset?: number) => Promise<{ forks: GistFork[]; hasMore: boolean }>;
    getComments: (id: string) => Promise<{ comments: GistComment[] }>;
    createComment: (id: string, body: string) => Promise<GistComment>;
    updateComment: (commentId: string, body: string) => Promise<{ success: boolean }>;
      deleteComment: (commentId: string) => Promise<{ success: boolean }>;
      getUserGists: (username: string, limit?: number, offset?: number) => Promise<{ gists: Gist[]; hasMore: boolean }>;
  };
  migrations: {
    list: () => Promise<{ migrations: RepositoryMigration[]; hasMore?: boolean }>;
    get: (id: string) => Promise<RepositoryMigration>;
    create: (data: unknown) => Promise<RepositoryMigration>;
    cancel: (id: string) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };
  reports: {
    submit: (data: {
      targetType: ReportTargetType;
      targetId: string;
      reason: ReportReason;
      description: string;
    }) => Promise<{ data: Report }>;
  };
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
    }) => Promise<{ data: DmcaRequest }>;
  };
  organizations: {
    list: () => Promise<{ organizations: Organization[]; hasMore?: boolean }>;
    get: (org: string) => Promise<Organization>;
    getMembers: (org: string) => Promise<{ members: OrganizationMember[] }>;
    getTeams: (org: string) => Promise<{ teams: Team[] }>;
    getRepositories: (org: string) => Promise<{ repositories: Repository[] }>;
    getInvitations: (org: string) => Promise<{ invitations: OrganizationInvitation[] }>;
    create: (data: unknown) => Promise<Organization>;
    update: (org: string, data: unknown) => Promise<{ success: boolean }>;
    delete: (org: string) => Promise<{ success: boolean }>;
    updateMember: (org: string, username: string, data: unknown) => Promise<{ success: boolean }>;
    removeMember: (org: string, username: string) => Promise<{ success: boolean }>;
    createTeam: (org: string, data: unknown) => Promise<Team>;
    deleteTeam: (org: string, team: string) => Promise<{ success: boolean }>;
    getTeam: (org: string, team: string) => Promise<Team>;
    addTeamMember: (org: string, team: string, data: unknown) => Promise<{ success: boolean }>;
    removeTeamMember: (org: string, team: string, username: string) => Promise<{ success: boolean }>;
    addTeamRepo: (org: string, team: string, repo: string, data: unknown) => Promise<{ success: boolean }>;
    removeTeamRepo: (org: string, team: string, repo: string) => Promise<{ success: boolean }>;
    deleteTeamRepo: (org: string, team: string, repo: string) => Promise<{ success: boolean }>;
    sendInvitation: (org: string, data: unknown) => Promise<OrganizationInvitation>;
    deleteInvitation: (org: string, id: string) => Promise<{ success: boolean }>;
    acceptInvitation: (token: string) => Promise<{ success: boolean }>;
  };
  admin: {
    getStats: () => Promise<{
      userCount: number;
      repoCount: number;
      publicRepoCount: number;
      privateRepoCount: number;
      adminCount: number;
      moderatorCount: number;
    }>;
    getSystemStats: () => Promise<{
      appUptimeSeconds: number;
      apiUptimeSeconds: number;
      postgres: {
        version: string | null;
        connections: number | null;
        databaseSizeBytes: number | null;
        cacheHitRatio: number | null;
        transactionsCommitted: number | null;
        transactionsRolledBack: number | null;
        rowsReturned: number | null;
        rowsFetched: number | null;
        rowsInserted: number | null;
        rowsUpdated: number | null;
        rowsDeleted: number | null;
        error: string | null;
      };
      generatedAt: string;
    }>;
    getUsers: (search?: string, role?: string, limit?: number, offset?: number) => Promise<{ users: UserProfile[]; hasMore: boolean }>;
    getUser: (id: string) => Promise<UserProfile & { repoCount: number }>;
    updateUser: (id: string, data: { role?: string }) => Promise<{ success: boolean }>;
    deleteUser: (id: string) => Promise<{ success: boolean }>;
    getRepositories: (search?: string, visibility?: string, limit?: number, offset?: number) => Promise<{ repositories: AdminRepository[]; hasMore: boolean }>;
    deleteRepository: (id: string) => Promise<{ success: boolean }>;
    transferRepository: (id: string, newOwnerId: string) => Promise<{ success: boolean }>;
    getGists: (search?: string, visibility?: string, limit?: number, offset?: number) => Promise<{ gists: Gist[]; hasMore: boolean }>;
    deleteGist: (id: string) => Promise<{ success: boolean }>;
    getAuditLogs: (action?: string, targetType?: string, limit?: number, offset?: number) => Promise<{
      logs: Array<{
        id: string;
        actorId: string | null;
        action: string;
        targetType: string;
        targetId: string | null;
        metadata: Record<string, unknown> | null;
        ipAddress: string | null;
        createdAt: string;
        actor?: { id: string; username: string; name: string } | null;
      }>;
      hasMore: boolean;
    }>;
    getReportsCounts: () => Promise<{ pending: number }>;
    getReports: (status?: string, targetType?: string, limit?: number, offset?: number) => Promise<{ reports: Report[]; hasMore: boolean }>;
    getReport: (id: string) => Promise<Report & { reporterEmail?: string | null }>;
    updateReport: (id: string, data: { status?: ReportStatus; adminNotes?: string }) => Promise<Report>;
    reportAction: (id: string, action: "dismiss" | "resolve" | "take_down" | "warn_user" | "ban_user") => Promise<{ success: boolean; status?: string }>;
    getDmcaCounts: () => Promise<{ pending: number }>;
    getDmcaRequests: (status?: string, limit?: number, offset?: number) => Promise<{ requests: DmcaRequest[]; hasMore: boolean }>;
    getDmcaRequest: (id: string) => Promise<DmcaRequest & { requesterEmail?: string | null }>;
    updateDmcaRequest: (id: string, data: { status?: string; adminNotes?: string }) => Promise<DmcaRequest>;
    dmcaAction: (id: string, action: "approve_takedown" | "reject" | "dismiss", reason?: string) => Promise<{ success: boolean; status?: string }>;
    getApplicationJobs: (openOnly?: boolean) => Promise<{ jobs: unknown[] }>;
    createApplicationJob: (data: {
      title: string;
      description: string;
      slug?: string;
      department?: string;
      location?: string;
      employmentType?: string;
    }) => Promise<unknown>;
    updateApplicationJob: (id: string, data: Record<string, unknown>) => Promise<unknown>;
    deleteApplicationJob: (id: string) => Promise<{ success: boolean }>;
    getApplications: (jobId?: string, status?: string, limit?: number, offset?: number) => Promise<{ applications: unknown[]; hasMore: boolean }>;
    getApplication: (id: string) => Promise<unknown>;
    updateApplicationStatus: (id: string, status: string) => Promise<unknown>;
    getSettings: () => Promise<Record<string, unknown>>;
    updateSettings: (settings: Record<string, unknown>) => Promise<{ success: boolean }>;
    toggleMaintenance: (enabled: boolean) => Promise<{ success: boolean }>;
    getUtilsPreview: () => Promise<{
      emptyRepos: number;
      unactivatedAccounts: number;
      expiredSessions: number;
      expiredVerifications: number;
    }>;
    cleanupEmptyRepos: () => Promise<{ deleted: number }>;
    cleanupUnactivatedAccounts: () => Promise<{ deleted: number }>;
    cleanupExpiredSessions: () => Promise<{ deleted: number }>;
    cleanupExpiredVerifications: () => Promise<{ deleted: number }>;
    releases: {
      list: (owner: string, repo: string, includeDrafts?: boolean) => Promise<{ releases: Release[] }>;
      getLatest: (owner: string, repo: string) => Promise<Release & { assets: ReleaseAsset[] }>;
      getByTag: (owner: string, repo: string, tag: string) => Promise<Release & { assets?: ReleaseAsset[] }>;
      get: (owner: string, repo: string, id: string) => Promise<Release>;
      create: (owner: string, repo: string, data: unknown) => Promise<{ data: Release }>;
      update: (owner: string, repo: string, id: string, data: unknown) => Promise<{ data: Release }>;
      delete: (owner: string, repo: string, id: string) => Promise<{ success: boolean }>;
      publish: (owner: string, repo: string, id: string) => Promise<{ data: Release }>;
      getAssets: (owner: string, repo: string, id: string) => Promise<{ assets: ReleaseAsset[] }>;
      uploadAsset: (owner: string, repo: string, id: string, file: File) => Promise<{ data: ReleaseAsset }>;
      deleteAsset: (owner: string, repo: string, id: string, assetId: string) => Promise<{ success: boolean }>;
    };
    gists: {
      list: () => Promise<{ gists: Gist[] }>;
      getPublic: (limit?: number, offset?: number) => Promise<{ gists: Gist[]; hasMore: boolean }>;
      get: (id: string) => Promise<Gist>;
      update: (id: string, data: unknown) => Promise<{ data: Gist }>;
      delete: (id: string) => Promise<{ success: boolean }>;
      getRevisions: (id: string) => Promise<{ revisions: unknown[] }>;
      toggleStar: (id: string) => Promise<{ starred: boolean }>;
      isStarred: (id: string) => Promise<{ starred: boolean }>;
      fork: (id: string) => Promise<{ id: string }>;
      getForks: (id: string, limit?: number, offset?: number) => Promise<{ forks: GistFork[]; hasMore: boolean }>;
      getComments: (id: string) => Promise<{ comments: GistComment[] }>;
      createComment: (id: string, body: string) => Promise<GistComment>;
      getUserGists: (username: string, limit?: number, offset?: number) => Promise<{ gists: Gist[]; hasMore: boolean }>;
    };
    migrations: {
      list: () => Promise<{ migrations: RepositoryMigration[]; hasMore?: boolean }>;
      get: (id: string) => Promise<RepositoryMigration>;
      create: (data: unknown) => Promise<{ data: RepositoryMigration }>;
      cancel: (id: string) => Promise<{ success: boolean }>;
      delete: (id: string) => Promise<{ success: boolean }>;
    };
    organizations: {
      list: () => Promise<{ organizations: Organization[] }>;
      get: (org: string) => Promise<Organization>;
      getMembers: (org: string) => Promise<{ members: OrganizationMember[] }>;
      getTeams: (org: string) => Promise<{ teams: Team[] }>;
      getRepositories: (org: string) => Promise<{ repositories: Repository[] }>;
      getInvitations: (org: string) => Promise<{ invitations: OrganizationInvitation[] }>;
      create: (data: unknown) => Promise<{ data: Organization }>;
      update: (org: string, data: unknown) => Promise<{ success: boolean }>;
      delete: (org: string) => Promise<{ success: boolean }>;
      updateMember: (org: string, username: string, data: unknown) => Promise<{ success: boolean }>;
       removeMember: (org: string, username: string) => Promise<{ success: boolean }>;
      createTeam: (org: string, data: unknown) => Promise<{ data: Team }>;
      deleteTeam: (org: string, team: string) => Promise<{ success: boolean }>;
      getTeam: (org: string, team: string) => Promise<Team>;
      addTeamMember: (org: string, team: string, data: unknown) => Promise<{ success: boolean }>;
      removeTeamMember: (org: string, team: string, username: string) => Promise<{ success: boolean }>;
      addTeamRepo: (org: string, team: string, repo: string, data: unknown) => Promise<{ success: boolean }>;
      removeTeamRepo: (org: string, team: string, repo: string) => Promise<{ success: boolean }>;
      deleteTeamRepo: (org: string, team: string, repo: string) => Promise<{ success: boolean }>;
      sendInvitation: (org: string, data: unknown) => Promise<{ data: OrganizationInvitation }>;
      deleteInvitation: (org: string, id: string) => Promise<{ success: boolean }>;
      acceptInvitation: (token: string) => Promise<{ success: boolean }>;
    };
  };
  workflows: {
    list: (owner: string, repo: string) => Promise<{ workflows: Workflow[] }>;
    sync: (owner: string, repo: string) => Promise<{ workflows: Workflow[] }>;
    dispatch: (owner: string, repo: string, workflowId: string, data?: { ref?: string; inputs?: Record<string, string> }) => Promise<{ runIds: string[] }>;
    listRuns: (owner: string, repo: string, page?: number) => Promise<{ runs: WorkflowRun[] }>;
    getRun: (owner: string, repo: string, runId: string) => Promise<{ run: WorkflowRun; jobs: WorkflowJob[] }>;
    getJobLogs: (owner: string, repo: string, runId: string, jobId: string) => Promise<{ logs: string; steps: WorkflowStep[] }>;
    cancelRun: (owner: string, repo: string, runId: string) => Promise<{ success: boolean }>;
  };
  runners: {
    list: () => Promise<{ runners: Runner[] }>;
    remove: (runnerId: string) => Promise<{ success: boolean }>;
  };
};

export type SearchResultType = "repository" | "issue" | "pull_request" | "user";

export type SearchResult = {
  type: SearchResultType;
  id: string;
  title: string;
  description?: string | null;
  url: string;
  owner?: { username: string; avatarUrl: string | null };
  repository?: { name: string; owner: string };
  state?: string;
  number?: number;
  createdAt: string;
};

export type SearchResponse = {
  results: SearchResult[];
  hasMore: boolean;
  query: string;
};

export type NotificationActor = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
  resourceNumber?: number | null;
  actor?: NotificationActor | null;
  read: boolean;
  createdAt: string;
};

export type DiscussionCategory = {
  id: string;
  name: string;
  emoji?: string | null;
  description?: string | null;
};

export type Discussion = {
  id: string;
  number: number;
  title: string;
  body: string;
  author: Owner;
  category: { id: string; name: string; emoji?: string | null } | null;
  isPinned: boolean;
  isLocked: boolean;
  isAnswered: boolean;
  answerId?: string | null;
  reactions: ReactionSummary[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DiscussionComment = {
  id: string;
  body: string;
  parentId?: string | null;
  isAnswer: boolean;
  author: Owner;
  reactions: ReactionSummary[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectItem = {
  id: string;
  type: "issue" | "pull_request" | "note";
  position: number;
  issue?: {
    id: string;
    number: number;
    title: string;
    state: string;
    author: Owner | null;
  };
  pullRequest?: {
    id: string;
    number: number;
    title: string;
    state: string;
    author: Owner | null;
  };
  noteContent?: string;
};

export type ProjectColumn = {
  id: string;
  name: string;
  position: number;
  items: ProjectItem[];
};

export type Project = {
  id: string;
  name: string;
  description?: string | null;
  columns: ProjectColumn[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectListItem = {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── Runner / Workflow types ───────────────────────────────────────────────────

export type RunnerStatus = 'online' | 'offline' | 'busy';
export type WorkflowRunStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type WorkflowRunConclusion = 'success' | 'failure' | 'cancelled' | 'skipped';
export type WorkflowJobStatus = 'queued' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type WorkflowStepStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export type Runner = {
  id: string;
  name: string;
  status: RunnerStatus;
  labels: string[] | null;
  os: string | null;
  arch: string | null;
  version: string | null;
  lastSeenAt: string | null;
  currentJobId: string | null;
  ipAddress: string | null;
  createdAt: string;
  /** When runner has a current job; for linking to run detail */
  currentRunId?: string;
  repoOwner?: string;
  repoName?: string;
  jobsRunCount?: number;
  jobsSuccessCount?: number;
  successRate?: number | null;
};

export type Workflow = {
  id: string;
  repositoryId: string;
  name: string;
  path: string;
  content: string;
  triggers: {
    push?: { branches?: string[] };
    pull_request?: { branches?: string[] };
    workflow_dispatch?: boolean;
  } | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowStep = {
  id: string;
  jobId: string;
  number: number;
  name: string;
  status: WorkflowStepStatus;
  exitCode: number | null;
  logOutput: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type WorkflowJob = {
  id: string;
  runId: string;
  name: string;
  runnerId: string | null;
  status: WorkflowJobStatus;
  conclusion: WorkflowRunConclusion | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  steps?: WorkflowStep[];
};

export type WorkflowRun = {
  id: string;
  workflowId: string;
  repositoryId: string;
  commitSha: string;
  branch: string;
  eventName: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowRunConclusion | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  workflowName?: string | null;
};

export type WorkflowRunDetail = WorkflowRun & {
  jobs: WorkflowJob[];
};
