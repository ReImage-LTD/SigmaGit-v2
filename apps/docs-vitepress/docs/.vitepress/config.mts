import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Sigmagit Docs',
  description: 'Documentation for Sigmagit',
  lang: 'en-US',
  lastUpdated: true,
  cleanUrls: true,
  vite: {
    server: {
      allowedHosts: ['docs.sigmagit.com'],
    },
  },
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'API', link: '/api/' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'Deployment', link: '/deployment/' },
      { text: 'Development', link: '/development/' },
    ],
    sidebar: {
      '/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Overview', link: '/' },
            { text: 'Migration Notes', link: '/migration-notes' },
          ],
        },
      ],
      '/api/': [{ text: 'API', items: [{ text: 'Overview', link: '/api/' }] }],
      '/architecture/': [{ text: 'Architecture', items: [{ text: 'Overview', link: '/architecture/' }] }],
      '/deployment/': [
        {
          text: 'Deployment',
          items: [
            { text: 'Overview', link: '/deployment/' },
            { text: 'VPS Guide', link: '/deployment/vps' },
          ],
        },
      ],
      '/development/': [{ text: 'Development', items: [{ text: 'Overview', link: '/development/' }] }],
      '/discord-bot/': [{ text: 'Discord Bot', items: [{ text: 'Overview', link: '/discord-bot/' }] }],
      '/security/': [{ text: 'Security', items: [{ text: 'Overview', link: '/security/' }] }],
      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Overview', link: '/features/' },
            { text: 'Git', link: '/features/git/' },
            { text: 'Auth', link: '/features/auth/' },
            { text: 'Storage', link: '/features/storage/' },
            { text: 'Webhooks', link: '/features/webhooks/' },
            { text: 'Account Linking', link: '/features/account-linking/' },
          ],
        },
      ],
    },
    search: {
      provider: 'local',
    },
    socialLinks: [{ icon: 'github', link: 'https://git.sigmagaming.net/SigmaGaming/SimgaGit-v2' }],
  },
});
