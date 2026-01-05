const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// The port Render will use, with a fallback for local development
const PORT = process.env.PORT || 3000;

// --- Static File Serving ---
// This is the key change: Serve all files from the project's 'public' directory.
app.use(express.static(__dirname + '/public'));

// Serve index.html as the main page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

const players = {};

// --- Socket.IO Game Logic ---
io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // Create a new player and add it to the players object
  players[socket.id] = {
    x: Math.floor(Math.random() * 700) + 50,
    y: 450,
    playerId: socket.id,
    health: 100, // Add health property
  };
  
  // Send the players object to the new player
  socket.emit('currentPlayers', players);
  
  // Update all other players of the new player
  socket.broadcast.emit('newPlayer', players[socket.id]);

  // Listen for player movement
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      // Broadcast the movement to all other players
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  // Listen for shooting event
  socket.on('playerShoots', (bulletData) => {
    socket.broadcast.emit('bulletFired', bulletData);
  });

  // Listen for when a player is hit
  socket.on('playerHit', (hitData) => {
    if (players[hitData.playerId]) {
      players[hitData.playerId].health -= 10;
      if (players[hitData.playerId].health <= 0) {
        // Handle player death if necessary
        console.log(`${hitData.playerId} has been eliminated.`);
      }
      // Broadcast the hit and updated health to all clients
      io.emit('playerWasHit', { 
        playerId: hitData.playerId, 
        health: players[hitData.playerId].health 
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // Remove this player from our players object
    delete players[socket.id];
    // Emit a message to all other players to remove this player
    io.emit('playerDisconnected', socket.id);
  });
});

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
