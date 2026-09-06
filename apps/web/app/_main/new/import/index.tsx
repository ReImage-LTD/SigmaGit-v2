"use client";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useCreateMigration } from "@sigmagit/hooks";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  Globe,
  Key,
  Link as LinkIcon,
  Loader2,
  Lock,
  MessageSquare,
  Server,
  Shield,
  Tag,
} from "lucide-react";
import { Github, Gitlab } from '@/components/brand-icons';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createMeta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_main/new/import/")({
  head: () => ({ meta: createMeta({ title: "Import Repository", description: "Import a repository from GitHub, GitLab, or other sources.", noIndex: true }) }),
  component: ImportRepositoryPage,
});

type SourceType = "github" | "gitlab" | "gitlab-self-hosted" | "gitea" | "bitbucket" | "url";

interface SourceConfig {
  id: SourceType;
  name: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  placeholder: string;
  description: string;
  requiresAuth: boolean;
  supportsSelfHosted: boolean;
}

const sources: Array<SourceConfig> = [
  {
    id: "github",
    name: "GitHub",
    icon: <Github className="size-6" />,
    color: "text-gray-900 dark:text-white",
    bgColor: "bg-gray-100 dark:bg-gray-800",
    placeholder: "owner/repo",
    description: "Import from GitHub.com",
    requiresAuth: true,
    supportsSelfHosted: false,
  },
  {
    id: "gitlab",
    name: "GitLab",
    icon: <Gitlab className="size-6" />,
    color: "text-orange-600",
    bgColor: "bg-orange-50 dark:bg-orange-950/30",
    placeholder: "owner/repo",
    description: "Import from GitLab.com",
    requiresAuth: true,
    supportsSelfHosted: true,
  },
  {
    id: "gitlab-self-hosted",
    name: "GitLab Self-Hosted",
    icon: <Server className="size-6" />,
    color: "text-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    placeholder: "https://gitlab.company.com/owner/repo",
    description: "Your own GitLab instance",
    requiresAuth: true,
    supportsSelfHosted: true,
  },
  {
    id: "gitea",
    name: "Gitea",
    icon: <GitBranch className="size-6" />,
    color: "text-green-600",
    bgColor: "bg-green-50 dark:bg-green-950/30",
    placeholder: "https://gitea.example.com/owner/repo",
    description: "Self-hosted Gitea instance",
    requiresAuth: true,
    supportsSelfHosted: true,
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    icon: <Download className="size-6" />,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    placeholder: "owner/repo",
    description: "Import from Bitbucket",
    requiresAuth: true,
    supportsSelfHosted: false,
  },
  {
    id: "url",
    name: "Any Git URL",
    icon: <LinkIcon className="size-6" />,
    color: "text-purple-600",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    placeholder: "https://git.example.com/repo.git",
    description: "Any public or private Git repo",
    requiresAuth: false,
    supportsSelfHosted: false,
  },
];

function ImportRepositoryPage() {
  const navigate = useNavigate();
  const createMigration = useCreateMigration();
  const [showToken, setShowToken] = useState(false);
  const [formData, setFormData] = useState({
    source: "github" as SourceType,
    sourceUrl: "",
    sourceBaseUrl: "",
    sourceOwner: "",
    sourceRepo: "",
    name: "",
    description: "",
    visibility: "public" as "public" | "private",
    importIssues: true,
    importPRs: false,
    importLabels: true,
    requiresAuth: false,
    authToken: "",
    authType: "token" as "token" | "password",
    username: "",
    password: "",
  });

  const activeSource = sources.find((s) => s.id === formData.source) || sources[0];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    let finalSourceUrl = formData.sourceUrl;
    let sourceBaseUrl = formData.sourceBaseUrl;

    // Build source URL based on source type
    if (formData.source === "gitlab-self-hosted" || formData.source === "gitea") {
      sourceBaseUrl = formData.sourceBaseUrl;
      finalSourceUrl = `${formData.sourceBaseUrl}/${formData.sourceOwner}/${formData.sourceRepo}.git`;
    } else if (formData.source !== "url") {
      const baseDomain = formData.source === "gitlab" ? "gitlab.com" : `${formData.source}.com`;
      sourceBaseUrl = `https://${baseDomain}`;
      finalSourceUrl = `https://${baseDomain}/${formData.sourceOwner}/${formData.sourceRepo}.git`;
    }

    // Build credentials object if auth is provided
    const credentials: Record<string, string> = {};
    if (formData.requiresAuth) {
      if (formData.authType === "token") {
        credentials.authToken = formData.authToken;
        credentials.authType = "token";
      } else {
        credentials.authToken = formData.password;
        credentials.authType = "password";
      }
    }

    createMigration.mutate(
      {
        source: formData.source === "gitlab-self-hosted" ? "gitlab" : formData.source,
        sourceUrl: finalSourceUrl,
        sourceBaseUrl,
        sourceOwner: formData.sourceOwner || undefined,
        sourceRepo: formData.sourceRepo || undefined,
        options: {
          importIssues: formData.importIssues,
          importPRs: formData.importPRs,
          importLabels: formData.importLabels,
          description: formData.description,
          visibility: formData.visibility,
        },
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Repository import started!");
          navigate({ to: "/settings/migrations" });
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Failed to start import");
        },
      }
    );
  }

  return (
    <div className="container max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 text-muted-foreground"
          onClick={() => navigate({ to: "/" })}
        >
          <ArrowLeft className="size-4 mr-1" />
          Back
        </Button>
        <div className="flex items-center gap-4">
          <div className="size-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
            <Download className="size-7" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Import a repository</h1>
            <p className="text-muted-foreground mt-1">
              Import an existing repository from GitHub, GitLab, Bitbucket, or any Git URL
            </p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-6 space-y-6">
              {/* Source Selection */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Select source</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {sources.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, source: source.id })}
                      className={cn(
                        "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200",
                        formData.source === source.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30 hover:bg-accent/50"
                      )}
                    >
                      <div
                        className={cn(
                          "size-12 rounded-xl flex items-center justify-center",
                          source.bgColor,
                          source.color
                        )}
                      >
                        {source.icon}
                      </div>
                      <span className="text-sm font-medium">{source.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Self-hosted URL input for GitLab/Gitea */}
              {(formData.source === "gitlab-self-hosted" || formData.source === "gitea") && (
                <div className="space-y-2">
                  <Label htmlFor="sourceBaseUrl" className="text-sm font-semibold">
                    Instance URL <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Server className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="sourceBaseUrl"
                      value={formData.sourceBaseUrl}
                      onChange={(e) => setFormData({ ...formData, sourceBaseUrl: e.target.value })}
                      placeholder={formData.source === "gitea" ? "https://gitea.example.com" : "https://gitlab.company.com"}
                      required
                      className="h-12 pl-10"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The base URL of your {formData.source === "gitea" ? "Gitea" : "GitLab"} instance
                  </p>
                </div>
              )}

              {/* Authentication Section */}
              {activeSource.requiresAuth && (
                <div className="space-y-4 pt-4 border-t border-border/50">
                  <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                      <Shield className="size-4 text-muted-foreground" />
                      <Label className="text-sm font-semibold">Authentication</Label>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={formData.requiresAuth}
                        onCheckedChange={(checked) => setFormData({ ...formData, requiresAuth: checked })}
                      />
                      <span className="text-sm text-muted-foreground">Private repository</span>
                    </label>
                  </div>

                  {formData.requiresAuth && (
                    <div className="space-y-4 p-4 rounded-xl bg-muted/50 border border-border/50">
                      {/* Auth Type Selection */}
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="authType"
                            value="token"
                            checked={formData.authType === "token"}
                            onChange={() => setFormData({ ...formData, authType: "token" })}
                            className="size-4"
                          />
                          <span className="text-sm">Personal Access Token</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="authType"
                            value="password"
                            checked={formData.authType === "password"}
                            onChange={() => setFormData({ ...formData, authType: "password" })}
                            className="size-4"
                          />
                          <span className="text-sm">Username & Password</span>
                        </label>
                      </div>

                      {formData.authType === "token" ? (
                        <div className="space-y-2">
                          <Label htmlFor="authToken" className="text-sm">
                            {formData.source === "github" && "GitHub Personal Access Token"}
                            {formData.source === "gitlab" && "GitLab Personal Access Token"}
                            {formData.source === "gitlab-self-hosted" && "GitLab Personal Access Token"}
                            {formData.source === "gitea" && "Gitea Access Token"}
                            {formData.source === "bitbucket" && "Bitbucket App Password"}
                          </Label>
                          <div className="relative">
                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                            <Input
                              id="authToken"
                              type={showToken ? "text" : "password"}
                              value={formData.authToken}
                              onChange={(e) => setFormData({ ...formData, authToken: e.target.value })}
                              placeholder="ghp_xxxxxxxxxxxx or glpat-xxxxxxxxxxxx"
                              className="h-12 pl-10 pr-10"
                            />
                            <button
                              type="button"
                              onClick={() => setShowToken(!showToken)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                              {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Your token is encrypted and only used for this import.{" "}
                            <a href="#" className="text-primary hover:underline">Learn more</a>
                          </p>
                        </div>
                      ) : (
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="username" className="text-sm">Username</Label>
                            <Input
                              id="username"
                              value={formData.username}
                              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                              placeholder="your-username"
                              className="h-12"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="password" className="text-sm">Password</Label>
                            <Input
                              id="password"
                              type="password"
                              value={formData.password}
                              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                              placeholder="••••••••"
                              className="h-12"
                            />
                          </div>
                        </div>
                      )}
                </div>
                  )}
                </div>
              )}

              {/* Source Input */}
        {formData.source === "url" ? (
          <div className="space-y-2">
            <Label htmlFor="sourceUrl" className="text-sm font-semibold">
                    Repository URL <span className="text-destructive">*</span>
            </Label>
                  <div className="relative">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              id="sourceUrl"
              value={formData.sourceUrl}
              onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
                      placeholder={activeSource.placeholder}
              required
                      className="h-12 pl-10"
              autoFocus
            />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter the full Git repository URL (HTTPS or SSH)
                  </p>
          </div>
        ) : (
                <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sourceOwner" className="text-sm font-semibold">
                      Owner / Organization <span className="text-destructive">*</span>
              </Label>
              <Input
                id="sourceOwner"
                value={formData.sourceOwner}
                onChange={(e) => setFormData({ ...formData, sourceOwner: e.target.value })}
                      placeholder="e.g., facebook"
                required
                      className="h-12"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sourceRepo" className="text-sm font-semibold">
                      Repository name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="sourceRepo"
                value={formData.sourceRepo}
                onChange={(e) => setFormData({ ...formData, sourceRepo: e.target.value })}
                      placeholder="e.g., react"
                required
                      className="h-12"
              />
            </div>
          </div>
        )}

              {/* Repository Details */}
              <div className="space-y-4 pt-4 border-t border-border/50">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm font-semibold">
                    New repository name{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Leave empty to use source name"
                    className="h-12"
          />
                  <p className="text-xs text-muted-foreground">
                    If left empty, the source repository name will be used
                  </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description" className="text-sm font-semibold">
                    Description{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="What's this repository about?"
                    className="h-12"
          />
                </div>
        </div>

              {/* Visibility */}
              <div className="space-y-3 pt-4 border-t border-border/50">
          <Label className="text-sm font-semibold">Visibility</Label>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div
                    className={cn(
                      "relative flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200",
                      formData.visibility === "public"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30 hover:bg-accent/50"
                    )}
                    onClick={() => setFormData({ ...formData, visibility: "public" })}
                  >
                    <div className="size-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                      <Globe className="size-5 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={formData.visibility === "public"}
                onChange={() => setFormData({ ...formData, visibility: "public" })}
                          className="size-4"
              />
                        <span className="font-semibold">Public</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Anyone can see this repository
                      </p>
                </div>
              </div>

                  <div
                    className={cn(
                      "relative flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200",
                      formData.visibility === "private"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30 hover:bg-accent/50"
                    )}
                    onClick={() => setFormData({ ...formData, visibility: "private" })}
                  >
                    <div className="size-10 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                      <Lock className="size-5 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
              <input
                type="radio"
                name="visibility"
                value="private"
                checked={formData.visibility === "private"}
                onChange={() => setFormData({ ...formData, visibility: "private" })}
                          className="size-4"
              />
                        <span className="font-semibold">Private</span>
                </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Only you can see this repository
                      </p>
              </div>
                  </div>
          </div>
        </div>

              {/* Import Options */}
              <div className="space-y-4 pt-4 border-t border-border/50">
          <Label className="text-sm font-semibold">Import options</Label>
                <div className="grid sm:grid-cols-3 gap-4">
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors cursor-pointer">
              <Checkbox
                id="importIssues"
                checked={formData.importIssues}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, importIssues: checked })
                      }
              />
                    <div className="flex items-center gap-2">
                      <MessageSquare className="size-4 text-muted-foreground" />
                      <span className="text-sm">Issues</span>
            </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors cursor-pointer">
              <Checkbox
                id="importPRs"
                checked={formData.importPRs}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, importPRs: checked })
                      }
              />
                    <div className="flex items-center gap-2">
                      <GitBranch className="size-4 text-muted-foreground" />
                      <span className="text-sm">Pull requests</span>
            </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors cursor-pointer">
              <Checkbox
                id="importLabels"
                checked={formData.importLabels}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, importLabels: checked })
                      }
              />
                    <div className="flex items-center gap-2">
                      <Tag className="size-4 text-muted-foreground" />
                      <span className="text-sm">Labels</span>
            </div>
                  </label>
          </div>
        </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
              size="lg"
            onClick={() => navigate({ to: "/" })}
            disabled={createMigration.isPending}
          >
            Cancel
          </Button>
            <Button
              type="submit"
              size="lg"
              disabled={createMigration.isPending}
              onClick={handleSubmit}
              className="gap-2"
            >
            {createMigration.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                  Starting import...
              </>
            ) : (
              <>
                <Download className="size-4" />
                  Begin import
              </>
            )}
          </Button>
        </div>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-primary" />
                <span className="font-semibold">What gets imported?</span>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span>Git history and all branches</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span>Repository files and structure</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span>Issues (if selected)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0-5">•</span>
                  <span>Pull requests (if selected)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span>Labels and milestones</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-5 text-muted-foreground" />
                <span className="font-semibold">Important notes</span>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground mt-0.5">•</span>
                  <span>Large repositories may take several minutes</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground mt-0.5">•</span>
                  <span>Private repos require authentication</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground mt-0.5">•</span>
                  <span>Wiki pages are not imported</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <div className="text-center">
            <a
              href="https://docs.sigmagit.com/import"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Learn more about importing
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
