/** Expense categories (FR-2.4) — the kinds of cost a road trip actually produces. Icons are emoji to keep the app dependency-free. */
export const CATEGORIES = ['rent', 'groceries', 'fuel', 'tolls', 'parking', 'restaurant', 'activity', 'transport', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_ICON: Record<Category, string> = {
  rent: '🏠', groceries: '🛒', fuel: '⛽', tolls: '🛣️', parking: '🅿️', restaurant: '🍽️', activity: '🎟️', transport: '🚆', other: '📦',
};
export function categoryIcon(c: string | undefined, type: 'expense' | 'transfer' | 'adjustment'): string {
  if (type === 'transfer') return '💸';
  if (type === 'adjustment') return '🧾';
  return c && c in CATEGORY_ICON ? CATEGORY_ICON[c as Category] : '📦';
}
