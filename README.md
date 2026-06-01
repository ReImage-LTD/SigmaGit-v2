# Sigmagit

A modern GitHub-like git hosting platform built with TypeScript, Bun, React, and more.

## Overview

Sigmagit is a fully-featured git hosting platform that allows you to host and manage your code with ease.

## 🚀 Quick Start

### Prerequisites
- **Bun 1.3+**: JavaScript runtime and package manager
- **Node.js 20+**: For certain dependencies
- **PostgreSQL 14+**: Database
- **Redis** (optional): For caching
- **S3-compatible storage** or local filesystem: For git objects

### Installation

```bash
# Clone repository
git clone <repository-url>
cd sigmagit

# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
bun run db:push

# Start web app + API server
bun run dev:web

# Start Discord bot only (optional)
bun run dev:discord
```

## 📁 Project Structure

```
sigmagitv2/
├── apps/
│   ├── api/              # Hono API server (Bun)
│   ├── web/              # TanStack Start web application
│   ├── docs-vitepress/   # VitePress documentation site
│   ├── discord-bot/      # Discord integration bot
│   └── runner/           # Go-based CI runner agent
├── packages/
│   ├── db/               # Drizzle ORM schema + migrations
│   ├── lib/              # Shared utilities + API client
│   └── hooks/            # Shared React Query hooks/types
├── docs/                 # Markdown technical docs
├── turbo.json            # Turbo monorepo pipeline config
└── .env.example          # Environment variables template
```

## 📚 Documentation

### Getting Started
- [Quick Start](/README.md) - This file
- [API Documentation](apps/docs-vitepress/docs/api/index.md) - API endpoints and usage
- [Web App](apps/docs-vitepress/docs/web/index.md) - Web app development
- [Discord Bot](apps/docs-vitepress/docs/discord-bot/index.md) - Discord integration
- [Architecture](apps/docs-vitepress/docs/architecture/index.md) - System architecture
- [Development](apps/docs-vitepress/docs/development/index.md) - Development workflow
- [Deployment](apps/docs-vitepress/docs/deployment/index.md) - Deployment guides
- [Features](apps/docs-vitepress/docs/features/index.md) - Feature documentation
- [Security](apps/docs-vitepress/docs/security/index.md) - Security best practices

### Technical Documentation
- [Git Operations](apps/docs-vitepress/docs/features/git/index.md) - Git hosting features
- [Authentication](apps/docs-vitepress/docs/features/auth/index.md) - User authentication
- [Storage](apps/docs-vitepress/docs/features/storage/index.md) - Git object storage
- [Webhooks](apps/docs-vitepress/docs/features/webhooks/index.md) - Webhook notifications
- [Account Linking](apps/docs-vitepress/docs/features/account-linking/index.md) - Discord account linking
- [Container Registry](apps/docs-vitepress/docs/features/registry/index.md) - OCI/Docker image hosting

## 🐳 Container Registry

Sigmagit includes an OCI Distribution (Docker Registry) v2–compatible API for hosting container images. Use your API host as the registry:

```bash
docker login <API_HOST>   # username + password or username + API key
docker push <API_HOST>/<owner>/<image>:<tag>
docker pull <API_HOST>/<owner>/<image>:<tag>
```

Images are stored in the same S3 or local storage backend as git objects, under the `registry/` prefix. Access follows Sigmagit identities: push/pull is allowed for the namespace owner (user or org) and org members.

## 🛠 Tech Stack

### Core Technologies
- **Runtime**: Bun 1.3.5+
- **Language**: TypeScript
- **Frontend**: React 19, TanStack Start, TailwindCSS
- **Backend**: Hono, Bun
- **Database**: PostgreSQL, Drizzle ORM
- **Caching**: Redis (optional)
- **Storage**: S3-compatible or local filesystem
- **Authentication**: better-auth

### Key Libraries
- **UI**: shadcn/ui, lucide-react, tanstack-theme-kit
- **State Management**: TanStack Query, TanStack Store
- **Forms**: react-hook-form
- **Routing**: TanStack Router (file-based)
- **Git**: isomorphic-git
- **Email**: Resend or Nodemailer (SMTP)
- **Database**: Drizzle ORM, postgres

## 🔒 Configuration

### Required Environment Variables

See [Environment Variables](#environment-variables) section below) for required configuration.

### Optional Features

- **Redis**: Enable for caching and rate limiting
- **S3**: Configure for git object storage (alternatively use local)
- **SMTP**: Configure for email sending (alternatively use Resend)

## 🔗 API

The API server provides REST endpoints for all Sigmagit functionality.

- Base URL: `http://localhost:3001` (configurable)
- Documentation: [API Documentation](apps/docs-vitepress/docs/api/index.md)

## 🌐 Web App

Modern React-based web application with file-based routing.

- Base URL: `http://localhost:3000` (configurable)
- Documentation: [Web App](apps/docs-vitepress/docs/web/index.md)

## 🤖 Discord Bot

Discord integration for notifications and repository management.

- Documentation: [Discord Bot](apps/docs-vitepress/docs/discord-bot/index.md)
- Feature Details: [Account Linking](apps/docs-vitepress/docs/features/account-linking/index.md)

## 🔐 Architecture

System architecture and data flow.

- Documentation: [Architecture](apps/docs-vitepress/docs/architecture/index.md)

## 🛠 Development

Development setup, workflow, and best practices.

- Documentation: [Development](apps/docs-vitepress/docs/development/index.md)

## 🚢 Deployment

Production deployment guides for various platforms.

- Documentation: [Deployment](apps/docs-vitepress/docs/deployment/index.md)

## 🔐 Features

Detailed feature documentation.

- [Git Operations](apps/docs-vitepress/docs/features/git/index.md)
- [Authentication](apps/docs-vitepress/docs/features/auth/index.md)
- [Storage](apps/docs-vitepress/docs/features/storage/index.md)
- [Webhooks](apps/docs-vitepress/docs/features/webhooks/index.md)
- [Account Linking](apps/docs-vitepress/docs/features/account-linking/index.md)

## 🔒 Security

Security best practices and guidelines.

- Documentation: [Security](apps/docs-vitepress/docs/security/index.md)

## 📞 Environment Variables

### Required

```env
DATABASE_URL="postgresql://user:password@localhost:5432/sigmagit"
BETTER_AUTH_SECRET="your-super-secret-key-here"
```

### Optional

```env
# Storage
STORAGE_TYPE="s3"  # Options: s3, local
S3_ENDPOINT="https://your-s3-endpoint.com"
S3_REGION="auto"
S3_ACCESS_KEY_ID="your-access-key-id"
S3_SECRET_ACCESS_KEY="your-secret-access-key"
S3_BUCKET_NAME="your-bucket-name"
STORAGE_LOCAL_PATH="./data/repos"  # Only if STORAGE_TYPE=local

# Redis (recommended)
REDIS_URL="redis://localhost:6379"

# Email
EMAIL_PROVIDER="resend"  # Options: resend, smtp
RESEND_API_KEY="resend-api-key-here"
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-username"
SMTP_PASS="your-password"
EMAIL_FROM="Sigmagit <noreply@sigmagit.dev>"

# API
API_URL="http://localhost:3001"
WEB_URL="http://localhost:3000"

# Discord Bot
DISCORD_BOT_TOKEN="your-bot-token-here"
DISCORD_CLIENT_ID="your-client-id-here"
DISCORD_GUILD_ID="your-server-id-here"

# Discord Webhooks (for API to send notifications to Discord)
DISCORD_WEBHOOK_URL="https://your-discord-webhook-url.com"
WEBHOOK_SECRET="your-webhook-secret-here"
PUBLIC_WEBHOOK_URL="http://your-domain.com/api/webhooks/discord"
```

## 🤝 Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

[License](LICENSE) - See LICENSE file for details.

## 🆘 Support

For support, please open an issue on [GitHub Issues](https://github.com/sigmagit/sigmagit/issues).

---

Made with ❤️ using Bun, TypeScript, React and TanStack
