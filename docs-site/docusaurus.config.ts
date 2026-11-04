import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'BYOBYaml',
  tagline: 'Docker Compose, Kubernetes und OpenShift aus Blöcken bauen',
  favicon: 'img/logo.svg',

  url: 'https://byobyaml.local',
  baseUrl: '/',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  markdown: { mermaid: true, hooks: { onBrokenMarkdownLinks: 'warn' } },

  i18n: { defaultLocale: 'de', locales: ['de'] },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          showLastUpdateTime: false,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['de', 'en'],
        indexBlog: false,
        docsRouteBasePath: '/docs',
        highlightSearchTermsOnTargetPage: true,
        searchBarShortcutHint: true,
      },
    ],
  ],

  themeConfig: {
    colorMode: { defaultMode: 'dark', respectPrefersColorScheme: false },
    mermaid: { theme: { light: 'neutral', dark: 'dark' } },
    docs: { sidebar: { hideable: true, autoCollapseCategories: false } },
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    navbar: {
      title: 'BYOBYaml',
      logo: { alt: 'BYOBYaml', src: 'img/logo.svg' },
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Dokumentation' },
        { to: '/docs/referenz', label: 'Block-Referenz', position: 'left' },
        { to: '/docs/vorlagen/katalog', label: 'Vorlagen', position: 'left' },
        { to: '/docs/entwicklung/architektur', label: 'Entwicklung', position: 'left' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Loslegen',
          items: [
            { label: 'Installation', to: '/docs/installation' },
            { label: 'Erste Schritte', to: '/docs/erste-schritte' },
            { label: 'Oberfläche', to: '/docs/oberflaeche' },
          ],
        },
        {
          title: 'Nachschlagen',
          items: [
            { label: 'Block-Referenz', to: '/docs/referenz' },
            { label: 'Import', to: '/docs/funktionen/import' },
            { label: '.byob-Format', to: '/docs/funktionen/byob-format' },
          ],
        },
        {
          title: 'Projekt',
          items: [
            { label: 'Architektur', to: '/docs/entwicklung/architektur' },
            { label: 'Fehlerbehebung', to: '/docs/fehlerbehebung' },
          ],
        },
      ],
      copyright: `BYOBYaml · Dokumentation gebaut mit Docusaurus`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['bash', 'powershell', 'json', 'yaml', 'sql'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
