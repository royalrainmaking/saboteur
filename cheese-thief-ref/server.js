const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ─────────────────────────────────────────────
const ROLE_CONFIGS = {
  4: ['thief', 'good', 'good', 'good'],
  5: ['thief', 'henchman', 'good', 'good', 'good'],
  6: ['thief', 'henchman', 'good', 'good', 'good', 'good'],
  7: ['thief', 'henchman', 'good', 'good', 'good', 'good', 'good'],
  8: ['thief', 'henchman', 'good', 'good', 'good', 'good', 'good', 'good'],
  9: ['thief', 'henchman', 'good', 'good', 'good', 'good', 'good', 'good', 'good'],
  10: ['thief', 'henchman', 'good', 'good', 'good', 'good', 'good', 'good', 'good', 'good'],
  11: ['thief', 'henchman', 'good', 'good', 'good', 'good', 'good', 'good', 'good', 'good', 'good'],
  12: ['thief', 'henchman', 'good', 'good', 'good', 'good', 'good', 'good', 'good', 'good', 'good', 'good'],
};

// ─── Helpers ────────────────────────────────────────────────
const rooms = {};

function generateCode() {
  let c;
  do { c = Math.random().toString(36).substring(2, 7).toUpperCase(); } while (rooms[c]);
  return c;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sanitize: hide other players' roles/dice (except in result phase)
function sanitize(room, forId) {
  const isResult = room.phase === 'result';
  const me = room.players.find(p => p.id === forId);
  const amEvil = me && (me.role === 'thief' || me.role === 'henchman');

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    nightStep: room.nightStep,
    nightReadyCount: room.nightReadySet.size,
    totalPlayers: room.players.length,
    totalNightSteps: room.totalNightSteps || room.players.length,
    introReadyIds: room.introReadySet ? [...room.introReadySet] : [],
    cheeseHolderId: (isResult || amEvil) ? room.cheeseHolderId : null,
    isCheeseStolen: !!room.cheeseHolderId,
    dayEndTime: room.dayEndTime || null,
    votes: isResult ? room.votes : {},
    roundResult: room.roundResult,
    players: room.players.map(p => {
      let exposedRole = null;
      if (isResult) exposedRole = p.role;
      else if (p.id === forId) {
        // Surprise! Henchman thinks they are Good during intro
        if (room.phase === 'night' && room.nightStep === 0 && p.role === 'henchman') {
          exposedRole = 'good';
        } else {
          exposedRole = p.role;
        }
      }

      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar || null,
        ready: p.ready,
        connected: p.connected,
        hasVoted: p.hasVoted,
        nightReady: room.nightReadySet.has(p.id),
        introReady: room.introReadySet ? room.introReadySet.has(p.id) : false,
        votedFor: (isResult || room.phase === 'vote') ? p.votedFor : null,
        dice: isResult ? p.dice : (p.id === forId ? p.dice : null),
        role: exposedRole,
      };
    }),
  };
}

function broadcast(room) {
  room.players.forEach(p => {
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit('room_update', sanitize(room, p.id));
  });
}

// ─── Game Logic ─────────────────────────────────────────────
function startNight(room) {
  room.phase = 'night';
  room.nightStep = 0;
  room.cheeseHolderId = null;
  room.votes = {};
  room.roundResult = null;
  room.nightReadySet = new Set();
  room.introReadySet = new Set(); // tracks who confirmed the intro

  // Assign roles
  const config = ROLE_CONFIGS[room.players.length];
  const roles = shuffle(config);
  room.players.forEach((p, i) => { p.role = roles[i]; p.hasVoted = false; p.votedFor = null; });

  // ── Dice assignment ─────────────────────────────────────────
  // Evil team (thief + henchman) share ONE exclusive slot from 1-6.
  // Good players are distributed via round-robin across the remaining 5 slots,
  // guaranteeing:
  //   1. Every player wakes up (dice always 1-6, nightStep covers 1-6)
  //   2. No good player ever gets the evil slot (0 good players wake with thief)
  //   3. Balanced distribution (e.g. 10 good + 5 slots → exactly 2 per slot)
  const evilPlayers = room.players.filter(p => p.role !== 'good');
  const goodPlayers = room.players.filter(p => p.role === 'good');

  const evilDice = Math.floor(Math.random() * 6) + 1; // pick a random slot 1-6 for evil
  const goodSlots = shuffle([1, 2, 3, 4, 5, 6].filter(x => x !== evilDice)); // shuffled 5-slot pool

  // Round-robin pool: repeat goodSlots until we cover all good players, then shuffle
  const goodDicePool = shuffle(
    Array.from({ length: goodPlayers.length }, (_, i) => goodSlots[i % goodSlots.length])
  );

  evilPlayers.forEach(p => { p.dice = evilDice; });
  goodPlayers.forEach((p, i) => { p.dice = goodDicePool[i]; });

  room.uniqueDice = [...new Set(room.players.map(p => p.dice))].sort((a, b) => a - b);
  room.totalNightSteps = 6;

  broadcast(room);
  io.to(room.code).emit('night_start');
}

function advanceNightStep(room) {
  if (room.nightTimer) clearTimeout(room.nightTimer);
  room.nightStep++;
  room.nightReadySet = new Set();
  broadcast(room);

  if (room.nightStep > 6) {
    startDay(room); // Fully automate transition, skipping host confirmation
    return;
  }

  const activePlayers = room.players.filter(p => p.dice === room.nightStep);

  if (activePlayers.length === 0) {
    // No one wakes up this hour — wait random 7s to 12s to simulate human action
    const randomWait = Math.floor(Math.random() * (12000 - 7000 + 1)) + 7000;
    room.nightTimer = setTimeout(() => {
      if (room.phase === 'night') {
        advanceNightStep(room);
      }
    }, randomWait);
  } else {
    // Emit 'your_turn' only to active players
    activePlayers.forEach(ap => {
      const s = io.sockets.sockets.get(ap.id);
      if (!s) return;
      const isEvil = ap.role !== 'good';
      s.emit('your_turn', {
        role: ap.role,
        step: room.nightStep,
        awakePlayers: isEvil
          ? activePlayers.map(x => ({ id: x.id, name: x.name, role: x.role }))
          : activePlayers.map(x => ({ id: x.id, name: x.name, role: null })),
      });
    });
  }

  io.to(room.code).emit('night_step_change', {
    step: room.nightStep,
    count: activePlayers.length,
    activePlayerIds: activePlayers.map(p => p.id),
  });
}


function startDay(room) {
  // Skip straight to vote phase, unlimited voting time
  room.phase = 'vote';
  room.dayEndTime = null;
  broadcast(room);
}


function processVotes(room) {
  const tally = {};
  room.players.forEach(p => {
    if (p.votedFor) tally[p.votedFor] = (tally[p.votedFor] || 0) + 1;
  });
  room.votes = tally;

  let maxVotes = 0;
  let topIds = [];
  Object.entries(tally).forEach(([id, cnt]) => {
    if (cnt > maxVotes) { maxVotes = cnt; topIds = [id]; }
    else if (cnt === maxVotes) topIds.push(id);
  });

  const caughtId = topIds.length === 1 ? topIds[0] : null;
  const caught = caughtId ? room.players.find(p => p.id === caughtId) : null;
  const thief = room.players.find(p => p.role === 'thief');

  room.roundResult = {
    winner: caught && caught.role === 'thief' ? 'good' : 'thief',
    caughtId,
    thiefId: thief ? thief.id : null,
  };
  room.phase = 'result';
  room.cheeseHolderId = thief ? thief.id : null;
  broadcast(room);
}

// ─── Socket Events ──────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('+ Connected:', socket.id);

  // ── Create room ────────────────────────────────────────
  socket.on('create_room', ({ name, avatar }) => {
    if (!name?.trim()) return;
    const code = generateCode();
    rooms[code] = {
      code, hostId: socket.id,
      phase: 'lobby',
      nightStep: 0,
      cheeseHolderId: null,
      votes: {},
      roundResult: null,
      nightReadySet: new Set(),
      players: [{
        id: socket.id, name: name.trim(), avatar: avatar || null,
        ready: false, role: null, dice: null,
        hasVoted: false, votedFor: null, connected: true,
      }],
    };
    socket.join(code);
    socket.emit('room_created', { code });
    socket.emit('room_update', sanitize(rooms[code], socket.id));
    console.log(`Room ${code} created by ${name}`);
  });

  // ── Join room ──────────────────────────────────────────
  socket.on('join_room', ({ name, code, avatar }) => {
    const room = rooms[code?.toUpperCase()];
    if (!room) { socket.emit('error', { message: 'ไม่พบห้องนี้ กรุณาตรวจสอบรหัส' }); return; }
    if (room.phase !== 'lobby') { socket.emit('error', { message: 'เกมเริ่มไปแล้ว ไม่สามารถเข้าได้' }); return; }
    if (room.players.length >= 12) { socket.emit('error', { message: 'ห้องเต็มแล้ว (สูงสุด 12 คน)' }); return; }
    if (!name?.trim()) return;

    room.players.push({
      id: socket.id, name: name.trim(), avatar: avatar || null,
      ready: false, role: null, dice: null,
      hasVoted: false, votedFor: null, connected: true,
    });
    socket.join(code.toUpperCase());
    socket.emit('room_joined', { code: room.code });
    broadcast(room);
    console.log(`${name} joined ${room.code}`);
  });

  // ── Toggle ready (non-host) ────────────────────────────
  socket.on('toggle_ready', () => {
    for (const room of Object.values(rooms)) {
      const p = room.players.find(x => x.id === socket.id);
      if (p && room.phase === 'lobby' && socket.id !== room.hostId) {
        p.ready = !p.ready;
        broadcast(room);
        break;
      }
    }
  });

  // ── Start game (host) ──────────────────────────────────
  socket.on('start_game', () => {
    for (const room of Object.values(rooms)) {
      if (room.hostId === socket.id && room.phase === 'lobby') {
        if (room.players.length < 4) {
          socket.emit('error', { message: 'ต้องมีผู้เล่นอย่างน้อย 4 คน' }); return;
        }
        startNight(room);
        break;
      }
    }
  });

  // ── Night: player confirms intro screen ────────────────
  socket.on('intro_confirm', () => {
    for (const room of Object.values(rooms)) {
      const p = room.players.find(x => x.id === socket.id);
      if (p && room.phase === 'night' && room.nightStep === 0) {
        room.introReadySet.add(socket.id);
        broadcast(room); // live update for everyone
        // Once ALL connected players confirm, start night steps
        const connected = room.players.filter(x => x.connected);
        if (room.introReadySet.size >= connected.length) {
          advanceNightStep(room);
        }
        break;
      }
    }
  });

  // ── Night: host calls next step ─────────────────────────
  // Host presses "เรียกขั้นตอนถัดไป" to advance the night step
  socket.on('call_next_step', () => {
    for (const room of Object.values(rooms)) {
      if (room.hostId === socket.id && room.phase === 'night') {
        advanceNightStep(room);
        break;
      }
    }
  });

  // ── Night: awake player done with action → auto go next step ──
  socket.on('night_action_done', () => {
    for (const room of Object.values(rooms)) {
      const p = room.players.find(x => x.id === socket.id);
      if (p && room.phase === 'night') {
        room.nightReadySet.add(socket.id);

        // Wait until ALL currently awake players confirm
        const currentDice = room.nightStep;
        const awakePlayers = room.players.filter(x => x.dice === currentDice);
        const readyAwake = awakePlayers.filter(x => room.nightReadySet.has(x.id));

        if (readyAwake.length >= awakePlayers.length) {
          advanceNightStep(room);
        } else {
          broadcast(room); // Optional: if you want to notify state
        }
        break;
      }
    }
  });

  // ── Thief takes cheese ─────────────────────────────────
  socket.on('take_cheese', () => {
    for (const room of Object.values(rooms)) {
      const p = room.players.find(x => x.id === socket.id);
      if (p && room.phase === 'night' && p.role === 'thief') {
        room.cheeseHolderId = socket.id;
        socket.emit('cheese_taken', { success: true });
        broadcast(room);
        break;
      }
    }
  });

  // ── Good player peeks neighbor dice ───────────────────
  socket.on('peek_dice', ({ targetId }) => {
    for (const room of Object.values(rooms)) {
      const p = room.players.find(x => x.id === socket.id);
      if (p && room.phase === 'night' && p.role === 'good') {
        // Block peek when multiple good players share this wake-up step
        const coAwake = room.players.filter(x => x.dice === room.nightStep);
        if (coAwake.length > 1) break; // more than 1 person awake → no peek allowed
        const target = room.players.find(x => x.id === targetId);
        if (target) {
          socket.emit('peek_result', { targetId, targetName: target.name, dice: target.dice });
        }
        break;
      }
    }
  });

  // ── Night end → start day ──────────────────────────────
  socket.on('end_night', () => {
    for (const room of Object.values(rooms)) {
      if (room.hostId === socket.id && room.phase === 'night') {
        startDay(room);
        break;
      }
    }
  });

  // ── Chat ───────────────────────────────────────────────
  socket.on('chat_message', ({ message }) => {
    for (const room of Object.values(rooms)) {
      const p = room.players.find(x => x.id === socket.id);
      if (p && ['lobby', 'day'].includes(room.phase)) {
        const msg = {
          id: uuidv4(),
          playerId: socket.id,
          playerName: p.name,
          message: String(message).substring(0, 200),
          timestamp: Date.now(),
        };
        io.to(room.code).emit('chat', msg);
        break;
      }
    }
  });

  // ── Cast vote ──────────────────────────────────────────
  socket.on('cast_vote', ({ targetId }) => {
    for (const room of Object.values(rooms)) {
      const p = room.players.find(x => x.id === socket.id);
      if (p && room.phase === 'vote' && !p.hasVoted && targetId !== socket.id) {
        const target = room.players.find(x => x.id === targetId);
        if (target) {
          p.hasVoted = true;
          p.votedFor = targetId;
          broadcast(room);
          if (room.players.every(x => x.hasVoted)) processVotes(room);
        }
        break;
      }
    }
  });

  // ── Play again (host) ──────────────────────────────────
  socket.on('play_again', () => {
    for (const room of Object.values(rooms)) {
      if (room.hostId === socket.id && room.phase === 'result') {
        room.phase = 'lobby';
        room.players.forEach(p => { p.ready = false; p.role = null; p.dice = null; p.hasVoted = false; p.votedFor = null; });
        room.votes = {}; room.roundResult = null; room.cheeseHolderId = null;
        room.nightReadySet = new Set();
        broadcast(room);
        break;
      }
    }
  });

  // ── Leave / Kick ─────────────────────────────────────────
  function hardRemovePlayer(targetId, emitEvent) {
    for (const room of Object.values(rooms)) {
      const pIndex = room.players.findIndex(x => x.id === targetId);
      if (pIndex !== -1) {
        room.players.splice(pIndex, 1);
        if (room.hostId === targetId && room.players.length > 0) {
          room.hostId = room.players[0].id;
        }
        io.to(targetId).emit(emitEvent);
        if (room.players.length === 0) {
          delete rooms[room.code];
        } else {
          broadcast(room);
        }
        break;
      }
    }
  }

  socket.on('leave_room', () => {
    hardRemovePlayer(socket.id, 'left_room');
  });

  socket.on('kick_player', ({ targetId }) => {
    for (const room of Object.values(rooms)) {
      if (room.hostId === socket.id && room.phase === 'lobby') {
        hardRemovePlayer(targetId, 'kicked');
        break;
      }
    }
  });

  // ── Disconnect ─────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('- Disconnected:', socket.id);
    for (const room of Object.values(rooms)) {
      const p = room.players.find(x => x.id === socket.id);
      if (p) {
        p.connected = false;
        broadcast(room);
        setTimeout(() => {
          if (!p.connected) {
            room.players = room.players.filter(x => x.id !== socket.id);
            if (room.hostId === socket.id && room.players.length > 0) {
              room.hostId = room.players[0].id;
            }
            if (room.players.length === 0) {
              delete rooms[room.code];
              console.log(`Room ${room.code} deleted`);
            } else {
              broadcast(room);
            }
          }
        }, 30000);
        break;
      }
    }
  });
});

// ─── Start ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🧀 Cheese Thief running on http://localhost:${PORT}`));
