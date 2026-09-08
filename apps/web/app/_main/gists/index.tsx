"use client";

import { Link, createFileRoute } from "@tanstack/react-router";
import { usePublicGists } from "@sigmagit/hooks";
import {
  Clock,
  Code2,
  FileCode2,
  FileText,
  Plus,
  Search,
  Sparkles,
  User,
} from "lucide-react";
import { getLanguage, timeAgo } from "@sigmagit/lib";
import { createMeta } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_main/gists/")({
  head: () => ({ meta: createMeta({ title: "Gists", description: "Discover and share code snippets. Public gists on Sigmagit." }) }),
  component: GistsPage,
});

const languageColors: Record<string, string> = {
  typescript: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  javascript: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  python: "bg-blue-400/10 text-blue-500 border-blue-400/20",
  java: "bg-orange-600/10 text-orange-600 border-orange-600/20",
  go: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
  rust: "bg-orange-700/10 text-orange-700 border-orange-700/20",
  html: "bg-orange-600/10 text-orange-600 border-orange-600/20",
  css: "bg-blue-600/10 text-blue-600 border-blue-600/20",
  json: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  markdown: "bg-gray-600/10 text-gray-600 border-gray-600/20",
  sql: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  shell: "bg-green-500/10 text-green-600 border-green-500/20",
  yaml: "bg-red-500/10 text-red-600 border-red-500/20",
  default: "bg-muted text-muted-foreground",
};

function GistsPage() {
  const { data, isLoading } = usePublicGists(20, 0);
  const gists = data?.gists ?? [];

  return (
    <div className="container max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
              <Code2 className="size-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Gists</h1>
              <p className="text-muted-foreground">Discover and share code snippets</p>
            </div>
          </div>
        </div>
        <Link to="/gists/new">
          <Button size="lg" className="gap-2">
            <Plus className="size-4" />
            New gist
          </Button>
        </Link>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="p-6">
                <Skeleton className="h-6 w-3/4 mb-3" />
                <Skeleton className="h-4 w-1/2 mb-4" />
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : gists.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <FileCode2 className="size-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No gists yet</h3>
            <p className="text-muted-foreground mb-6 max-w-sm">
              Be the first to share a code snippet with the community
            </p>
            <Link to="/gists/new">
              <Button size="lg" className="gap-2">
                <Plus className="size-4" />
                Create your first gist
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {gists.map((gist) => {
            const files = gist.files;
            const firstFile = files[0];
            const language = firstFile?.language || getLanguage(firstFile?.filename || "");
            const languageClass = languageColors[language.toLowerCase()] || languageColors.default;
            const owner = gist.owner;

            return (
              <Link
                key={gist.id}
                to="/gists/$id"
                params={{ id: gist.id }}
                className="group block"
              >
                <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-primary/30 group-hover:-translate-y-1">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base font-semibold line-clamp-2 group-hover:text-primary transition-colors">
                        {gist.description || firstFile?.filename || "Untitled gist"}
                      </CardTitle>
                      <Badge
                        variant="outline"
                        className={cn("shrink-0 text-xs capitalize", languageClass)}
                      >
                        {language}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {/* Code Preview */}
                    {firstFile?.preview && (
                      <div className="relative mb-4">
                        <div className="bg-muted/50 rounded-lg p-3 pb-5 font-mono text-xs text-muted-foreground line-clamp-4 overflow-hidden">
                          <pre className="m-0">{firstFile.preview}</pre>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent rounded-b-lg" />
                      </div>
                    )}

                    {/* Meta */}
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <div className="flex items-center gap-3">
                        {owner && (
                          <div className="flex items-center gap-1.5">
                            <User className="size-3.5" />
                            <span className="font-medium">{owner.username}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <FileText className="size-3.5" />
                          <span>{files.length} {files.length === 1 ? "file" : "files"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="size-3.5" />
                        <span>{timeAgo(gist.updatedAt)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
