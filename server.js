const express = require("express");
const { createServer } = require("http");
const socketIO = require("socket.io");
const { MultiPlayerGame } = require("./controllers/gameController");
const { initialTiles } = require("./constants/multiPlayerGame");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = createServer(app);
const io = socketIO(server, {
  cors: {
    origin: ["http://localhost:3001"],
  },
});

const chatIO = io.of("/chat");
const singleIO = io.of("/singlePlayer");
const gameIO = io.of("/game");

app.get("/", (req, res) => {
  res.send("Serving backend");
});

singleIO.on("connection", (socket) => {
  socket.emit("load-game", shuffle(initialTiles));
});

// Function to shuffle the array of tiles.
function shuffle(array) {
  let currentIndex = array.length,
    randomIndex;

  while (currentIndex != 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    let temp = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temp;
  }
  return array;
}

// Socket connection for chats.
chatIO.on("connection", (socket) => {
  const roomId = socket.handshake.auth.gameRoomId;
  socket.join(roomId);
  // Receive the client message and forward it to all the other connected clients.
  socket.on("send-message", (message, roomId) => {
    socket.to(roomId).emit("receive-message", message);
  });
});

// Array to keep track of the number of players.
const players = [];
// Array to go on with the opening of a new gameRoom when players are 4.
let fourPlayersCount = 0;
// To increment only by one whilst initializing the players.
let initializationIndex = 0;
// To iterate the players of a room whilst gaming.
// let playerIndex = 0;

const gameRoomIds = new Map();
let currentRoomId = null;

// Socket connection for the game.
gameIO.on("connection", (socket) => {
  let activeGameInstance = null;
  let roomId = null;
  if (fourPlayersCount % 4 !== 0) {
    roomId = currentRoomId;
    activeGameInstance = gameRoomIds.get(currentRoomId);
  } else {
    roomId = uuidv4();
    const gameRoom = new MultiPlayerGame();
    initializationIndex = 0;
    fourPlayersCount = 0;
    gameRoomIds.set(roomId, {
      gameRoom,
      players: [],
      playerIndex: 0,
    });
    console.log(socket.id);
    activeGameInstance = gameRoomIds.get(roomId);
    activeGameInstance.gameRoom.getGameState().roomId = roomId;
    currentRoomId = roomId;
  }

  players.push(players.length);
  fourPlayersCount++;
  activeGameInstance.players.push(activeGameInstance.players.length);

  // Update the time in the game state.
  const min = Math.floor(activeGameInstance.gameRoom.getTimeInSeconds() / 60);
  const sec = activeGameInstance.gameRoom.getTimeInSeconds() % 60;
  let minutes = min.toString();
  if (minutes.length < 2) {
    minutes = "0" + minutes;
  }
  let seconds = sec.toString();
  if (seconds.length < 2) {
    seconds = "0" + seconds;
  }
  activeGameInstance.gameRoom.getGameState().seconds = seconds;
  activeGameInstance.gameRoom.getGameState().minutes = minutes;

  // Appending the user in the score array of objects of the gameState.
  activeGameInstance.gameRoom.getGameState().score[
    players[initializationIndex]
  ] = 0;

  socket.join(roomId);

  // Emit game state to the clients.
  socket.emit(
    "load-game",
    activeGameInstance.gameRoom.getGameState(),
    activeGameInstance.gameRoom.getTimeInSeconds(),
    activeGameInstance.players[initializationIndex],
    roomId
  );

  gameIO
    .to(roomId)
    .emit(
      "players-joined",
      activeGameInstance.players,
      activeGameInstance.players[initializationIndex]
    );

  initializationIndex++;

  // Roll the dice when a client requests it and emit the result.
  socket.on("roll-dice-request", (playerCode, roomId) => {
    const activeGameInstance = gameRoomIds.get(roomId);
    if (
      playerCode ===
        activeGameInstance.players[activeGameInstance.playerIndex] &&
      activeGameInstance.gameRoom.getGameState().tilesLeft &&
      !activeGameInstance.gameRoom.getGameState().isTilesClickAllowed
    ) {
      const diceColor = activeGameInstance.gameRoom.rollDice();
      activeGameInstance.gameRoom.getGameState().diceColor = diceColor;
      activeGameInstance.gameRoom.getGameState().isTilesClickAllowed = true;
      activeGameInstance.gameRoom.getGameState().shouldStartTimer = true;
      gameIO
        .to(roomId)
        .emit(
          "roll-dice-receive",
          activeGameInstance.gameRoom.getGameState().diceColor,
          playerCode,
          activeGameInstance.gameRoom.getGameState().isTilesClickAllowed,
          activeGameInstance.gameRoom.getGameState().shouldStartTimer
        );
    }
  });

  // Send the updated time when the client requests it.
  socket.on("request-updated-timer", (roomId) => {
    const activeGameInstance = gameRoomIds.get(roomId);
    socket.emit(
      "receive-updated-timer",
      activeGameInstance.gameRoom.getTimeInSeconds()
    );
  });

  socket.on("start-game", (roomId) => {
    if (fourPlayersCount !== 1) {
      fourPlayersCount = 0;
      gameIO.to(roomId).emit("start-game-screen");
      const activeGameInstance = gameRoomIds.get(roomId);
      if (!activeGameInstance.gameRoom.getGameState().hasGameStarted) {
        activeGameInstance.gameRoom.startPerPlayerTimer(
          gameIO,
          activeGameInstance.players[activeGameInstance.playerIndex],
          activeGameInstance
        );
      }
      activeGameInstance.gameRoom.getGameState().hasGameStarted = true;
    }
  });

  socket.on(
    "multi-player-tiles-clicked-request",
    (index, playerCode, roomId) => {
      const activeGameInstance = gameRoomIds.get(roomId);
      activeGameInstance.gameRoom.stopPlayerTimer();
      if (
        playerCode ===
          activeGameInstance.players[activeGameInstance.playerIndex] &&
        activeGameInstance.gameRoom.getGameState().isTilesClickAllowed
      ) {
        const isMatched =
          activeGameInstance.gameRoom.getGameState().diceColor ===
          activeGameInstance.gameRoom.getGameState().tiles[index].color;
        if (
          isMatched &&
          !activeGameInstance.gameRoom.getGameState().tiles[index].matched
        ) {
          activeGameInstance.gameRoom.getGameState().tiles[
            index
          ].matched = true;
          activeGameInstance.gameRoom.getGameState().score[playerCode] += 1;
          activeGameInstance.gameRoom.getGameState().tilesLeft--;
          if (activeGameInstance.gameRoom.getGameState().tilesLeft === 0) {
            let championCode = -1;
            let highestScore = 0;
            activeGameInstance.players.forEach((player) => {
              if (
                activeGameInstance.gameRoom.getGameState().score[player] >=
                highestScore
              ) {
                highestScore =
                  activeGameInstance.gameRoom.getGameState().score[player];
                championCode = player;
              }
            });
            activeGameInstance.gameRoom.getGameState().score;
            activeGameInstance.gameRoom.getGameState().playerWon = championCode;
            activeGameInstance.gameRoom.getGameState().shouldStopTimer = true;
            activeGameInstance.gameRoom.getGameState().shouldStartTimer = false;
          }
        }
        activeGameInstance.gameRoom.getGameState().isTilesClickAllowed = false;
        if (
          activeGameInstance.playerIndex <
          activeGameInstance.players.length - 1
        ) {
          activeGameInstance.playerIndex++;
        } else {
          activeGameInstance.playerIndex = 0;
        }
        gameIO
          .to(roomId)
          .emit(
            "multi-player-tiles-clicked-receive",
            isMatched,
            activeGameInstance.gameRoom.getGameState().tiles,
            activeGameInstance.gameRoom.getGameState().score[playerCode],
            playerCode,
            activeGameInstance.players[activeGameInstance.playerIndex],
            activeGameInstance.gameRoom.getGameState().isTilesClickAllowed,
            activeGameInstance.gameRoom.getGameState().playerWon
          );
        activeGameInstance.gameRoom.startPerPlayerTimer(
          gameIO,
          activeGameInstance.players[activeGameInstance.playerIndex],
          activeGameInstance
        );
      }
    }
  );
  if (fourPlayersCount === 4) {
    fourPlayersCount = 0;
    gameIO.to(roomId).emit("start-game-screen");
    const activeGameInstance = gameRoomIds.get(roomId);
    if (!activeGameInstance.gameRoom.getGameState().hasGameStarted) {
      activeGameInstance.gameRoom.startPerPlayerTimer(
        gameIO,
        activeGameInstance.players[activeGameInstance.playerIndex],
        activeGameInstance
      );
    }
  }
});

server.listen(3000, () => {
  console.log("Listening on port 3000");
});
