// === CONFIG ===
const TARGET_TILE = 512;
const GAME_TIME_SECONDS = 5 * 60; // 5 minutes

// Each cell: { player: "white" | "black" | null, value: number | null, type: "pawn"|"knight"|"bishop"|"rook"|"queen"|null }
let board = [];
let currentPlayer = "white";
let selectedCell = null;    // { row, col } or null
let possibleMoves = [];     // [{ row, col }]
let gameOver = false;

// for animations
let lastAction = null; // { type: "move" | "merge" | "capture", cells: [{row,col}] }

// sounds
let moveSound = null;
let mergeSound = null;

// timer
let timerSeconds = GAME_TIME_SECONDS;
let timerInterval = null;

// === VALUE → PIECE TYPE MAPPING ===
// 2 -> pawn, 4 -> knight, 8 -> bishop, 16 -> rook, 32+ -> queen
function getTypeForValue(value) {
  if (value <= 2) return "pawn";
  if (value <= 4) return "knight";
  if (value <= 8) return "bishop";
  if (value <= 16) return "rook";
  return "queen"; // 32 and higher
}

// --- INIT ---
window.addEventListener("load", () => {
  initBoardState();
  renderBoard();

  const restartBtn = document.getElementById("restart-btn");
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      initBoardState();
      renderBoard();
      setMessage("");
    });
  }

  moveSound = document.getElementById("sound-move");
  mergeSound = document.getElementById("sound-merge");
});

// === SOUNDS ===
function playSound(audioEl) {
  if (!audioEl) return;
  try {
    audioEl.currentTime = 0;
    audioEl.play();
  } catch (e) {
    // ignore autoplay issues
  }
}

// === TIMER ===
function updateTimerDisplay() {
  const el = document.getElementById("timer");
  if (!el) return;
  const m = Math.floor(timerSeconds / 60);
  const s = timerSeconds % 60;
  el.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTimer() {
  stopTimer();
  timerSeconds = GAME_TIME_SECONDS;
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    if (gameOver) {
      stopTimer();
      return;
    }
    if (timerSeconds > 0) {
      timerSeconds--;
      updateTimerDisplay();
      if (timerSeconds === 0) {
        handleTimeUp();
      }
    }
  }, 1000);
}

function handleTimeUp() {
  if (gameOver) return;
  const { white, black } = computeScores();
  let text;

  if (white > black) {
    text = "WHITE WINS !!";
    setMessage(`WHITE wins on time by score (${white} vs ${black}).`);
  } else if (black > white) {
    text = "BLACK WINS !!";
    setMessage(`BLACK wins on time by score (${black} vs ${white}).`);
  } else {
    text = "DRAW !!";
    setMessage(`DRAW on time (${white} vs ${black}).`);
  }

  showWinnerOverlay(text);
  gameOver = true;
  stopTimer();
}

// === INIT BOARD ===
function initBoardState() {
  board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => ({ player: null, value: null, type: null }))
  );

  function place(row, col, player, value) {
    board[row][col] = { player, value, type: getTypeForValue(value) };
  }

  // --- Top player (black) ---
  for (let c = 0; c < 8; c++) place(1, c, "black", 2);

  place(0, 0, "black", 16);
  place(0, 7, "black", 16);

  place(0, 1, "black", 4);
  place(0, 6, "black", 4);

  place(0, 2, "black", 8);
  place(0, 5, "black", 8);

  place(0, 3, "black", 32);
  place(0, 4, "black", 32);

  // --- Bottom player (white) ---
  for (let c = 0; c < 8; c++) place(6, c, "white", 2);

  place(7, 0, "white", 16);
  place(7, 7, "white", 16);

  place(7, 1, "white", 4);
  place(7, 6, "white", 4);

  place(7, 2, "white", 8);
  place(7, 5, "white", 8);

  place(7, 3, "white", 32);
  place(7, 4, "white", 32);

  currentPlayer = "white";
  selectedCell = null;
  possibleMoves = [];
  gameOver = false;
  lastAction = null;

  const cpEl = document.getElementById("current-player");
  const tgtEl = document.getElementById("target-tile");
  if (cpEl) cpEl.textContent = "White";
  if (tgtEl) tgtEl.textContent = TARGET_TILE;

  hideWinnerOverlay();
  startTimer();
}

// === MESSAGE & WIN OVERLAY ===
function setMessage(msg) {
  const el = document.getElementById("message");
  if (el) el.textContent = msg;
}

function showWinnerOverlay(text) {
  const overlay = document.getElementById("winner-overlay");
  const label = document.getElementById("winner-text");
  if (!overlay || !label) return;
  label.textContent = text;
  overlay.classList.add("visible");
}

function hideWinnerOverlay() {
  const overlay = document.getElementById("winner-overlay");
  if (!overlay) return;
  overlay.classList.remove("visible");
}

// === SCORE HELPERS ===
function computeScores() {
  let white = 0, black = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p.player) continue;
      if (p.player === "white") white += p.value;
      else black += p.value;
    }
  }
  return { white, black };
}

function updateScores() {
  const { white, black } = computeScores();
  const w = document.getElementById("score-white");
  const b = document.getElementById("score-black");
  if (w) w.textContent = white;
  if (b) b.textContent = black;
}

// === RENDER BOARD ===
function renderBoard(animate = false) {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;
  updateBoardOrientation(boardEl);
  boardEl.innerHTML = "";

  updateScores();

  const moveSet = new Set(possibleMoves.map(m => `${m.row},${m.col}`));

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.row = r;
      cell.dataset.col = c;

      const piece = board[r][c];

      if (piece.player) {
        const v = piece.value;
        cell.textContent = v;
        cell.classList.add(v >= 2048 ? "tile-super" : `tile-${v}`);
        cell.classList.add(
          piece.player === "white" ? "piece-white" : "piece-black"
        );
      }

      if (selectedCell && selectedCell.row === r && selectedCell.col === c) {
        cell.classList.add("selected");
      }

      if (moveSet.has(`${r},${c}`)) {
        cell.classList.add("move-option");
      }

      if (animate && lastAction) {
        const hit = lastAction.cells.some(p => p.row === r && p.col === c);
        if (hit) {
          cell.classList.add(
            lastAction.type === "move" ? "tile-new" : "tile-merged"
          );
        }
      }

      cell.addEventListener("click", onCellClick);
      boardEl.appendChild(cell);
    }
  }
}

function updateBoardOrientation(boardEl = document.getElementById("board")) {
  if (!boardEl) return;
  boardEl.classList.toggle("flipped", currentPlayer === "black");
}

// === CLICK HANDLING ===
function onCellClick(e) {
  if (gameOver) return;

  const row = +e.currentTarget.dataset.row;
  const col = +e.currentTarget.dataset.col;
  const piece = board[row][col];

  if (!selectedCell) {
    if (piece.player === currentPlayer) {
      selectedCell = { row, col };
      possibleMoves = computePossibleMoves(row, col);
      renderBoard();
    }
    return;
  }

  if (selectedCell.row === row && selectedCell.col === col) {
    selectedCell = null;
    possibleMoves = [];
    renderBoard();
    return;
  }

  const { row: fr, col: fc } = selectedCell;

  if (tryMove(fr, fc, row, col)) {
    selectedCell = null;
    possibleMoves = [];
    renderBoard(true);
    checkWinCondition();
    if (!gameOver) switchPlayer();
  } else {
    if (piece.player === currentPlayer) {
      selectedCell = { row, col };
      possibleMoves = computePossibleMoves(row, col);
      renderBoard();
    }
  }
}

function switchPlayer() {
  currentPlayer = currentPlayer === "white" ? "black" : "white";
  const el = document.getElementById("current-player");
  if (el) el.textContent =
    currentPlayer.charAt(0).toUpperCase() + currentPlayer.slice(1);
  updateBoardOrientation();
}

// === MOVE LOGIC ===
// returns: "move" | "merge" | "capture" | null
function getMoveType(fr, fc, tr, tc) {
  if (fr === tr && fc === tc) return null;

  const from = board[fr][fc];
  if (!from.player || from.player !== currentPlayer) return null;

  const to = board[tr][tc];
  const isCapture = !!(to.player && to.player !== currentPlayer);

  if (!isLegalMovement(from, fr, fc, tr, tc, isCapture)) return null;
  if (!isPathClear(from, fr, fc, tr, tc)) return null;

  if (!to.player) return "move";
  if (to.player === currentPlayer) return null;

  if (to.value === from.value) return "merge";

  return "capture"; // different value -> chess-style capture
}

function tryMove(fr, fc, tr, tc) {
  const moveType = getMoveType(fr, fc, tr, tc);
  if (!moveType) return false;

  const from = board[fr][fc];

  if (moveType === "move") {
    board[tr][tc] = { ...from };
    board[fr][fc] = empty();

    if (from.type === "pawn") {
      maybePromotePawn(tr, tc);
    }

    lastAction = { type: "move", cells: [{ row: tr, col: tc }] };
    playSound(moveSound);
    return true;
  }

  if (moveType === "merge") {
    const newValue = from.value * 2;
    const newType = getTypeForValue(newValue);

    board[tr][tc] = { player: from.player, value: newValue, type: newType };
    board[fr][fc] = empty();

    lastAction = { type: "merge", cells: [{ row: tr, col: tc }] };
    playSound(mergeSound);
    return true;
  }

  if (moveType === "capture") {
    board[tr][tc] = { ...from };
    board[fr][fc] = empty();

    if (from.type === "pawn") {
      maybePromotePawn(tr, tc);
    }

    lastAction = { type: "capture", cells: [{ row: tr, col: tc }] };
    playSound(mergeSound);
    return true;
  }

  return false;
}

function empty() {
  return { player: null, value: null, type: null };
}

// === MOVEMENT RULES ===
function isLegalMovement(piece, fr, fc, tr, tc, isCapture) {
  const dr = tr - fr;
  const dc = tc - fc;

  switch (piece.type) {
    case "pawn":
      return pawnMove(piece, fr, fc, tr, tc, isCapture);
    case "knight":
      return (
        (Math.abs(dr) === 2 && Math.abs(dc) === 1) ||
        (Math.abs(dr) === 1 && Math.abs(dc) === 2)
      );
    case "bishop":
      return Math.abs(dr) === Math.abs(dc);
    case "rook":
      return dr === 0 || dc === 0;
    case "queen":
      return (
        dr === 0 ||
        dc === 0 ||
        Math.abs(dr) === Math.abs(dc)
      );
  }
  return false;
}

function pawnMove(piece, fr, fc, tr, tc, isCapture) {
  const dir = piece.player === "white" ? -1 : 1;
  const dr = tr - fr;
  const dc = tc - fc;

  if (isCapture) return dr === dir && Math.abs(dc) === 1;

  if (dc === 0 && dr === dir) return true;

  const startRow = piece.player === "white" ? 6 : 1;
  if (
    fr === startRow &&
    dc === 0 &&
    dr === 2 * dir &&
    !board[fr + dir][fc].player &&
    !board[tr][tc].player
  ) return true;

  return false;
}

function isPathClear(piece, fr, fc, tr, tc) {
  if (piece.type === "knight" || piece.type === "pawn") return true;

  const dr = tr - fr;
  const dc = tc - fc;
  const stepR = dr === 0 ? 0 : dr / Math.abs(dr);
  const stepC = dc === 0 ? 0 : dc / Math.abs(dc);

  let r = fr + stepR;
  let c = fc + stepC;

  while (r !== tr || c !== tc) {
    if (board[r][c].player) return false;
    r += stepR;
    c += stepC;
  }
  return true;
}

// === PAWN PROMOTION (2 → 32 on last rank) ===
function maybePromotePawn(r, c) {
  const p = board[r][c];
  if (p.type !== "pawn") return; // only original pawns (value 2)

  const isLastRank =
    (p.player === "white" && r === 0) ||
    (p.player === "black" && r === 7);

  if (!isLastRank) return;

  const value = 32; // promotion value
  board[r][c] = {
    player: p.player,
    value,
    type: getTypeForValue(value) // becomes "queen"
  };
  setMessage(`${p.player} pawn promoted to 32!`);
}

// === MOVE HIGHLIGHT ===
function computePossibleMoves(fr, fc) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (getMoveType(fr, fc, r, c)) {
        moves.push({ row: r, col: c });
      }
    }
  }
  return moves;
}

// === HELPER: CHECK IF A PLAYER HAS ANY LEGAL MOVE ===
function hasAnyLegalMove(player) {
  const prev = currentPlayer;
  currentPlayer = player;
  let found = false;

  for (let r = 0; r < 8 && !found; r++) {
    for (let c = 0; c < 8 && !found; c++) {
      const p = board[r][c];
      if (p.player !== player) continue;
      const moves = computePossibleMoves(r, c);
      if (moves.length > 0) {
        found = true;
      }
    }
  }

  currentPlayer = prev;
  return found;
}

// === WIN CONDITION ===
function checkWinCondition() {
  // 1) Target tile win (512)
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p.value && p.value >= TARGET_TILE) {
        const winner = currentPlayer.toUpperCase();
        setMessage(`${winner} wins by reaching ${p.value}!`);
        showWinnerOverlay(`${winner} WINS !!`);
        gameOver = true;
        stopTimer();
        return;
      }
    }
  }

  const opponent = currentPlayer === "white" ? "black" : "white";

  // 2) Capture victory – opponent has no pieces left
  let opponentHasPiece = false;
  for (let r = 0; r < 8 && !opponentHasPiece; r++) {
    for (let c = 0; c < 8 && !opponentHasPiece; c++) {
      if (board[r][c].player === opponent) {
        opponentHasPiece = true;
      }
    }
  }

  if (!opponentHasPiece) {
    const winner = currentPlayer.toUpperCase();
    setMessage(`${winner} wins (captured all pieces)!`);
    showWinnerOverlay(`${winner} WINS !!`);
    gameOver = true;
    stopTimer();
    return;
  }

  // 3) Stalemate-like: opponent has pieces but NO legal moves
  const opponentCanMove = hasAnyLegalMove(opponent);

  if (!opponentCanMove) {
    const { white, black } = computeScores();
    if (white > black) {
      setMessage(`WHITE wins by score (${white} vs ${black}) – ${opponent} has no moves.`);
      showWinnerOverlay(`WHITE WINS !!`);
    } else if (black > white) {
      setMessage(`BLACK wins by score (${black} vs ${white}) – ${opponent} has no moves.`);
      showWinnerOverlay(`BLACK WINS !!`);
    } else {
      setMessage(`DRAW by score (${white} vs ${black}) – no moves left.`);
      showWinnerOverlay(`DRAW !!`);
    }
    gameOver = true;
    stopTimer();
    return;
  }
}
