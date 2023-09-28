// if (process.env.NODE_ENV != "production") {
//   require("dotenv").config();
// }
require("dotenv").config();

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
    origin: ["https://colortrapgame.com", "https://colourtrapgame.com"],
    allowedHeaders: ["Authorization"],
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

// To iterate the players of a room whilst gaming.
// let playerIndex = 0;

const gameRoomIds = new Map();
const socketToRooms = new Map();
let currentRoomId = null;

// Socket connection for the game.
gameIO.on("connection", (socket) => {
  let activeGameInstance = gameRoomIds.get(currentRoomId);
  let roomId = null;
  if (currentRoomId != null) {
    roomId = currentRoomId;
  } else {
    roomId = uuidv4();
    const gameRoom = new MultiPlayerGame();
    gameRoomIds.set(roomId, {
      gameRoom,
      players: [],
      playerIndex: 0,
      fourPlayersCount: 0,
    });
    activeGameInstance = gameRoomIds.get(roomId);
    activeGameInstance.gameRoom.getGameState().roomId = roomId;
    currentRoomId = roomId;
  }
  players.push(players.length);
  socketToRooms.set(socket.id, {
    roomId,
    playerCode: activeGameInstance.players.length,
  });
  activeGameInstance.players.push(socket.id);

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
  activeGameInstance.gameRoom.getGameState().score[socket.id] = 0;

  socket.join(roomId);

  // Emit game state to the clients.
  socket.emit(
    "load-game",
    activeGameInstance.gameRoom.getGameState(),
    activeGameInstance.gameRoom.getTimeInSeconds(),
    activeGameInstance.players[activeGameInstance.fourPlayersCount],
    roomId
  );

  gameIO
    .to(roomId)
    .emit(
      "players-joined",
      activeGameInstance.players,
      activeGameInstance.players[activeGameInstance.fourPlayersCount]
    );

  activeGameInstance.fourPlayersCount++;

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
          activeGameInstance.gameRoom.getGameState().isTilesClickAllowed
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
          activeGameInstance.playerIndex,
          activeGameInstance
        );
      }
    }
  );

  socket.on("start-game", (roomId, playerCode) => {
    if (activeGameInstance.fourPlayersCount > 1) {
      currentRoomId = null;
      gameIO
        .to(roomId)
        .emit(
          "start-game-screen",
          activeGameInstance.players[activeGameInstance.playerIndex],
          true
        );
      if (!activeGameInstance.gameRoom.getGameState().hasGameStarted) {
        activeGameInstance.gameRoom.startPerPlayerTimer(
          gameIO,
          activeGameInstance.playerIndex,
          activeGameInstance
        );
      }
      activeGameInstance.gameRoom.getGameState().hasGameStarted = true;
    }
  });

  if (activeGameInstance.fourPlayersCount === 4) {
    currentRoomId = null;
    gameIO
      .to(roomId)
      .emit(
        "start-game-screen",
        activeGameInstance.players[activeGameInstance.playerIndex],
        true
      );
    if (!activeGameInstance.gameRoom.getGameState().hasGameStarted) {
      activeGameInstance.gameRoom.startPerPlayerTimer(
        gameIO,
        activeGameInstance.playerIndex,
        activeGameInstance
      );
    }
    activeGameInstance.gameRoom.getGameState().hasGameStarted = true;
  }

  socket.on("disconnect", () => {
    const roomId = socketToRooms.get(socket.id).roomId;
    const playerIndex = socketToRooms.get(socket.id).playerCode;
    socketToRooms.delete(socket.id);
    const gameRoom = gameRoomIds.get(roomId);
    gameRoom.players = gameRoom.players.filter(
      (number) => number !== socket.id
    );
    if (gameRoom.players.length === 0) {
      gameRoomIds.delete(roomId);
      currentRoomId = null;
      gameRoom.gameRoom.getGameState().shouldStopTimer = true;
    } else {
      gameIO
        .to(roomId)
        .emit("player-left-event", playerIndex, gameRoom.players);
    }
    gameRoom.fourPlayersCount--;
  });
});

const PORT = process.env.PORT;

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
