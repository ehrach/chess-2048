/**********************
 *  FIREBASE SETUP
 **********************/
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyArA9AlJWeMsAQyplXBCtShKEdsqRRXanU",
  authDomain: "chess-2048.firebaseapp.com",
  databaseURL: "https://chess-2048-default-rtdb.firebaseio.com",
  projectId: "chess-2048",
  storageBucket: "chess-2048.firebasestorage.app",
  messagingSenderId: "690514379000",
  appId: "1:690514379000:web:4a0c90aa6c31f5f7fafb0d"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/**********************
 *  GAME STATE
 **********************/
const TARGET_TILE = 512;

let board = [];
let currentPlayer = "white";
let selectedCell = null;
let possibleMoves = [];
let gameOver = false;
let lastAction = null;

let moveSound = null;
let mergeSound = null;

// multiplayer
let roomId = null;
let localPlayer = null; // "white" | "black" | "spectator"

// screens
let gameScreenVisible = false;

/**********************
 *  INIT
 **********************/
window.addEventListener("load", () => {
  moveSound = document.getElementById("sound-move");
  mergeSound = document.getElementById("sound-merge");

  const restartBtn = document.getElementById("restart-btn");
  if (restartBtn) restartBtn.addEventListener("click", onRestartClick);

  const createBtn = document.getElementById("create-room-btn");
  if (createBtn) createBtn.addEventListener("click", createRoomAndShare);

  const copyBtn = document.getElementById("copy-link-btn");
  if (copyBtn) copyBtn.addEventListener("click", copyRoomLink);

  // detect room from URL
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoom = urlParams.get("room");

  if (urlRoom) {
    roomId = urlRoom;
    setRoomLabel(roomId);
    setLobbyStatus(`Joining room ${roomId}…`);
    joinRoom(roomId);
  } else {
    // no room: just show lobby, local-only mode if you start
    showLobbyScreen();
    initBoardState();
    updateLocalPlayerLabel();
  }
});

/**********************
 *  SCREEN HELPERS
 **********************/
function showLobbyScreen() {
  const lobby = document.getElementById("lobby-screen");
  const game = document.getElementById("game-screen");
  if (lobby) lobby.classList.remove("hidden");
  if (game) game.classList.add("hidden");
  gameScreenVisible = false;
}

function showGameScreen() {
  const lobby = document.getElementById("lobby-screen");
  const game = document.getElementById("game-screen");
  if (lobby) lobby.classList.add("hidden");
  if (game) game.classList.remove("hidden");
  gameScreenVisible = true;
  renderBoard();
}

function setLobbyStatus(text) {
  const el = document.getElementById("lobby-status");
  if (el) el.textContent = text;
}

/**********************
 *  ROOM / MULTIPLAYER
 **********************/
function randomRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function setRoomLabel(id) {
  const label = document.getElementById("room-id-label");
  if (label) label.textContent = id || "";
}

function updateLocalPlayerLabel() {
  const el = document.getElementById("local-player");
  if (!el) return;
  if (!roomId) {
    el.textContent = "Local only";
  } else if (!localPlayer) {
    el.textContent = "Joining…";
  } else {
    el.textContent =
      localPlayer.charAt(0).toUpperCase() + localPlayer.slice(1);
  }
}

function createRoomAndShare() {
  if (roomId) {
    alert("Room already exists: " + roomId);
    return;
  }
  const id = randomRoomId();
  roomId = id;
  setRoomLabel(id);

  // Set URL ?room=ID
  const url = new URL(window.location.href);
  url.searchParams.set("room", id);
  window.history.replaceState({}, "", url.toString());

  // create initial state in DB
  initBoardState();
  pushStateToFirebase(true, "Game created.");

  // you are white by default
  localPlayer = "white";
  updateLocalPlayerLabel();

  // show room info block
  const roomInfo = document.getElementById("room-info");
  if (roomInfo) roomInfo.classList.remove("hidden");

  const linkInput = document.getElementById("room-link");
  if (linkInput) linkInput.value = url.toString();

  setLobbyStatus("Room created. Send the link to your friend. Game starts when both players join.");

  // start listening
  subscribeToRoom(id);

  // try copy link automatically
  navigator.clipboard?.writeText(url.toString()).catch(() => {});
}

function copyRoomLink() {
  const linkInput = document.getElementById("room-link");
  if (!linkInput) return;
  linkInput.select();
  linkInput.setSelectionRange(0, 99999);
  navigator.clipboard?.writeText(linkInput.value)
    .then(() => setLobbyStatus("Link copied! Send it to your friend."))
    .catch(() => setLobbyStatus("Copy failed, please copy link manually."));
}

function joinRoom(id) {
  const roomRef = db.ref(`rooms/${id}`);
  roomRef.once("value").then(snapshot => {
    const data = snapshot.val();

    if (!data) {
      // room does not exist yet → create and be white
      roomId = id;
      initBoardState();
      pushStateToFirebase(true, "Room created.");
      localPlayer = "white";
      setLobbyStatus(`Room ${id} created. You are White. Waiting for second player…`);
    } else {
      // room exists: check sides
      const hasWhite = !!data.players?.white;
      const hasBlack = !!data.players?.black;
      if (!hasWhite) {
        localPlayer = "white";
      } else if (!hasBlack) {
        localPlayer = "black";
      } else {
        localPlayer = "spectator";
      }

      // load game state from DB
      if (data.board && data.currentPlayer) {
        board = data.board;
        currentPlayer = data.currentPlayer;
        gameOver = !!data.gameOver;
        lastAction = null;
      }

      if (localPlayer === "spectator") {
        setLobbyStatus(`Room ${id} is full. You are a spectator.`);
      } else {
        setLobbyStatus(`Joined room ${id} as ${localPlayer}. Waiting for both players…`);
      }
    }

    // update players in DB
    const playerField =
      localPlayer === "white" ? "players/white" :
      localPlayer === "black" ? "players/black" : null;

    if (playerField) {
      const uid = `user_${Math.random().toString(36).slice(2, 8)}`;
      roomRef.child(playerField).set(uid);
    }

    updateLocalPlayerLabel();
    subscribeToRoom(id);
  });
}

function subscribeToRoom(id) {
  const roomRef = db.ref(`rooms/${id}`);
  roomRef.on("value", snapshot => {
    const data = snapshot.val();
    if (!data) return;
    if (!data.board || !data.currentPlayer) return;

    board = data.board;
    currentPlayer = data.currentPlayer;
    gameOver = !!data.gameOver;
    lastAction = null;

    // update message if exists
    if (data.message) setMessage(data.message);

    // check if both players present -> show game screen
    const hasWhite = !!data.players?.white;
    const hasBlack = !!data.players?.black;

    if (hasWhite && hasBlack) {
      if (!gameScreenVisible) {
        showGameScreen();
        setMessage("");
      } else {
        renderBoard();
      }
    } else {
      // still waiting in lobby
      if (!gameScreenVisible) {
        if (localPlayer === "white") {
          setLobbyStatus(`Room ${id}. Waiting for second player to join…`);
        } else if (localPlayer === "black") {
          setLobbyStatus(`Joined room ${id} as Black. Waiting for White…`);
        } else {
          setLobbyStatus(`Watching room ${id}…`);
        }
      }
    }
  });
}

function pushStateToFirebase(fullReset = false, customMessage = null) {
  if (!roomId) return;
  const roomRef = db.ref(`rooms/${roomId}`);

  const payload = {
    board,
    currentPlayer,
    gameOver,
  };

  if (customMessage !== null) {
    payload.message = customMessage;
  }

  if (fullReset) {
    roomRef.update(payload);
  } else {
    roomRef.update(payload);
  }
}

/**********************
 *  BASE GAME LOGIC
 **********************/
function setMessage(msg) {
  const el = document.getElementById("message");
  if (el) el.textContent = msg;
}

function playSound(audioEl) {
  if (!audioEl) return;
  try {
    audioEl.currentTime = 0;
    audioEl.play();
  } catch (e) {}
}

function initBoardState() {
  board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => ({ player: null, value: null, type: null }))
  );

  function place(row, col, player, value) {
    board[row][col] = { player, value, type: getTypeForValue(value) };
  }

  // Black side at top
  for (let c = 0; c < 8; c++) place(1, c, "black", 2);
  place(0, 0, "black", 16);
  place(0, 7, "black", 16);
  place(0, 1, "black", 4);
  place(0, 6, "black", 4);
  place(0, 2, "black", 8);
  place(0, 5, "black", 8);
  place(0, 3, "black", 32);
  place(0, 4, "black", 32);

  // White side at bottom
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
}

/**********************
 *  RENDER
 **********************/
function renderBoard(animate = false) {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;
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

  const cpEl = document.getElementById("current-player");
  if (cpEl) {
    cpEl.textContent =
      currentPlayer.charAt(0).toUpperCase() + currentPlayer.slice(1);
  }
}

/**********************
 *  SCORES
 **********************/
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

/**********************
 *  CLICK HANDLING
 **********************/
function onCellClick(e) {
  if (gameOver) return;

  // spectator cannot move
  if (localPlayer === "spectator" && roomId) {
    setMessage("You are a spectator in this room.");
    return;
  }

  // only current side can move in online mode
  if (roomId && localPlayer && localPlayer !== currentPlayer) {
    setMessage("It is not your turn.");
    return;
  }

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
    const winnerText = checkWinCondition();
    if (!gameOver) switchPlayer();
    pushStateToFirebase(false, winnerText || null);
  } else {
    if (piece.player === currentPlayer) {
      selectedCell = { row, col };
      possibleMoves = computePossibleMoves(row, col);
      renderBoard();
    }
  }
}

function onRestartClick() {
  if (!roomId) {
    initBoardState();
    renderBoard();
    setMessage("");
    return;
  }
  initBoardState();
  renderBoard();
  setMessage("Game restarted.");
  pushStateToFirebase(true, "Game restarted.");
}

/**********************
 *  MOVES / RULES
 **********************/
function switchPlayer() {
  currentPlayer = currentPlayer === "white" ? "black" : "white";
}

function empty() {
  return { player: null, value: null, type: null };
}

// 2 -> pawn, 4 -> knight, 8 -> bishop, 16 -> rook, 32+ -> queen
function getTypeForValue(value) {
  if (value <= 2) return "pawn";
  if (value <= 4) return "knight";
  if (value <= 8) return "bishop";
  if (value <= 16) return "rook";
  return "queen";
}

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

  return "capture";
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

// promotion: 2 → 32 on last rank
function maybePromotePawn(r, c) {
  const p = board[r][c];
  if (p.type !== "pawn") return;

  const isLastRank =
    (p.player === "white" && r === 0) ||
    (p.player === "black" && r === 7);

  if (!isLastRank) return;

  const value = 32;
  board[r][c] = {
    player: p.player,
    value,
    type: getTypeForValue(value)
  };
  setMessage(`${p.player} pawn promoted to 32!`);
}

/**********************
 *  MOVES LIST
 **********************/
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

/**********************
 *  WIN CONDITIONS
 **********************/
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

function checkWinCondition() {
  // 1) Target tile win
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p.value && p.value >= TARGET_TILE) {
        const winner = currentPlayer.toUpperCase();
        const text = `${winner} wins by reaching ${p.value}!`;
        setMessage(text);
        showWinnerOverlay(`${winner} WINS !!`);
        gameOver = true;
        return text;
      }
    }
  }

  const opponent = currentPlayer === "white" ? "black" : "white";

  // 2) Opponent no pieces
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
    const text = `${winner} wins (captured all pieces)!`;
    setMessage(text);
    showWinnerOverlay(`${winner} WINS !!`);
    gameOver = true;
    return text;
  }

  // 3) Stalemate-like: opponent has pieces but no moves
  const opponentCanMove = hasAnyLegalMove(opponent);

  if (!opponentCanMove) {
    const { white, black } = computeScores();
    let text = "";
    if (white > black) {
      text = `WHITE wins by score (${white} vs ${black}) – ${opponent} has no moves.`;
      showWinnerOverlay(`WHITE WINS !!`);
    } else if (black > white) {
      text = `BLACK wins by score (${black} vs ${white}) – ${opponent} has no moves.`;
      showWinnerOverlay(`BLACK WINS !!`);
    } else {
      text = `DRAW by score (${white} vs ${black}) – no moves left.`;
      showWinnerOverlay(`DRAW !!`);
    }
    setMessage(text);
    gameOver = true;
    return text;
  }

  return null;
}

/**********************
 *  OVERLAY
 **********************/
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