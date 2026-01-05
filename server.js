const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const path = require('path');

const PORT = process.env.PORT || 8081;

// Serve the 'public' folder where your HTML/JS files live
app.use(express.static(path.join(__dirname, 'public')));

let players = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Initial state for new player
    players[socket.id] = {
        x: 100,
        y: 450,
        playerId: socket.id,
        health: 100,
        score: 0
    };

    // Send current players list to the NEW connection
    socket.emit('currentPlayers', players);

    // Tell OTHERS a new player joined
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // Handle movement synchronization
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // Handle shooting events
    socket.on('shoot', (bulletData) => {
        socket.broadcast.emit('enemyShot', bulletData);
    });

    // Handle disconnects
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete players[socket.id];
        io.emit('disconnectPlayer', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Game server running on port ${PORT}`);
});