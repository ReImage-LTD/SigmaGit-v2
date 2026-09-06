import { createFileRoute } from "@tanstack/react-router";
import { Mail, MessageSquare } from "lucide-react";
import { Github, Twitter } from '@/components/brand-icons';
import { createMeta } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_main/contact")({
  head: () => ({ meta: createMeta({ title: "Contact", description: "Get in touch with Sigmagit. General inquiries, support, and feedback." }) }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div className="container max-w-4xl mx-auto px-4 py-12">
      <div className="text-center mb-16">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Get in Touch</h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Have a question or want to learn more? We'd love to hear from you.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 mb-12">
        <Card>
          <CardHeader>
            <Mail className="size-8 text-primary mb-4" />
            <CardTitle>General Inquiries</CardTitle>
            <CardDescription>
              For general questions, support, or feedback
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <a href="mailto:support@sigmagit.com">
                support@sigmagit.com
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MessageSquare className="size-8 text-primary mb-4" />
            <CardTitle>Business Inquiries</CardTitle>
            <CardDescription>
              For partnerships, enterprise, or business questions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <a href="mailto:business@sigmagit.com">
                business@sigmagit.com
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-semibold mb-4">Connect With Us</h2>
          <div className="flex items-center gap-4">
            <Button variant="outline" asChild>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="gap-2">
                <Github className="size-4" />
                GitHub
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="gap-2">
                <Twitter className="size-4" />
                Twitter
              </a>
            </Button>
          </div>
        </section>

        <section className="p-6 rounded-lg border border-border bg-card">
          <h2 className="text-xl font-semibold mb-4">Response Time</h2>
          <p className="text-muted-foreground">
            We typically respond to inquiries within 24-48 hours during business days. 
            For urgent matters, please reach out via our support email.
          </p>
        </section>
      </div>
    </div>
  );
}
