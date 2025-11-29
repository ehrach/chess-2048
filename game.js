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

// messages / overlay
let lastMessage = "";
let winnerText = "";

// online play state
const ONLINE_COLORS = { host: "white", guest: "black" };
let net = {
  mode: "offline", // offline | hosting | joining | online-host | online-guest
  roomId: null,
  peer: null,
  conn: null
};
let myColor = null;

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
  const joinRoom = getRoomFromUrl();
  initBoardState({ startClock: !joinRoom });
  renderBoard();
  setupRestartButton();
  setupOnlineControls(joinRoom);

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

  if (isGuest()) {
    timerSeconds = GAME_TIME_SECONDS;
    updateTimerDisplay();
    return;
  }

  timerSeconds = GAME_TIME_SECONDS;
  updateTimerDisplay();
  sendTimerUpdate();

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
      sendTimerUpdate();
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
  syncState("time");
}

// === ONLINE HELPERS ===
function getRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  return room && room.trim() ? room.trim() : null;
}

function generateRoomId() {
  return `chess2048-${Math.random().toString(36).slice(2, 8)}`;
}

function isOnline() {
  return net.mode !== "offline";
}

function isHost() {
  return net.mode === "hosting" || net.mode === "online-host";
}

function isGuest() {
  return net.mode === "joining" || net.mode === "online-guest";
}

function isConnected() {
  return net.mode === "online-host" || net.mode === "online-guest";
}

function shouldStartClock() {
  return !isGuest();
}

function buildInviteLink(roomId) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?room=${roomId}`;
}

function setOnlineStatus(text) {
  const el = document.getElementById("online-status");
  if (el) el.textContent = text;
}

function updateInviteLink(link) {
  const input = document.getElementById("invite-url");
  const copyBtn = document.getElementById("copy-link-btn");
  if (input) input.value = link || "";
  if (copyBtn) copyBtn.disabled = !link;
}

function getPeerOptions() {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (!isLocal) return undefined;
  return {
    host: "localhost",
    port: 9000,
    path: "/peerjs",
    secure: false
  };
}

function setupOnlineControls(joinRoom) {
  const hostBtn = document.getElementById("host-online-btn");
  const copyBtn = document.getElementById("copy-link-btn");

  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const url = document.getElementById("invite-url");
      if (!url || !url.value) return;
      navigator.clipboard?.writeText(url.value).catch(() => {});
      setMessage("Invite link copied.");
    });
  }

  if (hostBtn) {
    hostBtn.addEventListener("click", () => {
      if (isOnline()) return;
      startHosting();
    });
  }

  if (joinRoom) {
    net.mode = "joining";
    myColor = ONLINE_COLORS.guest;
    setOnlineStatus(`Joining room ${joinRoom}...`);
    if (hostBtn) hostBtn.disabled = true;
    connectAsGuest(joinRoom);
  }
}

function setupRestartButton() {
  const restartBtn = document.getElementById("restart-btn");
  if (!restartBtn) return;

  restartBtn.addEventListener("click", () => {
    if (isGuest()) {
      if (net.conn && net.conn.open) {
        sendToPeer({ type: "restart" });
        setMessage("Requested restart from host.");
      } else {
        setMessage("Connect to a host before restarting.");
      }
      return;
    }

    initBoardState({ startClock: shouldStartClock() });
    renderBoard();
    setMessage("");
    syncState("restart");
  });
}

function startHosting() {
  if (typeof Peer === "undefined") {
    setMessage("PeerJS failed to load. Online play unavailable.");
    return;
  }

  net.roomId = generateRoomId();
  net.mode = "hosting";
  myColor = ONLINE_COLORS.host;

  const hostBtn = document.getElementById("host-online-btn");
  if (hostBtn) hostBtn.disabled = true;

  const inviteLink = buildInviteLink(net.roomId);
  updateInviteLink(inviteLink);
  setOnlineStatus("Waiting for guest... (you are White)");
  setMessage("Hosting online game. Share the invite link.");

  net.peer = new Peer(net.roomId, getPeerOptions());

  net.peer.on("open", () => {
    setOnlineStatus("Hosting online match. Waiting for guest...");
  });

  net.peer.on("connection", connection => {
    net.conn = connection;
    setupConnectionHandlers(connection);
    net.mode = "online-host";
    setOnlineStatus("Guest connected! You are White.");
    syncState("peer-connected");
  });

  net.peer.on("error", err => {
    setMessage(`PeerJS error: ${err.type || err.message}`);
  });

  initBoardState({ startClock: shouldStartClock() });
  renderBoard();
}

function connectAsGuest(roomId) {
  if (typeof Peer === "undefined") {
    setMessage("PeerJS failed to load. Online play unavailable.");
    return;
  }

  myColor = ONLINE_COLORS.guest;
  net.roomId = roomId;
  net.peer = new Peer(null, getPeerOptions());

  net.peer.on("open", () => {
    setOnlineStatus(`Connecting to room ${roomId}...`);
    net.conn = net.peer.connect(roomId);
    setupConnectionHandlers(net.conn);
  });

  net.peer.on("error", err => {
    setMessage(`PeerJS error: ${err.type || err.message}`);
  });
}

function setupConnectionHandlers(connection) {
  if (!connection) return;

  connection.on("open", () => {
    if (isHost()) {
      net.mode = "online-host";
      setOnlineStatus("Guest connected! You are White.");
      syncState("connection-open");
    } else {
      net.mode = "online-guest";
      setOnlineStatus("Connected. You are Black.");
      setMessage("Connected. Waiting for host state...");
    }
  });

  connection.on("data", handleIncomingData);

  connection.on("close", () => {
    setOnlineStatus("Disconnected. Reload to reconnect.");
    setMessage("Connection closed.");
    net.mode = "offline";
    myColor = null;
    net.conn = null;
  });
}

function sendToPeer(payload) {
  if (!net.conn || !net.conn.open) return;
  try {
    net.conn.send(payload);
  } catch (e) {
    // ignore send failures
  }
}

function sendTimerUpdate() {
  if (!isHost() || !isConnected()) return;
  sendToPeer({ type: "timer", payload: { timerSeconds } });
}

function syncState(reason) {
  if (!isHost() || !isConnected()) return;
  const payload = {
    board,
    currentPlayer,
    timerSeconds,
    gameOver,
    message: lastMessage,
    winnerText,
    overlayVisible: !!winnerText || gameOver,
    lastAction
  };
  sendToPeer({ type: "sync", payload, reason });
}

function handleIncomingData(data) {
  if (!data || !data.type) return;

  if (data.type === "sync" && isGuest()) {
    applyRemoteState(data.payload || {});
    return;
  }

  if (data.type === "timer" && isGuest()) {
    if (data.payload && typeof data.payload.timerSeconds === "number") {
      timerSeconds = data.payload.timerSeconds;
      updateTimerDisplay();
    }
    return;
  }

  if (data.type === "status") {
    setMessage(data.text || "");
    return;
  }

  if (data.type === "move" && isHost()) {
    handleRemoteMove(data);
    return;
  }

  if (data.type === "restart") {
    if (isHost()) {
      initBoardState({ startClock: shouldStartClock() });
      renderBoard();
      setMessage("Restarted at guest request.");
      syncState("restart");
    }
    return;
  }
}

function applyRemoteState(payload) {
  if (!payload) return;
  stopTimer();

  if (Array.isArray(payload.board)) {
    board = payload.board.map(row => row.map(cell => ({ ...cell })));
  }

  currentPlayer = payload.currentPlayer || "white";
  timerSeconds = typeof payload.timerSeconds === "number" ? payload.timerSeconds : timerSeconds;
  gameOver = !!payload.gameOver;
  lastAction = payload.lastAction || null;
  selectedCell = null;
  possibleMoves = [];

  updateTimerDisplay();

  if (payload.overlayVisible && payload.winnerText) {
    showWinnerOverlay(payload.winnerText);
  } else {
    hideWinnerOverlay();
  }

  if (payload.message !== undefined) {
    setMessage(payload.message || "");
  }

  renderBoard(true);
}

function handleRemoteMove(data) {
  if (!data || !data.from || !data.to) return;
  if (gameOver) {
    sendStatus("Game is over.");
    return;
  }
  if (currentPlayer !== ONLINE_COLORS.guest) {
    sendStatus("Not your turn.");
    return;
  }

  const { from, to } = data;
  const fr = +from.row;
  const fc = +from.col;
  const tr = +to.row;
  const tc = +to.col;

  selectedCell = { row: fr, col: fc };
  possibleMoves = computePossibleMoves(fr, fc);

  if (tryMove(fr, fc, tr, tc)) {
    selectedCell = null;
    possibleMoves = [];
    renderBoard(true);
    checkWinCondition();
    if (!gameOver) switchPlayer();
    syncState("remote-move");
  } else {
    selectedCell = null;
    possibleMoves = [];
    renderBoard();
    sendStatus("Illegal move.");
  }
}

function sendStatus(text) {
  if (!isHost() || !isConnected()) return;
  sendToPeer({ type: "status", text });
}

// === INIT BOARD ===
function initBoardState() {
  const opts = arguments[0] || {};
  const startClock = opts.startClock !== false;

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
  if (startClock) {
    startTimer();
  } else {
    stopTimer();
    timerSeconds = GAME_TIME_SECONDS;
    updateTimerDisplay();
  }
}

// === MESSAGE & WIN OVERLAY ===
function setMessage(msg) {
  const el = document.getElementById("message");
  lastMessage = msg;
  if (el) el.textContent = msg;
}

function showWinnerOverlay(text) {
  const overlay = document.getElementById("winner-overlay");
  const label = document.getElementById("winner-text");
  if (!overlay || !label) return;
  label.textContent = text;
  winnerText = text;
  overlay.classList.add("visible");
}

function hideWinnerOverlay() {
  const overlay = document.getElementById("winner-overlay");
  if (!overlay) return;
  winnerText = "";
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
  const perspective = isOnline() ? myColor || "white" : "white";
  boardEl.classList.toggle("flipped", perspective === "black");
}

// === CLICK HANDLING ===
function onCellClick(e) {
  if (gameOver) return;
  if (isOnline() && currentPlayer !== myColor) return;

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

  if (shouldSendOnlineMove()) {
    sendMoveAttempt(fr, fc, row, col);
    selectedCell = null;
    possibleMoves = [];
    renderBoard();
    return;
  }

  if (tryMove(fr, fc, row, col)) {
    selectedCell = null;
    possibleMoves = [];
    renderBoard(true);
    checkWinCondition();
    if (!gameOver) switchPlayer();
    syncState("move");
  } else {
    if (piece.player === currentPlayer) {
      selectedCell = { row, col };
      possibleMoves = computePossibleMoves(row, col);
      renderBoard();
    }
  }
}

function shouldSendOnlineMove() {
  return isConnected() && isGuest();
}

function sendMoveAttempt(fr, fc, tr, tc) {
  if (!shouldSendOnlineMove()) return;
  if (!net.conn || !net.conn.open) {
    setMessage("Not connected to host.");
    return;
  }
  sendToPeer({ type: "move", from: { row: fr, col: fc }, to: { row: tr, col: tc } });
  setMessage("Move sent to host...");
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
        syncState("target");
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
    syncState("capture-all");
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
      setMessage(`DRAW by score (${white} vs ${black}) - no moves left.`);
      showWinnerOverlay(`DRAW !!`);
    }
    gameOver = true;
    stopTimer();
    syncState("stalemate");
    return;
  }
}
