/**
 * Live lookup of saved dashboards, kept in step with the config.
 *
 * The compositor resolves a slot's `overlayDashboardId` through here on every
 * tick -- the same way it reads crop and viewport fresh each time -- so
 * editing and saving a dashboard shows up on any panel already overlaying it
 * without rebuilding anything.
 */
import type { Dashboard } from '@shared/types';

let dashboards: Dashboard[] = [];

export function setDashboards(list: Dashboard[]): void {
  dashboards = list;
}

export function getDashboard(id: string | null | undefined): Dashboard | null {
  if (!id) return null;
  return dashboards.find((d) => d.id === id) ?? null;
}

export function listDashboards(): Dashboard[] {
  return dashboards;
}
