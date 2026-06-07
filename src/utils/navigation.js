export function readHashKey(validKeys, fallback = 'overview') {
  const hashKey = window.location.hash.replace(/^#\/?/, '');
  return validKeys.includes(hashKey) ? hashKey : fallback;
}
