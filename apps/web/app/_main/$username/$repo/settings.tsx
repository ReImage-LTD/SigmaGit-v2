import {
  useDeleteRepository,
  useRepoPageData,
  useRepositoryInfo,
  useUpdateRepository,
} from '@sigmagit/hooks';
import { AlertTriangle, Globe, Loader2, Lock, Shield, Trash2, Users, Webhook } from 'lucide-react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { FormEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BranchProtectionTab } from '@/components/repo-settings/branch-protection-tab';
import { CollaboratorsTab } from '@/components/repo-settings/collaborators-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WebhooksTab } from '@/components/repo-settings/webhooks-tab';
import { parseAsStringLiteral, useQueryState } from '@/lib/hooks';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { createMeta } from '@/lib/seo';

const tabTriggerClassName =
  'gap-1.5 text-sm px-3 py-2 rounded-none whitespace-nowrap text-muted-foreground data-[selected]:bg-transparent data-[selected]:text-foreground data-[selected]:border-b-2 data-[selected]:border-foreground';

export const Route = createFileRoute('/_main/$username/$repo/settings')({
  head: ({ params }) => ({
    meta: createMeta({
      title: `${params.username}/${params.repo} · Settings`,
      description: 'Manage repository settings and options.',
      noIndex: true,
    }),
  }),
  component: RepoSettingsPage,
});

type TabValue = 'general' | 'collaborators' | 'branch-protection' | 'webhooks' | 'danger';

function GeneralTab({
  formData,
  setFormData,
  hasChanges,
  onSubmit,
  saving,
}: {
  username: string;
  repoName: string;
  repo: { name: string; description: string | null; visibility: 'public' | 'private' };
  formData: { name: string; description: string; visibility: 'public' | 'private' };
  setFormData: React.Dispatch<
    React.SetStateAction<{ name: string; description: string; visibility: 'public' | 'private' }>
  >;
  hasChanges: boolean;
  onSubmit: (e: FormEvent) => void;
  saving: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="border-border/60 bg-muted/20 border-b">
          <CardTitle>General</CardTitle>
          <CardDescription>Basic repository information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Repository name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              pattern="^[a-zA-Z0-9_.-]+$"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="A short description of your repository"
              rows={3}
            />
          </div>
          <div className="space-y-3">
            <Label>Visibility</Label>
            <div className="space-y-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  formData.visibility === 'public'
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={formData.visibility === 'public'}
                  onChange={() => setFormData((prev) => ({ ...prev, visibility: 'public' }))}
                  className="sr-only"
                />
                <Globe className="text-muted-foreground mt-0.5 size-5" />
                <div>
                  <p className="font-medium">Public</p>
                  <p className="text-muted-foreground text-sm">Anyone can see this repository</p>
                </div>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  formData.visibility === 'private'
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={formData.visibility === 'private'}
                  onChange={() => setFormData((prev) => ({ ...prev, visibility: 'private' }))}
                  className="sr-only"
                />
                <Lock className="text-muted-foreground mt-0.5 size-5" />
                <div>
                  <p className="font-medium">Private</p>
                  <p className="text-muted-foreground text-sm">Only you can see this repository</p>
                </div>
              </label>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !hasChanges}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function DangerZoneTab({
  username,
  repo,
  deleteConfirm,
  setDeleteConfirm,
  deleteOpen,
  setDeleteOpen,
  onDelete,
  deleting,
}: {
  username: string;
  repo: { name: string };
  deleteConfirm: string;
  setDeleteConfirm: (v: string) => void;
  deleteOpen: boolean;
  setDeleteOpen: (v: boolean) => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <Card className="border-destructive/40">
      <CardHeader className="border-destructive/20 bg-destructive/5 border-b">
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
        <CardDescription>Irreversible actions that can affect your repository</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="border-destructive/30 bg-destructive/5 flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-medium">Delete this repository</p>
            <p className="text-muted-foreground text-sm">Once deleted, it cannot be recovered</p>
          </div>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="mr-2 size-4" />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete repository</DialogTitle>
                <DialogDescription>
                  This action cannot be undone. This will permanently delete the{' '}
                  <strong>
                    {username}/{repo.name}
                  </strong>{' '}
                  repository and all of its contents.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-4">
                <Label htmlFor="confirm">
                  Type <strong>{repo.name}</strong> to confirm
                </Label>
                <Input
                  id="confirm"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder={repo.name}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={onDelete}
                  disabled={deleteConfirm !== repo.name || deleting}
                >
                  {deleting && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Delete repository
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}

function RepoSettingsPage() {
  const { username, repo: repoName } = Route.useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringLiteral([
      'general',
      'collaborators',
      'branch-protection',
      'webhooks',
      'danger',
    ]).withDefault('general'),
  );
  const { data: pageData, isLoading } = useRepoPageData(username, repoName);
  const { data: repoInfo, isLoading: isLoadingInfo } = useRepositoryInfo(username, repoName);
  const repo = repoInfo?.repo;
  const isOwner = pageData?.isOwner ?? false;
  const { mutate: updateRepo, isPending: saving } = useUpdateRepository(repo?.id || '');
  const { mutate: deleteRepo, isPending: deleting } = useDeleteRepository(repo?.id || '');

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    visibility: 'public' as 'public' | 'private',
  });

  useEffect(() => {
    if (!repo) return;
    setFormData({
      name: repo.name,
      description: repo.description || '',
      visibility: repo.visibility,
    });
  }, [repo]);

  const hasChanges =
    !!repo &&
    (formData.name !== repo.name ||
      formData.description !== (repo.description || '') ||
      formData.visibility !== repo.visibility);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!repo) return;
    updateRepo(
      {
        name: formData.name,
        description: formData.description,
        visibility: formData.visibility,
      },
      {
        onSuccess: (updated) => {
          toast.success('Settings saved');
          if (updated.name !== repo.name) {
            navigate({
              to: '/$username/$repo/settings',
              params: { username, repo: updated.name },
            });
          }
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : 'Failed to save settings');
        },
      },
    );
  }

  function handleDelete() {
    if (!repo || deleteConfirm !== repo.name) return;
    deleteRepo(undefined, {
      onSuccess: () => {
        toast.success('Repository deleted');
        navigate({ to: '/$username', params: { username } });
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : 'Failed to delete repository');
      },
    });
  }

  if (isLoading || isLoadingInfo) {
    return (
      <div className="container mx-auto max-w-[1280px] px-4 py-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-8 animate-spin" />
        </div>
      </div>
    );
  }

  if (!repo || !isOwner) {
    return (
      <div className="container mx-auto max-w-[1280px] px-4 py-6">
        <Card className="mx-auto max-w-2xl">
          <CardContent className="p-12 text-center">
            <AlertTriangle className="text-muted-foreground mx-auto mb-4 size-12" />
            <h2 className="mb-2 text-xl font-semibold">Access Denied</h2>
            <p className="text-muted-foreground mb-6">
              You don't have permission to access this page
            </p>
            <Link to="/$username/$repo" params={{ username, repo: repoName }}>
              <Button>Back to repository</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-[1280px] space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Repository settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage details and visibility for{' '}
          <span className="font-mono">
            {username}/{repo.name}
          </span>
          .
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <div className="mb-6 overflow-x-auto">
          <TabsList className="h-auto min-w-max gap-1 bg-transparent p-0">
            <TabsTrigger value="general" className={tabTriggerClassName}>
              General
            </TabsTrigger>
            <TabsTrigger value="collaborators" className={tabTriggerClassName}>
              <Users className="size-4" />
              Collaborators
            </TabsTrigger>
            <TabsTrigger value="branch-protection" className={tabTriggerClassName}>
              <Shield className="size-4" />
              Branch Protection
            </TabsTrigger>
            <TabsTrigger value="webhooks" className={tabTriggerClassName}>
              <Webhook className="size-4" />
              Webhooks
            </TabsTrigger>
            <TabsTrigger value="danger" className={tabTriggerClassName}>
              <Trash2 className="size-4" />
              Danger Zone
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="general" className="mt-0">
          <GeneralTab
            username={username}
            repoName={repoName}
            repo={repo}
            formData={formData}
            setFormData={setFormData}
            hasChanges={hasChanges}
            onSubmit={handleSubmit}
            saving={saving}
          />
        </TabsContent>

        <TabsContent value="collaborators" className="mt-0">
          <CollaboratorsTab owner={username} repoName={repo.name} />
        </TabsContent>

        <TabsContent value="branch-protection" className="mt-0">
          <BranchProtectionTab owner={username} repoName={repo.name} />
        </TabsContent>

        <TabsContent value="webhooks" className="mt-0">
          <WebhooksTab owner={username} repoName={repo.name} />
        </TabsContent>

        <TabsContent value="danger" className="mt-0">
          <div className="mx-auto max-w-3xl">
            <DangerZoneTab
              username={username}
              repo={repo}
              deleteConfirm={deleteConfirm}
              setDeleteConfirm={setDeleteConfirm}
              deleteOpen={deleteOpen}
              setDeleteOpen={setDeleteOpen}
              onDelete={handleDelete}
              deleting={deleting}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
