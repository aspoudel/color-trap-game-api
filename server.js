const express = require("express");
const { createServer } = require("http");
const socketIO = require("socket.io");
const { MultiPlayerGame } = require("./controllers/gameController");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = createServer(app);
const io = socketIO(server, {
  cors: {
    origin: ["http://localhost:3001"],
  },
});

const chatIO = io.of("/chat");
const gameIO = io.of("/game");

app.get("/", (req, res) => {
  res.send("Serving backend");
});

// Socket connection for chats.
chatIO.on("connection", (socket) => {
  console.log("Connected chat socket: " + socket.id);

  // Receive the client message and forward it to all the other connected clients.
  socket.on("send-message", (message) => {
    socket.broadcast.emit("receive-message", message);
  });
});

// Array to track the players
const players = [];
// To increment only by one whilst initializing the players
let initializationIndex = 0;
// To iterate the players of a room whilst gaming.
// let playerIndex = 0;

const gameRoomIds = new Map();
let currentRoomId = null;

// Socket connection for the game.
gameIO.on("connection", (socket) => {
  console.log("Connected game socket: " + socket.id);

  let activeGameInstance = null;
  let roomId = null;
  if (players.length % 4 !== 0) {
    roomId = currentRoomId;
    activeGameInstance = gameRoomIds.get(currentRoomId);
  } else {
    roomId = uuidv4();
    console.log("New object instance");
    const gameRoom = new MultiPlayerGame();
    initializationIndex = 0;
    gameRoomIds.set(roomId, {
      gameRoom,
      players: [],
      playerIndex: 0,
    });
    activeGameInstance = gameRoomIds.get(roomId);
    activeGameInstance.gameRoom.getGameState().roomId = roomId;
    currentRoomId = roomId;
  }

  players.push(players.length);
  console.log("Players: ", players);
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

  console.log(
    "Score object: ",
    activeGameInstance.gameRoom.getGameState().score
  );

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
    console.log(
      "Roll Dice Values ",
      playerCode +
        " " +
        activeGameInstance.players[activeGameInstance.playerIndex] +
        " " +
        activeGameInstance.gameRoom.getGameState().tilesLeft +
        " " +
        activeGameInstance.gameRoom.getGameState().isTilesClickAllowed
    );
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
    console.log("Room ID:", roomId);
    socket.emit(
      "receive-updated-timer",
      activeGameInstance.gameRoom.getTimeInSeconds()
    );
  });

  socket.on("start-game", (roomId) => {
    const activeGameInstance = gameRoomIds.get(roomId);
    activeGameInstance.gameRoom.startPerPlayerTimer(
      gameIO,
      activeGameInstance.players[activeGameInstance.playerIndex],
      activeGameInstance
    );
  });

  socket.on(
    "multi-player-tiles-clicked-request",
    (index, playerCode, roomId) => {
      const activeGameInstance = gameRoomIds.get(roomId);
      activeGameInstance.gameRoom.stopPlayerTimer();
      console.log("Active game room ID:", roomId);
      console.log(
        playerCode,
        activeGameInstance.players[activeGameInstance.playerIndex],
        activeGameInstance.gameRoom.getGameState().isTilesClickAllowed
      );
      if (
        playerCode ===
          activeGameInstance.players[activeGameInstance.playerIndex] &&
        activeGameInstance.gameRoom.getGameState().isTilesClickAllowed
      ) {
        console.log(
          activeGameInstance.gameRoom.getGameState().diceColor,
          activeGameInstance.gameRoom.getGameState().tiles[index].color
        );
        const isMatched =
          activeGameInstance.gameRoom.getGameState().diceColor ===
          activeGameInstance.gameRoom.getGameState().tiles[index].color;
        if (isMatched) {
          console.log("It's a match!");
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
});

server.listen(3000, () => {
  console.log("Listening on port 3000");
});
