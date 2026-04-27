// ─────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const W = 500, H = 500, CX = 250, CY = 250;
const BORDER = 40;       // board edge thickness
const WALL_MIN = BORDER;
const WALL_MAX_X = W - BORDER;
const WALL_MAX_Y = H - BORDER;
const POCKET_R = 24;     // pocket hole radius/
const PIECE_R = 15;      // normal piece radius/
const STRIKER_R = 18;    // striker radius/
const FRICTION = 0.983;  // per-frame velocity multiplier/
const RESTITUTION = 0.72;// bounce energy retention/
const MAX_SPEED = 22;    // max launch speed/
const MAX_DRAG = 120;    // max drag distance in px/

// ─────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────
let pieces = [];
let striker = null;
let scores = [0, 0];
let turn = 1;           // 1 = player, 2 = CPU
let phase = 'aim';      // 'aim' | 'moving' | 'cpu_wait'
let gameOn = false;

// Drag state
let dragging = false;
let dragStart = { x: 0, y: 0 };
let dragNow   = { x: 0, y: 0 };

// ─────────────────────────────────────────
//  PIECE
// ─────────────────────────────────────────
class Piece {
  constructor(x, y, type) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.type = type;  // 'black' | 'white' | 'red' | 'striker'
    this.r = (type === 'striker') ? STRIKER_R : PIECE_R;
    this.alive = true;
  }

  /* colours */
  get fillColor() {
    if (this.type === 'black')  return '#1c1c14';
    if (this.type === 'white')  return '#f2ede0';
    if (this.type === 'red')    return '#c0392b';
    if (this.type === 'striker')return '#e8c84a';
    return '#888';
  }
  get rimColor() {
    if (this.type === 'black')  return '#555';
    if (this.type === 'white')  return '#bbb';
    if (this.type === 'red')    return '#7a1010';
    if (this.type === 'striker')return '#b09020';
    return '#444';
  }

  draw() {
    if (!this.alive) return;
    ctx.save();
    // shadow
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur  = 6;
    ctx.shadowOffsetY = 3;
    // body
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = this.fillColor;
    ctx.fill();
    ctx.strokeStyle = this.rimColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    // shine
    ctx.beginPath();
    ctx.arc(this.x - this.r * 0.28, this.y - this.r * 0.3, this.r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();
    ctx.restore();
  }

  step() {
    if (!this.alive) return;
    this.x  += this.vx;
    this.y  += this.vy;
    this.vx *= FRICTION;
    this.vy *= FRICTION;
    if (Math.abs(this.vx) < 0.05) this.vx = 0;
    if (Math.abs(this.vy) < 0.05) this.vy = 0;
    this.bounceWalls();
    this.checkPocket();
  }

  bounceWalls() {
    const mn = WALL_MIN + this.r;
    const mxX = WALL_MAX_X - this.r;
    const mxY = WALL_MAX_Y - this.r;
    if (this.x < mn)   { this.x = mn;   this.vx =  Math.abs(this.vx) * RESTITUTION; }
    if (this.x > mxX)  { this.x = mxX;  this.vx = -Math.abs(this.vx) * RESTITUTION; }
    if (this.y < mn)   { this.y = mn;    this.vy =  Math.abs(this.vy) * RESTITUTION; }
    if (this.y > mxY)  { this.y = mxY;  this.vy = -Math.abs(this.vy) * RESTITUTION; }
  }

  checkPocket() {
    const pockets = [
      { x: BORDER, y: BORDER },
      { x: W - BORDER, y: BORDER },
      { x: BORDER, y: H - BORDER },
      { x: W - BORDER, y: H - BORDER }
    ];
    for (const p of pockets) {
      if (dist(this.x, this.y, p.x, p.y) < POCKET_R - 2) {
        this.pocket();
        return;
      }
    }
  }

  pocket() {
    this.alive = false;
    this.vx = this.vy = 0;
    if (this.type === 'striker') {
      scores[turn - 1] = Math.max(0, scores[turn - 1] - 5);
      updateScoreUI();
      showToast('Striker pocketed! -5 penalty');
    } else {
      const pts = this.type === 'red' ? 50 : this.type === 'white' ? 20 : 10;
      scores[turn - 1] += pts;
      updateScoreUI();
      showToast('+' + pts + ' pts! ' + this.type + ' piece pocketed');
    }
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get moving() { return this.speed > 0.08; }
}

// ─────────────────────────────────────────
//  COLLISION between two pieces
// ─────────────────────────────────────────
function resolveCollision(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d  = Math.hypot(dx, dy);
  if (d === 0 || d > a.r + b.r) return;

  const nx = dx / d, ny = dy / d;
  const overlap = (a.r + b.r - d) / 2;

  // Push apart equally
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;

  // Velocity exchange along normal
  const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
  const dot  = dvx * nx + dvy * ny;
  if (dot > 0) return; // already separating

  const impulse = dot * RESTITUTION;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
}

// ─────────────────────────────────────────
//  HELPER
// ─────────────────────────────────────────
function dist(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2); }

// ─────────────────────────────────────────
//  BOARD DRAWING
// ─────────────────────────────────────────
function drawBoard() {
  // Outer wood frame
  ctx.fillStyle = '#5a3008';
  ctx.fillRect(0, 0, W, H);

  // Inner lighter wood
  const wg = ctx.createRadialGradient(CX, CY, 50, CX, CY, W * 0.7);
  wg.addColorStop(0, '#c08828');
  wg.addColorStop(0.5, '#906018');
  wg.addColorStop(1, '#604008');
  ctx.fillStyle = wg;
  ctx.fillRect(BORDER - 8, BORDER - 8, W - (BORDER - 8) * 2, H - (BORDER - 8) * 2);

  // Felt (green playing surface)
  const fg = ctx.createRadialGradient(CX, CY, 20, CX, CY, 220);
  fg.addColorStop(0, '#3a7022');
  fg.addColorStop(1, '#1e4810');
  ctx.fillStyle = fg;
  ctx.fillRect(BORDER, BORDER, W - BORDER * 2, H - BORDER * 2);

  // Pockets (black circles at corners)
  const pPos = [
    { x: BORDER, y: BORDER },
    { x: W - BORDER, y: BORDER },
    { x: BORDER, y: H - BORDER },
    { x: W - BORDER, y: H - BORDER }
  ];
  for (const p of pPos) {
    // Dark hole
    ctx.beginPath(); ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
    ctx.fillStyle = '#050505'; ctx.fill();
    // Rim
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3; ctx.stroke();
    // Inner ring highlight
    ctx.beginPath(); ctx.arc(p.x, p.y, POCKET_R - 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // Outer circle (decoration)
  ctx.beginPath(); ctx.arc(CX, CY, 155, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,200,0.12)'; ctx.lineWidth = 1.5; ctx.stroke();

  // Inner circle
  ctx.beginPath(); ctx.arc(CX, CY, 40, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,200,0.15)'; ctx.lineWidth = 1; ctx.stroke();

  // Striker baselines
  const sl = BORDER + 35;
  ctx.strokeStyle = 'rgba(255,255,150,0.2)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(sl, H - BORDER - 32); ctx.lineTo(W - sl, H - BORDER - 32); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sl, BORDER + 32);     ctx.lineTo(W - sl, BORDER + 32);     ctx.stroke();

  // Board border
  ctx.strokeStyle = 'rgba(232,200,74,0.2)'; ctx.lineWidth = 2;
  ctx.strokeRect(BORDER, BORDER, W - BORDER * 2, H - BORDER * 2);
}

// ─────────────────────────────────────────
//  AIM INDICATOR
// ─────────────────────────────────────────
function drawAim() {
  if (!dragging || !striker || !striker.alive) return;
  const dx  = dragStart.x - dragNow.x;
  const dy  = dragStart.y - dragNow.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const nx = dx / len, ny = dy / len;

  // Dashed aim line
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(232,200,74,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(striker.x, striker.y);
  ctx.lineTo(striker.x + nx * 130, striker.y + ny * 130);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead
  ctx.fillStyle = 'rgba(232,200,74,0.6)';
  ctx.beginPath();
  ctx.arc(striker.x + nx * 130, striker.y + ny * 130, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Power bar
  const power = Math.min(len / MAX_DRAG, 1);
  document.getElementById('pfill').style.width = (power * 100) + '%';
  document.getElementById('pval').textContent  = Math.round(power * 100) + '%';
}

// ─────────────────────────────────────────
//  GAME INIT
// ─────────────────────────────────────────
function initPieces() {
  pieces = [];
  // Classic carrom formation (2 rings + queen)
  // Types alternating black/white
  const ring1 = [
    [0, -28],  [20, -14], [20, 14],
    [0, 28],   [-20, 14], [-20, -14]
  ];
  const ring1types = ['black','white','black','white','black','white'];

  const ring2 = [
    [0, -52],  [26, -43], [45, -15],
    [45, 15],  [26, 43],  [0, 52],
    [-26, 43], [-45, 15], [-45, -15], [-26, -43]
  ];
  const ring2types = ['white','black','white','black','white','black','white','black','white','black'];

  ring1.forEach((pos, i) => pieces.push(new Piece(CX + pos[0], CY + pos[1], ring1types[i])));
  ring2.forEach((pos, i) => pieces.push(new Piece(CX + pos[0], CY + pos[1], ring2types[i])));

  // Red queen at center
  pieces.push(new Piece(CX, CY, 'red'));

  // Striker for player at bottom baseline
  striker = new Piece(CX, H - BORDER - 32, 'striker');
}

function placeStriker() {
  striker = new Piece(CX, H - BORDER - 32, 'striker');
}

// ─────────────────────────────────────────
//  MAIN LOOP
// ─────────────────────────────────────────
let rafId = null;
function gameLoop() {
  // Physics update
  const allPieces = [...pieces, striker].filter(p => p && p.alive);

  allPieces.forEach(p => p.step());

  // Collision detection — all pairs
  for (let i = 0; i < allPieces.length; i++) {
    for (let j = i + 1; j < allPieces.length; j++) {
      resolveCollision(allPieces[i], allPieces[j]);
    }
  }

  // ── DRAW ──
  ctx.clearRect(0, 0, W, H);
  drawBoard();
  pieces.forEach(p => p.draw());
  if (striker && striker.alive) striker.draw();
  drawAim();

  // ── PHASE MANAGEMENT ──
  const anyMoving = allPieces.some(p => p.moving);

  if (phase === 'moving' && !anyMoving) {
    // Everything stopped
    if (!striker || !striker.alive) {
      placeStriker();
    }
    // Check win
    if (pieces.filter(p => p.alive).length === 0) {
      endGame(); return;
    }
    // Switch turn
    if (turn === 1) {
      turn = 2;
      phase = 'cpu_wait';
      document.getElementById('tlbl').textContent = 'CPU TURN';
      setTimeout(doCpuTurn, 900);
    } else {
      turn = 1;
      phase = 'aim';
      document.getElementById('tlbl').textContent = 'YOUR TURN';
    }
  }

  rafId = requestAnimationFrame(gameLoop);
}

// ─────────────────────────────────────────
//  CPU TURN — simple AI
// ─────────────────────────────────────────
function doCpuTurn() {
  if (!gameOn || turn !== 2) return;

  // Make sure striker exists
  if (!striker || !striker.alive) placeStriker();

  const targets = pieces.filter(p => p.alive);
  if (targets.length === 0) return;

  // Score each target: prefer red > white > black, and closer pieces
  let best = null, bestScore = -Infinity;
  for (const t of targets) {
    const value = t.type === 'red' ? 3 : t.type === 'white' ? 2 : 1;
    const proximity = 1 - dist(striker.x, striker.y, t.x, t.y) / 600;
    const score = value + proximity;
    if (score > bestScore) { bestScore = score; best = t; }
  }

  if (!best) return;

  // Aim at target with some inaccuracy
  const dx = best.x - striker.x;
  const dy = best.y - striker.y;
  const len = Math.hypot(dx, dy);
  const spread = (Math.random() - 0.5) * 0.3; // ±0.15 rad inaccuracy
  const angle  = Math.atan2(dy, dx) + spread;
  const power  = 0.55 + Math.random() * 0.35;
  const speed  = power * MAX_SPEED;

  striker.vx = Math.cos(angle) * speed;
  striker.vy = Math.sin(angle) * speed;
  phase = 'moving';
}

// ─────────────────────────────────────────
//  INPUT — mouse
// ─────────────────────────────────────────
cv.addEventListener('mousedown', e => {
  if (!gameOn || phase !== 'aim' || turn !== 1) return;
  const rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  if (!striker || !striker.alive) return;
  if (dist(mx, my, striker.x, striker.y) < striker.r + 22) {
    dragging = true;
    dragStart = { x: mx, y: my };
    dragNow   = { x: mx, y: my };
  }
});

cv.addEventListener('mousemove', e => {
  if (!dragging) return;
  const rect = cv.getBoundingClientRect();
  let mx = e.clientX - rect.left;
  let my = e.clientY - rect.top;
  // Clamp drag to MAX_DRAG radius
  const dx = mx - dragStart.x, dy = my - dragStart.y;
  const len = Math.hypot(dx, dy);
  if (len > MAX_DRAG) {
    mx = dragStart.x + (dx / len) * MAX_DRAG;
    my = dragStart.y + (dy / len) * MAX_DRAG;
  }
  dragNow = { x: mx, y: my };
});

cv.addEventListener('mouseup', e => {
  if (!dragging || !striker) { dragging = false; return; }
  const dx  = dragStart.x - dragNow.x;
  const dy  = dragStart.y - dragNow.y;
  const len = Math.hypot(dx, dy);
  if (len > 8) {
    const power = Math.min(len / MAX_DRAG, 1);
    striker.vx  = (dx / len) * power * MAX_SPEED;
    striker.vy  = (dy / len) * power * MAX_SPEED;
    phase = 'moving';
  }
  dragging = false;
  document.getElementById('pfill').style.width = '0%';
  document.getElementById('pval').textContent  = '0%';
});

// Touch events
cv.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.touches[0];
  cv.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY }));
}, { passive: false });

cv.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  cv.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY }));
}, { passive: false });

cv.addEventListener('touchend', e => {
  e.preventDefault();
  cv.dispatchEvent(new MouseEvent('mouseup', {}));
});

// ─────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────
function updateScoreUI() {
  document.getElementById('s1').textContent = scores[0];
  document.getElementById('s2').textContent = scores[1];
}

let toastTimer = null;
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:#1e1408;border:1px solid #e8c84a;color:#e8c84a;font-family:Georgia,serif;' +
      'font-size:0.8rem;padding:8px 20px;border-radius:5px;z-index:200;text-align:center;' +
      'pointer-events:none;transition:opacity 0.3s;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2000);
}

function endGame() {
  gameOn = false;
  cancelAnimationFrame(rafId);
  const w = scores[0] > scores[1] ? '🎉 You Win!' : scores[1] > scores[0] ? '🤖 CPU Wins!' : "It's a Draw!";
  document.getElementById('mtitle').textContent = w;
  document.getElementById('msub').innerHTML =
    'Your Score: <b style="color:#e8c84a">' + scores[0] + '</b> &nbsp;|&nbsp; CPU Score: <b style="color:#e8c84a">' + scores[1] + '</b>';
  document.getElementById('mbtn').textContent = 'Play Again';
  document.getElementById('mbtn').onclick = startGame;
  document.getElementById('modal').classList.remove('hide');
}

// ─────────────────────────────────────────
//  GAME CONTROL
// ─────────────────────────────────────────
function startGame() {
  document.getElementById('modal').classList.add('hide');
  newGame();
}

function newGame() {
  cancelAnimationFrame(rafId);
  scores = [0, 0]; turn = 1; phase = 'aim';
  dragging = false;
  updateScoreUI();
  document.getElementById('tlbl').textContent = 'YOUR TURN';
  document.getElementById('pfill').style.width = '0%';
  document.getElementById('pval').textContent  = '0%';
  initPieces();
  gameOn = true;
  rafId = requestAnimationFrame(gameLoop);
}

function rules() {
  document.getElementById('mtitle').textContent = 'How to Play';
  document.getElementById('msub').innerHTML =
    '1. Click & drag the <b style="color:#e8c84a">gold striker</b> to aim<br>' +
    '2. Drag further back = more power<br>' +
    '3. Release to shoot!<br><br>' +
    '⚫ Black = 10 pts &nbsp;·&nbsp; ⚪ White = 20 pts<br>' +
    '🔴 Red Queen = 50 pts<br>' +
    '🚫 Pocket striker = -5 penalty<br><br>' +
    'Pot all pieces to win!';
  document.getElementById('mbtn').textContent = 'Got it!';
  document.getElementById('mbtn').onclick = () => {
    document.getElementById('modal').classList.add('hide');
    document.getElementById('mbtn').onclick = startGame;
    if (!gameOn) newGame();
  };
  document.getElementById('modal').classList.remove('hide');
}
