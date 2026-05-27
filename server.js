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
// Disconnect timeouts mapped as { [roomCode]: { [userId]: timeoutRef } }
const disconnectTimeouts = {};

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

    socket.on('joinRoom', ({ room, name, avatar, userId }) => {
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
        const added = game.addPlayer(socket.id, name || 'Guest', avatar, userId);
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
            // Broadcast animation event first if actionDetails present
            if (res.actionDetails) {
                io.to(currentRoom).emit('actionAnimation', res.actionDetails);
            }
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
            if (res.actionDetails) {
                io.to(currentRoom).emit('actionAnimation', res.actionDetails);
            }
            game.players.forEach(p => {
                io.to(p.id).emit('gameState', game.getState(p.id));
            });
        }
    });

    socket.on('reconnectPlayer', ({ room, userId }) => {
        room = (room || "").toUpperCase();
        if (!games[room]) {
            socket.emit('errorMsg', "ไม่พบห้องดังกล่าวหรือเกมสิ้นสุดไปแล้ว");
            return;
        }

        const game = games[room];
        const player = game.players.find(p => p.userId === userId);

        if (player) {
            // Clear reconnection timeout if active
            if (disconnectTimeouts[room] && disconnectTimeouts[room][userId]) {
                clearTimeout(disconnectTimeouts[room][userId]);
                delete disconnectTimeouts[room][userId];
            }

            // Update player socket association
            player.id = socket.id;
            player.connected = true;

            currentRoom = room;
            socket.join(room);

            socket.emit('joined', room);
            game.addLog(`⚡ ${player.name} กลับเข้าสู่เกม`);

            game.players.forEach(p => {
                io.to(p.id).emit('gameState', game.getState(p.id));
            });
            console.log(`Player reconnected: ${player.name} (${socket.id}) to room ${room}`);
        } else {
            socket.emit('errorMsg', "คุณไม่ได้อยู่ในห้องดังกล่าวแล้ว");
        }
    });

    socket.on('leaveRoom', () => {
        if (currentRoom && games[currentRoom]) {
            const game = games[currentRoom];
            if (game.status === 'lobby') {
                game.removePlayer(socket.id);
                socket.leave(currentRoom);
                
                if (game.players.length === 0) {
                    delete games[currentRoom];
                } else {
                    if (!game.players.find(p => p.isHost) && game.players.length > 0) {
                        game.players[0].isHost = true;
                    }
                    game.players.forEach(p => {
                        io.to(p.id).emit('gameState', game.getState(p.id));
                    });
                }
                currentRoom = null;
            }
        }
    });

    socket.on('kickPlayer', ({ targetPlayerId }) => {
        if (currentRoom && games[currentRoom]) {
            const game = games[currentRoom];
            const me = game.players.find(p => p.id === socket.id);
            
            if (me && me.isHost && game.status === 'lobby') {
                const targetPlayer = game.players.find(p => p.id === targetPlayerId);
                if (targetPlayer) {
                    io.to(targetPlayerId).emit('kicked');
                    game.removePlayer(targetPlayerId);
                    
                    const targetSocket = io.sockets.sockets.get(targetPlayerId);
                    if (targetSocket) {
                        targetSocket.leave(currentRoom);
                    }
                    
                    game.players.forEach(p => {
                        io.to(p.id).emit('gameState', game.getState(p.id));
                    });
                    console.log(`Player kicked: ${targetPlayer.name} by host ${me.name} in room ${currentRoom}`);
                }
            }
        }
    });

    socket.on('startNextRound', () => {
        if (!currentRoom || !games[currentRoom]) return;
        const game = games[currentRoom];
        const me = game.players.find(p => p.id === socket.id);
        
        if (me && me.isHost && game.status === 'finished' && game.round < 3) {
            if (game.startNextRound()) {
                // Emit new role reveals for the new round
                game.players.forEach(p => {
                    io.to(p.id).emit('roleReveal', { role: p.role, avatar: p.avatar });
                });
                
                // Delay 2.5s and emit new gamestate
                setTimeout(() => {
                    game.players.forEach(p => {
                        io.to(p.id).emit('gameState', game.getState(p.id));
                    });
                }, 2500);
            }
        }
    });

    socket.on('returnToLobby', () => {
        if (!currentRoom || !games[currentRoom]) return;
        const game = games[currentRoom];
        const me = game.players.find(p => p.id === socket.id);
        
        if (me && me.isHost && game.status === 'finished') {
            if (game.returnToLobby()) {
                game.players.forEach(p => {
                    io.to(p.id).emit('gameState', game.getState(p.id));
                });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected: ' + socket.id);
        if (currentRoom && games[currentRoom]) {
            const game = games[currentRoom];
            const player = game.players.find(p => p.id === socket.id);
            
            if (player) {
                const userId = player.userId;
                game.removePlayer(socket.id); // Marks offline if playing, removes if lobby

                if (game.status === 'playing' || game.status === 'finished') {
                    // Update state so players see offline indicator
                    game.players.forEach(p => {
                        io.to(p.id).emit('gameState', game.getState(p.id));
                    });

                    // Set 2-minute kick timeout (120,000 ms)
                    if (!disconnectTimeouts[currentRoom]) disconnectTimeouts[currentRoom] = {};
                    if (disconnectTimeouts[currentRoom][userId]) {
                        clearTimeout(disconnectTimeouts[currentRoom][userId]);
                    }

                    disconnectTimeouts[currentRoom][userId] = setTimeout(() => {
                        if (games[currentRoom]) {
                            const g = games[currentRoom];
                            const pl = g.players.find(p => p.userId === userId);
                            if (pl && !pl.connected) {
                                g.removePlayerByUserId(userId);
                                
                                // Clean up room if no connected players left
                                const activePlayers = g.players.filter(p => p.connected);
                                if (activePlayers.length === 0) {
                                    delete games[currentRoom];
                                    delete disconnectTimeouts[currentRoom];
                                } else {
                                    // Reassign host if host left
                                    if (!g.players.find(p => p.isHost) && g.players.length > 0) {
                                        g.players[0].isHost = true;
                                    }
                                    g.players.forEach(p => {
                                        io.to(p.id).emit('gameState', g.getState(p.id));
                                    });
                                }
                            }
                        }
                    }, 120000);
                } else {
                    // Lobby phase disconnect
                    if (game.players.length === 0) {
                        delete games[currentRoom];
                    } else {
                        if (!game.players.find(p => p.isHost) && game.players.length > 0) {
                            game.players[0].isHost = true;
                        }
                        game.players.forEach(p => {
                            io.to(p.id).emit('gameState', game.getState(p.id));
                        });
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Saboteur Server running on port ${PORT}`);
});
