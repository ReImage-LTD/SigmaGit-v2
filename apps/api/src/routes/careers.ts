import { db, jobApplications, jobListings } from '@sigmagit/db';
import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';

const app = new Hono();

const DEFAULT_JOBS = [
  {
    slug: 'senior-full-stack-engineer',
    title: 'Senior Full-Stack Engineer',
    description:
      "We're looking for an experienced full-stack engineer to help us build and scale sigmagit. You'll work on everything from the API to the frontend, helping shape the product.",
    department: 'Engineering',
    location: 'Remote',
    employmentType: 'full_time' as const,
  },
  {
    slug: 'devops-engineer',
    title: 'DevOps Engineer',
    description:
      "Help us build and maintain our infrastructure. You'll work on deployment, monitoring, and ensuring our platform is fast and reliable.",
    department: 'Engineering',
    location: 'Remote',
    employmentType: 'full_time' as const,
  },
];

async function ensureDefaultJobs() {
  const existing = await db.select().from(jobListings).limit(1);
  if (existing.length > 0) return;
  await db.insert(jobListings).values(
    DEFAULT_JOBS.map((j) => ({
      slug: j.slug,
      title: j.title,
      description: j.description,
      department: j.department,
      location: j.location,
      employmentType: j.employmentType,
      open: true,
    })),
  );
}

app.get('/api/careers/jobs', async (c) => {
  await ensureDefaultJobs();
  const jobs = await db
    .select()
    .from(jobListings)
    .where(eq(jobListings.open, true))
    .orderBy(desc(jobListings.createdAt));
  return c.json({ jobs });
});

app.get('/api/careers/jobs/:id', async (c) => {
  const id = c.req.param('id');
  const [job] = await db.select().from(jobListings).where(eq(jobListings.id, id)).limit(1);
  if (!job || !job.open) {
    return c.json({ error: 'Job not found or no longer open' }, 404);
  }
  return c.json(job);
});

app.post('/api/careers/jobs/:id/apply', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const coverLetter = typeof body.coverLetter === 'string' ? body.coverLetter.trim() : null;
  const resumeUrl = typeof body.resumeUrl === 'string' ? body.resumeUrl.trim() || null : null;
  const linkedInUrl = typeof body.linkedInUrl === 'string' ? body.linkedInUrl.trim() || null : null;
  const phone = typeof body.phone === 'string' ? body.phone.trim() || null : null;

  if (!name || name.length > 200 || !email || email.length > 254) {
    return c.json({ error: 'Name and email are required (max 200/254 chars)' }, 400);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return c.json({ error: 'Please enter a valid email address' }, 400);
  }
  if (coverLetter && coverLetter.length > 10000) {
    return c.json({ error: 'Cover letter too long (max 10000 chars)' }, 400);
  }
  if (resumeUrl && resumeUrl.length > 2048) {
    return c.json({ error: 'resumeUrl too long' }, 400);
  }
  if (linkedInUrl && linkedInUrl.length > 2048) {
    return c.json({ error: 'linkedInUrl too long' }, 400);
  }
  if (phone && phone.length > 50) {
    return c.json({ error: 'phone too long' }, 400);
  }
  // Protocol-sanitize external URLs
  if (resumeUrl && !/^https?:\/\//i.test(resumeUrl)) {
    return c.json({ error: 'resumeUrl must be http(s)' }, 400);
  }
  if (linkedInUrl && !/^https?:\/\//i.test(linkedInUrl)) {
    return c.json({ error: 'linkedInUrl must be http(s)' }, 400);
  }

  const [job] = await db.select().from(jobListings).where(eq(jobListings.id, id)).limit(1);
  if (!job || !job.open) {
    return c.json({ error: 'Job not found or no longer accepting applications' }, 404);
  }

  const [application] = await db
    .insert(jobApplications)
    .values({
      jobListingId: job.id,
      name,
      email,
      phone: phone || null,
      coverLetter: coverLetter || null,
      resumeUrl,
      linkedInUrl,
    })
    .returning();

  return c.json({ success: true, applicationId: application.id }, 201);
});

export default app;
