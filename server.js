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

// --- Socket.IO Game Logic ---
io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // Example: Listen for a player moving
  socket.on('playerMovement', (movementData) => {
    // Broadcast the movement to all other players
    socket.broadcast.emit('playerMoved', { id: socket.id, ...movementData });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // Emit an event to all other clients that this player has disconnected
    io.emit('playerDisconnected', socket.id);
  });
});

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
