export const SHARE_PAYLOAD_QUERY = "p";

export function createPortableShareUrl(baseUrl, encryptedPayload) {
  const url = new URL("share.html", baseUrl);
  url.searchParams.set(SHARE_PAYLOAD_QUERY, encryptedPayload);
  return url;
}

export function readSharePayload(urlLike) {
  const url = new URL(urlLike);
  return url.searchParams.get(SHARE_PAYLOAD_QUERY) || url.hash.slice(1);
}

export function removeSharePayloadFromAddressBar(payload) {
  if (!payload || !globalThis.history?.replaceState) return;
  globalThis.history.replaceState(null, "", globalThis.location.pathname);
}
