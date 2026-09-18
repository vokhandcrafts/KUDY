// The single app-transition config (consumed by G10.01.b pages and G10.02.a).
// The app is not published: store URLs are explicit placeholders and are never
// fabricated (plan global constraint). Every app CTA resolves through
// fallbackPath, so no path can dead-end even with empty store URLs.
export interface AppLinks {
  appStoreUrl: string;
  playStoreUrl: string;
  fallbackPath: '/app';
}

export const appLinks: AppLinks = {
  appStoreUrl: '',
  playStoreUrl: '',
  fallbackPath: '/app',
};

export function isStoreLinkConfigured(links: AppLinks): boolean {
  return links.appStoreUrl !== '' || links.playStoreUrl !== '';
}
