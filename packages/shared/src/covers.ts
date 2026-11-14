/**
 * Mixed into every card and search-result DTO. The server attaches the hash
 * from its `cover_hashes` table when it answers; nothing upstream supplies
 * it, so it never lives in a medium's metadata table.
 */
export interface CoverHashed {
  /** Base64 ThumbHash (https://evanw.github.io/thumbhash/) of the cover,
   *  painted while the real image loads. Absent or null until the server
   *  has hashed that cover. */
  coverHash?: string | null;
}
