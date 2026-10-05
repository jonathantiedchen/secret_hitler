// REST API

import type { Express } from 'express';
import type { Server } from 'socket.io';
import { games, createGameRecord } from './gameRecord.js';
import { sanitizeGameState } from './state.js';
import { runGameLoop } from './gameLoop.js';

export function registerRoutes(app: Express, io: Server) {
  // REST API endpoints
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', games: games.size });
  });

  app.post('/api/games', (req, res) => {
    const { players, apiKey, settings } = req.body;

    if (!players || players.length < 5 || players.length > 10) {
      return res.status(400).json({ error: 'Need 5-10 players' });
    }

    const gameId = `game-${Date.now()}`;
    const game = createGameRecord(gameId, players, apiKey, settings);

    res.json({ gameId, state: sanitizeGameState(game.state) });
  });


  app.get('/api/games/:gameId', (req, res) => {
    const game = games.get(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json({ state: sanitizeGameState(game.state) });
  });

  // Get game history for analysis
  app.get('/api/games/:gameId/history', (req, res) => {
    const game = games.get(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json({ history: game.history });
  });

  app.post('/api/games/:gameId/start', async (req, res) => {
    const game = games.get(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.isRunning) {
      return res.status(400).json({ error: 'Game already running' });
    }

    game.isRunning = true;
    res.json({ status: 'started' });

    // Start the game loop in background
    runGameLoop(req.params.gameId, io);
  });

  app.post('/api/games/:gameId/pause', (req, res) => {
    const game = games.get(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    game.isPaused = !game.isPaused;
    io.to(req.params.gameId).emit('paused', { isPaused: game.isPaused });
    res.json({ isPaused: game.isPaused });
  });
}
