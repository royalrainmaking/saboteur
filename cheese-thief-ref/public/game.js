/* ╔══════════════════════════════════════════╗
   ║   CHEESE THIEF  –  Client Game Logic    ║
   ╚══════════════════════════════════════════╝ */

const socket = io();

// ── State ────────────────────────────────
let myId = null;
let currentRoom = null;
let prevPhase = null;
let myRole = null;
let myDice = null;

let actionDone = false;    // Prevents doing action twice (night phase)
let imReady = false;       // Have I clicked "Ready" for the current night step?
let multiGoodAwake = false; // True when 2+ good players share the same wake-up slot

// ── Helpers ──────────────────────────────
function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(id);
    if (page) page.classList.add('active');
}

function toast(msg, type = 'info', icon = '💬') {
    const c = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3100);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function initials(name) { return (name || '?').trim()[0].toUpperCase(); }

// ═════════════════════════════════════════
// DOM Elements
// ═════════════════════════════════════════

// Landing
const iName = document.getElementById('input-name');
const iCode = document.getElementById('input-code');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');

// Lobby
const btnCopy = document.getElementById('btn-copy');
const btnLeave = document.getElementById('btn-leave');
const btnReady = document.getElementById('btn-ready');
const btnStart = document.getElementById('btn-start');

// Night
const btnCallNext = document.getElementById('btn-call-next');
const btnEndNight = document.getElementById('btn-end-night');
const btnLightReady = document.getElementById('btn-light-ready');


// Result
const btnPlayAgain = document.getElementById('btn-play-again');
const btnBackHome = document.getElementById('btn-back-home');

// ═════════════════════════════════════════
// Listeners
// ═════════════════════════════════════════

let selectedAvatar = '🐶';
document.querySelectorAll('.avatar-option').forEach(el => {
    el.addEventListener('click', () => {
        document.querySelectorAll('.avatar-option').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        selectedAvatar = el.dataset.av;
    });
});

btnCreate.addEventListener('click', () => {
    const name = iName.value.trim();
    if (!name) return toast('ใส่ชื่อก่อนครับ', 'error', '⚠️');
    socket.emit('create_room', { name, avatar: selectedAvatar });
});

btnJoin.addEventListener('click', () => {
    const name = iName.value.trim();
    const code = iCode.value.trim().toUpperCase();
    if (!name) return toast('ใส่ชื่อก่อนครับ', 'error', '⚠️');
    if (code.length < 5) return toast('รหัสห้องต้องมี 5 ตัวอักษร', 'error', '⚠️');
    socket.emit('join_room', { name, code, avatar: selectedAvatar });
});

iName.addEventListener('keydown', e => {
    if (e.key === 'Enter') { iCode.value.trim() ? btnJoin.click() : btnCreate.click(); }
});
iCode.addEventListener('keydown', e => { if (e.key === 'Enter') btnJoin.click(); });
iCode.addEventListener('input', e => e.target.value = e.target.value.toUpperCase());

// Lobby
btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoom?.code || '').then(() => toast('คัดลอกรหัสแล้ว', 'success', '📋'));
});
btnLeave.addEventListener('click', () => {
    if (confirm('ต้องการออกจากห้องหรือไม่?')) {
        socket.emit('leave_room');
    }
});
btnReady.addEventListener('click', () => socket.emit('toggle_ready'));
btnStart.addEventListener('click', () => socket.emit('start_game'));



// Night actions
btnCallNext.addEventListener('click', () => { btnCallNext.disabled = true; socket.emit('call_next_step'); });
btnEndNight.addEventListener('click', () => { socket.emit('end_night'); });
btnLightReady.addEventListener('click', () => {
    actionDone = true;
    socket.emit('night_action_done');
    // Remove co-awake notice when going back to sleep
    const notice = document.getElementById('co-awake-notice');
    if (notice) notice.remove();
    renderNight(currentRoom);
});



// Result
btnPlayAgain.addEventListener('click', () => socket.emit('play_again'));
btnBackHome.addEventListener('click', resetToLanding);

function resetToLanding() {
    currentRoom = null; myRole = null; myDice = null;
    document.getElementById('lobby-wrap').classList.add('hidden');
    document.getElementById('login-card').style.display = 'block';
    const howCard = document.getElementById('how-card');
    if (howCard) howCard.style.display = '';
    showPage('page-landing');
}

// ═════════════════════════════════════════
// Renders
// ═════════════════════════════════════════

function renderLobby(room) {
    document.getElementById('lobby-wrap').classList.remove('hidden');
    document.getElementById('login-card').style.display = 'none';
    const howCard = document.getElementById('how-card');
    if (howCard) howCard.style.display = 'none';

    const amHost = room.hostId === myId;
    document.getElementById('lob-code').textContent = room.code;
    document.getElementById('lob-count').textContent = `(${room.players.length}/12)`;

    const list = document.getElementById('lob-players');
    list.innerHTML = '';
    room.players.forEach(p => {
        const isMe = p.id === myId;
        const badges = [];
        if (p.id === room.hostId) badges.push('<span class="badge badge-host">👑 Host</span>');
        if (p.id !== room.hostId) {
            badges.push(p.ready ? '<span class="badge badge-ready">✅ พร้อม</span>' : '<span class="badge badge-wait">⏳ รอ</span>');
        }
        if (!p.connected) badges.push('<span class="badge badge-offline">📵 ออฟไลน์</span>');

        const div = document.createElement('div');
        div.className = 'player-item';
        div.innerHTML = `
      <div class="player-avatar">${p.avatar || initials(p.name)}</div>
      <div class="player-name">${escapeHtml(p.name)}${isMe ? ' <span style="color:var(--gold);font-size:0.8rem">(ฉัน)</span>' : ''}</div>
      <div class="player-badges">${badges.join('')}</div>
    `;

        if (amHost && !isMe) {
            const btnKick = document.createElement('button');
            btnKick.textContent = '❌ เตะ';
            btnKick.style.cssText = 'background:transparent; color:#ef4444; border:1px solid #ef4444; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:8px; cursor:pointer; font-weight:bold;';
            btnKick.onclick = () => { if (confirm(`เตะ ${p.name} ออกจากห้อง?`)) socket.emit('kick_player', { targetId: p.id }); };
            div.querySelector('.player-badges').appendChild(btnKick);
        }

        list.appendChild(div);
    });

    btnReady.classList.toggle('hidden', amHost);
    btnStart.classList.toggle('hidden', !amHost);

    const me = room.players.find(p => p.id === myId);
    if (me && !amHost) {
        btnReady.innerHTML = me.ready ? '❌ ยกเลิก' : '✅ พร้อมเล่น';
    }

    const need = Math.max(0, 4 - room.players.length);
    const hintEl = document.getElementById('lob-hint');
    if (amHost) {
        hintEl.style.display = room.players.length >= 4 ? 'none' : 'block';
        document.getElementById('lob-need').textContent = need;
    } else {
        hintEl.style.display = 'block';
        hintEl.textContent = room.players.length >= 4 ? 'กำลังรอ Host เริ่มเกม...' : `รอผู้เล่นอีก ${need} คน...`;
    }
}

// ── Night Intro Sequence ─────────────────────────────
let diceShown = false;
let currentAwakePlayers = [];

function playNightIntro(room) {
    const box = document.getElementById('night-action-box');

    if (!diceShown) {
        // Build initial HTML structure ONE TIME ONLY
        box.innerHTML = `
          <div id="intro-container" class="intro-container">
            <div id="intro-role" class="intro-role-card">
               <div id="intro-role-inner" class="intro-role-inner">
                 <div class="intro-role-front">❓</div>
                 <div class="intro-role-back">${myRole === 'good' ? '🐭' : (myRole === 'thief' ? '🦹' : '😈')}</div>
               </div>
               <div id="intro-role-label" style="text-align:center; font-weight:bold; margin-top:8px; opacity:0; transition:opacity 0.5s;">${getRoleName(myRole)}</div>
            </div>
            <div id="intro-dice" class="hidden">🎲</div>
            <div id="intro-text" style="display:none; text-align:center;">
              <div style="font-size:1.1rem; color:var(--gold); margin-bottom:4px;">⏰ เวลาตื่นของคุณคือ</div>
              <div style="font-size:3rem; font-weight:900; color:#fff; letter-spacing:2px; text-shadow:0 0 15px rgba(255,255,255,0.4);">
                0${myDice}:00 AM
              </div>
            </div>
            <div id="intro-ok-wrap" style="display:none; margin-top:20px;">
              <button id="btn-intro-ok" class="btn btn-gold big-btn" style="font-size:1.2rem; padding:14px 40px;">
                ✅ ตกลง
              </button>
            </div>
          </div>
        `;

        diceShown = true;
        const ring = document.getElementById('intro-role-inner');
        const rLabel = document.getElementById('intro-role-label');
        const diceB = document.getElementById('intro-dice');
        const txt = document.getElementById('intro-text');
        const okWrap = document.getElementById('intro-ok-wrap');

        // 1. Flip role card
        setTimeout(() => {
            ring.classList.add('is-flipped');
            rLabel.style.opacity = '1';

            // 2. Drop in dice and shake
            setTimeout(() => {
                diceB.classList.remove('hidden');
                diceB.classList.add('shake-anim');

                // 3. Stop shaking, reveal number + time + OK button
                setTimeout(() => {
                    diceB.classList.remove('shake-anim');
                    diceB.classList.add('intro-dice-pop');
                    diceB.textContent = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][myDice] || '🎲';
                    txt.style.display = 'block';
                    txt.classList.add('intro-dice-pop');
                    const memBox = document.getElementById('my-memory-box');
                    if (memBox) {
                        memBox.classList.remove('hidden');
                        document.getElementById('mem-dice').textContent = (myDice ?? '?') + ':00';
                    }
                    // Reveal OK button after a beat
                    setTimeout(() => {
                        okWrap.style.display = 'block';
                        const btn = document.getElementById('btn-intro-ok');
                        if (btn && !btn.disabled) {
                            btn.addEventListener('click', () => {
                                socket.emit('intro_confirm');
                                btn.textContent = '✅ รอ...';
                                btn.disabled = true;
                                btn.style.opacity = '0.4';
                            });
                        }
                    }, 500);
                }, 1800);
            }, 800);
        }, 500);
    } else {
        // Already shown — just wire up OK button if not yet confirmed or update state
        const me = room.players.find(p => p.id === myId);
        const btn = document.getElementById('btn-intro-ok');
        if (btn) {
            if (!me?.introReady) {
                // Not yet clicked, re-add listener safely (button might have been clicked then update received)
                btn.onclick = () => {
                    socket.emit('intro_confirm');
                    btn.textContent = '✅ รอ...';
                    btn.disabled = true;
                    btn.style.opacity = '0.4';
                };
            } else {
                // I have confirmed, ensure button reflects that
                btn.textContent = '✅ รอ...';
                btn.disabled = true;
                btn.style.opacity = '0.4';
            }
        }
    }
}

// Live badge of who has NOT confirmed the intro
function updateIntroStatus(room) {
    let badge = document.getElementById('intro-status-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'intro-status-badge';
        badge.style.cssText = [
            'position:fixed', 'top:14px', 'right:14px', 'z-index:200',
            'background:rgba(0,0,0,0.75)', 'backdrop-filter:blur(8px)',
            'border:1px solid rgba(255,215,0,0.3)', 'border-radius:10px',
            'padding:10px 14px', 'font-size:0.8rem', 'max-width:180px',
            'box-shadow:0 4px 15px rgba(0,0,0,0.5)'
        ].join(';');
        document.body.appendChild(badge);
    }
    const waiting = room.players.filter(p => !p.introReady);
    if (waiting.length === 0 || room.nightStep > 0) {
        badge.remove();
        return;
    }
    badge.innerHTML = `
        <div style="color:var(--gold);font-weight:bold;margin-bottom:6px">⏳ รอกดตกลง (${room.players.length - waiting.length}/${room.players.length})</div>
        ${waiting.map(p => `<div style="color:#ccc;padding:2px 0">🔴 ${escapeHtml(p.name)}</div>`).join('')}
    `;
}

// ── Co-Awake Bottom-Right Notice ──────────────────────
function showCoAwakeNotice(awakePlayers, myRoleArg) {
    const old = document.getElementById('co-awake-notice');
    if (old) old.remove();

    const others = awakePlayers.filter(p => p.id !== myId);
    if (others.length === 0) return; // alone, no notice needed

    const isEvil = myRoleArg !== 'good';
    const notice = document.createElement('div');
    notice.id = 'co-awake-notice';
    notice.style.cssText = [
        'position:fixed', 'bottom:20px', 'right:20px', 'z-index:300',
        'background:rgba(0,0,0,0.88)', 'backdrop-filter:blur(10px)',
        'border:1px solid ' + (isEvil ? 'rgba(255,140,0,0.6)' : 'rgba(100,200,255,0.45)'),
        'border-radius:12px', 'padding:12px 16px',
        'font-size:0.82rem', 'max-width:220px',
        'box-shadow:0 4px 20px rgba(0,0,0,0.6)',
        'animation:popIn 0.4s ease'
    ].join(';');

    notice.innerHTML = `
        <div style="color:${isEvil ? 'var(--orange)' : '#7dd3fc'};font-weight:bold;margin-bottom:8px;font-size:0.88rem;">
            ${isEvil ? '😈 ทีมโจรตื่นพร้อมกัน' : '👥 ตื่นมาพร้อมกัน'}
        </div>
        ${others.map(p => `<div style="color:#ddd;padding:2px 0;">⚡ ${escapeHtml(p.name)}</div>`).join('')}
        ${!isEvil ? '<div style="color:#94a3b8;font-size:0.75rem;margin-top:6px;">ไม่สามารถแอบดูเวลาใครได้รอบนี้</div>' : ''}
    `;
    document.body.appendChild(notice);
}

function renderNight(room) {
    const amHost = room.hostId === myId;
    const me = room.players.find(p => p.id === myId);
    const amAwake = room.nightStep > 0 && room.nightStep === myDice;

    // Ambient background colour
    const ambBg = document.getElementById('night-ambient-bg');
    ambBg.className = 'night-ambient-bg';
    if (amAwake && !actionDone) {
        ambBg.classList.add('awake');
        if (myRole === 'thief') ambBg.classList.add('role-thief');
        if (myRole === 'henchman') ambBg.classList.add('role-henchman');
    }

    // Clock & Content
    const clockEl = document.getElementById('night-clock');
    const statusEl = document.getElementById('night-dark-status');
    if (room.nightStep === 0) {
        clockEl.textContent = '12:00 AM';
        statusEl.textContent = 'เกมกำลังจะเริ่ม...';
        playNightIntro(room);
        updateIntroStatus(room);
    } else {
        if (room.nightStep > room.totalNightSteps) {
            clockEl.textContent = '09:00 AM';
            statusEl.textContent = 'แสงแรกแห่งเช้า ☀️';
            // Dawn state — show sunrise UI, NOT the sleeping animation
            const box = document.getElementById('night-action-box');
            box.innerHTML = `
              <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:350px; gap:16px;">
                <div style="font-size:6rem; animation:logoBounce 2s ease-in-out infinite;">🌅</div>
                <div style="font-size:1.3rem; color:var(--yellow); font-weight:bold; text-align:center;">คืนผ่านไปแล้ว...</div>
                <div style="font-size:0.95rem; color:var(--text-dim); text-align:center;">กำลังเข้าสู่การอภิปรายและโหวต</div>
              </div>
            `;
            // The unified host-controls block below handles visibility
        } else {
            const h = String(room.nightStep).padStart(2, '0');
            clockEl.textContent = `${h}:00 AM`;
            statusEl.textContent = amAwake ? '✨ ถึงเวลาของคุณ' : '💤 รอผู้เล่นทำกิจกรรม...';
            buildNightCircle(amAwake ? myRole : null, room);
        }
    }

    // Host controls visibility (use style.display — consistent with HTML)
    const hostCtrl = document.getElementById('host-controls');
    const awakeCtrl = document.getElementById('awake-controls');
    const isDawn = room.nightStep > room.totalNightSteps;

    hostCtrl.style.display = (amHost && !amAwake && !isDawn) ? '' : 'none';
    awakeCtrl.classList.toggle('hidden', !amAwake || isDawn);

    // Remove co-awake notice when no longer awake
    if (!amAwake || isDawn) {
        const notice = document.getElementById('co-awake-notice');
        if (notice) notice.remove();
        if (!amAwake) multiGoodAwake = false;
    }

    // Good player must peek first — UNLESS multiple good woke together (skip peek)
    const needsPeekFirst = myRole === 'good' && !actionDone && !multiGoodAwake;
    btnLightReady.disabled = needsPeekFirst;
    btnLightReady.style.opacity = needsPeekFirst ? '0.4' : '1';
    btnLightReady.textContent = needsPeekFirst
        ? '👆 ดูเวลาตื่นเพื่อนก่อน แล้วค่อยกด'
        : '✅ เสร็จแล้ว แกล้งหลับต่อ';

    // Host call-next / end-night buttons
    if (amHost && !amAwake && !isDawn) {
        if (room.nightStep === 0) {
            btnCallNext.style.display = '';
            btnCallNext.disabled = false;
            btnEndNight.style.display = 'none';
            btnCallNext.textContent = '▶ เริ่มต้นคืน';
        } else if (room.nightStep > room.totalNightSteps) {
            btnCallNext.style.display = 'none';
            btnEndNight.style.display = '';
        } else {
            btnCallNext.style.display = '';
            btnCallNext.disabled = false;
            btnEndNight.style.display = 'none';
            btnCallNext.textContent = `▶ เรียกเวลา ${String(room.nightStep + 1).padStart(2, '0')}:00 AM`;
        }
    }
}



function renderVote(room) {
    const me = room.players.find(p => p.id === myId);
    const alreadyVoted = me?.hasVoted;
    const votedCount = room.players.filter(p => p.hasVoted).length;
    const total = room.players.length;

    // Progress counter
    document.getElementById('vote-progress').textContent =
        `โหวตแล้ว ${votedCount}/${total} คน`;

    // Show/hide the voted-done banner
    const doneEl = document.getElementById('voted-done');
    doneEl.classList.toggle('hidden', !alreadyVoted);

    // Build the circle stage inside vote-circle-wrap
    const wrap = document.getElementById('vote-circle-wrap');
    if (!wrap) return; // guard: element not ready
    wrap.innerHTML = `
      <div class="night-circle-stage" id="vote-circle-stage">
        <div class="night-center-cheese ${room.isCheeseStolen ? 'stolen' : ''}"
             style="font-size:3.5rem; cursor:default;">
          ${room.isCheeseStolen ? '' : '🧀'}
        </div>
      </div>
      <div style="text-align:center; margin-top:8px; color:var(--text2); font-size:0.9rem;">
        ${alreadyVoted
            ? '<span style="color:#4ade80;">✅ คุณโหวตแล้ว รอผลจากทุกคน...</span>'
            : (room.isCheeseStolen
                ? '😲 ชีสหายไป! กดที่คนที่คุณสงสัย'
                : '🧀 ชีสยังอยู่? กดที่คนที่คุณสงสัย')}
      </div>
    `;

    const stage = document.getElementById('vote-circle-stage');
    const myIdx = room.players.findIndex(x => x.id === myId);
    const myVoteTarget = me?.votedFor;

    room.players.forEach((p, i) => {
        const relIdx = (i - myIdx + total) % total;
        const angleDeg = 90 + (relIdx * (360 / total));
        const angleRad = angleDeg * (Math.PI / 180);
        const px = Math.cos(angleRad) * 130;
        const py = Math.sin(angleRad) * 130;

        const div = document.createElement('div');
        div.className = `circle-player ${p.id === myId ? 'is-me' : ''}`;
        div.style.left = `calc(50% + ${px}px)`;
        div.style.top = `calc(50% + ${py}px)`;

        // Highlight the player this user voted for
        if (myVoteTarget && p.id === myVoteTarget) {
            div.style.border = '2px solid #f87171';
            div.style.boxShadow = '0 0 12px #f87171';
        }

        const isMe = p.id === myId;
        const votesForP = room.players.filter(x => x.votedFor === p.id).length;
        const hasCheese = room.cheeseHolderId === p.id ? '🧀 ' : '';

        div.innerHTML = `
          <div class="cp-av" style="${isMe ? 'border:2px solid var(--purple)' : ''}">
            ${hasCheese || (p.avatar || initials(p.name))}
          </div>
          <div class="cp-name">${hasCheese}${escapeHtml(p.name)}${isMe ? ' (ฉัน)' : ''}</div>
          ${p.hasVoted ? '<div style="position:absolute;top:-6px;right:-6px;background:#4ade80;color:#000;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;box-shadow:0 2px 5px rgba(0,0,0,0.5);">✓</div>' : ''}
          ${votesForP > 0 ? `<div style="position:absolute;bottom:-12px;left:50%;transform:translateX(-50%);background:#f87171;color:#fff;border-radius:12px;padding:3px 10px;font-size:11px;font-weight:bold;box-shadow:0 2px 8px rgba(248,113,113,0.5);border:2px solid #000;white-space:nowrap;z-index:2;">ถูกโหวต ${votesForP}</div>` : ''}
        `;

        // Tap to vote — anyone except self, only before voting
        if (!alreadyVoted && p.id !== myId) {
            div.classList.add('peekable');
            div.style.cursor = 'pointer';
            div.addEventListener('click', () => socket.emit('cast_vote', { targetId: p.id }));
        }
        stage.appendChild(div);
    });
}

function renderResult(room) {
    const amHost = room.hostId === myId;
    const { winner, caughtId, thiefId } = room.roundResult || {};

    const bg = document.getElementById('result-bg-layer');
    bg.className = 'result-bg-layer ' + (winner === 'good' ? 'good-wins' : 'thief-wins');
    document.getElementById('res-icon').textContent = winner === 'good' ? '🐭' : '🦹';
    document.getElementById('res-title').textContent = winner === 'good' ? 'หนูดีชนะ!' : 'จอมโจรรอดไปได้!';
    document.getElementById('res-title').style.color = winner === 'good' ? '#4ade80' : '#f87171';

    const caught = room.players.find(x => x.id === caughtId);
    const thief = room.players.find(x => x.id === thiefId);

    const sub = document.getElementById('res-sub');
    if (winner === 'good') {
        sub.innerHTML = `จับ <b>${escapeHtml(caught?.name)}</b> ได้! เขาคือจอมโจรตัวจริง`;
    } else {
        sub.innerHTML = caughtId
            ? `เพื่อนโหวต <b>${escapeHtml(caught?.name)}</b> ซึ่งไม่ใช่โจร... โจรตัวจริงหนีรอดไปได้!`
            : `โหวตเสมอกัน โจรหนีรอดไปได้!`;
    }

    const grid = document.getElementById('res-players');
    grid.innerHTML = '';
    room.players.forEach(p => {
        const card = document.createElement('div');
        card.className = `res-card ${p.role}` + (p.id === caughtId ? ' caught' : '');
        card.innerHTML = `
      <div class="res-av">${p.avatar || initials(p.name)}</div>
      <div class="res-name">${escapeHtml(p.name)}${p.id === myId ? ' (ฉัน)' : ''}</div>
      <div class="res-role-chip ${p.role}">${getRoleName(p.role)}</div>
      <div class="res-dice">⏰ เวลาตื่น: ${p.dice ?? '?'}</div>
      ${p.id === caughtId ? '<div class="res-caught">⛓️ ถูกจับ</div>' : ''}
    `;
        grid.appendChild(card);
    });

    btnPlayAgain.classList.toggle('hidden', !amHost);
}

// ═════════════════════════════════════════
// Night Circle Builder
// ═════════════════════════════════════════
function buildNightCircle(roleInfo, room) {
    const isActuallySleeping = !roleInfo || actionDone;
    const box = document.getElementById('night-action-box');

    if (isActuallySleeping) {
        box.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:350px; opacity:0.8; animation: sleepPulse 3s infinite ease-in-out;">
                <div style="font-size: 6rem; margin-bottom: 20px;">😴</div>
                <div style="font-size: 1.2rem; color: var(--gold);">(คุณกำลังหลับตา...)</div>
            </div>
        `;
        return;
    }

    const isStolen = room.isCheeseStolen;
    box.innerHTML = `
      <div class="night-circle-stage" id="night-circle-stage">
        <div id="night-center-cheese" class="night-center-cheese ${isStolen && !actionDone ? 'stolen' : ''}">
          ${(isStolen && !actionDone) ? '' : '🧀'}
        </div>
      </div>
      <div id="night-action-text" class="action-desc" style="text-align:center; margin-top:10px;"></div>
    `;

    const stageCircle = document.getElementById('night-circle-stage');
    const cheese = document.getElementById('night-center-cheese');
    const txt = document.getElementById('night-action-text');
    const isAwake = !!roleInfo;

    const total = room.players.length;
    const myIdx = room.players.findIndex(x => x.id === myId);

    // Check if team is evil and multiple people are awake
    const multipleAwake = currentAwakePlayers.length > 1;

    room.players.forEach((p, i) => {
        let relIdx = (i - myIdx + total) % total;
        let angleDeg = 90 + (relIdx * (360 / total));
        let angleRad = angleDeg * (Math.PI / 180);
        let px = Math.cos(angleRad) * 130;
        let py = Math.sin(angleRad) * 130;

        const div = document.createElement('div');
        div.className = `circle-player ${p.id === myId ? 'is-me' : ''}`;
        div.id = `circle-p-${p.id}`;
        div.style.left = `calc(50% + ${px}px)`;
        div.style.top = `calc(50% + ${py}px)`;

        // Co-awake evil visibility
        const isEvilMate = isAwake && p.id !== myId && currentAwakePlayers.some(ap => ap.id === p.id && ap.role);
        let mateRoleIcon = '';
        if (isEvilMate) {
            div.style.border = '2px solid var(--orange)';
            div.style.boxShadow = '0 0 10px var(--orange)';
            const mr = currentAwakePlayers.find(ap => ap.id === p.id).role;
            mateRoleIcon = mr === 'thief' ? '🦹' : (mr === 'henchman' ? '😈' : '');
        }
        const hasCheese = room.cheeseHolderId === p.id ? '🧀 ' : '';

        div.innerHTML = `
          ${hasCheese || mateRoleIcon || (p.avatar || initials(p.name))}
          <div class="cp-name">${hasCheese}${escapeHtml(p.name)}</div>
        `;

        if (room.cheeseHolderId === p.id) {
            const trail = document.createElement('div');
            trail.className = 'cheese-trail';
            trail.style.setProperty('--tx', `${px}px`);
            trail.style.setProperty('--ty', `${py}px`);
            trail.style.setProperty('--rot', `${angleDeg}deg`);
            trail.innerHTML = `
               <div class="trail-line"></div>
               <div class="trail-cheese">🧀</div>
            `;
            stageCircle.appendChild(trail);
        }

        // Peek logic (only for Good, alone) — disabled when multiple good awake together
        if (roleInfo === 'good' && !actionDone && !multiGoodAwake && p.id !== myId) {
            div.classList.add('peekable');
            div.addEventListener('click', () => {
                if (actionDone) return;
                socket.emit('peek_dice', { targetId: p.id });
                actionDone = true;
                document.querySelectorAll('.peekable').forEach(el => el.classList.remove('peekable'));

                // Update UI without full rerender
                const btn = document.getElementById('btn-light-ready');
                if (btn) {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.textContent = '✅ เสร็จแล้ว แกล้งหลับต่อ';
                }
                const txt = document.getElementById('night-action-text');
                if (txt) txt.innerHTML = '✅ ดูเวลาตื่นเรียบร้อยแล้ว! กดปุ่มด้านล่างเพื่อแกล้งหลับ';
            });
        }
        stageCircle.appendChild(div);
    });

    if (!isAwake) {
        txt.innerHTML = '';
        return;
    }

    if (roleInfo === 'thief') {
        const henchman = currentAwakePlayers.find(p => p.role === 'henchman');
        const hmName = henchman ? escapeHtml(henchman.name) : null;
        const hmText = hmName ? `<br><span style="font-size:0.95rem;color:var(--orange);margin-top:4px;display:block;">😈 ลูกสมุนของคุณที่ตื่นอยู่คือ: <b>${hmName}</b></span>` : '';

        if (isStolen || actionDone) {
            txt.innerHTML = '✅ คุณแอบขโมยชีสมาแล้ว ซ่อนมันไว้ให้ดีล่ะ!' + hmText;
            // Make sure cheese is visually gone
            const c = document.getElementById('night-center-cheese');
            if (c) c.classList.add('stolen');
            const memAction = document.getElementById('mem-action');
            if (memAction && actionDone) memAction.innerHTML = '🧀 สเตตัส: <b style="color:var(--orange);">แอบขโมยชีสแล้ว</b>' + (hmName ? `<br>😈 ลูกสมุน: <b>${hmName}</b>` : '');
        } else {
            txt.innerHTML = 'กำลังขโมยชีส... 🧀' + hmText;
            if (!window._thiefStealing) {
                window._thiefStealing = true;
                setTimeout(() => {
                    // Re-query fresh DOM elements (avoid stale references)
                    const freshMe = document.getElementById(`circle-p-${myId}`);
                    const freshCheese = document.getElementById('night-center-cheese');
                    const freshTxt = document.getElementById('night-action-text');
                    if (!freshMe || !freshCheese) { window._thiefStealing = false; return; }

                    socket.emit('take_cheese');

                    const meRect = freshMe.getBoundingClientRect();
                    const chRect = freshCheese.getBoundingClientRect();
                    const dx = (chRect.left + chRect.width / 2) - (meRect.left + meRect.width / 2);
                    const dy = (chRect.top + chRect.height / 2) - (meRect.top + meRect.height / 2);

                    const hand = document.createElement('div');
                    hand.className = 'thief-hand';
                    hand.textContent = '🖐️';
                    hand.style.left = (meRect.left + meRect.width / 2 - 20) + 'px';
                    hand.style.top = (meRect.top + meRect.height / 2 - 20) + 'px';
                    document.body.appendChild(hand);

                    setTimeout(() => {
                        hand.style.transform = `translate(${dx}px, ${dy}px) rotate(-15deg)`;
                        setTimeout(() => {
                            hand.textContent = '✊🧀';
                            freshCheese.classList.add('stolen'); // cheese disappears
                            freshCheese.textContent = '';
                            hand.style.transform = `translate(0px, 0px) rotate(0deg)`;
                            setTimeout(() => {
                                hand.remove();
                                if (freshTxt) freshTxt.innerHTML = '✅ ขโมยชีสเข้ากระเป๋าแล้ว! กด "เสร็จแล้ว" ด้านล่าง' + hmText;
                                const memAction = document.getElementById('mem-action');
                                if (memAction) memAction.innerHTML = '🧀 สเตตัส: <b style="color:var(--orange);">แอบขโมยชีสแล้ว</b>' + (hmName ? `<br>😈 ลูกสมุน: <b>${hmName}</b>` : '');
                                window._thiefStealing = false;
                            }, 400);
                        }, 400);
                    }, 50);
                }, 1200);
            }
        }
    } else if (roleInfo === 'henchman') {
        const thief = currentAwakePlayers.find(p => p.role === 'thief');
        const thiefName = escapeHtml(thief?.name || '?');
        txt.innerHTML = `<div style="font-size:1.2rem; color:var(--orange); font-weight:900; margin-bottom: 10px; animation: popIn 0.5s ease; text-shadow: 0 0 10px rgba(255, 165, 0, 0.5); line-height:1.4;">🔥 คุณตื่นมาพร้อมกับจอมโจร และถูกจับเป็น "สมุนโจร!" 😈</div>` +
            (isStolen
                ? `<div style="font-size:1.05rem">จอมโจรของคุณคือ: <b style="color:#f87171; font-size:1.2rem;">${thiefName}</b><br><span style="color:var(--text-dim);font-size:0.85rem;">(ชีสถูกขโมยไปแล้ว)</span></div>`
                : `<div style="font-size:1.05rem">ช่วยเหลือจอมโจรของคุณ: <b style="color:#f87171; font-size:1.2rem;">${thiefName}</b><br><span style="color:var(--text-dim);font-size:0.85rem;">(เขากำลังแอบขโมยชีส)</span></div>`);
        const memAction = document.getElementById('mem-action');
        if (memAction) memAction.innerHTML = `😈 สมุนของโจร: <b style="color:#f87171;">${thiefName}</b>`;
    } else if (roleInfo === 'good') {
        if (multiGoodAwake) {
            // Multiple good players awake — no peek allowed, show co-awake message
            const others = currentAwakePlayers.filter(ap => ap.id !== myId);
            const namesHtml = others.map(ap => `<b style="color:#7dd3fc">${escapeHtml(ap.name)}</b>`).join(', ');
            const namesText = others.map(ap => escapeHtml(ap.name)).join(', ');
            txt.innerHTML = `
                <div style="font-size:1.05rem;color:#7dd3fc;font-weight:bold;margin-bottom:8px;">👥 คุณตื่นมาพร้อมกับ ${namesHtml}</div>
                <div style="font-size:0.9rem;color:var(--text-dim);">เพราะตื่นมาพร้อมกัน จึงไม่สามารถแอบดูเวลาตื่นใครได้รอบนี้<br><span style="color:#94a3b8;">กด "เสร็จแล้ว" เพื่อแกล้งหลับต่อ</span></div>
            `;
            // Update memory box
            const memAction = document.getElementById('mem-action');
            if (memAction) memAction.innerHTML = `👥 ตื่นพร้อม: <b style="color:#7dd3fc;">${namesText}</b>`;
        } else if (actionDone) {
            txt.innerHTML = '✅ ดูเวลาตื่นเรียบร้อยแล้ว! กดปุ่มด้านล่างเพื่อแกล้งหลับ';
        } else {
            txt.innerHTML = isStolen
                ? `<b>ชีสหายไปแล้ว!</b> 😲 กดดูเวลาตื่นใครก็ได้ในวงเพื่อแอบดู`
                : `ชีสยังตั้งอยู่! กดดูเวลาตื่นใครก็ได้ในวงเพื่อแอบดูไว้เป็นเบาะแส`;
        }
    }
}

// ═════════════════════════════════════════
// Socket Handlers
// ═════════════════════════════════════════

socket.on('connect', () => { myId = socket.id; });

socket.on('room_created', ({ code }) => showPage('page-landing'));
socket.on('room_joined', ({ code }) => showPage('page-landing'));

socket.on('room_update', (room) => {
    const incPhase = room.phase;

    // Save personal info
    const me = room.players.find(p => p.id === myId);
    if (me) {
        if (me.role) myRole = me.role;
        if (me.dice) myDice = me.dice;
    }

    // Reset state if phase transitions to night
    const oldPhase = currentRoom ? currentRoom.phase : null;
    if (incPhase === 'night' && oldPhase !== 'night') {
        actionDone = false;
        imReady = false;
        diceShown = false;
        multiGoodAwake = false;
        currentAwakePlayers = [];
        const memAction = document.getElementById('mem-action');
        if (memAction) memAction.innerHTML = '';
    }

    const memBox = document.getElementById('my-memory-box');
    if (memBox) {
        if ((incPhase === 'night' && diceShown) || incPhase === 'vote') {
            memBox.classList.remove('hidden');
            document.getElementById('mem-dice').textContent = (myDice ?? '?') + ':00';
        } else {
            memBox.classList.add('hidden');
        }
    }

    currentRoom = room;

    switch (incPhase) {
        case 'lobby': renderLobby(room); showPage('page-landing'); break;
        case 'night':
            if (!window._thiefStealing) renderNight(room);
            showPage('page-night');
            break;
        case 'vote': renderVote(room); showPage('page-vote'); break;
        case 'result': renderResult(room); showPage('page-result'); break;
    }
});

socket.on('your_turn', ({ role, step, awakePlayers }) => {
    if (!currentRoom) return;
    actionDone = false;
    currentAwakePlayers = awakePlayers || [];
    // Detect multiple good players sharing the same wake-up slot
    multiGoodAwake = role === 'good' && currentAwakePlayers.length > 1;
    showCoAwakeNotice(currentAwakePlayers, role);
    renderNight(currentRoom);
});

socket.on('all_ready_for_next_step', ({ step }) => {
    if (currentRoom && currentRoom.hostId === myId) {
        btnCallNext.disabled = false;
        btnCallNext.innerHTML = `▶ เรียกหมายเลข ${step + 1}`;
        // Optional: add a visual pulse so host sees it's time
    }
});

socket.on('peek_result', ({ targetName, dice }) => {
    if (multiGoodAwake) return; // blocked: multiple good players awake, peek not allowed
    const wakeH = String(dice).padStart(2, '0');
    const txt = document.getElementById('night-action-text');
    if (txt) {
        const msg = `<div class="peek-result" style="text-align:center;margin-bottom:10px;">👀 เวลาที่ <b>${escapeHtml(targetName)}</b> ตื่นคือ <b>${wakeH}:00 AM</b></div>`;
        txt.innerHTML = msg + txt.innerHTML;
    }
    const memAction = document.getElementById('mem-action');
    if (memAction) {
        memAction.innerHTML = `👀 ดู <b>${escapeHtml(targetName)}</b> = <b style="color:var(--yellow);">${wakeH}:00</b>`;
    }
});

socket.on('cheese_taken', ({ thiefId }) => {
    // Animate the cheese-steal for co-awake evil teammates (henchman watching thief act)
    if (currentRoom?.phase === 'night' && myId !== thiefId) {
        const thiefEl = document.getElementById(`circle-p-${thiefId}`);
        const cheeseEl = document.getElementById('night-center-cheese');
        if (thiefEl && cheeseEl && !cheeseEl.classList.contains('stolen')) {
            const tr = thiefEl.getBoundingClientRect();
            const cr = cheeseEl.getBoundingClientRect();
            const dx = (cr.left + cr.width / 2) - (tr.left + tr.width / 2);
            const dy = (cr.top + cr.height / 2) - (tr.top + tr.height / 2);

            const hand = document.createElement('div');
            hand.className = 'thief-hand';
            hand.textContent = '🖐️';
            hand.style.left = (tr.left + tr.width / 2 - 20) + 'px';
            hand.style.top = (tr.top + tr.height / 2 - 20) + 'px';
            document.body.appendChild(hand);

            setTimeout(() => {
                hand.style.transform = `translate(${dx}px, ${dy}px) rotate(-15deg)`;
                setTimeout(() => {
                    hand.textContent = '✊🧀';
                    cheeseEl.classList.add('stolen');
                    cheeseEl.textContent = '';
                    hand.style.transform = 'translate(0px, 0px) rotate(0deg)';
                    setTimeout(() => hand.remove(), 400);
                }, 400);
            }, 50);
        }
    }
});

socket.on('night_end', () => {
    // night_end is informational only; renderNight handles button state via room_update
});



socket.on('left_room', () => {
    resetToLanding();
});

socket.on('kicked', () => {
    resetToLanding();
    setTimeout(() => toast('คุณถูกเตะออกจากห้อง', 'error', '⚠️'), 300);
});

// System text
socket.on('chat', (msg) => {
    const buildItem = () => {
        const d = document.createElement('div');
        d.className = 'chat-msg' + (msg.system ? ' sys' : '');
        if (msg.system) d.innerHTML = `<span class="body">— ${escapeHtml(msg.message)} —</span>`;
        else d.innerHTML = `<span class="sender">${escapeHtml(msg.playerName)}:</span> <span class="body">${escapeHtml(msg.message)}</span>`;
        return d;
    };
    const lob = document.getElementById('lob-chat');
    if (lob) { lob.appendChild(buildItem()); lob.scrollTop = lob.scrollHeight; }
});

socket.on('error', ({ message }) => toast(message, 'error', '❌'));

// Utility map
function getRoleName(k) { return { good: 'หนูดี', thief: 'จอมโจรชีส', henchman: 'ลูกสมุน' }[k] || 'Unknown'; }

// Init
showPage('page-landing');
