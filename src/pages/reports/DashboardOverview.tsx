import React from 'react';
import { DashboardOverviewContent } from './DashboardOverviewContent';

/**
 * Reports Center wrapper around the shared minimal dashboard — same content
 * as the main app's /dashboard, just inside the Reports Center's own page
 * chrome. The content component owns its own toolbar (date range + refresh),
 * so nothing else is added here.
 */
export default function DashboardOverview() {
  return <DashboardOverviewContent />;
}
