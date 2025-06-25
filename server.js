const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
app.use(express.static('public'));

const rooms = {}; // roomId -> room state

const {
  GOAL_WIDTH,
  GOAL_DEPTH,
  PUCK_RADIUS,
  FRICTION,
  GAME_DURATION,
  GOAL_POS_Y_BOTTOM,
  GOAL_POS_Y_TOP,
  GOAL_POS_X
} = require('./shared/constants');

function createRoom() {
  const roomId = Math.random().toString(36).substr(2, 6);
  console.log("Created room", roomId);
  rooms[roomId] = {
    id: roomId,
    players: {},
    puck: { x: 200, y: 600, vx: 0, vy: 0 },
    scores: { top: 0, bottom: 0 },
    gameStartTime: null,
    gameLoop: null,
    puckHitCooldown: 0,
    private: false,
    frameCount: 0,
    spectators: {},
    puckSide: null,
    puckSideTime: null,
  };
  return rooms[roomId];
}

function resetPuck(room, direction = 1) {
  room.puck = {
    x: 200,
    y: 600,
    vx: 0,
    vy: 5 * direction,
  };
}

function startGame(room) {
  room.gameStartTime = Date.now();
  resetPuck(room);

  room.gameLoop = setInterval(() => {
    gameLoop(room);
  }, 1000 / 60);

  setInterval(() => {
    sendTimer(room);
  }, 1000);
}

function sendTimer(room) {
  if (!room.gameStartTime) return;

  const elapsed = Date.now() - room.gameStartTime;
  const remaining = Math.max(0, GAME_DURATION - elapsed);

  io.to(room.id).emit('timer', remaining);

  if (remaining <= 0) {
    clearInterval(room.gameLoop);
    room.gameLoop = null;
    io.to(room.id).emit('gameOver', room.scores);
    delete rooms[room.id];
  }
}
let lastLoop = Date.now();
let totalDelay = 0;
let loopCount = 0;


function gameLoop(room) {

   const now = Date.now();
  const delay = now - lastLoop;
  lastLoop = now;

  totalDelay += delay;
  loopCount++;

  // Log average every 5 seconds or so
  if (loopCount % 300 === 0) {  // 60 FPS x 5 seconds = 300
    const avgDelay = totalDelay / loopCount;
    console.log(`Average loop delay: ${avgDelay.toFixed(2)} ms over ${loopCount} loops`);
    // Reset
    totalDelay = 0;
    loopCount = 0;
  }

  room.frameCount++;
  const puck = room.puck;
  puck.x += puck.vx;
  puck.y += puck.vy;

  puck.vx *= FRICTION;
  puck.vy *= FRICTION;

  // Bounce off left/right walls
  if (puck.x - PUCK_RADIUS <= 0) {
    puck.x = PUCK_RADIUS;
    puck.vx *= -1;
  }
  if (puck.x + PUCK_RADIUS >= 600) {
    puck.x = 600 - PUCK_RADIUS;
    puck.vx *= -1;
  }

  // Top back wall (outside goal)
  if (puck.y <= GOAL_DEPTH) {
    // Check if puck is NOT inside the goal horizontally
    if (puck.x < (GOAL_POS_X - GOAL_WIDTH / 2) || puck.x > (GOAL_POS_X + GOAL_WIDTH / 2)) {
      puck.vy *= -1; // Bounce back
      puck.y = GOAL_DEPTH; // Prevent puck from sticking in wall
    }
  }

  // Bottom back wall (outside goal)
  if (puck.y >= 800 - GOAL_DEPTH) {
    // Check if puck is NOT inside the goal horizontally
    if (puck.x < (GOAL_POS_X - GOAL_WIDTH / 2) || puck.x > (GOAL_POS_X + GOAL_WIDTH / 2)) {
      puck.vy *= -1; // Bounce back
      puck.y = 800 - GOAL_DEPTH; // Prevent puck from sticking in wall
    }
  }

  const currentSide = room.puck.y < 400 ? 'top' : 'bottom'; // assuming 800px height

  if (room.puckSide !== currentSide) {
    // Puck crossed to the other side — reset timer
    room.puckSide = currentSide;
    room.puckSideTime = Date.now();

    const offender = Object.values(room.players).find(p => p.side !== currentSide);
      if (offender && offender.socket) {
        offender.socket.emit(
          'systemMessage',
          ``
        );
      }

  } else {
    // Check if puck has overstayed
    const HOLD_LIMIT = 8000; // 8 seconds
    const now = Date.now();
    const timeStayed = room.puckSideTime && now - room.puckSideTime;

    if (timeStayed > 3000) {
      const offender = Object.values(room.players).find(p => p.side === currentSide);
      if (offender && offender.socket) {
        offender.socket.emit(
          'systemMessage',
          `Don't stall! You will be penalized in ${Math.round((HOLD_LIMIT - timeStayed) / 1000)}s`
        );
      }
    }

    if (timeStayed > HOLD_LIMIT) {
      // Penalize by giving puck to the other player
      const offender = currentSide;
      const winner = offender === 'top' ? 'bottom' : 'top';

      io.to(room.id).emit(
        'chatMessage',
        `SYSTEM: ${offender.toUpperCase()} kept the puck too long! Possession given to ${winner.toUpperCase()}`
      );
      
      const offendingPlayer = Object.values(room.players).find(p => p.side === currentSide);
      if (offendingPlayer && offendingPlayer.socket) {
        offendingPlayer.socket.emit(
          'systemMessage',
          `You were penalized!`
        );
      }

      // Reset puck to the winner's side
      room.puck = {
        x: 300,
        y: winner === 'top' ? 375 : 425,
        vx: 0,
        vy: winner === 'top' ? -3: 3,
      };

      // Reset cooldowns and timers
      room.puckSide = null;
      room.puckSideTime = Date.now();
      room.warnedAboutStall = false;
    }
  }

  // Scoring
  if (
    puck.y + PUCK_RADIUS >= GOAL_POS_Y_BOTTOM &&
    puck.x >= GOAL_POS_X - GOAL_WIDTH / 2 &&
    puck.x <= GOAL_POS_X + GOAL_WIDTH / 2
  ) {
    room.scores.top++;
    io.to(room.id).emit('updateScore', room.scores);
    resetPuck(room, -1);
    return;
  }

  if (
    puck.y - PUCK_RADIUS <= GOAL_POS_Y_TOP &&
    puck.x >= GOAL_POS_X - GOAL_WIDTH / 2 &&
    puck.x <= GOAL_POS_X + GOAL_WIDTH / 2
  ) {
    room.scores.bottom++;
    io.to(room.id).emit('updateScore', room.scores);
    resetPuck(room, 1);
    return;
  }

  // Paddle collisions
  const players = Object.values(room.players);
  const spectators = Object.values(room.spectators);

  if (players.length === 2) {
    if (room.puckHitCooldown > 0) {
      room.puckHitCooldown--;
    } else {
      for (const player of players) {
        const dx = puck.x - player.pos.x;
        const dy = puck.y - player.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = 30 + PUCK_RADIUS; // paddleRadius + puckRadius
  
        if (dist < minDist) {
          const norm = { x: dx / dist, y: dy / dist };
          const overlap = minDist - dist;
      
          // Always push the puck out
          puck.x += norm.x * overlap;
          puck.y += norm.y * overlap;
      
          // Only apply new velocity if cooldown has expired
          // if (room.frameCount - player.lastHitFrame >= 4) {
            const relativeSpeed = player.vel.x * norm.x + player.vel.y * norm.y;
            const speed = Math.max(2, relativeSpeed);

            // Optionally boost the effect (so paddle hits feel stronger)
            const hitStrength = 3;
            puck.vx = norm.x * speed * hitStrength;
            puck.vy = norm.y * speed * hitStrength;
      
            room.puckHitCooldown = 3;
            player.lastHitFrame = room.frameCount;
          // }
          break;
        }
      }
    }
  }

  // Emit game state
  for (const player of players) {
    const opponent = players.find(p => p.id !== player.id);
    if (opponent) {
      player.socket.emit('update', {
        puck,
        opponentPos: opponent.pos
      });
    }
  }

  for (const spectator of spectators) {
    spectator.socket.emit('update', {
      puck,
      players: {
        top: getTopPlayer(room),
        bottom: getBottomPlayer(room),
      },
      scores: room.scores,

    })
  }
}

function getTopPlayer(room) {
  return extractPlayerData(Object.values(room.players).find(p => p.side === 'top'));
}

function getBottomPlayer(room) {
  return extractPlayerData(Object.values(room.players).find(p => p.side === 'bottom'));
}

function extractPlayerData(player) {
  if (!player) return null;
  return {
    id: player.id,
    pos: player.pos,
    vel: player.vel,
    side: player.side
  };
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('joinAsSpectator', (roomId) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('errorMessage', 'Room does not exist');
      return;
    }

    socket.join(roomId);
    // if (!room.spectators) room.spectators = [];
    room.spectators[socket.id] = { socket };

    socket.emit('initSpectator');
    socket.emit('statusMessage', 'Spectating game...');
    
    io.to(room.id).emit('chatMessage', `A spectator has joined the match.`);
  });

  // Different logic for joining quick matches but u still need the same room listers
  socket.on('joinQuickMatch', () => {
    console.log('Player requested quick match:', socket.id);
  
    // Find or create a room with fewer than 2 players
    let room = Object.values(rooms).find(r => !r.private && Object.keys(r.players).length < 2);
    if (!room) room = createRoom();  // creates a non-private room by default

  
    const side = Object.keys(room.players).length === 0 ? 'bottom' : 'top';
  
    room.players[socket.id] = {
      id: socket.id,
      socket,
      side,
      vel: { x: 0, y: 0 },
      pos: side === 'bottom' ? { x: 200, y: 700 } : { x: 200, y: 100 },
      lastHitFrame: -10 // NEW
    };
  
    socket.join(room.id);
    socket.emit('init', side);
    socket.emit('statusMessage', 'Waiting for opponent...');
  
    if (Object.keys(room.players).length === 2) {
      io.to(room.id).emit('statusMessage', 'Match found! Starting in 3...');
  
      let count = 3;
      const countdownInterval = setInterval(() => {
        if (count > 1) {
          count--;
          io.to(room.id).emit('statusMessage', `Starting in ${count}...`);
        } else {
          clearInterval(countdownInterval);
          io.to(room.id).emit('statusMessage', 'Game in progress');
          startGame(room);
        }
      }, 1000);
    }
  
    // Register per-room listeners (similar to joinRoom)
    socket.on('move', (pos) => {
      const player = room.players[socket.id];
      if (!player) return;
    
      const dx = pos.x - player.pos.x;
      const dy = pos.y - player.pos.y;
    
      const maxPaddleSpeed = 100;
      const limitedDx = Math.max(-maxPaddleSpeed, Math.min(maxPaddleSpeed, dx));
      const limitedDy = Math.max(-maxPaddleSpeed, Math.min(maxPaddleSpeed, dy));
    
      // Update velocity and position
      player.vel = { x: limitedDx, y: limitedDy };
      player.pos = pos;
    });

    socket.on('chatMessage', (msg) => {
      const player = room.players[socket.id];
      if (player) {
        io.to(room.id).emit('chatMessage', `${player.side.toUpperCase()}: ${msg}`);
      }
    });
  
    socket.on('disconnect', () => {
      console.log('Player disconnected:', socket.id);
      delete room.players[socket.id];
      if (Object.keys(room.players).length === 0) {
        clearInterval(room.gameLoop);
        delete rooms[room.id];
      } else {
        io.to(room.id).emit('playerLeft');
        io.to(room.id).emit('statusMessage', 'Opponent disconnected.');
      }
    });
  });

  socket.on('joinRoom', (roomId) => {
    roomId = roomId.toLowerCase();

    // Create room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        players: {},
        puck: { x: 200, y: 600, vx: 0, vy: 0 },
        scores: { top: 0, bottom: 0 },
        gameStartTime: null,
        gameLoop: null,
        puckHitCooldown: 0,
        private: true,
        spectators: {},
        puckSide: null,
      puckSideTime: null,
      };
    }

    const room = rooms[roomId];

    if (Object.keys(room.players).length >= 2) {
      socket.emit('full');
      return;
    }

    const side = Object.keys(room.players).length === 0 ? 'bottom' : 'top';
    room.players[socket.id] = {
      id: socket.id,
      socket,
      side,
      vel: { x: 0, y: 0 },
      pos: side === 'bottom' ? { x: 200, y: 700 } : { x: 200, y: 100 },
    };

    socket.join(roomId);
    socket.emit('init', side);

    if (Object.keys(room.players).length === 2) {
        io.to(room.id).emit('statusMessage', 'Match found! Starting in 3...');
    
        let count = 3;
        const countdownInterval = setInterval(() => {
          if (count > 1) {
            count--;
            io.to(room.id).emit('statusMessage', `Starting in ${count}...`);
          } else {
            clearInterval(countdownInterval);
            io.to(room.id).emit('statusMessage', 'Game in progress');
            startGame(room);
          }
        }, 1000);
    
    } else {
      socket.emit('statusMessage', 'Waiting for opponent...');
    }

    socket.on('move', (pos) => {
      const player = room.players[socket.id];
      if (!player) return;
    
      const dx = pos.x - player.pos.x;
      const dy = pos.y - player.pos.y;
    
      const maxPaddleSpeed = 100;
      const limitedDx = Math.max(-maxPaddleSpeed, Math.min(maxPaddleSpeed, dx));
      const limitedDy = Math.max(-maxPaddleSpeed, Math.min(maxPaddleSpeed, dy));
    
      // Update velocity and position
      player.vel = { x: limitedDx, y: limitedDy };
      player.pos = pos;
    });

    socket.on('chatMessage', (msg) => {
      const player = room.players[socket.id];
      if (player) {
        io.to(roomId).emit('chatMessage', `${player.side.toUpperCase()}: ${msg}`);
      }
    });

    socket.on('disconnect', () => {
      console.log('Player disconnected:', socket.id);
      delete room.players[socket.id];
      if (Object.keys(room.players).length === 0) {
        clearInterval(room.gameLoop);
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('statusMessage', 'Waiting for opponent...');
      }
    });
  });
});


server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
