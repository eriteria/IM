/**
 * GUID/UUID normalization utilities
 *
 * These utilities help with consistent GUID comparison across the app,
 * handling case-sensitivity and format differences between backend and mobile.
 */

/**
 * Normalizes a GUID to lowercase for consistent comparison
 */
export const normalizeGuid = (guid: string | undefined | null): string => {
  if (!guid) return '';
  return guid.toLowerCase().trim();
};

/**
 * Compares two GUIDs for equality, handling case differences
 */
export const guidsEqual = (a: string | undefined | null, b: string | undefined | null): boolean => {
  if (!a || !b) return false;
  return normalizeGuid(a) === normalizeGuid(b);
};

/**
 * Checks if a GUID exists in an array of GUIDs (case-insensitive)
 */
export const guidInArray = (guid: string | undefined | null, array: string[]): boolean => {
  if (!guid || !array.length) return false;
  const normalizedGuid = normalizeGuid(guid);
  return array.some(item => normalizeGuid(item) === normalizedGuid);
};

/**
 * Finds a GUID in an array and returns it (case-insensitive match)
 */
export const findGuid = (guid: string | undefined | null, array: string[]): string | undefined => {
  if (!guid || !array.length) return undefined;
  const normalizedGuid = normalizeGuid(guid);
  return array.find(item => normalizeGuid(item) === normalizedGuid);
};
