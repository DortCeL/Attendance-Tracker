export function uid(): string {
  // randomUUID is unavailable on insecure origins (e.g. testing over LAN http).
  if (typeof crypto !== "undefined" && "randomUUID" in crypto && window.isSecureContext) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
