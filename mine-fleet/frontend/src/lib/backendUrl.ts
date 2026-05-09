/** Browser-visible backend origin (SSE, fetch). */
export function getBackendOrigin(): string {
  const u = import.meta.env.VITE_BACKEND_URL;
  if (typeof u === "string" && u.length > 0) {
    return u.replace(/\/$/, "");
  }
  return "http://localhost:8080";
}
