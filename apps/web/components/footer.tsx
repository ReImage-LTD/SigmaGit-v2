import { Link } from "@tanstack/react-router";
import { ExternalLink, GitBranch, Heart, Mail } from "lucide-react";
import { Github, Twitter } from '@/components/brand-icons';

export function Footer() {
  return (
    <footer className="border-t border-border/50 bg-muted/30 mt-auto">
      <div className="container py-8 lg:py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="lg:col-span-2 space-y-4">
            <Link to="/" className="flex items-center gap-2.5 group w-fit">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground font-bold text-lg shadow-lg shadow-primary/20 group-hover:shadow-primary/30 transition-all duration-300 group-hover:scale-105">
                σ
              </div>
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                sigmagit
              </span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              Where code lives. A modern Git hosting platform built for developers who ship.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/disclearing/SigmaGit-v2"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center size-9 rounded-xl bg-background border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:shadow-sm transition-all duration-200"
                aria-label="GitHub"
              >
                <Github className="size-4" />
              </a>
              <a
                href="https://twitter.com/gasthefrench"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center size-9 rounded-xl bg-background border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:shadow-sm transition-all duration-200"
                aria-label="Twitter"
              >
                <Twitter className="size-4" />
              </a>
              <a
                href="mailto:info@sigmagit.com"
                className="flex items-center justify-center size-9 rounded-xl bg-background border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:shadow-sm transition-all duration-200"
                aria-label="Email"
              >
                <Mail className="size-4" />
              </a>
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="font-semibold mb-4 text-sm">Product</h3>
            <ul className="space-y-3 text-sm">
              <li>
                <Link to="/explore" className="text-muted-foreground hover:text-foreground transition-colors duration-200 flex items-center gap-1 group">
                  Explore
                  <ExternalLink className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                </Link>
              </li>
              <li>
                <Link to="/search" className="text-muted-foreground hover:text-foreground transition-colors duration-200 flex items-center gap-1 group">
                  Search
                  <ExternalLink className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                </Link>
              </li>
              <li>
                <Link to="/features" className="text-muted-foreground hover:text-foreground transition-colors duration-200 flex items-center gap-1 group">
                  Features
                  <ExternalLink className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                </Link>
              </li>
              <li>
                <Link to="/register" className="text-muted-foreground hover:text-foreground transition-colors duration-200">
                  Get Started
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-semibold mb-4 text-sm">Resources</h3>
            <ul className="space-y-3 text-sm">
              <li>
                <a
                  href="https://docs.sigmagit.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors duration-200 flex items-center gap-1 group"
                >
                  Documentation
                  <ExternalLink className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                </a>
              </li>
              <li>
                <a
                  href="https://blog.sigmagit.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors duration-200 flex items-center gap-1 group"
                >
                  Blog
                  <ExternalLink className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                </a>
              </li>
              <li>
                <a
                  href="https://status.sigmagit.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors duration-200 flex items-center gap-1 group"
                >
                  Status
                  <ExternalLink className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                </a>
              </li>
              <li>
                <a
                  href="https://sigmagit.com/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors duration-200 flex items-center gap-1 group"
                >
                  API
                  <ExternalLink className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                </a>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="font-semibold mb-4 text-sm">Company</h3>
            <ul className="space-y-3 text-sm">
              <li>
                <Link to="/about" className="text-muted-foreground hover:text-foreground transition-colors duration-200">
                  About
                </Link>
              </li>
              <li>
                <Link to="/careers" className="text-muted-foreground hover:text-foreground transition-colors duration-200">
                  Careers
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-muted-foreground hover:text-foreground transition-colors duration-200">
                  Contact
                </Link>
              </li>
              <li>
                <Link to="/login" className="text-muted-foreground hover:text-foreground transition-colors duration-200">
                  Sign in
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            © {new Date().getFullYear()} sigmagit. Made with <Heart className="size-3 text-red-500 fill-red-500" /> for developers.
          </p>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground transition-colors duration-200">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors duration-200">
              Privacy
            </Link>
            <Link to="/security" className="hover:text-foreground transition-colors duration-200">
              Security
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
