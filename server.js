const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game } = require('./gameCore');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Store games. Room code mapped to Game object.
const games = {};

function generateRoomCode() {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < 4; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

io.on('connection', (socket) => {
    console.log('Player connected: ' + socket.id);
    let currentRoom = null;

    socket.on('joinRoom', ({ room, name, avatar }) => {
        room = (room || "").toUpperCase();
        if (!games[room]) {
            if (room.length === 4) {
                games[room] = new Game(room);
            } else {
                room = generateRoomCode();
                games[room] = new Game(room);
            }
        }

        const game = games[room];
        const added = game.addPlayer(socket.id, name || 'Guest', avatar);
        if (added) {
            currentRoom = room;
            socket.join(room);
            // Broadcast updated lobby to all players with their own perspective
            game.players.forEach(p => {
                io.to(p.id).emit('gameState', game.getState(p.id));
            });
            socket.emit('joined', room);
        } else {
            socket.emit('errorMsg', "Failed to join room. It might be full or already playing.");
        }
    });

    socket.on('toggleReady', () => {
        if (!currentRoom || !games[currentRoom]) return;
        const game = games[currentRoom];
        game.toggleReady(socket.id);
        game.players.forEach(p => {
            io.to(p.id).emit('gameState', game.getState(p.id));
        });
    });

    socket.on('startGame', () => {
        if (!currentRoom || !games[currentRoom]) return;
        const game = games[currentRoom];
        const me = game.players.find(p => p.id === socket.id);
        if (!me || !me.isHost) {
            socket.emit('errorMsg', "Only the host can start the game.");
            return;
        }
        if (game.start()) {
            // Send each player their role privately first for reveal animation
            game.players.forEach(p => {
                io.to(p.id).emit('roleReveal', { role: p.role, avatar: p.avatar });
            });
            // Slight delay then send full game state
            setTimeout(() => {
                game.players.forEach(p => {
                    io.to(p.id).emit('gameState', game.getState(p.id));
                });
            }, 2500);
        } else {
            socket.emit('errorMsg', "Cannot start game. Need at least 3 players and all non-host players must be ready.");
        }
    });

    socket.on('playCard', ({ cardId, opts }) => {
        if (!currentRoom || !games[currentRoom]) return;
        const game = games[currentRoom];
        const res = game.playCard(socket.id, cardId, opts);
        if (res.error) {
            socket.emit('errorMsg', res.error);
        } else {
            // Update everyone
            game.players.forEach(p => {
                io.to(p.id).emit('gameState', game.getState(p.id));
                if (p.mapReveal) {
                    io.to(p.id).emit('mapReveal', p.mapReveal);
                    p.mapReveal = null;
                } else if (p.privateMessage) {
                    io.to(p.id).emit('errorMsg', p.privateMessage);
                    p.privateMessage = null;
                }
            });
        }
    });

    socket.on('discardCard', ({ cardId }) => {
        if (!currentRoom || !games[currentRoom]) return;
        const game = games[currentRoom];
        const res = game.discardCard(socket.id, cardId);
        if (res.error) {
            socket.emit('errorMsg', res.error);
        } else {
            game.players.forEach(p => {
                io.to(p.id).emit('gameState', game.getState(p.id));
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected: ' + socket.id);
        if (currentRoom && games[currentRoom]) {
            const game = games[currentRoom];
            game.removePlayer(socket.id);
            if (game.players.length === 0) {
                delete games[currentRoom];
            } else {
                // Reassign host if the host left
                if (!game.players.find(p => p.isHost) && game.players.length > 0) {
                    game.players[0].isHost = true;
                }
                game.players.forEach(p => {
                    io.to(p.id).emit('gameState', game.getState(p.id));
                });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Saboteur Server running on port ${PORT}`);
});
