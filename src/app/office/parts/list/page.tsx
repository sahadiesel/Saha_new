import { redirect } from 'next/navigation';

/**
 * This route is now handled by the root app/ directory to avoid conflicts.
 * Redirecting to the canonical path under /app prefix.
 */
export default function LegacyPartsListPage() {
  redirect('/app/office/parts/list');
}
