export const MIN_SIDEBAR_WIDTH = 188;
export const MAX_SIDEBAR_WIDTH = 380;

export function clampSidebarWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)));
}
