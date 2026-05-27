const { v4: uuidv4 } = require('uuid');

// Exit indices: [N, E, S, W] = [0, 1, 2, 3]
const AVATARS = ['🧔', '🧙‍♂️', '👨‍🔧', '👩‍🔧', '👷‍♂️', '👷‍♀️', '🧝‍♂️', '🧨', '💎', '⛏️'];

const DECK_COMPOSITION = {
    paths: [
        { exits: [1, 1, 1, 1], deadEnd: false, count: 5 },
        { exits: [1, 0, 1, 0], deadEnd: false, count: 4 },
        { exits: [0, 1, 0, 1], deadEnd: false, count: 4 },
        { exits: [1, 1, 0, 0], deadEnd: false, count: 5 },
        { exits: [0, 1, 1, 0], deadEnd: false, count: 5 },
        { exits: [0, 0, 1, 1], deadEnd: false, count: 5 },
        { exits: [1, 0, 0, 1], deadEnd: false, count: 5 },
        { exits: [1, 1, 1, 0], deadEnd: false, count: 5 },
        { exits: [0, 1, 1, 1], deadEnd: false, count: 5 },
        { exits: [1, 0, 1, 1], deadEnd: false, count: 5 },
        { exits: [1, 1, 0, 1], deadEnd: false, count: 5 },
        // Dead-ends
        { exits: [1, 1, 1, 1], deadEnd: true, count: 1 },
        { exits: [1, 0, 1, 0], deadEnd: true, count: 1 },
        { exits: [0, 1, 0, 1], deadEnd: true, count: 1 },
        { exits: [1, 1, 0, 0], deadEnd: true, count: 1 },
        { exits: [0, 1, 1, 0], deadEnd: true, count: 1 },
        { exits: [0, 0, 1, 1], deadEnd: true, count: 1 },
        { exits: [1, 0, 0, 1], deadEnd: true, count: 1 },
        { exits: [1, 1, 1, 0], deadEnd: true, count: 1 },
        { exits: [0, 1, 1, 1], deadEnd: true, count: 1 },
        { exits: [1, 0, 1, 1], deadEnd: true, count: 1 },
        { exits: [1, 1, 0, 1], deadEnd: true, count: 1 },
    ],
    actions: [
        { type: 'map', target: null, count: 6 },
        { type: 'rockfall', target: null, count: 3 },
        { type: 'break', target: 'pickaxe', count: 3 },
        { type: 'break', target: 'lantern', count: 3 },
        { type: 'break', target: 'cart', count: 3 },
        { type: 'fix', target: 'pickaxe', count: 2 },
        { type: 'fix', target: 'lantern', count: 2 },
        { type: 'fix', target: 'cart', count: 2 },
        { type: 'fix', target: 'pickaxe_lantern', count: 1 },
        { type: 'fix', target: 'pickaxe_cart', count: 1 },
        { type: 'fix', target: 'lantern_cart', count: 1 },
    ]
};

// Saboteur counts by player count (official rules)
// Saboteur counts by player count (official rules)
const SABOTEUR_COUNTS = { 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };

const ROLE_POOLS = {
    3: { saboteurs: 1, miners: 3 }, // 4 cards, deal 3
    4: { saboteurs: 1, miners: 4 }, // 5 cards, deal 4
    5: { saboteurs: 2, miners: 4 }, // 6 cards, deal 5
    6: { saboteurs: 2, miners: 5 }, // 7 cards, deal 6
    7: { saboteurs: 3, miners: 5 }, // 8 cards, deal 7
    8: { saboteurs: 3, miners: 6 }, // 9 cards, deal 8
    9: { saboteurs: 3, miners: 7 }, // 10 cards, deal 9
    10: { saboteurs: 4, miners: 7 } // 11 cards, deal 10
};

// Neighbor directions: [dx, dy, exitOut, exitIn]
const DIRS = [
    { dx: 0, dy: -1, eOut: 0, eIn: 2 }, // North
    { dx: 1, dy: 0, eOut: 1, eIn: 3 }, // East
    { dx: 0, dy: 1, eOut: 2, eIn: 0 }, // South
    { dx: -1, dy: 0, eOut: 3, eIn: 1 }, // West
];

class Game {
    constructor(id) {
        this.id = id;
        this.players = [];
        this.status = 'lobby'; // 'lobby' | 'playing' | 'finished'
        this.deck = [];
        this.board = {};       // key "x,y" => cell object
        this.currentTurnIdx = 0;
        this.winner = null;    // 'miners' | 'saboteurs'
        this.messages = [];
        this.lastDiscard = null;
        this._warnedDeckEmpty = false;
        
        // Multi-round state
        this.round = 1;
        this.roundWinnerId = null;
        this.roundGoldDrawn = [];
        this.roundGoldDistribution = {};
        this.goldDeck = [];
        this._initGoldDeck();
    }

    _initGoldDeck() {
        this.goldDeck = [
            3, 3, 3, 3, 3, 3, 3, 3, 
            2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
        ];
        // Fisher-Yates Shuffle
        for (let i = this.goldDeck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.goldDeck[i], this.goldDeck[j]] = [this.goldDeck[j], this.goldDeck[i]];
        }
    }

    // ─── Lobby ────────────────────────────────────────────────────────────────

    addPlayer(socketId, name, avatar, userId) {
        if (this.status !== 'lobby') return false;
        if (this.players.length >= 10) return false;

        this.players.push({
            id: socketId,
            userId: userId || socketId,
            name,
            avatar: avatar || AVATARS[this.players.length % AVATARS.length],
            isHost: this.players.length === 0,
            isReady: false,
            role: null,
            hand: [],
            brokenTools: { pickaxe: false, lantern: false, cart: false },
            connected: true,
            goldHistory: [],
            goldTotal: 0
        });
        return true;
    }

    toggleReady(socketId) {
        const p = this.players.find(pl => pl.id === socketId);
        if (p && !p.isHost) p.isReady = !p.isReady;
    }

    removePlayer(socketId) {
        const pIdx = this.players.findIndex(p => p.id === socketId);
        if (pIdx === -1) return;

        const player = this.players[pIdx];

        if (this.status === 'playing' || this.status === 'finished') {
            player.connected = false;
            this.addLog(`🔌 ${player.name} หลุดการเชื่อมต่อ`);
            return;
        }

        this.players.splice(pIdx, 1);
        
        if (this.players.length === 0) {
            this.status = 'finished';
            return;
        }

        // Reassign host if the host left in lobby
        if (this.status === 'lobby' && !this.players.find(p => p.isHost) && this.players.length > 0) {
            this.players[0].isHost = true;
        }
    }

    removePlayerByUserId(userId) {
        const pIdx = this.players.findIndex(p => p.userId === userId);
        if (pIdx === -1) return;

        const player = this.players[pIdx];
        this.addLog(`❌ ${player.name} ขาดการเชื่อมต่อนานเกิน 2 นาทีและถูกเตะออกจากเกม`);

        this.players.splice(pIdx, 1);
        
        if (this.players.length === 0) {
            this.status = 'finished';
            return;
        }

        if (this.status === 'playing') {
            if (this._checkSaboteurWin()) return;

            if (pIdx < this.currentTurnIdx) {
                this.currentTurnIdx--;
            } else if (pIdx === this.currentTurnIdx) {
                this.currentTurnIdx = this.currentTurnIdx % this.players.length;
                if (this.players.length > 0 && this.players[this.currentTurnIdx].hand.length === 0) {
                    this.currentTurnIdx = (this.currentTurnIdx - 1 + this.players.length) % this.players.length;
                    this._nextTurn();
                }
            }
        }
    }

    // ─── Game Start ───────────────────────────────────────────────────────────

    start() {
        if (this.players.length < 3) return false;

        // All non-host players must be ready
        const nonHosts = this.players.filter(p => !p.isHost);
        if (nonHosts.length > 0 && !nonHosts.every(p => p.isReady)) return false;

        this.status = 'playing';
        this._assignRoles();
        this._buildDeck();
        this._dealHands();
        this._initBoard();
        this.currentTurnIdx = Math.floor(Math.random() * this.players.length);
        this.addLog(`🎮 เกมเริ่มแล้ว! ถึงคิวของ ${this.players[this.currentTurnIdx].name}`);
        return true;
    }

    _assignRoles() {
        const poolCfg = ROLE_POOLS[this.players.length] || { saboteurs: 1, miners: this.players.length };
        const pool = [
            ...Array(poolCfg.saboteurs).fill('saboteur'),
            ...Array(poolCfg.miners).fill('miner')
        ];
        // Fisher-Yates shuffle
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        // Deal roles to players (leaving 1 card face down)
        this.players.forEach((p, i) => p.role = pool[i]);
    }

    _buildDeck() {
        this.deck = [];
        for (const p of DECK_COMPOSITION.paths) {
            for (let i = 0; i < p.count; i++) {
                this.deck.push({ type: 'path', exits: p.exits.slice(), deadEnd: p.deadEnd, id: uuidv4() });
            }
        }
        for (const a of DECK_COMPOSITION.actions) {
            for (let i = 0; i < a.count; i++) {
                this.deck.push({ type: 'action', actionType: a.type, target: a.target, id: uuidv4() });
            }
        }
        // Double-shuffle for better randomness
        for (let pass = 0; pass < 2; pass++) {
            for (let i = this.deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
            }
        }
    }

    _dealHands() {
        const n = this.players.length;
        const handSize = n >= 8 ? 4 : n >= 6 ? 5 : 6;
        for (const p of this.players) {
            for (let i = 0; i < handSize; i++) p.hand.push(this.deck.pop());
        }
    }

    _initBoard() {
        this.board = {
            '0,0': { type: 'path', exits: [1, 1, 1, 1], deadEnd: false, isStart: true }
        };
        const goals = ['gold', 'coal', 'coal'];
        // Shuffle goal positions
        for (let i = goals.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [goals[i], goals[j]] = [goals[j], goals[i]];
        }
        this.board['8,-2'] = { type: 'path', isGoal: true, goalType: goals[0], faceDown: true, exits: [1, 1, 1, 1], deadEnd: false };
        this.board['8,0'] = { type: 'path', isGoal: true, goalType: goals[1], faceDown: true, exits: [1, 1, 1, 1], deadEnd: false };
        this.board['8,2'] = { type: 'path', isGoal: true, goalType: goals[2], faceDown: true, exits: [1, 1, 1, 1], deadEnd: false };
    }

    // ─── Turn Actions ─────────────────────────────────────────────────────────

    discardCard(playerId, cardId) {
        const pIdx = this.players.findIndex(p => p.id === playerId);
        if (pIdx !== this.currentTurnIdx) return { error: 'ยังไม่ถึงคิวของคุณ!' };

        const p = this.players[pIdx];
        const cardIdx = p.hand.findIndex(c => c.id === cardId);
        if (cardIdx === -1) return { error: 'ไม่พบการ์ดนี้' };

        const discardedCard = p.hand[cardIdx];
        this.lastDiscard = { playerName: p.name, card: discardedCard };
        p.hand.splice(cardIdx, 1);
        this._drawCard(p);
        this.addLog(`${p.name} ทิ้งการ์ด 1 ใบ`);

        const actionDetails = { type: 'discard', player: p.name, card: discardedCard };

        if (this._checkSaboteurWin()) return { success: true, actionDetails };
        this._nextTurn();
        return { success: true, actionDetails };
    }

    playCard(playerId, cardId, opts) {
        const pIdx = this.players.findIndex(p => p.id === playerId);
        if (pIdx !== this.currentTurnIdx) return { error: 'ยังไม่ถึงคิวของคุณ!' };

        const p = this.players[pIdx];
        const cardIdx = p.hand.findIndex(c => c.id === cardId);
        if (cardIdx === -1) return { error: 'ไม่พบการ์ดนี้' };

        const card = p.hand[cardIdx];
        let result;

        if (card.type === 'action') {
            result = this._playActionCard(p, card, opts || {});
        } else if (card.type === 'path') {
            result = this._playPathCard(p, card, opts || {});
        } else {
            return { error: 'ประเภทการ์ดไม่ถูกต้อง' };
        }

        if (result.error) return result;

        const privateMessage = result.privateMessage || null;
        const mapReveal = result.mapReveal || null;

        const actionDetails = {
            type: card.type === 'path' ? 'playPath' : (card.actionType === 'map' ? 'mapReveal' : 'playAction'),
            player: p.name,
            card: card,
            opts: opts || {}
        };

        p.hand.splice(cardIdx, 1);
        this._drawCard(p);

        if (this.status !== 'finished') {
            if (this._checkSaboteurWin()) {
                p.privateMessage = privateMessage;
                p.mapReveal = mapReveal;
                return { success: true, actionDetails };
            }
            this._nextTurn();
        }

        // Pass ephemeral properties to player object so server.js can read it
        p.privateMessage = privateMessage;
        p.mapReveal = mapReveal;

        return { success: true, actionDetails };
    }

    // ─── Internal: Action Cards ───────────────────────────────────────────────

    _playActionCard(player, card, opts) {
        if (card.actionType === 'break') {
            const t = this.players.find(p => p.id === opts.targetPlayerId);
            if (!t) return { error: 'ไม่พบผู้เล่นเป้าหมาย' };
            if (t.brokenTools[card.target]) return { error: `${t.name} ถูกพัง ${card.target} อยู่แล้ว` };
            t.brokenTools[card.target] = true;
            this.addLog(`💥 ${player.name} พัง ${card.target} ของ ${t.name}!`);

        } else if (card.actionType === 'fix') {
            const t = this.players.find(p => p.id === opts.targetPlayerId);
            if (!t) return { error: 'ไม่พบผู้เล่นเป้าหมาย' };

            const options = card.target.split('_');
            const toFix = opts.fixChoice || options[0];
            if (!options.includes(toFix)) return { error: 'เลือกอุปกรณ์ที่ซ่อมไม่ได้' };
            if (!t.brokenTools[toFix]) return { error: `${t.name} ไม่ได้พัง ${toFix} อยู่` };

            t.brokenTools[toFix] = false;
            this.addLog(`🔧 ${player.name} ซ่อม ${toFix} ให้ ${t.name}!`);

        } else if (card.actionType === 'map') {
            const posKey = `${opts.x},${opts.y}`;
            const cell = this.board[posKey];
            if (!cell || !cell.isGoal) return { error: 'เป้าหมายไม่ใช่การ์ดขุมทรัพย์' };
            let posName = 'ปริศนา';
            if (opts.y === -2) posName = 'บน';
            else if (opts.y === 0) posName = 'กลาง';
            else if (opts.y === 2) posName = 'ล่าง';
            this.addLog(`🗺️ ${player.name} ส่องดูการ์ดขุมทรัพย์ใบ${posName}`);
            return { success: true, mapReveal: { goalType: cell.goalType } };

        } else if (card.actionType === 'rockfall') {
            const posKey = `${opts.x},${opts.y}`;
            const cell = this.board[posKey];
            if (!cell) return { error: 'ไม่มีการ์ดตรงนี้' };
            if (cell.isGoal || cell.isStart) return { error: 'ไม่สามารถทำลายการ์ดนี้ได้' };
            delete this.board[posKey];
            this.addLog(`🪨 ${player.name} ทำให้เกิดหินถล่มที่ (${opts.x},${opts.y})!`);
        }

        return { success: true };
    }

    // ─── Internal: Path Cards ─────────────────────────────────────────────────

    _playPathCard(player, card, opts) {
        // Broken tools prevent placing path cards
        if (player.brokenTools.pickaxe || player.brokenTools.lantern || player.brokenTools.cart) {
            return { error: 'คุณไม่สามารถวางการ์ดเส้นทางได้เพราะเครื่องมือพัง!' };
        }

        const x = parseInt(opts.x, 10);
        const y = parseInt(opts.y, 10);
        if (isNaN(x) || isNaN(y)) return { error: 'ตำแหน่งไม่ถูกต้อง' };

        const posKey = `${x},${y}`;

        // Cell must be empty, or a face-down goal (which can be covered to reveal)
        const existing = this.board[posKey];
        if (existing && !(existing.isGoal && existing.faceDown)) {
            return { error: 'ช่องนี้ถูกใช้ไปแล้ว' };
        }

        // Apply 180° rotation if requested
        let exits = card.exits.slice();
        if (opts.rotated) exits = [exits[2], exits[3], exits[0], exits[1]];

        // --- Adjacency & exit-matching check ---
        let hasNeighbor = false;
        for (const dir of DIRS) {
            const nKey = `${x + dir.dx},${y + dir.dy}`;
            const neighbor = this.board[nKey];
            if (!neighbor) continue;
            // Face-down goals are treated as "not yet revealed" — skip matching
            if (neighbor.isGoal && neighbor.faceDown) continue;

            hasNeighbor = true;
            if (neighbor.exits[dir.eIn] !== exits[dir.eOut]) {
                return { error: 'เส้นทางไม่ตรงกัน!' };
            }
        }
        if (!hasNeighbor) return { error: 'ต้องวางติดกับการ์ดที่มีอยู่แล้ว' };

        // --- Temporarily place the card and BFS from start ---
        this.board[posKey] = { type: 'path', exits, deadEnd: card.deadEnd };

        const reachable = this._bfsFromStart();

        if (!reachable.has(posKey)) {
            delete this.board[posKey]; // rollback
            return { error: 'เส้นทางต้องเชื่อมกลับไปถึงจุดเริ่มต้น!' };
        }

        this.addLog(`${player.name} วางการ์ดเส้นทางที่ (${x},${y})`);

        // --- Check if any goal is now reachable & reveal it ---
        if (!card.deadEnd) {
            for (const dir of DIRS) {
                if (!exits[dir.eOut]) continue;
                const nk = `${x + dir.dx},${y + dir.dy}`;
                const adj = this.board[nk];
                if (adj && adj.isGoal && adj.faceDown) {
                    adj.faceDown = false;
                    if (adj.goalType === 'gold') {
                        this.addLog(`⭐ เจอขุมทอง! นักขุดชนะ!`);
                        this.status = 'finished';
                        this.winner = 'miners';
                        this.roundWinnerId = player.id;
                        this._distributeGold('miners', player.id);
                    } else {
                        this.addLog(`🪨 นักขุดประมาท! ขุดไปเจอถ่านหิน ถ้ำถล่มปิดตาย คนทรยศชนะ!`);
                        this.status = 'finished';
                        this.winner = 'saboteurs';
                        this.roundWinnerId = player.id;
                        this._distributeGold('saboteurs', player.id);
                    }
                }
            }
        }

        return { success: true };
    }

    // BFS from start (0,0). Returns Set of reachable cell keys.
    // Dead-end cards can be entered but traversal stops there (cannot pass through).
    _bfsFromStart() {
        const visited = new Set(['0,0']);
        const queue = ['0,0'];
        while (queue.length > 0) {
            const currKey = queue.shift();
            const [cx, cy] = currKey.split(',').map(Number);
            const cNode = this.board[currKey];
            if (!cNode) continue;

            for (const dir of DIRS) {
                if (!cNode.exits[dir.eOut]) continue;
                const nk = `${cx + dir.dx},${cy + dir.dy}`;
                if (visited.has(nk)) continue;

                const nNode = this.board[nk];
                if (!nNode || !nNode.exits[dir.eIn]) continue;

                visited.add(nk);
                // Don't propagate THROUGH a dead-end card
                if (!nNode.deadEnd) queue.push(nk);
            }
        }
        return visited;
    }

    // ─── Win Checking ─────────────────────────────────────────────────────────

    _checkSaboteurWin() {
        // Saboteurs win when the deck is empty and all players are out of cards
        if (this.deck.length === 0 && this.players.every(p => p.hand.length === 0)) {
            this.status = 'finished';
            this.winner = 'saboteurs';
            this.roundWinnerId = null;
            this._distributeGold('saboteurs', null);
            this.addLog('💀 การ์ดหมดทุกใบแล้ว! คนทรยศชนะ!');
            return true;
        }
        return false;
    }

    // ─── Turn Progression ─────────────────────────────────────────────────────

    _drawCard(player) {
        if (this.deck.length > 0) player.hand.push(this.deck.pop());
    }

    _nextTurn() {
        if (this.deck.length === 0 && !this._warnedDeckEmpty) {
            const cardsLeft = this.players.reduce((s, p) => s + p.hand.length, 0);
            if (cardsLeft > 0) {
                this._warnedDeckEmpty = true;
                this.addLog(`⚠️ กองจั่วหมดแล้ว! เหลือการ์ดในมือรวม ${cardsLeft} ใบ`);
            }
        }

        // Advance and skip players with no cards
        const n = this.players.length;
        for (let i = 0; i < n; i++) {
            this.currentTurnIdx = (this.currentTurnIdx + 1) % n;
            if (this.players[this.currentTurnIdx].hand.length > 0) break;
        }
    }

    // ─── State Snapshot ───────────────────────────────────────────────────────

    addLog(msg) {
        this.messages.push({ time: new Date().toISOString(), text: msg });
        if (this.messages.length > 50) this.messages.shift();
    }

    getState(socketId) {
        const maskedPlayers = this.players.map(pl => ({
            id: pl.id,
            userId: pl.userId,
            name: pl.name,
            avatar: pl.avatar,
            isHost: pl.isHost,
            isReady: pl.isReady,
            handSize: pl.hand.length,
            hand: pl.id === socketId ? pl.hand : [],
            brokenTools: pl.brokenTools,
            connected: pl.connected !== false,
            goldHistory: pl.goldHistory || [],
            goldTotal: pl.goldTotal || 0,
            // Role is revealed only to yourself, or to everyone after game ends
            role: (this.status === 'finished' || pl.id === socketId) ? pl.role : 'hidden',
            isCurrentTurn: this.players.indexOf(pl) === this.currentTurnIdx
        }));

        return {
            id: this.id,
            status: this.status,
            round: this.round,
            roundGoldDrawn: this.roundGoldDrawn,
            roundGoldDistribution: this.roundGoldDistribution,
            me: maskedPlayers.find(m => m.id === socketId) ?? null,
            players: maskedPlayers,
            board: this.board,
            deckSize: this.deck.length,
            currentTurnIdx: this.currentTurnIdx,
            winner: this.winner,
            messages: this.messages,
            lastDiscard: this.lastDiscard
        };
    }

    _distributeGold(winnerSide, winningPlayerId) {
        this.roundGoldDrawn = [];
        this.roundGoldDistribution = {};
        
        this.players.forEach(p => {
            this.roundGoldDistribution[p.id] = 0;
        });

        if (winnerSide === 'miners') {
            const miners = this.players.filter(p => p.role === 'miner');
            const saboteurs = this.players.filter(p => p.role === 'saboteur');

            let cardsToDraw = miners.length;
            if (saboteurs.length === 0) {
                cardsToDraw = Math.max(0, miners.length - 1);
            }

            const drawnGold = [];
            for (let i = 0; i < cardsToDraw; i++) {
                if (this.goldDeck.length === 0) this._initGoldDeck();
                drawnGold.push(this.goldDeck.pop() || 1);
            }

            this.roundGoldDrawn = [...drawnGold];
            drawnGold.sort((a, b) => b - a);

            let winnerIdx = this.players.findIndex(p => p.id === winningPlayerId);
            if (winnerIdx === -1) winnerIdx = this.currentTurnIdx;

            let goldIdx = 0;
            const n = this.players.length;
            for (let i = 0; i < n; i++) {
                const p = this.players[(winnerIdx + i) % n];
                if (p.role === 'miner') {
                    const goldVal = drawnGold[goldIdx] !== undefined ? drawnGold[goldIdx] : 0;
                    this.roundGoldDistribution[p.id] = goldVal;
                    p.goldHistory.push(goldVal);
                    p.goldTotal += goldVal;
                    goldIdx++;
                } else {
                    p.goldHistory.push(0);
                }
            }
            this.addLog(`💰 คนขุดทองชนะรอบนี้! จั่วการ์ดรูปทอง ${cardsToDraw} ใบและผลัดกันเลือก!`);

        } else if (winnerSide === 'saboteurs') {
            const saboteurs = this.players.filter(p => p.role === 'saboteur');
            const numSaboteurs = saboteurs.length;

            let goldValPerSaboteur = 0;
            if (numSaboteurs === 1) goldValPerSaboteur = 4;
            else if (numSaboteurs === 2 || numSaboteurs === 3) goldValPerSaboteur = 3;
            else if (numSaboteurs >= 4) goldValPerSaboteur = 2;

            this.players.forEach(p => {
                if (p.role === 'saboteur') {
                    this.roundGoldDistribution[p.id] = goldValPerSaboteur;
                    p.goldHistory.push(goldValPerSaboteur);
                    p.goldTotal += goldValPerSaboteur;
                } else {
                    p.goldHistory.push(0);
                }
            });
            this.addLog(`💰 คนทรยศชนะรอบนี้! ได้รับทองคนละ ${goldValPerSaboteur} ก้อน!`);
        }
    }

    startNextRound() {
        if (this.status !== 'finished' || this.round >= 3) return false;

        this.round++;
        this.status = 'playing';
        this.winner = null;
        this.roundWinnerId = null;
        this.roundGoldDrawn = [];
        this.roundGoldDistribution = {};
        this.lastDiscard = null;
        this._warnedDeckEmpty = false;
        this.board = {};
        this.deck = [];

        this.players.forEach(p => {
            p.hand = [];
            p.brokenTools = { pickaxe: false, lantern: false, cart: false };
            p.role = null;
            p.isReady = false;
        });

        this._assignRoles();
        this._buildDeck();
        this._dealHands();
        this._initBoard();
        this.currentTurnIdx = Math.floor(Math.random() * this.players.length);
        this.addLog(`🎮 เริ่มการแข่งรอบที่ ${this.round}/3! ถึงคิวของ ${this.players[this.currentTurnIdx].name}`);
        return true;
    }

    returnToLobby() {
        this.round = 1;
        this.status = 'lobby';
        this.winner = null;
        this.roundWinnerId = null;
        this.roundGoldDrawn = [];
        this.roundGoldDistribution = {};
        this.lastDiscard = null;
        this._warnedDeckEmpty = false;
        this.board = {};
        this.deck = [];

        this.players.forEach((p, idx) => {
            p.hand = [];
            p.brokenTools = { pickaxe: false, lantern: false, cart: false };
            p.role = null;
            p.isReady = false;
            p.isHost = idx === 0;
            p.goldHistory = [];
            p.goldTotal = 0;
        });

        this.addLog(`🚪 สิ้นสุดเกมแมตช์ใหญ่! ผู้เล่นทั้งหมดกลับเข้าสู่ล็อบบี้หลักเรียบร้อย`);
        return true;
    }
}

module.exports = { Game };
