'use client';

import {
  useOrganization,
  useOrganizationMembers,
  useOrganizationRepos,
  useOrganizationTeams,
} from '@sigmagit/hooks';
import { BookOpen, Building2, GitBranch, Globe, Mail, MapPin, Users } from 'lucide-react';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { formatDate, timeAgo } from '@sigmagit/lib';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { parseAsStringLiteral, useQueryState } from '@/lib/hooks';
import RepositoryCard from '@/components/repository-card';
import { sanitizeUserUrl } from '@/lib/safe-html';
import { createMeta } from '@/lib/seo';

export const Route = createFileRoute('/_main/$username/index-org')({
  head: ({ params }) => ({
    meta: createMeta({
      title: params.username,
      description: `${params.username} organization on Sigmagit. Profile and repositories.`,
    }),
  }),
  component: OrganizationProfilePage,
});

function RepositoriesTab({ orgName }: { orgName: string }) {
  const { data, isLoading } = useOrganizationRepos(orgName);

  if (isLoading) {
    return <TabSkeleton />;
  }

  const repos = data?.repositories || [];

  if (repos.length === 0) {
    return (
      <div className="bg-muted/20 border border-dashed py-20 text-center">
        <GitBranch className="text-muted-foreground/50 mx-auto mb-4 size-10" />
        <h3 className="text-base font-medium">No repositories yet</h3>
        <p className="text-muted-foreground text-sm">
          This organization hasn't created any repositories yet.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="border-border bg-card border p-4">
          <div className="text-2xl font-bold">{repos.length}</div>
          <div className="text-muted-foreground mt-1 text-sm">Repositories</div>
        </div>
      </div>
      <div className="border-border bg-card divide-border divide-y rounded-lg border">
        {repos.map((repo) => (
          <RepositoryCard key={repo.id} repository={repo} />
        ))}
      </div>
    </>
  );
}

function MembersTab({ orgName }: { orgName: string }) {
  const { data, isLoading } = useOrganizationMembers(orgName);

  if (isLoading) {
    return <TabSkeleton />;
  }

  const members = data?.members || [];

  return (
    <div className="border-border bg-card divide-border divide-y rounded-lg border">
      {members.map((member) => (
        <div key={member.userId} className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback>{member.user?.name?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <div>
              <div className="font-medium">{member.user?.name || 'Unknown'}</div>
              <div className="text-muted-foreground text-sm">
                @{member.user?.username || 'unknown'}
              </div>
            </div>
          </div>
          <div className="text-muted-foreground text-sm capitalize">{member.role}</div>
        </div>
      ))}
    </div>
  );
}

function TeamsTab({ orgName }: { orgName: string }) {
  const { data, isLoading } = useOrganizationTeams(orgName);

  if (isLoading) {
    return <TabSkeleton />;
  }

  const teams = data?.teams || [];

  if (teams.length === 0) {
    return (
      <div className="bg-muted/20 border border-dashed py-20 text-center">
        <Users className="text-muted-foreground/50 mx-auto mb-4 size-10" />
        <h3 className="text-base font-medium">No teams yet</h3>
        <p className="text-muted-foreground text-sm">
          This organization hasn't created any teams yet.
        </p>
      </div>
    );
  }

  return (
    <div className="border-border bg-card divide-border divide-y rounded-lg border">
      {teams.map((team) => (
        <div key={team.id} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">{team.name}</div>
              {team.description && (
                <div className="text-muted-foreground mt-1 text-sm">{team.description}</div>
              )}
            </div>
            <div className="text-muted-foreground text-sm capitalize">{team.permission}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-card border-border h-28 animate-pulse border" />
      ))}
    </div>
  );
}

function OrganizationProfilePage() {
  const { username } = Route.useParams();
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringLiteral(['repositories', 'members', 'teams']).withDefault('repositories'),
  );
  const { data: org, isLoading, error } = useOrganization(username);
  const { data: reposData } = useOrganizationRepos(username);
  const { data: membersData } = useOrganizationMembers(username);
  const { data: teamsData } = useOrganizationTeams(username);

  const repoCount = reposData?.repositories.length || 0;
  const memberCount = membersData?.members.length || 0;
  const teamCount = teamsData?.teams.length || 0;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="flex animate-pulse flex-col gap-12 lg:flex-row">
          <div className="space-y-6 lg:w-72">
            <div className="bg-muted h-64 w-64" />
            <div className="bg-muted h-8 w-48" />
            <div className="bg-muted h-4 w-full" />
          </div>
          <div className="flex-1 space-y-6">
            <div className="bg-muted h-10 w-64" />
            <TabSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (error || !org) {
    // If not found as org, let it fall through to user profile
    return null;
  }

  return (
    <div className="container mx-auto max-w-[1280px] px-4 py-8">
      <div className="flex flex-col items-start gap-12 lg:flex-row">
        <aside className="shrink-0 space-y-3 lg:w-72">
          <Avatar className="border-border h-40 w-40 rounded-full border-2 lg:h-64 lg:w-64">
            <AvatarImage src={org.avatarUrl || undefined} className="object-cover" />
            <AvatarFallback className="bg-muted text-muted-foreground text-4xl font-semibold">
              <Building2 className="size-16" />
            </AvatarFallback>
          </Avatar>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{org.displayName}</h1>
              {org.isVerified && (
                <span className="text-primary" title="Verified">
                  ✓
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-base">@{org.name}</p>
          </div>

          {org.description && (
            <div className="pt-2">
              <p className="text-muted-foreground text-sm leading-relaxed">{org.description}</p>
            </div>
          )}

          <div className="space-y-3 pt-2">
            {org.email && (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Mail className="size-4" />
                <span>{org.email}</span>
              </div>
            )}
            {org.location && (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <MapPin className="size-4" />
                <span>{org.location}</span>
              </div>
            )}
            {sanitizeUserUrl(org.website) && (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Globe className="size-4" />
                <a
                  href={sanitizeUserUrl(org.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary truncate hover:underline"
                >
                  {org.website.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <span>Created {formatDate(org.createdAt)}</span>
            </div>
          </div>
        </aside>

        <div className="w-full">
          <Tabs
            value={tab}
            onValueChange={(value) =>
              setTab(value === 'repositories' ? null : (value as 'members' | 'teams'))
            }
          >
            <TabsList variant="line" className="mb-6 h-auto w-full bg-transparent p-0">
              <TabsTrigger value="repositories" className="gap-2">
                <BookOpen className="size-4" />
                <span>Repositories</span>
                {repoCount > 0 && (
                  <span className="text-muted-foreground ml-1 text-xs">({repoCount})</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="members" className="gap-2">
                <Users className="size-4" />
                <span>Members</span>
                {memberCount > 0 && (
                  <span className="text-muted-foreground ml-1 text-xs">({memberCount})</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="teams" className="gap-2">
                <Users className="size-4" />
                <span>Teams</span>
                {teamCount > 0 && (
                  <span className="text-muted-foreground ml-1 text-xs">({teamCount})</span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="repositories" className="mt-0">
              <RepositoriesTab orgName={username} />
            </TabsContent>

            <TabsContent value="members" className="mt-0">
              <MembersTab orgName={username} />
            </TabsContent>

            <TabsContent value="teams" className="mt-0">
              <TeamsTab orgName={username} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
