const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let gameState = null;
let playerName = '';
let selectedAvatar = '⛏️';
let roomCode = '';
let myId = socket.id;
let userId = localStorage.getItem('saboteur_userId');
if (!userId) {
    userId = 'usr_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('saboteur_userId', userId);
}
let selectedCardId = null;
let cardRotated = false;
let _lastStatus = null;
let _wasMyTurn = false;
let isAnimating = false;
let pendingGameState = null;

// ─── DOM Cache ────────────────────────────────────────────────────────────────
const screens = {
    landing: document.getElementById('page-landing'),
    game: document.getElementById('game-screen')
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    if (screenId === 'lobby') {
        document.getElementById('page-landing').classList.add('active');
        document.getElementById('lobby-wrap').classList.remove('hidden');
        document.getElementById('login-wrap').style.opacity = '0.4';
        document.getElementById('login-wrap').style.pointerEvents = 'none';
    } else if (screenId === 'game') {
        document.getElementById('game-screen').classList.add('active');
    } else if (screenId === 'login') {
        document.getElementById('page-landing').classList.add('active');
        document.getElementById('lobby-wrap').classList.add('hidden');
        document.getElementById('login-wrap').style.opacity = '1';
        document.getElementById('login-wrap').style.pointerEvents = 'auto';
    }
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── Avatar Picker ───────────────────────────────────────────────────────────────
const AVATAR_LIST = ['⛏️', '🧔', '🧙‍♂️', '👨‍🔧', '👩‍🔧', '👷‍♂️', '👷‍♀️', '👽', '🦊', '🐻', '🐉', '🦨', '💀', '👻'];

(function buildAvatarPicker() {
    const picker = document.getElementById('avatar-grid');
    if (!picker) return;
    picker.innerHTML = '';
    AVATAR_LIST.forEach((emo, i) => {
        const div = document.createElement('div');
        div.className = 'avatar-option' + (i === 0 ? ' selected' : '');
        div.innerText = emo;
        if (i === 0) selectedAvatar = emo;
        div.onclick = () => {
            selectedAvatar = emo;
            picker.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
            div.classList.add('selected');
        };
        picker.appendChild(div);
    });
})();

// ─── Initialization ───────────────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
    playerName = document.getElementById('input-name').value.trim() || `Dwarf${Math.floor(Math.random() * 1000)}`;
    socket.emit('joinRoom', { room: '', name: playerName, avatar: selectedAvatar, userId });
});

document.getElementById('btn-join').addEventListener('click', () => {
    playerName = document.getElementById('input-name').value.trim() || `Dwarf${Math.floor(Math.random() * 1000)}`;
    roomCode = document.getElementById('input-code').value.trim();
    if (!roomCode) { showToast('กรุณากรอกรหัสห้อง'); return; }
    socket.emit('joinRoom', { room: roomCode, name: playerName, avatar: selectedAvatar, userId });
});

document.getElementById('btn-start').addEventListener('click', () => socket.emit('startGame'));
document.getElementById('btn-ready').addEventListener('click', () => socket.emit('toggleReady'));
document.getElementById('btn-leave-lobby').addEventListener('click', () => {
    socket.emit('leaveRoom');
    localStorage.removeItem('saboteur_session');
    switchScreen('login');
});

// ─── Socket Handlers ──────────────────────────────────────────────────────────
socket.on('connect', () => { myId = socket.id; });

socket.on('joined', (room) => {
    roomCode = room;
    document.getElementById('lob-code').innerText = room;
    localStorage.setItem('saboteur_session', JSON.stringify({ roomCode: room, userId, playerName, avatar: selectedAvatar }));
    switchScreen('lobby');
});

socket.on('gameState', (state) => {
    if (isAnimating) {
        pendingGameState = state;
    } else {
        gameState = state;
        render();
    }
});

socket.on('actionAnimation', (animData) => {
    isAnimating = true;
    playAnimation(animData).then(() => {
        isAnimating = false;
        if (pendingGameState) {
            gameState = pendingGameState;
            pendingGameState = null;
            render();
        }
    });
});

socket.on('errorMsg', (msg) => {
    showToast(msg);
    if (msg && (msg.includes("ไม่พบห้องดังกล่าว") || msg.includes("คุณไม่ได้อยู่ในห้อง"))) {
        localStorage.removeItem('saboteur_session');
    }
});

socket.on('kicked', () => {
    showToast('❌ คุณถูกเตะออกจากห้อง');
    localStorage.removeItem('saboteur_session');
    switchScreen('login');
});

socket.on('mapReveal', ({ goalType }) => {
    const modal = document.getElementById('map-reveal-modal');
    const flipper = document.getElementById('map-flip-card');
    const icon = document.getElementById('map-reveal-icon');
    const text = document.getElementById('map-reveal-text');
    const btn = document.getElementById('map-reveal-close');

    if (goalType === 'gold') {
        icon.className = 'material-symbols-rounded';
        icon.innerText = 'diamond';
        text.innerText = 'นี่คือทองคำ!';
        text.style.color = '#fbc02d';
        document.getElementById('map-flip-back').style.borderColor = '#fbc02d';
    } else {
        icon.className = 'material-symbols-rounded';
        icon.innerText = 'landslide';
        text.innerText = 'ก้อนถ่านหิน';
        text.style.color = '#aaa';
        document.getElementById('map-flip-back').style.borderColor = '#555';
    }

    modal.classList.remove('hidden');
    flipper.style.transform = 'rotateY(0deg)';
    btn.style.display = 'none';

    setTimeout(() => {
        flipper.style.transform = 'rotateY(180deg)';
        setTimeout(() => btn.style.display = 'block', 600);
    }, 800);

    btn.onclick = () => {
        modal.classList.add('hidden');
    };
});

socket.on('roleReveal', ({ role, avatar }) => {
    const overlay = document.getElementById('role-reveal-overlay');
    document.getElementById('reveal-avatar').innerText = avatar || (role === 'miner' ? '⛏️' : '💣');
    document.getElementById('reveal-role-name').innerText = role === 'miner' ? 'Gold Miner' : 'Saboteur';
    document.getElementById('reveal-role-name').style.color = role === 'miner' ? '#43a047' : '#e53935';
    document.getElementById('reveal-role-desc').innerText = role === 'miner'
        ? 'ขุดหาทองคำ! เชื่อมเส้นทางจากบันไดไปหาขุมทองทางขวา'
        : 'คุณคือหนอนบ่อนไส้! ขัดขวางไม่ให้นักขุดเจอทอง';

    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 4000);
});

// ─── Render Entry ─────────────────────────────────────────────────────────────
function render() {
    if (!gameState) return;

    if (gameState.status === 'lobby') {
        switchScreen('lobby');
        renderLobby();
    } else if (gameState.status === 'playing' || gameState.status === 'finished') {
        switchScreen('game');
        renderGame();
        if (gameState.status === 'finished') {
            renderGameOver();
            document.getElementById('game-over-modal').classList.remove('hidden');
        } else {
            document.getElementById('game-over-modal').classList.add('hidden');
        }
    }
    _lastStatus = gameState.status;
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
function renderLobby() {
    const list = document.getElementById('lob-players');
    document.getElementById('lob-count').innerText = '(' + gameState.players.length + '/10)';
    list.innerHTML = '';

    let allReady = true;
    const me = gameState.me;

    gameState.players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'player-item';
        
        let badgesHtml = '';
        if (p.isHost) badgesHtml += '<span class="badge badge-host">👑 HOST</span>';
        else if (p.isReady) badgesHtml += '<span class="badge badge-ready">✅ READY</span>';
        else badgesHtml += '<span class="badge badge-wait">รอ...</span>';

        if (p.id === myId) badgesHtml += '<span class="badge" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2);">(คุณ)</span>';

        let kickHtml = '';
        if (me && me.isHost && !p.isHost) {
            kickHtml = `<button class="btn btn-kick" style="padding: 4px 8px; font-size: 0.8rem; background: rgba(229, 57, 53, 0.1); color: var(--danger); border: 1px solid rgba(229, 57, 53, 0.3); border-radius: 4px; font-weight: bold; margin-left: 8px;" onclick="kickPlayer('${p.id}')">❌ เตะ</button>`;
        }

        div.innerHTML = `
            <div class="player-avatar">${p.avatar}</div>
            <div class="player-name" style="${p.id === myId ? 'color:var(--gold)' : ''}">${p.name}</div>
            <div class="player-badges" style="display:flex; align-items:center; gap:4px;">
                ${badgesHtml}
                ${kickHtml}
            </div>
        `;
        list.appendChild(div);

        if (!p.isHost && !p.isReady) allReady = false;
    });

    const rBtn = document.getElementById('btn-ready');
    const sBtn = document.getElementById('btn-start');

    if (me && me.isHost) {
        rBtn.classList.add('hidden');
        sBtn.classList.remove('hidden');
        sBtn.innerText = `🎮 เริ่มเกม (${gameState.players.length}/10)`;
        sBtn.disabled = gameState.players.length < 3 || !allReady;
    } else if (me) {
        rBtn.classList.remove('hidden');
        sBtn.classList.add('hidden');
        rBtn.innerText = me.isReady ? '❌ ยกเลิกความพร้อม' : '✅ พร้อมเล่น';
        if (me.isReady) {
            rBtn.classList.remove('btn-outline');
            rBtn.style.background = '#555';
            rBtn.style.color = '#fff';
            rBtn.style.borderColor = 'transparent';
        } else {
            rBtn.classList.add('btn-outline');
            rBtn.style.background = 'transparent';
            rBtn.style.color = 'var(--text-light)';
            rBtn.style.borderColor = 'rgba(255,255,255,0.08)';
        }
    }
}

// ─── Game ─────────────────────────────────────────────────────────────────────
function renderGame() {
    renderTopBar();
    renderSidebar();
    renderBoard();
    renderHand();
    renderLogs();
    renderLastDiscard();
    renderRoleCorner();
}

function playTurnSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
    } catch(e) { console.error(e); }
}

function renderTopBar() {
    const turnEl = document.getElementById('turn-indicator');
    const currPlayer = gameState.players[gameState.currentTurnIdx];
    if (!currPlayer) return;

    const roundPrefix = `[รอบที่ ${gameState.round}/3] `;

    if (currPlayer.id === myId) {
        if (!_wasMyTurn) {
            playTurnSound();
        }
        _wasMyTurn = true;
        turnEl.innerText = roundPrefix + '🕐 ถึงเวลาของคุณแล้ว!';
        turnEl.classList.add('my-turn');
    } else {
        _wasMyTurn = false;
        turnEl.innerText = roundPrefix + `⏳ รอ ${currPlayer.name}...`;
        turnEl.classList.remove('my-turn');
    }
    document.getElementById('deck-size').innerText = gameState.deckSize;
}

function renderRoleCorner() {
    const me = gameState.me;
    const panel = document.getElementById('role-panel');
    const inlineBadge = document.getElementById('role-inline-badge');
    const avatar = document.getElementById('role-inline-avatar');
    const name = document.getElementById('role-inline-name');

    if (!me || !me.role || me.role === 'hidden') {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';
    const isMiner = me.role === 'miner';

    inlineBadge.style.borderColor = isMiner ? '#43a047' : '#e53935';
    inlineBadge.style.boxShadow = `inset 0 0 15px ${isMiner ? 'rgba(67,160,71,0.2)' : 'rgba(229,57,53,0.2)'}`;

    avatar.innerText = me.avatar || (isMiner ? '⛏️' : '💣');
    name.innerText = isMiner ? 'นักขุด' : 'คนทรยศ';
    name.style.color = isMiner ? '#43a047' : '#e53935';
}

function renderSidebar() {
    const me = gameState.me;
    if (!me) return;

    const TOOL_ICON = { pickaxe: 'hardware', lantern: 'tungsten', cart: 'shopping_cart' };
    const playersList = document.getElementById('game-players-list');
    playersList.innerHTML = '';

    gameState.players.forEach((p, idx) => {
        const li = document.createElement('li');
        li.className = 'player-item';
        if (idx === gameState.currentTurnIdx) li.className += ' current-turn';
        if (p.id === myId) li.className += ' is-me';

        if (!p.connected) {
            li.style.opacity = '0.5';
            li.style.border = '1px dashed rgba(229, 57, 53, 0.4)';
        }

        const toolHtml = ['pickaxe', 'lantern', 'cart'].map(t => `
            <span class="material-symbols-rounded mini-tool ${p.brokenTools[t] ? 'broken' : 'fine'}" title="${t}">${TOOL_ICON[t]}</span>
        `).join('');

        const offlineLabel = p.connected ? '' : ' <span style="color:var(--danger); font-size:0.75rem; font-weight:bold;">(🔴 Offline)</span>';

        li.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;">
                <span class="player-avatar" style="width:32px;height:32px;font-size:1.2rem;border:1px solid rgba(255,255,255,0.1);">${p.avatar || '🧔'}</span>
                <span class="player-name" style="${!p.connected ? 'color: #888;' : ''}">${p.name}${p.id === myId ? ' (คุณ)' : ''}${offlineLabel} [${p.handSize}]</span>
            </div>
            <div class="player-tools">${toolHtml}</div>
        `;
        li.ondragover = (e) => e.preventDefault();
        li.ondrop = (e) => {
            e.preventDefault();
            const cardId = e.dataTransfer.getData('text/plain');
            if (cardId) {
                selectedCardId = cardId;
                playActionCard(p.id);
            }
        };

        playersList.appendChild(li);
    });
}

// ─── Card HTML ────────────────────────────────────────────────────────────────
const ACTION_ICONS = {
    map: { icon: '<span class="material-symbols-rounded" style="font-size: 32px;">map</span>', label: 'แผนที่', cls: 'act-map' },
    rockfall: { icon: '<span class="material-symbols-rounded" style="font-size: 32px;">landslide</span>', label: 'ถ้ำถล่ม', cls: 'act-rockfall' },
    'break-pickaxe': { icon: '<span class="material-symbols-rounded" style="font-size: 32px;">hardware</span>', label: 'พังจอบ', cls: 'act-break' },
    'break-lantern': { icon: '<span class="material-symbols-rounded" style="font-size: 32px;">tungsten</span>', label: 'พังตะเกียง', cls: 'act-break' },
    'break-cart': { icon: '<span class="material-symbols-rounded" style="font-size: 32px;">shopping_cart</span>', label: 'พังรถ', cls: 'act-break' },
    'fix-pickaxe': { icon: '<span class="material-symbols-rounded" style="font-size: 32px;">hardware</span>', label: 'ซ่อมจอบ', cls: 'act-fix' },
    'fix-lantern': { icon: '<span class="material-symbols-rounded" style="font-size: 32px;">tungsten</span>', label: 'ซ่อมตะเกียง', cls: 'act-fix' },
    'fix-cart': { icon: '<span class="material-symbols-rounded" style="font-size: 32px;">shopping_cart</span>', label: 'ซ่อมรถ', cls: 'act-fix' },
    'fix-pickaxe_lantern': { icon: '<span class="material-symbols-rounded" style="font-size: 30px; letter-spacing: -10px;">hardware tungsten</span>', label: 'ซ่อม 2 อย่าง', cls: 'act-fix' },
    'fix-pickaxe_cart': { icon: '<span class="material-symbols-rounded" style="font-size: 30px; letter-spacing: -10px;">hardware shopping_cart</span>', label: 'ซ่อม 2 อย่าง', cls: 'act-fix' },
    'fix-lantern_cart': { icon: '<span class="material-symbols-rounded" style="font-size: 30px; letter-spacing: -10px;">tungsten shopping_cart</span>', label: 'ซ่อม 2 อย่าง', cls: 'act-fix' },
};

function generateCardHTML(card, rotated = false) {
    if (card.type === 'path') {
        let [n, e, s, w] = card.exits;
        if (rotated) {
            [n, e, s, w] = [s, w, n, e];
        }
        return `
            ${n ? '<div class="path-n"></div>' : ''}
            ${e ? '<div class="path-e"></div>' : ''}
            ${s ? '<div class="path-s"></div>' : ''}
            ${w ? '<div class="path-w"></div>' : ''}
            <div class="path-center"></div>
            ${card.deadEnd ? '<div class="dead-end-marker">✕</div>' : ''}
        `;
    }
    if (card.type === 'action') {
        const key = card.target ? `${card.actionType}-${card.target}` : card.actionType;
        const info = ACTION_ICONS[key] || { icon: '❓', label: card.actionType, cls: '' };
        return `<div class="action-content ${info.cls}"><div class="action-icon">${info.icon}</div><div class="action-label">${info.label}</div></div>`;
    }
    return '';
}

// ─── Hand ─────────────────────────────────────────────────────────────────────
function renderHand() {
    const handEl = document.getElementById('hand');
    handEl.innerHTML = '';
    const me = gameState.me;
    if (!me) return;

    for (const c of me.hand) {
        const cdiv = document.createElement('div');
        cdiv.className = `hand-card${c.type === 'action' ? ' action-card' : ''}${c.deadEnd ? ' dead-end' : ''}`;

        if (c.id === selectedCardId) {
            cdiv.classList.add('selected');
            if (cardRotated) cdiv.style.transform = 'translateY(-15px) rotate(180deg)';
        }

        cdiv.innerHTML = generateCardHTML(c);

        const isBroken = me.brokenTools.pickaxe || me.brokenTools.lantern || me.brokenTools.cart;

        cdiv.draggable = true;
        cdiv.ondragstart = (e) => {
            selectedCardId = c.id;
            e.dataTransfer.setData('text/plain', c.id);

            // Build a rotated ghost image when card is rotated
            if (cardRotated && c.type === 'path') {
                const ghost = document.createElement('div');
                ghost.id = 'drag-ghost';
                const w = cdiv.offsetWidth || 90;
                const h = cdiv.offsetHeight || 130;
                ghost.className = 'hand-card' + (c.deadEnd ? ' dead-end' : '');
                ghost.innerHTML = generateCardHTML(c, true);
                ghost.style.cssText = `
                    position: absolute; top: -9999px; left: -9999px;
                    width: ${w}px; height: ${h}px;
                    pointer-events: none;
                    border-radius: 8px; border: 3px solid #1a1105;
                    background: var(--card-bg);
                    overflow: hidden; z-index: -9999;
                `;
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, w / 2, h / 2);
            }

            // Re-render so the board highlights valid slots immediately while dragging
            setTimeout(() => render(), 10);
        };

        cdiv.ondragend = () => {
            const ghost = document.getElementById('drag-ghost');
            if (ghost) ghost.remove();
        };

        cdiv.addEventListener('click', () => {
            if (c.type === 'path' && isBroken) {
                showToast('❌ ติดอุปกรณ์พัง! ลงทางเดินไม่ได้ต้องซ่อมหรือทิ้งการ์ด');
            }
            selectedCardId = (selectedCardId === c.id) ? null : c.id;
            if (selectedCardId !== c.id) cardRotated = false;
            render();
        });
        handEl.appendChild(cdiv);
    }

    renderHandControls();
}

function renderHandControls() {
    const controls = document.getElementById('hand-controls');
    controls.innerHTML = '';

    const isMyTurn = gameState.players[gameState.currentTurnIdx]?.id === myId;

    if (isMyTurn) {
        const trashBtn = document.createElement('div');
        trashBtn.className = 'trash-dropzone';
        trashBtn.innerHTML = '🗑️ ลากมาทิ้งที่นี่ (หรือคลิกเพื่อทิ้ง)';
        trashBtn.ondragover = (e) => { e.preventDefault(); trashBtn.classList.add('drag-over'); };
        trashBtn.ondragleave = (e) => { trashBtn.classList.remove('drag-over'); };
        trashBtn.ondrop = (e) => {
            e.preventDefault();
            trashBtn.classList.remove('drag-over');
            const cardId = e.dataTransfer.getData('text/plain');
            if (cardId) {
                socket.emit('discardCard', { cardId });
                selectedCardId = null;
                cardRotated = false;
            }
        };
        trashBtn.onclick = () => {
            if (selectedCardId) {
                socket.emit('discardCard', { cardId: selectedCardId });
                selectedCardId = null;
                cardRotated = false;
            } else {
                showToast('กรูณาเลือกการ์ดก่อนกดทิ้ง');
            }
        };
        controls.appendChild(trashBtn);
    }

    if (!selectedCardId) {
        if (!isMyTurn) {
            controls.innerHTML = '<span style="color:#666; width:100%; text-align:center;">รอผู้เล่นอื่นเล่น...</span>';
        }
        return;
    }

    const card = gameState.me?.hand.find(c => c.id === selectedCardId);
    if (!card) return;

    if (card.type === 'path') {
        const rotBtn = document.createElement('button');
        rotBtn.className = isMyTurn ? 'active' : '';
        rotBtn.innerText = '🔄 หมุน';
        if (isMyTurn) rotBtn.onclick = () => { cardRotated = !cardRotated; render(); };
        controls.appendChild(rotBtn);

    } else if (card.type === 'action' && (card.actionType === 'break' || card.actionType === 'fix')) {
        const playBtn = document.createElement('button');
        playBtn.className = `play-btn${isMyTurn ? ' active' : ''}`;
        playBtn.innerText = '▶ ใช้การ์ดใบนี้';
        if (isMyTurn) playBtn.onclick = () => showTargetPlayerModal(card);
        controls.appendChild(playBtn);

    } else if (card.type === 'action') {
        const hintBtn = document.createElement('button');
        hintBtn.className = 'info-btn active';
        hintBtn.innerText = 'คลิกช่องบนกระดานเพื่อใช้';
        hintBtn.style.pointerEvents = 'none';
        controls.appendChild(hintBtn);
    }

    if (!isMyTurn) {
        const hint = document.createElement('span');
        hint.style.cssText = 'color:#e53935;margin-left:10px;line-height:40px;';
        hint.innerText = '(ยังไม่ถึงคิวของคุณ)';
        controls.appendChild(hint);
    }
}

// ─── Board ────────────────────────────────────────────────────────────────────
function renderBoard() {
    const boardEl = document.getElementById('board');
    const container = document.getElementById('board-container');
    boardEl.innerHTML = '';

    const CELL_W = 90;
    const CELL_H = 120;
    const PAD = 1.5; // padding cells around the bounding box

    const b = gameState.board;

    // Bounding box (always includes start and all 3 goal positions)
    let minX = 0, maxX = 8, minY = -2, maxY = 2;
    for (const key in b) {
        const [x, y] = key.split(',').map(Number);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }

    const pMinX = minX - PAD;
    const pMinY = minY - PAD;

    // Board pixel dimensions (unscaled)
    const boardPixelW = (maxX - minX + 1 + PAD * 2) * CELL_W;
    const boardPixelH = (maxY - minY + 1 + PAD * 2) * CELL_H;

    // Fit to container
    const cW = container.clientWidth || 800;
    const cH = container.clientHeight || 500;
    const scale = Math.min(cW / boardPixelW, cH / boardPixelH, 1);
    const offsetX = (cW - boardPixelW * scale) / 2;
    const offsetY = (cH - boardPixelH * scale) / 2;

    boardEl.style.width = boardPixelW + 'px';
    boardEl.style.height = boardPixelH + 'px';
    boardEl.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`;
    boardEl.style.transformOrigin = 'top left';

    const toLeft = x => (x - pMinX) * CELL_W + CELL_W / 2;
    const toTop = y => (y - pMinY) * CELL_H + CELL_H / 2;

    // Determine selected card for board interactions
    const selCard = selectedCardId
        ? gameState.me?.hand.find(c => c.id === selectedCardId)
        : null;

    // Draw placed cards
    for (const key in b) {
        const [x, y] = key.split(',').map(Number);
        const cell = b[key];

        const cdiv = document.createElement('div');
        cdiv.className = 'card-cell';
        cdiv.style.left = toLeft(x) + 'px';
        cdiv.style.top = toTop(y) + 'px';

        if (cell.isStart) cdiv.classList.add('start-card');
        if (cell.isGoal) {
            cdiv.classList.add('goal-card');
            cdiv.classList.add(cell.faceDown ? 'face-down' : `${cell.goalType}-revealed`);
        }

        if (!cell.isGoal) {
            cdiv.innerHTML = generateCardHTML(cell);
            if (cell.deadEnd) cdiv.classList.add('dead-end');
        }

        // Board-targeted action cards
        if (selCard?.type === 'action') {
            if (selCard.actionType === 'map' && cell.isGoal && cell.faceDown) {
                cdiv.classList.add('grid-highlight');
                cdiv.onclick = () => playActionCard(null, x, y);
                cdiv.ondragover = (e) => e.preventDefault();
                cdiv.ondrop = (e) => { e.preventDefault(); playActionCard(null, x, y); };
            } else if (selCard.actionType === 'rockfall' && !cell.isGoal && !cell.isStart) {
                cdiv.classList.add('grid-highlight');
                cdiv.onclick = () => playActionCard(null, x, y);
                cdiv.ondragover = (e) => e.preventDefault();
                cdiv.ondrop = (e) => { e.preventDefault(); playActionCard(null, x, y); };
            }
        }

        boardEl.appendChild(cdiv);
    }

    // Empty placement slots when a path card is selected
    if (selCard?.type === 'path') {
        const isMyTurn = gameState.players[gameState.currentTurnIdx]?.id === myId;
        const me = gameState.me;
        const canPlay = isMyTurn && me && !me.brokenTools.pickaxe && !me.brokenTools.lantern && !me.brokenTools.cart;

        if (canPlay) {
            for (let x = minX - 1; x <= maxX + 1; x++) {
                for (let y = minY - 1; y <= maxY + 1; y++) {
                    const key = `${x},${y}`;
                    if (b[key]) continue;

                    // Highlight logic
                    const isValid = isPlacementValid(b, x, y, selCard, cardRotated);
                    if (!isValid) continue; // Don't show slot at all if invalid

                    const slot = document.createElement('div');
                    slot.className = 'valid-slot';
                    slot.style.left = toLeft(x) + 'px';
                    slot.style.top = toTop(y) + 'px';
                    slot.onclick = () => placePathCard(x, y);
                    slot.ondragover = (e) => e.preventDefault();
                    slot.ondrop = (e) => { e.preventDefault(); placePathCard(x, y); };
                    boardEl.appendChild(slot);
                }
            }
        }
    }
}

function isPlacementValid(board, x, y, card, rotated) {
    const DIRS = [
        { dx: 0, dy: -1, eOut: 0, eIn: 2 },
        { dx: 1, dy: 0, eOut: 1, eIn: 3 },
        { dx: 0, dy: 1, eOut: 2, eIn: 0 },
        { dx: -1, dy: 0, eOut: 3, eIn: 1 },
    ];
    let exits = card.exits.slice();
    if (rotated) exits = [exits[2], exits[3], exits[0], exits[1]];

    let hasNeighbor = false;
    for (const d of DIRS) {
        const neighbor = board[`${x + d.dx},${y + d.dy}`];
        if (!neighbor) continue;
        if (neighbor.isGoal && neighbor.faceDown) continue;
        hasNeighbor = true;
        if (neighbor.exits[d.eIn] !== exits[d.eOut]) return false;
    }
    if (!hasNeighbor) return false;

    // BFS simulation without cloning to prevent UI freeze on large boards
    const targetKey = `${x},${y}`;
    const targetNode = { type: 'path', exits, deadEnd: card.deadEnd };

    const visited = new Set(['0,0']);
    const queue = ['0,0'];
    while (queue.length > 0) {
        const curr = queue.shift();
        const [cx, cy] = curr.split(',').map(Number);

        let cNode = board[curr];
        if (curr === targetKey) cNode = targetNode;

        if (!cNode) continue;
        for (const d of DIRS) {
            if (!cNode.exits[d.eOut]) continue;
            const nk = `${cx + d.dx},${cy + d.dy}`;
            if (visited.has(nk)) continue;

            let nNode = board[nk];
            if (nk === targetKey) nNode = targetNode;

            if (!nNode || !nNode.exits[d.eIn]) continue;
            visited.add(nk);
            if (!nNode.deadEnd) queue.push(nk);
        }
    }
    return visited.has(`${x},${y}`);
}

// ─── Card Actions ─────────────────────────────────────────────────────────────
function placePathCard(x, y) {
    if (!selectedCardId) return;
    socket.emit('playCard', { cardId: selectedCardId, opts: { x, y, rotated: cardRotated } });
    selectedCardId = null;
    cardRotated = false;
}

function playActionCard(targetPlayerId, x, y) {
    if (!selectedCardId) return;
    const card = gameState.me?.hand.find(c => c.id === selectedCardId);
    if (!card) return;

    const opts = {};

    if (targetPlayerId) {
        opts.targetPlayerId = targetPlayerId;
        if (card.actionType === 'fix' && card.target?.includes('_')) {
            showFixChoiceModal(card.target.split('_'), (chosenTool) => {
                opts.fixChoice = chosenTool;
                socket.emit('playCard', { cardId: selectedCardId, opts });
                selectedCardId = null;
            });
            return; // wait for modal
        }
        if (card.actionType === 'fix') opts.fixChoice = card.target;
    }
    if (x !== undefined) { opts.x = x; opts.y = y; }

    socket.emit('playCard', { cardId: selectedCardId, opts });
    selectedCardId = null;
}

// ─── Modals ───────────────────────────────────────────────────────────────────
const TOOL_LABEL = { pickaxe: '⛏️ จอบ', lantern: '🔦 ตะเกียง', cart: '🚎 รถเข็น' };

function showFixChoiceModal(tools, onConfirm) {
    const modal = document.getElementById('fix-choice-modal');
    const subtitle = document.getElementById('fix-choice-subtitle');
    const buttonsEl = document.getElementById('fix-choice-buttons');
    const cancelBtn = document.getElementById('fix-choice-cancel');

    subtitle.innerText = `การ์ดนี้ซ่อมได้ 1 ชิ้นจาก: ${tools.map(t => TOOL_LABEL[t] || t).join(' หรือ ')}`;
    buttonsEl.innerHTML = '';

    for (const tool of tools) {
        const btn = document.createElement('button');
        btn.className = 'fix-option-btn';
        btn.innerText = TOOL_LABEL[tool] || tool;
        btn.onclick = () => { modal.classList.add('hidden'); onConfirm(tool); };
        buttonsEl.appendChild(btn);
    }

    cancelBtn.onclick = () => modal.classList.add('hidden');
    modal.classList.remove('hidden');
}

function showTargetPlayerModal(card) {
    const modal = document.getElementById('target-player-modal');
    const subtitle = document.getElementById('target-choice-subtitle');
    const listEl = document.getElementById('target-choice-list');
    const cancelBtn = document.getElementById('target-choice-cancel');

    const key = card.target ? `${card.actionType}-${card.target}` : card.actionType;
    const info = ACTION_ICONS[key] || { label: card.actionType };
    subtitle.innerText = `ใช้การ์ด '${info.label}' กับใครดี?`;
    listEl.innerHTML = '';

    const TOOL_ICON = { pickaxe: 'hardware', lantern: 'tungsten', cart: 'shopping_cart' };

    for (const p of gameState.players) {
        const btn = document.createElement('button');
        btn.className = 'target-player-btn';

        const toolHtml = ['pickaxe', 'lantern', 'cart'].map(t => `
            <span class="material-symbols-rounded mini-tool ${p.brokenTools[t] ? 'broken' : 'fine'}" title="${t}">${TOOL_ICON[t]}</span>
        `).join('');

        btn.innerHTML = `
            <div class="target-p-info">
                <span class="target-p-avatar">${p.avatar}</span>
                <span class="target-p-name">${p.name}${p.id === myId ? ' (คุณ)' : ''}</span>
            </div>
            <div class="player-tools">${toolHtml}</div>
        `;
        btn.onclick = () => { modal.classList.add('hidden'); playActionCard(p.id); };
        listEl.appendChild(btn);
    }

    cancelBtn.onclick = () => modal.classList.add('hidden');
    modal.classList.remove('hidden');
}

// ─── Game Over ────────────────────────────────────────────────────────────────
function renderGameOver() {
    const { winner } = gameState;
    const banner = document.getElementById('game-over-banner');
    const iconEl = document.getElementById('game-over-icon');
    const titleEl = document.getElementById('winner-text');
    const reasonEl = document.getElementById('winner-reason');
    const grid = document.getElementById('roles-reveal-grid');

    banner.style.background = 'linear-gradient(135deg, rgba(30, 20, 15, 0.9), rgba(15, 10, 5, 0.9))';
    banner.style.borderColor = 'var(--gold)';

    if (winner === 'miners') {
        iconEl.innerText = '🏆';
        titleEl.innerText = `จบการแข่งรอบที่ ${gameState.round} (นักขุดชนะ)`;
        titleEl.style.color = '#43a047';
        reasonEl.innerText = 'เส้นทางถูกเชื่อมไปถึงขุมทองคำสำเร็จ!';
    } else {
        iconEl.innerText = '💀';
        titleEl.innerText = `จบการแข่งรอบที่ ${gameState.round} (คนทรยศชนะ)`;
        titleEl.style.color = '#e53935';
        reasonEl.innerText = 'การ์ดหมดมือทุกคนแล้ว ยังขุดไปไม่ถึงขุมทอง!';
    }

    // 1. Render round gold distribution
    const goldListEl = document.getElementById('round-gold-list');
    goldListEl.innerHTML = '';
    gameState.players.forEach(p => {
        const goldVal = (gameState.roundGoldDistribution && gameState.roundGoldDistribution[p.id]) || 0;
        const roleIcon = p.role === 'miner' ? '⛏️' : '💣';
        const roleNameText = p.role === 'miner' ? 'นักขุด' : 'คนทรยศ';
        const tr = document.createElement('tr');
        if (p.id === myId) tr.style.background = 'rgba(255, 255, 255, 0.04)';
        
        tr.innerHTML = `
            <td>
                <span style="font-size: 1.2rem; margin-right: 6px;">${p.avatar || '🧔'}</span>
                <b>${p.name}</b>${p.id === myId ? ' (คุณ)' : ''}
            </td>
            <td style="text-align: center;">
                <span class="badge-role ${p.role}">${roleIcon} ${roleNameText}</span>
            </td>
            <td style="text-align: right; color: var(--gold); font-weight: bold;">
                +${goldVal} ก้อน
            </td>
        `;
        goldListEl.appendChild(tr);
    });

    // 2. Render overall cumulative standings
    const standingsListEl = document.getElementById('standings-list');
    standingsListEl.innerHTML = '';
    const sorted = [...gameState.players].sort((a, b) => b.goldTotal - a.goldTotal);
    sorted.forEach((p, rank) => {
        const tr = document.createElement('tr');
        
        let rankBadge = rank === 0 ? '👑 1' : rank === 1 ? '🥈 2' : rank === 2 ? '🥉 3' : `${rank + 1}`;
        
        if (rank === 0) {
            tr.className = 'rank-highlight';
            if (gameState.round === 3) {
                tr.style.background = 'rgba(251, 192, 45, 0.12)';
                p.name = '🏆 ' + p.name; // Tag grand champion
            }
        }
        if (p.id === myId) {
            tr.style.borderLeft = '3px solid rgba(251, 192, 45, 0.8)';
            tr.style.background = 'rgba(255, 255, 255, 0.04)';
        }

        tr.innerHTML = `
            <td style="font-weight: 800; font-size: 1.05rem;">${rankBadge}</td>
            <td>
                <span style="font-size: 1.2rem; margin-right: 6px;">${p.avatar || '🧔'}</span>
                <b>${p.name}</b>${p.id === myId ? ' (คุณ)' : ''}
            </td>
            <td style="text-align: right; color: var(--gold); font-weight: 800; font-size: 1.05rem;">
                ${p.goldTotal} ก้อน
            </td>
        `;
        standingsListEl.appendChild(tr);
    });

    // 3. Render roles this round
    grid.innerHTML = '';
    for (const p of gameState.players) {
        const isMiner = p.role === 'miner';
        const card = document.createElement('div');
        card.className = `role-reveal-card-mini ${isMiner ? 'miner' : 'saboteur'}`;
        card.innerHTML = `
            <span class="rmini-avatar">${p.avatar || '🧔'}</span>
            <span class="rmini-name">${p.name.replace('🏆 ', '')}${p.id === myId ? ' (คุณ)' : ''}</span>
            <span class="rmini-role">${isMiner ? '⛏️ นักขุด' : '💀 คนทรยศ'}</span>
        `;
        grid.appendChild(card);
    }

    // 4. Configure action button controls
    const nextBtn = document.getElementById('btn-next-round');
    const lobbyBtn = document.getElementById('btn-to-lobby');
    const waitMsg = document.getElementById('non-host-wait-msg');

    nextBtn.classList.add('hidden');
    lobbyBtn.classList.add('hidden');
    waitMsg.classList.add('hidden');
    nextBtn.disabled = false;
    lobbyBtn.disabled = false;

    const isMeHost = gameState.me && gameState.me.isHost;

    if (gameState.round < 3) {
        if (isMeHost) {
            nextBtn.classList.remove('hidden');
            nextBtn.onclick = () => {
                nextBtn.disabled = true;
                socket.emit('startNextRound');
            };
        } else {
            waitMsg.classList.remove('hidden');
            waitMsg.innerText = '⏳ รอผู้สร้างห้องเริ่มการแข่งรอบถัดไป...';
        }
    } else {
        if (isMeHost) {
            lobbyBtn.classList.remove('hidden');
            lobbyBtn.onclick = () => {
                lobbyBtn.disabled = true;
                socket.emit('returnToLobby');
            };
        } else {
            waitMsg.classList.remove('hidden');
            waitMsg.innerText = '🏁 จบการแข่งขัน 3 รอบ! รอโฮสต์นำทุกคนกลับล็อบบี้เดิม...';
        }
    }
}

// ─── Logs & Last Discard ───────────────────────────────────────────────────────
function renderLogs() {
    const logsEl = document.getElementById('game-logs');
    if (!logsEl || !gameState.messages) return;
    
    // Check if we are scrolled to the bottom before rendering
    const isScrolledToBottom = logsEl.scrollHeight - logsEl.clientHeight <= logsEl.scrollTop + 10;
    
    logsEl.innerHTML = '';
    gameState.messages.forEach(m => {
        const d = document.createElement('div');
        const timeStr = new Date(m.time).toLocaleTimeString('th-TH', { hour: '2-digit', minute:'2-digit', second:'2-digit' });
        d.innerHTML = `<span style="color:#888;">[${timeStr}]</span> ${m.text}`;
        logsEl.appendChild(d);
    });
    
    // Auto-scroll to bottom
    logsEl.scrollTop = logsEl.scrollHeight;
}

function renderLastDiscard() {
    const panel = document.getElementById('discard-panel');
    const info = document.getElementById('last-discard-info');
    const cardEl = document.getElementById('last-discard-card');
    
    if (!gameState.lastDiscard || !gameState.lastDiscard.card) {
        panel.style.display = 'none';
        return;
    }
    
    panel.style.display = 'block';
    info.innerText = `โดย ${gameState.lastDiscard.playerName}`;
    
    const card = gameState.lastDiscard.card;
    cardEl.className = `hand-card${card.type === 'action' ? ' action-card' : ''}${card.deadEnd ? ' dead-end' : ''}`;
    cardEl.innerHTML = generateCardHTML(card);
}

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => { if (gameState && gameState.status !== 'lobby') renderBoard(); });

// ─── Animations ───────────────────────────────────────────────────────────────
function playAnimation(animData) {
    return new Promise((resolve) => {
        const { type, player, card, opts } = animData;
        const ghost = document.createElement('div');
        ghost.className = `ghost-card ${card.type === 'action' ? 'action-card' : ''} ${card.deadEnd ? 'dead-end' : ''}`;
        ghost.innerHTML = generateCardHTML(card, opts && opts.rotated);
        document.body.appendChild(ghost);

        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;

        if (type === 'discard') {
            // Start at bottom center (where hand usually is)
            ghost.style.left = `${cx}px`;
            ghost.style.top = `${window.innerHeight}px`;
            ghost.style.transform = `translate(-50%, -50%) scale(0.5)`;
            
            // Force reflow
            void ghost.offsetWidth;

            // Fly to center, spin and shrink to trash
            ghost.style.transition = 'all 1s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            ghost.style.left = `${cx}px`;
            ghost.style.top = `${cy}px`;
            ghost.style.transform = `translate(-50%, -50%) scale(1.5) rotate(720deg)`;
            ghost.style.opacity = '0';
            
            setTimeout(() => {
                ghost.remove();
                resolve();
            }, 1000);
        } else if (type === 'playPath' || type === 'playAction') {
            // Start at bottom center
            ghost.style.left = `${cx}px`;
            ghost.style.top = `${window.innerHeight}px`;
            ghost.style.transform = `translate(-50%, -50%) scale(0.5)`;
            
            void ghost.offsetWidth;

            // Phase 1: Fly to center
            ghost.style.transition = 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            ghost.style.left = `${cx}px`;
            ghost.style.top = `${cy}px`;
            ghost.style.transform = `translate(-50%, -50%) scale(1.5)`;

            setTimeout(() => {
                // Phase 2: Fly to target
                if (type === 'playPath' || (opts && opts.x !== undefined)) {
                    // Calculate board target position
                    const boardEl = document.getElementById('board');
                    let scale = 1;
                    if (boardEl && boardEl.style.transform) {
                        const match = boardEl.style.transform.match(/scale\(([^)]+)\)/);
                        if (match) scale = parseFloat(match[1]);
                    }
                    const bRect = boardEl ? boardEl.getBoundingClientRect() : { left: cx, top: cy };

                    // Find minX, minY to offset correctly
                    let minX = 0, minY = -2;
                    if (gameState && gameState.board) {
                        for (const key in gameState.board) {
                            const [bx, by] = key.split(',').map(Number);
                            if (bx < minX) minX = bx;
                            if (by < minY) minY = by;
                        }
                    }
                    const PAD = 1.5;
                    const pMinX = minX - PAD;
                    const pMinY = minY - PAD;
                    const CELL_W = 90;
                    const CELL_H = 120;
                    
                    const targetLeft = (opts.x - pMinX) * CELL_W + CELL_W/2;
                    const targetTop = (opts.y - pMinY) * CELL_H + CELL_H/2;

                    const screenX = bRect.left + (targetLeft * scale);
                    const screenY = bRect.top + (targetTop * scale);

                    ghost.style.transition = 'all 0.5s ease-in';
                    ghost.style.left = `${screenX}px`;
                    ghost.style.top = `${screenY}px`;
                    ghost.style.transform = `translate(-50%, -50%) scale(${scale})`;
                    ghost.style.opacity = '0';
                } else {
                    // Fly to target player in sidebar (approximate right)
                    ghost.style.transition = 'all 0.5s ease-in';
                    ghost.style.left = `calc(100vw - 150px)`;
                    ghost.style.top = `${cy}px`;
                    ghost.style.transform = `translate(-50%, -50%) scale(0.5)`;
                    ghost.style.opacity = '0';
                }
                
                setTimeout(() => {
                    ghost.remove();
                    resolve();
                }, 500);
            }, 700);
        } else if (type === 'mapReveal') {
            // Start at target on board
            const boardEl = document.getElementById('board');
            let scale = 1;
            if (boardEl && boardEl.style.transform) {
                const match = boardEl.style.transform.match(/scale\(([^)]+)\)/);
                if (match) scale = parseFloat(match[1]);
            }
            const bRect = boardEl ? boardEl.getBoundingClientRect() : { left: cx, top: cy };
            
            let minX = 0, minY = -2;
            if (gameState && gameState.board) {
                for (const key in gameState.board) {
                    const [bx, by] = key.split(',').map(Number);
                    if (bx < minX) minX = bx;
                    if (by < minY) minY = by;
                }
            }
            const PAD = 1.5;
            const pMinX = minX - PAD;
            const pMinY = minY - PAD;
            const CELL_W = 90;
            const CELL_H = 120;
            
            const targetLeft = (opts.x - pMinX) * CELL_W + CELL_W/2;
            const targetTop = (opts.y - pMinY) * CELL_H + CELL_H/2;

            const screenX = bRect.left + (targetLeft * scale);
            const screenY = bRect.top + (targetTop * scale);

            ghost.className = 'ghost-card goal-card face-down';
            ghost.innerHTML = '';
            
            ghost.style.left = `${screenX}px`;
            ghost.style.top = `${screenY}px`;
            ghost.style.transform = `translate(-50%, -50%) scale(${scale})`;

            void ghost.offsetWidth;

            // Fly to center and spin
            ghost.style.transition = 'all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            ghost.style.left = `${cx}px`;
            ghost.style.top = `${cy}px`;
            ghost.style.transform = `translate(-50%, -50%) scale(2.5) rotateY(1080deg)`;

            setTimeout(() => {
                // Fly back
                ghost.style.transition = 'all 0.6s ease-in';
                ghost.style.left = `${screenX}px`;
                ghost.style.top = `${screenY}px`;
                ghost.style.transform = `translate(-50%, -50%) scale(${scale}) rotateY(0deg)`;
                
                setTimeout(() => {
                    ghost.remove();
                    resolve();
                }, 600);
            }, 1500); // 1.5s pause to read it? Actually, it's face down so no need to read.
        } else {
            ghost.remove();
            resolve();
        }
    });
}
// ─── Reconnection check on startup ───────────────────────────────────────────
(function checkSavedSession() {
    const saved = localStorage.getItem('saboteur_session');
    if (saved) {
        try {
            const session = JSON.parse(saved);
            if (session && session.roomCode && session.userId) {
                const modal = document.getElementById('reconnect-prompt-modal');
                if (modal) {
                    modal.classList.remove('hidden');
                    
                    document.getElementById('btn-reconnect-yes').onclick = () => {
                        modal.classList.add('hidden');
                        playerName = session.playerName;
                        selectedAvatar = session.avatar;
                        roomCode = session.roomCode;
                        socket.emit('reconnectPlayer', { room: session.roomCode, userId: session.userId });
                    };
                    
                    document.getElementById('btn-reconnect-no').onclick = () => {
                        modal.classList.add('hidden');
                        localStorage.removeItem('saboteur_session');
                    };
                }
            }
        } catch (e) {
            console.error('Failed to parse saved session:', e);
            localStorage.removeItem('saboteur_session');
        }
    }
})();
window.kickPlayer = (playerId) => {
    socket.emit('kickPlayer', { targetPlayerId: playerId });
};
