/** Explicit role-based trims, relative to the authored layer balance. No per-render normalization. */
import type { OriginalId } from './original-catalog';
export const LEVELS: Partial<Record<OriginalId,number>> = {
  'page-flip': 3.4, send: 1.7, zipper: 1.4, 'record-scratch': 1.1,
  applause: 1.35, vinyl: 1.65, wind: 1.45, 'campfire': 1.15,
  'bike-bell': 1.2, 'phone-bell': 1.2, scanner: 1.2,
};
