"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  useAdminApplication,
  useAdminApplicationJobs,
  useAdminApplications,
  useCreateAdminApplicationJob,
  useDeleteAdminApplicationJob,
  useUpdateAdminApplicationJob,
  useUpdateAdminApplicationStatus,
} from "@sigmagit/hooks";
import {
  AlertTriangle,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  MoreHorizontal,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_main/admin/applications/")({
  head: () => ({
    meta: [
      { title: "Applications | Admin Panel | Sigmagit" },
      {
        name: "description",
        content: "Manage job listings and view career applications.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminApplicationsPage,
});

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
];

const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
];

function AdminApplicationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Applications</h1>
        <p className="text-muted-foreground mt-2">
          Post job listings and manage career applications
        </p>
      </div>

      <Tabs defaultValue="jobs" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="jobs" className="gap-2">
            <Briefcase className="size-4" />
            Job listings
          </TabsTrigger>
          <TabsTrigger value="applications" className="gap-2">
            <User className="size-4" />
            Applications
          </TabsTrigger>
        </TabsList>
        <TabsContent value="jobs" className="space-y-6">
          <JobsTab />
        </TabsContent>
        <TabsContent value="applications" className="space-y-6">
          <ApplicationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function JobsTab() {
  const { data, isLoading, error } = useAdminApplicationJobs(false);
  const createJob = useCreateAdminApplicationJob();
  const updateJob = useUpdateAdminApplicationJob();
  const deleteJob = useDeleteAdminApplicationJob();
  const [createOpen, setCreateOpen] = useState(false);
  const [editJob, setEditJob] = useState<{ id: string; title: string; description: string; slug: string; department: string | null; location: string | null; employmentType: string; open: boolean } | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    slug: "",
    department: "Engineering",
    location: "Remote",
    employmentType: "full_time",
  });

  const jobs = data?.jobs ?? [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createJob.mutateAsync({
        title: form.title,
        description: form.description,
        slug: form.slug || undefined,
        department: form.department || undefined,
        location: form.location || undefined,
        employmentType: form.employmentType,
      });
      toast.success("Job listing created");
      setCreateOpen(false);
      setForm({ title: "", description: "", slug: "", department: "Engineering", location: "Remote", employmentType: "full_time" });
    } catch {
      toast.error("Failed to create job listing");
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editJob) return;
    try {
      await updateJob.mutateAsync({
        id: editJob.id,
        data: {
          title: form.title,
          description: form.description,
          slug: form.slug || undefined,
          department: form.department || undefined,
          location: form.location || undefined,
          employmentType: form.employmentType,
          open: editJob.open,
        },
      });
      toast.success("Job listing updated");
      setEditJob(null);
    } catch {
      toast.error("Failed to update job listing");
    }
  };

  const handleDelete = async (job: { id: string; title: string }) => {
    if (!confirm(`Delete job "${job.title}"? Applications for this job will also be removed.`)) return;
    try {
      await deleteJob.mutateAsync(job.id);
      toast.success("Job listing deleted");
    } catch {
      toast.error("Failed to delete job listing");
    }
  };

  const openEdit = (job: typeof jobs[0]) => {
    setEditJob(job);
    setForm({
      title: job.title,
      description: job.description,
      slug: job.slug,
      department: job.department || "Engineering",
      location: job.location || "Remote",
      employmentType: job.employmentType || "full_time",
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            Loading job listings...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="py-8 flex flex-col items-center gap-3">
          <AlertTriangle className="size-10 text-destructive" />
          <p className="text-muted-foreground">Failed to load job listings</p>
          <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Job listings</CardTitle>
            <CardDescription>
              {jobs.length} job{jobs.length !== 1 ? "s" : ""} — these appear on the careers page
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" />
            New job
          </Button>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
              <Briefcase className="size-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No job listings yet</p>
              <p className="text-sm mt-1">Create one to start receiving applications.</p>
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>New job</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{job.title}</span>
                      <Badge variant={job.open ? "default" : "secondary"} className="text-xs">
                        {job.open ? "Open" : "Closed"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      {job.department && <span>{job.department}</span>}
                      {job.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3" />
                          {job.location}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{job.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`/careers`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 w-9 hover:bg-accent"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-9">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(job)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            updateJob.mutate({
                              id: job.id,
                              data: { open: !job.open },
                            })
                          }
                        >
                          {job.open ? "Close listing" : "Reopen listing"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(job)}
                        >
                          <Trash2 className="size-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create job dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New job listing</DialogTitle>
            <DialogDescription>
              This job will appear on the public careers page. Applicants can apply from there.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="job-title">Title *</Label>
              <Input
                id="job-title"
                required
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Senior Full-Stack Engineer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-desc">Description *</Label>
              <textarea
                id="job-desc"
                required
                rows={4}
                className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe the role..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="job-dept">Department</Label>
                <Input
                  id="job-dept"
                  value={form.department}
                  onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                  placeholder="Engineering"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-loc">Location</Label>
                <Input
                  id="job-loc"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="Remote"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Employment type</Label>
              <Select
                value={form.employmentType}
                onValueChange={(v) => setForm((f) => ({ ...f, employmentType: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-slug">URL slug (optional)</Label>
              <Input
                id="job-slug"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="auto-generated from title"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createJob.isPending}>
                {createJob.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Create job
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit job dialog */}
      <Dialog open={!!editJob} onOpenChange={(open) => !open && setEditJob(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit job listing</DialogTitle>
            <DialogDescription>Update the job details. Changes appear on the careers page.</DialogDescription>
          </DialogHeader>
          {editJob && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">Title *</Label>
                <Input
                  id="edit-title"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-desc">Description *</Label>
                <textarea
                  id="edit-desc"
                  required
                  rows={4}
                  className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Input
                    value={form.department}
                    onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Input
                    value={form.location}
                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Employment type</Label>
                <Select
                  value={form.employmentType}
                  onValueChange={(v) => setForm((f) => ({ ...f, employmentType: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditJob(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateJob.isPending}>
                  {updateJob.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                  Save changes
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ApplicationsTab() {
  const [jobId, setJobId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(0);
  const limit = 20;
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: jobsData } = useAdminApplicationJobs(false);
  const { data, isLoading, error } = useAdminApplications(
    jobId || undefined,
    status || undefined,
    limit,
    page * limit
  );
  const applications = data?.applications ?? [];
  const hasMore = data?.hasMore ?? false;
  const jobs = jobsData?.jobs ?? [];

  if (isLoading && page === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-10 w-48 mb-4" />
          <Skeleton className="h-64" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>
            View and update status of career applications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Select value={jobId || "all"} onValueChange={(v) => { setJobId(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All jobs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All jobs</SelectItem>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
              <AlertTriangle className="size-10 text-destructive" />
              <p>Failed to load applications</p>
            </div>
          ) : applications.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              <User className="size-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No applications yet</p>
              <p className="text-sm mt-1">Applications will appear here when candidates apply from the careers page.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {applications.map((app: any) => (
                <ApplicationRow
                  key={app.id}
                  application={app}
                  onView={() => setDetailId(app.id)}
                />
              ))}
            </div>
          )}

          {(hasMore || page > 0) && (
            <div className="flex items-center justify-between pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {page + 1}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {detailId && (
        <ApplicationDetailDialog
          applicationId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  );
}

function ApplicationRow({
  application,
  onView,
}: {
  application: any;
  onView: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4 hover:bg-muted/30">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{application.name}</span>
          <Badge variant="secondary" className="text-xs">
            {application.jobTitle}
          </Badge>
          <StatusBadge status={application.status} />
        </div>
        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
          <Mail className="size-3" />
          <a href={`mailto:${application.email}`} className="hover:text-foreground truncate">
            {application.email}
          </a>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Applied {new Date(application.createdAt).toLocaleDateString(undefined, {
            dateStyle: "medium",
          })}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onView}>
        View
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "rejected"
      ? "destructive"
      : status === "offer"
        ? "default"
        : "secondary";
  const label = STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

function ApplicationDetailDialog({
  applicationId,
  onClose,
}: {
  applicationId: string;
  onClose: () => void;
}) {
  const { data: app, isLoading } = useAdminApplication(applicationId);
  const updateStatus = useUpdateAdminApplicationStatus();

  return (
    <Dialog open={!!applicationId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Application details</DialogTitle>
          <DialogDescription>
            {app ? `${app.name} — ${app.jobTitle}` : "Loading..."}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !app ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Name</p>
                <p className="font-medium">{app.name}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Email</p>
                <a href={`mailto:${app.email}`} className="text-primary hover:underline">
                  {app.email}
                </a>
              </div>
              {app.phone && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Phone</p>
                  <p>{app.phone}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground">Position</p>
                <p>{app.jobTitle}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Status</p>
                <Select
                  value={app.status}
                  onValueChange={async (v) => {
                    await updateStatus.mutateAsync({ id: app.id, status: v });
                    toast.success("Status updated");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {app.coverLetter && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Cover letter</p>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                  {app.coverLetter}
                </div>
              </div>
            )}
            {(app.resumeUrl || app.linkedInUrl) && (
              <div className="flex gap-3">
                {app.resumeUrl && (
                  <a
                    href={app.resumeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    Resume / Portfolio →
                  </a>
                )}
                {app.linkedInUrl && (
                  <a
                    href={app.linkedInUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    LinkedIn →
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
