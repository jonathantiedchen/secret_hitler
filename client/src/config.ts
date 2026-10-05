// In dev the API runs separately on :3001; in production the server also serves
// this client, so requests go to the same origin. VITE_SERVER_URL overrides both.
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);
