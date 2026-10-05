import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { registerRoutes } from './server/routes.js';
import { registerSocketHandlers } from './server/sockets.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

registerRoutes(app, io);
registerSocketHandlers(io);

// Serve the built client (production); unknown paths fall through to the SPA
const CLIENT_DIST = process.env.CLIENT_DIST || fileURLToPath(new URL('../../client/dist', import.meta.url));
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (_req, res) => {
    res.sendFile('index.html', { root: CLIENT_DIST });
  });
}

// Start server
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
