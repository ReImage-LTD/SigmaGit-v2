import { useEffect, useState } from "react";
import { GitBranch, Globe, Loader2, Lock } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useCreateRepository, useCurrentUser, useOrganizations } from "@sigmagit/hooks";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const LICENSE_OPTIONS = [
  { value: "none", label: "No license" },
  { value: "mit", label: "MIT License" },
  { value: "apache-2.0", label: "Apache License 2.0" },
  { value: "gpl-3.0", label: "GNU GPL v3.0" },
  { value: "agpl-3.0", label: "GNU AGPL v3.0" },
  { value: "lgpl-3.0", label: "GNU LGPL v3.0" },
  { value: "mpl-2.0", label: "Mozilla Public License 2.0" },
  { value: "bsd-3-clause", label: "BSD 3-Clause" },
  { value: "unlicense", label: "The Unlicense" },
] as const;

interface NewRepositoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewRepositoryModal({ open, onOpenChange }: NewRepositoryModalProps) {
  const { data: session } = useSession();
  const { data: currentUser } = useCurrentUser();
  const { data: orgsData } = useOrganizations();
  const navigate = useNavigate();
  const { mutate: createRepo, isPending: isCreating } = useCreateRepository();
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    visibility: "public" as "public" | "private",
    organizationId: "personal",
    license: "none" as (typeof LICENSE_OPTIONS)[number]["value"],
  });

  const organizations = orgsData?.organizations || [];

  useEffect(() => {
    if (currentUser?.user.defaultRepositoryVisibility) {
      setFormData((prev) => ({
        ...prev,
        visibility: currentUser.user.defaultRepositoryVisibility as "public" | "private",
      }));
    }
  }, [currentUser?.user.defaultRepositoryVisibility]);

  useEffect(() => {
    if (!open) {
      setFormData({
        name: "",
        description: "",
        visibility: currentUser?.user.defaultRepositoryVisibility || "public",
        organizationId: "personal",
        license: "none",
      });
    }
  }, [open, currentUser?.user.defaultRepositoryVisibility]);

  if (!session?.user) {
    return null;
  }

  const username = (session.user as { username?: string }).username || "";
  const selectedOwnerLabel =
    formData.organizationId === "personal"
      ? `${username} (Personal)`
      : organizations.find((o) => o.id === formData.organizationId)?.displayName || username;
  const ownerUsername = formData.organizationId !== "personal"
    ? organizations.find((o) => o.id === formData.organizationId)?.name || username
    : username;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    createRepo(
      {
        name: formData.name,
        description: formData.description || undefined,
        visibility: formData.visibility,
        organizationId: formData.organizationId === "personal" ? undefined : formData.organizationId,
        license: formData.license === "none" ? undefined : formData.license,
      },
      {
        onSuccess: () => {
          toast.success("Repository created successfully!");
          onOpenChange(false);
          navigate({
            to: "/$username/$repo",
            params: {
              username: ownerUsername,
              repo: formData.name.toLowerCase().replace(/\s+/g, "-"),
            },
          });
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Failed to create repository");
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="mx-auto size-12 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground mb-4 shadow-lg shadow-primary/20">
            <GitBranch className="size-6" />
          </div>
          <DialogTitle className="text-xl font-bold text-center">Create a new repository</DialogTitle>
          <DialogDescription className="text-center">
            A repository contains all project files, including the revision history.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            {organizations.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="owner" className="text-sm font-medium">
                  Owner
                </Label>
                <Select
                  value={formData.organizationId}
                  onValueChange={(value) => setFormData({ ...formData, organizationId: value })}
                >
                  <SelectTrigger id="owner" className="h-11">
                    <SelectValue>{selectedOwnerLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">{username} (Personal)</SelectItem>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium">
                Repository name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="my-awesome-project"
                required
                pattern="^[a-zA-Z0-9_.-]+$"
                className="h-11"
                autoFocus
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Great repository names are short and memorable. Need inspiration? How about{" "}
              <span className="text-primary font-medium">awesome-project</span>?
            </p>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="A short description of your project"
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="license" className="text-sm font-medium">
                License <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Select
                value={formData.license}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    license: value as (typeof LICENSE_OPTIONS)[number]["value"],
                  })
                }
              >
                <SelectTrigger id="license" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LICENSE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Visibility Cards */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Visibility</Label>

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
                <Globe className="size-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={formData.visibility === "public"}
                onChange={() => setFormData({ ...formData, visibility: "public" })}
                    className="size-4 text-primary"
              />
                  <span className="font-semibold text-sm">Public</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Anyone on the internet can see this repository. You choose who can commit.
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
                <Lock className="size-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
              <input
                type="radio"
                name="visibility"
                value="private"
                checked={formData.visibility === "private"}
                onChange={() => setFormData({ ...formData, visibility: "private" })}
                    className="size-4 text-primary"
              />
                  <span className="font-semibold text-sm">Private</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  You choose who can see and commit to this repository.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isCreating}
              className="h-11"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isCreating || !formData.name}
              className="h-11 px-6"
            >
              {isCreating ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <GitBranch className="size-4 mr-2" />
                  Create repository
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
