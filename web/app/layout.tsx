import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'KUDY',
  description: 'KUDY — аўдыёгіды; вольны пласт вэб-канала',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="be">
      <body>{children}</body>
    </html>
  );
}
