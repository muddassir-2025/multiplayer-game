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

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
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
      players[targetId].health -= 10;
      
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