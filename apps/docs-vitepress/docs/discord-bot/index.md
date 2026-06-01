# Sigmagit Discord Bot

Discord bot that provides repository management, notifications, and account linking features.

## 🚀 Quick Start

### Prerequisites

- **Bun 1.3.5+** - JavaScript runtime
- **Node.js 20+** - For dependencies
- **Discord Application** - Created in Discord Developer Portal
- **Sigmagit API** - Running API server

### Installation

```bash
# Install dependencies
cd apps/discord-bot
bun install

# Configure environment variables
cp .env.example .env
# Edit .env with your Discord bot token

# Register Discord commands
bun run register

# Start bot
bun run dev
```

## 📁 Project Structure

```
apps/discord-bot/
├── src/
│   ├── index.ts                 # Main bot entry point
│   ├── config.ts               # Configuration management
│   ├── api.ts                 # Sigmagit API client
│   ├── webhooks.ts             # Webhook handlers
│   └── commands/
│       ├── register.ts            # Command definitions
│       ├── handlers.ts             # Command implementations
│       └── link.ts                # Account linking commands
├── package.json
└── tsconfig.json
```

## 🤖 Discord Bot Features

### Repository Management

- **`/repo [owner] [repo]`** - Get repository details
- **`/search [query]`** - Search repositories
- **`/issues [owner] [repo] [state]`** - List issues (open/closed)
- **`/prs [owner] [repo] [state]`** - List pull requests (open/closed/merged)
- **`/commits [owner] [repo] [branch]`** - View recent commits
- **`/fork [owner] [repo] [name]`** - Fork a repository

### Account Linking

- **`/link`** - Start account linking process
- **`/link-email [email]`** - Link with email verification
- **`/unlink`** - Unlink Discord account
- **`/link-status`** - Check link status and verification

### User Experience

- **Rich Embeds** - Beautiful embeds for all responses
- **Button Interactions** - Interactive buttons for workflows
- **Error Handling** - Graceful error messages
- **Loading States** - Defer replies for operations

## 🎨 Commands Reference

### Repository Commands

#### `/repo [owner] [repo]`

**Description:** Get detailed information about a repository.

**Parameters:**
- `owner` - Repository owner username (required)
- `repo` - Repository name (required)

**Example:**
```
/repo owner torvalds linux
```

**Response:**
- Repository name, description, visibility, stats, owner info

#### `/search [query]`

**Description:** Search for repositories on Sigmagit.

**Parameters:**
- `query` - Search query (required)

**Example:**
```
/search javascript web framework
```

**Response:**
- List of matching repositories

#### `/issues [owner] [repo] [state]`

**Description:** List issues for a repository.

**Parameters:**
- `owner` - Repository owner username (required)
- `repo` - Repository name (required)
- `state` - Issue state: open/closed (default: open)

**Example:**
```
/issues owner torvalds repo linux state closed
```

#### `/prs [owner] [repo] [state]`

**Description:** List pull requests for a repository.

**Parameters:**
- `owner` - Repository owner username (required)
- `repo` - Repository name (required)
- `state` - PR state: open/closed/merged (default: open)

**Example:```
/prs owner torvalds repo linux state open
```

#### `/commits [owner] [repo] [branch]`

**Description:** View recent commits for a repository.

**Parameters:**
- `owner` - Repository owner username (required)
- `repo` - Repository name (required)
- `branch` - Branch name (default: main)

**Example:**
```
/commits owner torvalds repo linux branch main
```

#### `/fork [owner] [repo] [name]`

**Description:** Fork a repository to your account.

**Parameters:**
- `owner` - Repository owner username (required)
- `repo` - Repository name (required)
- `name` - Fork name (optional)

**Example:**
```
/fork owner torvalds linux name my-linux
```

### Account Linking Commands

#### `/link`

**Description:** Start Discord account linking process.

Shows a menu with options to link via email or manage existing link.

#### `/link-email [email]`

**Description:** Generate verification link for your Sigmagit account.

**Parameters:**
- `email` - Your Sigmagit account email (required)

**Example:**
```
/link-email your-email@sigmagit.dev
```

**Flow:**
1. User provides Sigmagit email
2. Bot generates verification token
3. Sigmagit API sends verification email
4. User clicks verification link in email
5. Bot verifies token with API
6. Account linked!

#### `/unlink`

**Description:** Unlink your Discord account from Sigmagit.

#### `/link-status`

**Description:** Check your account link status.

**Response:**
- Linked status (boolean)
- Verification status (boolean)
- Sigmagit user info (if linked)

## 📊 Events and Webhooks

### Supported Event Types

- **Issue Events**
  - `opened` - New issue created
  - `closed` - Issue closed
  - `reopened` - Issue reopened
  - `edited` - Issue edited

- **Pull Request Events**
  - `opened` - New PR created
  - `closed` - PR closed
  - `edited` - PR edited
  - `merged` - PR merged

- **Push Events**
  - New commits pushed

- **Star Events**
  - `added` - Repository starred
  - `removed` - Repository unstarred

- **Fork Events**
  - Repository forked

### Webhook Configuration

The API sends webhook notifications to Discord when events occur.

**Configuration:**
```env
DISCORD_WEBHOOK_URL="https://your-discord-webhook-url.com/api/webhooks/discord"
WEBHOOK_SECRET="your-secret-key-here"
PUBLIC_WEBHOOK_URL="http://your-domain.com/api/webhooks/discord"
```

## 🔐 API Integration

### Sigmagit API Client

**Location:** `apps/discord-bot/src/api.ts`

**Usage:**
```typescript
import { SigmagitApiClient } from './api';

const api = new SigmagitApiClient('http://localhost:3001');

const { data } = await api.getRepository('owner', 'repo');
```

### API Endpoints Used

- `GET /api/repositories/:owner/:name` - Repository info
- `GET /api/repositories/:owner/:name/issues` - Issues
- `GET /api/repositories/:owner/:name/pulls` - Pull requests
- `GET /api/repositories/:owner/:name/commits` - Commits
- `GET /api/search` - Search
- `POST /api/repositories/:owner/:name/fork` - Fork repository

### Discord Linking API

- `POST /api/discord/link/generate` - Generate link token
- `POST /api/discord/link/verify` - Verify link token
- `POST /api/discord/link/unlink` - Unlink account
- `GET /api/discord/link/status/:discordId` - Check link status

## 🎨 Embeds

### Issue Notification Embed

- Title, description, state, author
- Labels, assignees
- Color-coded by state (open: green, closed: red)

### Pull Request Embed

- Title, description, state, author
- Branch comparison
- Merge status colors

### Push Notification Embed

- Commit messages (last 5 shown)
- Total commit count

### Star Notification Embed

- Repository name and star/unstar action
- Color-coded (yellow for star, gray for unstar)

### Fork Notification Embed

- Repository name, forker username
- Green color

## 🔒 Best Practices

### Error Handling
- All commands wrapped in try-catch
- User-friendly error messages
- Ephemeral responses for sensitive operations
- Loading indicators for async operations

### Rate Limiting
- Discord rate limits respected
- API requests include retry logic

### Logging
- Structured logging for all operations
- Error logging with context

### Security
- Token validation
- Webhook signature verification (planned)
- User ID verification
- No sensitive data in logs

## 🚀 Development

### Running Development Server

```bash
# Start bot
bun run dev

# Register commands
bun run register

# Watch for changes
bun run dev --watch
```

### Testing

```bash
# Test Discord bot locally
bun run dev

# Test slash commands
# Use Discord Developer Portal to test commands

# Test webhooks
curl http://localhost:3001/api/webhooks/discord/test
```

### Building

```bash
# Build for production
bun build
```

### Environment Variables

Required:
```env
DISCORD_BOT_TOKEN="your-bot-token-here"
DISCORD_CLIENT_ID="your-client-id-here"
API_URL="http://localhost:3001"
```

Optional:
```env
DISCORD_GUILD_ID="your-server-id-here"

# For webhooks (API server side)
DISCORD_WEBHOOK_URL="https://your-discord-webhook-url.com/api/webhooks/discord"
WEBHOOK_SECRET="your-secret-key-here"
PUBLIC_WEBHOOK_URL="http://your-domain.com/api/webhooks/discord"
```

## 🎨 Discord Application Setup

### 1. Create Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Set application name (e.g., "Sigmagit Bot")
4. Click "Create"

### 2. Create Bot User

1. Go to "Bot" section
2. Click "Add Bot"
3. Set bot username (e.g., "Sigmagit")
4. Enable privileged intents:
   - Server Members Intent
   - Message Content Intent
5. Click "Save Changes"

### 3. Configure OAuth2 Scopes

1. Go to "OAuth2" > "URL Generator"
2. Select scopes:
   - `applications.commands`
3. Select permissions:
   - Send Messages
   - Embed Links
   - Read Messages
   - Read Message History
4. Copy generated OAuth2 URL

### 4. Invite Bot to Server

1. Open OAuth2 URL in browser
2. Select your Discord server
3. Authorize bot with selected permissions

## 📱 Common Issues

### Bot doesn't respond
- Verify bot has correct permissions
- Check bot token is correct
- Ensure bot is invited to server

### Commands not found
- Run `bun run register` to register commands
- Verify DISCORD_CLIENT_ID is correct

### API errors
- Check API server is running
- Verify API_URL is correct
- Verify webhook URL is configured

### Linking issues
- Check email address is correct Sigmagit email
- Verify user has access to account
- Check Discord ID format is correct (string)

### Webhooks not working
- Verify DISCORD_WEBHOOK_URL is set correctly
- Check webhook secret matches
- Test webhook with `/api/webhooks/discord/test`

## 📚 See Also

- [Docs Home](../) - Project overview
- [API Documentation](../api/) - API endpoints
- [Web App](../web/) - Web application
- [Architecture](../architecture/) - System architecture
- [Development](../development/) - Development workflow
- [Deployment](../deployment/) - Deployment guides
- [Git Operations](../features/git/) - Git features
- [Authentication](../features/auth/) - Auth details
- [Storage](../features/storage/) - Storage backend
- [Webhooks](../features/webhooks/) - Webhook system
- [Account Linking](../features/account-linking/) - Discord linking details

---

**Built with Discord.js v14 + Bun**
