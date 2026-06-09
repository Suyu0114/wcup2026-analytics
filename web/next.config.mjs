import createNextIntlPlugin from 'next-intl/plugin';

// next-intl request config lives at lib/i18n.ts (spec §9).
const withNextIntl = createNextIntlPlugin('./lib/i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ESLint config is intentionally not set up for P5 v1; keep TS type-checking on.
  eslint: { ignoreDuringBuilds: true },
};

export default withNextIntl(nextConfig);
