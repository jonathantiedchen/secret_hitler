// REST API

import type { Express } from 'express';
import type { Server } from 'socket.io';
import { games, createGameRecord } from './gameRecord.js';
import { sanitizeGameState } from './state.js';
import { runGameLoop } from './gameLoop.js';
import { isSeed } from '../game/random.js';
import { isLyingInstruction, LYING_INSTRUCTIONS } from '../ai/prompts.js';

export function registerRoutes(app: Express, io: Server) {
  // REST API endpoints
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', games: games.size });
  });

  app.post('/api/games', (req, res) => {
    const { players, apiKey, settings, seed } = req.body;

    if (!players || players.length < 5 || players.length > 10) {
      return res.status(400).json({ error: 'Need 5-10 players' });
    }
    // Optional: replays the deal of an earlier game (its log records the seed)
    if (seed !== undefined && !isSeed(seed)) {
      return res.status(400).json({ error: 'seed must be an integer from 0 to 4294967295' });
    }
    if (settings?.lyingInstruction !== undefined && !isLyingInstruction(settings.lyingInstruction)) {
      return res.status(400).json({ error: `settings.lyingInstruction must be one of: ${LYING_INSTRUCTIONS.join(', ')}` });
    }

    const gameId = `game-${Date.now()}`;
    const game = createGameRecord(gameId, players, apiKey, settings, { seed });

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
    const gameId = req.params.gameId;
    runGameLoop(gameId, (event, data) => io.to(gameId).emit(event, data));
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
