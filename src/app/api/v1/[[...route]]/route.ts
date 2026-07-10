import { app } from "@/server/api/app";

// Hängt die Hono-API in den Next.js-App-Router ein. Alle /api/v1/*-Anfragen
// werden an die Hono-App delegiert (ein Worker, ein Deploy).
const handler = (request: Request) => app.fetch(request);

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
};
