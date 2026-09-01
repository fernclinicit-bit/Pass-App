export function normalizeRequestMatch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._]+/gu, " ")
    .trim();
}

export function requestItemMatchScore(request, item) {
  if (request.requestVaultItemId && request.requestVaultItemId === item.id) return 10_000;
  const requestedSystem = normalizeRequestMatch(request.system);
  const requestedAccount = normalizeRequestMatch(request.requestAccount);
  const requestedReason = normalizeRequestMatch(request.reason);
  const requestedText = `${requestedSystem} ${requestedAccount} ${requestedReason}`.trim();
  const itemName = normalizeRequestMatch(item.name);
  const itemUsername = normalizeRequestMatch(item.username);
  const itemOwner = normalizeRequestMatch(item.owner);
  const itemPurpose = normalizeRequestMatch(item.purpose);
  let score = 0;
  if (requestedSystem && itemName && requestedSystem === itemName) score += 300;
  else if (requestedSystem && itemName && (requestedSystem.includes(itemName) || itemName.includes(requestedSystem))) score += 180;
  if (requestedAccount && itemUsername && requestedAccount === itemUsername) score += 500;
  else if (requestedText && itemUsername && requestedText.includes(itemUsername)) score += 350;
  if (requestedAccount && itemOwner && requestedAccount.includes(itemOwner)) score += 90;
  if (requestedText && itemPurpose && requestedText.includes(itemPurpose)) score += 70;
  return score;
}
