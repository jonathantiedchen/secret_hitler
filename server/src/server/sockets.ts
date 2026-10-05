// Socket.IO: clients join a game and step through its history

import type { Server } from 'socket.io';
import { games } from './gameRecord.js';
import { sanitizeGameState } from './state.js';

export function registerSocketHandlers(io: Server) {
  // Socket.IO connection handling
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join', (gameId: string) => {
      socket.join(gameId);
      const game = games.get(gameId);
      if (game) {
        socket.emit('state', sanitizeGameState(game.state));
        // Send current navigation state
        socket.emit('history_nav', {
          currentIndex: game.viewingIndex,
          totalSnapshots: game.snapshots.length,
          isLive: game.viewingIndex === null,
        });
      }
    });

    // Step navigation - go to previous step
    socket.on('step_back', (gameId: string) => {
      const game = games.get(gameId);
      if (!game || game.snapshots.length === 0) return;

      // If viewing live, go to last snapshot
      if (game.viewingIndex === null) {
        game.viewingIndex = game.snapshots.length - 1;
      } else if (game.viewingIndex > 0) {
        game.viewingIndex--;
      }

      const snapshot = game.snapshots[game.viewingIndex];
      io.to(gameId).emit('state', snapshot.state);
      io.to(gameId).emit('history_nav', {
        currentIndex: game.viewingIndex,
        totalSnapshots: game.snapshots.length,
        isLive: false,
        description: snapshot.description,
      });
    });

    // Step navigation - go to next step
    socket.on('step_forward', (gameId: string) => {
      const game = games.get(gameId);
      if (!game || game.snapshots.length === 0) return;

      if (game.viewingIndex === null) return; // Already live

      if (game.viewingIndex < game.snapshots.length - 1) {
        game.viewingIndex++;
        const snapshot = game.snapshots[game.viewingIndex];
        io.to(gameId).emit('state', snapshot.state);
        io.to(gameId).emit('history_nav', {
          currentIndex: game.viewingIndex,
          totalSnapshots: game.snapshots.length,
          isLive: false,
          description: snapshot.description,
        });
      } else {
        // Go back to live
        game.viewingIndex = null;
        io.to(gameId).emit('state', sanitizeGameState(game.state));
        io.to(gameId).emit('history_nav', {
          currentIndex: null,
          totalSnapshots: game.snapshots.length,
          isLive: true,
        });
      }
    });

    // Go directly to live state
    socket.on('go_live', (gameId: string) => {
      const game = games.get(gameId);
      if (!game) return;

      game.viewingIndex = null;
      io.to(gameId).emit('state', sanitizeGameState(game.state));
      io.to(gameId).emit('history_nav', {
        currentIndex: null,
        totalSnapshots: game.snapshots.length,
        isLive: true,
      });
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
}
