let socket = null;
let playerPos = { x: 200, y: 700 };
let opponentPos = { x: 200, y: 100 };
let puck = { x: 200, y: 600 };
let side = 'bottom';
let gameActive = true;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreboard = document.getElementById('scoreboard');
const statusMessage = document.getElementById('status-message');
const systemMessage = document.getElementById('system-message');
const timerEl = document.getElementById('timer');
const chatBox = document.getElementById('chat-box');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

let isSpectator = false;

const backBtn = document.getElementById('back-btn');

backBtn.addEventListener('click', () => {
  if (socket) {
    socket.disconnect();  // Leave the game room on server
  }
  // Show landing screen, hide game screen
  document.getElementById('landing-screen').style.display = 'block';
  document.getElementById('game-screen').style.display = 'none';

  // Reset any game UI state here if needed
});


// Initially disabled, enable if waiting for opponent (game not started)
function updateBackButton(statusMsg) {
  if (statusMsg === 'Waiting for opponent...') {
    backBtn.disabled = false;
  } else {
    backBtn.disabled = true;
  }
}


// Triggered when user clicks "Watch Game" (e.g., from a lobby or URL)
document.getElementById('watch-btn')?.addEventListener('click', () => {
  const roomCode = document.getElementById('room-code-input').value.trim().toLowerCase();
  if (roomCode) {
    socket = io();
    socket.emit('joinAsSpectator', roomCode);
    setupSocketHandlers();
    isSpectator = true;
    document.getElementById('landing-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
  }
});

document.getElementById('create-btn').addEventListener('click', () => {
  const roomCode = generateRoomCode();
  joinRoom(roomCode, true);
});

document.getElementById('join-btn').addEventListener('click', () => {
  const code = document.getElementById('room-code-input').value.trim().toLowerCase();
  if (code) joinRoom(code);
});

function copyRoomCode() {
  const text = document.getElementById('room-code-display').textContent.replace('Your Lobby Code: ', '');
  navigator.clipboard.writeText(text).then(() => {
    alert('Lobby code copied to clipboard!');
  });
}

function joinRoom(code, isCreator = false) {
  document.getElementById('landing-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'block';

  socket = io();

  socket.emit('joinRoom', code);

  setupSocketHandlers();

  if (isCreator) {
    console.log(code);
    const display = document.getElementById('room-code-display');
    display.textContent = `Your Lobby Code: ${code.toUpperCase()}`;
  }
}


function generateRoomCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Start the game only when Play is clicked
document.getElementById('play-btn').addEventListener('click', () => {
  document.getElementById('landing-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'block';

  socket = io();
  socket.emit('joinQuickMatch');

  setupSocketHandlers();
});

// Setup all socket listeners
function setupSocketHandlers() {
  socket.on('connect', () => {
    console.log('Connected to server');
  });

  socket.on('initSpectator', () => {
    isSpectator = true;
    statusMessage.textContent = 'Spectating game...';
  });

  socket.on('init', (playerSide) => {
    side = playerSide;
    if (side === 'top') {
      playerPos = { x: 200, y: 100 };
      opponentPos = { x: 200, y: 700 };
    }
  });

  socket.on('update', (gameState) => {
    if (isSpectator) {
        // Handle rendering puck, players, scores
      puck = gameState.puck;
      const { top, bottom } = gameState.players;
      playerPos = top.pos;
      opponentPos = bottom.pos;
      draw();
    }
    else {
      opponentPos = gameState.opponentPos;
      puck = gameState.puck;
      draw();
    }
  });

  socket.on('updateScore', ({ top, bottom }) => {
    scoreboard.textContent = `TOP: ${top}   |   BOTTOM: ${bottom}`;
  });

  socket.on('statusMessage', (msg) => {
    statusMessage.textContent = msg;
    updateBackButton(msg);
  });

  socket.on('systemMessage', (msg) => {
    systemMessage.textContent = msg;
  });

  socket.on('timer', (msRemaining) => {
    const seconds = Math.floor(msRemaining / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  });

  socket.on('gameOver', (finalScores) => {
    gameActive = false;
    alert(`Game Over!\nFinal Scores:\nTOP: ${finalScores.top}\nBOTTOM: ${finalScores.bottom}`);
  
    location.reload();
  });
  
  socket.on('playerLeft', () => {
    alert('Your opponent has left the match.');
    
    location.reload();
  });

  socket.on('chatMessage', (data) => {
    const div = document.createElement('div');
    div.textContent = data;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
  });

  // Mouse movement listener (must be inside setup so it doesn't run without socket)
  canvas.addEventListener('mousemove', (e) => {
    if (!gameActive || isSpectator) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (side === 'top' && mouseY <= canvas.height / 2 - PADDLE_RADIUS) {
      playerPos.x = mouseX;
      playerPos.y = mouseY;
    }
    if (side === 'bottom' && mouseY >= canvas.height / 2 + PADDLE_RADIUS) {
      playerPos.x = mouseX;
      playerPos.y = mouseY;
    }

    socket.emit('move', playerPos);
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (message) {
      socket.emit('chatMessage', message);
      chatInput.value = '';
    }
  });
}

// Drawing logic
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Midline
  ctx.strokeStyle = '#555';
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();

  // Goal semi-circles
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 2;

  // Top goal semi-circle (facing downward)
  ctx.beginPath();
  ctx.arc(canvas.width / 2, 0, 80, 0, Math.PI, false); // semi-circle from left to right
  ctx.stroke();

  // Bottom goal semi-circle (facing upward)
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height, 80, Math.PI, 0, false); // semi-circle from right to left
  ctx.stroke();

  // Center circle
  ctx.strokeStyle = '#888';
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, 60, 0, Math.PI * 2);
  ctx.stroke();

  // Full game border
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);

  // Gray-out top goal area
  ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
  ctx.fillRect((canvas.width - GOAL_WIDTH) / 2, 0, GOAL_WIDTH, GOAL_DEPTH);

  // Gray-out bottom goal area
  ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
  ctx.fillRect((canvas.width - GOAL_WIDTH) / 2, canvas.height - GOAL_DEPTH, GOAL_WIDTH, GOAL_DEPTH);


  // Paddles
  ctx.fillStyle = 'red';
  ctx.beginPath();
  ctx.arc(playerPos.x, playerPos.y, PADDLE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(opponentPos.x, opponentPos.y, PADDLE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Goals
  // ctx.fillStyle = 'white';
  // ctx.fillRect(GOAL_POS_X - 50, GOAL_POS_Y_TOP, GOAL_WIDTH, GOAL_DEPTH); // top
  // ctx.fillRect(GOAL_POS_X - 50, GOAL_POS_Y_BOTTOM - GOAL_DEPTH, GOAL_WIDTH, GOAL_DEPTH); // bottom

  // Puck
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(puck.x, puck.y, PUCK_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}
