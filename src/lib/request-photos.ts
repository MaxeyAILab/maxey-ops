/**
 * Photos attached to a return / transfer request, so whoever approves can see what is being moved. Pure helpers shared by the
 * pages, the forms and the tests.
 */

/** Most photos that can be sent with one request (a few clear shots are enough). */
export const MAX_NEW_REQUEST_PHOTOS = 4;
/** Most photos one request can hold in all, however many times people add to it. */
export const MAX_REQUEST_PHOTOS = 8;

/** The stored photo list (a JSON column) as plain strings — anything that isn't a list of text is ignored. */
export function photoList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

/** What is left over to add: a request can hold MAX_REQUEST_PHOTOS in all. */
export const photoRoom = (value: unknown): number => Math.max(0, MAX_REQUEST_PHOTOS - photoList(value).length);

/** The stored list with new photos added after the existing ones. */
export const withPhotos = (value: unknown, added: string[]): string[] => [...photoList(value), ...added].slice(0, MAX_REQUEST_PHOTOS);
