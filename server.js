const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Deployment Port: Render/Heroku will provide a PORT, otherwise use 3000
const PORT = process.env.PORT || 3000;

// --- Middleware & Static Routing ---
// Serves images, scripts, and CSS from the /public folder
app.use(express.static(__dirname + '/public'));
app.use(express.json()); // For parsing application/json

// Landing Page (default)
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Game Page
app.get('/game', (req, res) => {
  res.sendFile(__dirname + '/public/game.html');
});

// --- Leaderboard (In-Memory) ---
// Mock data to start with
let leaderboard = [
    { name: 'Speed', score: 1000, date: '2023-10-27' },
    { name: 'BoxMaster', score: 900, date: '2023-10-26' },
    { name: 'Hunter', score: 950, date: '2023-10-25' },
    { name: 'Pixel', score: 800, date: '2023-10-24' },
    { name: 'Void', score: 600, date: '2023-10-23' }
];

app.get('/api/leaderboard', (req, res) => {
    // Sort by score descending
    const sorted = leaderboard.sort((a, b) => b.score - a.score).slice(0, 10);
    res.json(sorted);
});

app.post('/api/submit-score', (req, res) => {
    const { name, score } = req.body;
    if (!name || score === undefined) {
        return res.status(400).json({ error: 'Name and score are required' });
    }
    
    leaderboard.push({
        name: name.substring(0, 15), // Limit name length
        score: parseInt(score),
        date: new Date().toISOString().split('T')[0]
    });
    
    // Keep top 50 only to prevent memory leak over long time (though it's just in-memory)
    if (leaderboard.length > 50) {
        leaderboard.sort((a, b) => b.score - a.score);
        leaderboard = leaderboard.slice(0, 50);
    }
    
    res.json({ success: true, rank: leaderboard.length });
});

// Centralized store for all active player data
const players = {};

// --- Socket.IO Event Handling ---
io.on('connection', (socket) => {
  console.log(`User Joined: ${socket.id}`);

  // Initialize player state on the server
  players[socket.id] = {
    x: Math.floor(Math.random() * 700) + 50,
    y: 450,
    playerId: socket.id,
    health: 100,
  };
  
  // STEP 1: Sync the new player with existing world state
  socket.emit('currentPlayers', players);
  
  // STEP 2: Notify everyone else that a new challenger has appeared
  socket.broadcast.emit('newPlayer', players[socket.id]);

  // Handle Movement Updates (Relay to others)
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      // broadcast.emit saves bandwidth by not sending your own coords back to you
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  // Handle Projectiles (Relay to others)
  socket.on('playerShoots', (bulletData) => {
    socket.broadcast.emit('bulletFired', bulletData);
  });

  // AUTHORITATIVE HEALTH LOGIC:
  // We process damage here so all players see the exact same health values.
  socket.on('playerHit', (hitData) => {
    const targetId = hitData.playerId;
    if (players[targetId]) {
      players[targetId].health -= 5;
      
      if (players[targetId].health <= 0) {
        console.log(`Elimination: ${targetId}`);
        // You could add logic here to reset their health or track a death count
      }
      
      // io.emit (everyone) ensures the victim AND the shooter see the health drop
      io.emit('playerWasHit', { 
        playerId: targetId, 
        health: players[targetId].health 
      });
    }
  });

  // Cleanup on Exit
  socket.on('disconnect', () => {
    console.log(`User Left: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Game Server running on port ${PORT}`);
});