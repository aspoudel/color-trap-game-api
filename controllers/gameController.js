const { initialTiles, diceColors } = require("../constants/multiPlayerGame");

class MultiPlayerGame {
  constructor() {
    // Multi Player Game Logic.
    this.shouldStartTimer = true;
    this.timeInSeconds = 0;
    this.playerTimer = null;

    const newTiles = initialTiles.map((tile) => ({
      ...tile,
    }));

    // Game State initialized in the server for synchronization.
    this.gameState = {
      tiles: this.shuffle(newTiles),
      diceColor: "#000",
      score: {},
      minutes: "00",
      seconds: "00",
      shouldStartTimer: false,
      shouldStopTimer: false,
      shouldPickColor: false,
      shouldRollDice: true,
      isTilesClickAllowed: false,
      isRollDiceAllowed: false,
      playerWon: null,
      tilesLeft: 25,
      perPlayerTime: 10,
      roomId: null,
      hasGameStarted: false,
    };

    this.startTimer = this.startTimer.bind(this);
  }

  stopPlayerTimer() {
    clearTimeout(this.playerTimer);
  }

  // Function to start the per player timer.
  startPerPlayerTimer(gameIO, playerIndex, activeGameInstance) {
    if (this.gameState.tilesLeft !== 0 && !this.gameState.shouldStopTimer) {
      if (this.shouldStartTimer) {
        setTimeout(this.startTimer, 1000);
        this.shouldStartTimer = false;
        this.gameState.shouldStartTimer = true;
      }
      gameIO
        .to(this.gameState.roomId)
        .emit("player-timer-call", activeGameInstance.players[playerIndex]);
      this.playerTimer = setTimeout(() => {
        this.sendPlayerTimerUpdate(
          gameIO,
          activeGameInstance.players[playerIndex],
          activeGameInstance
        );
        if (playerIndex < activeGameInstance.players.length - 1) {
          playerIndex++;
        } else {
          playerIndex = 0;
        }
      }, 10500);
    } else {
      gameIO.to(this.gameState.roomId).emit("player-timer-call", -1);
    }
  }

  sendPlayerTimerUpdate(gameIO, playerCode, activeGameInstance) {
    if (
      activeGameInstance.playerIndex <
      activeGameInstance.players.length - 1
    ) {
      activeGameInstance.playerIndex++;
    } else {
      activeGameInstance.playerIndex = 0;
    }

    gameIO
      .to(this.gameState.roomId)
      .emit(
        "player-turn-change",
        false,
        this.gameState.tiles,
        this.gameState.score[playerCode],
        playerCode,
        activeGameInstance.players[activeGameInstance.playerIndex],
        false,
        this.gameState.playerWon
      );
    this.gameState.isTilesClickAllowed = false;
    this.startPerPlayerTimer(
      gameIO,
      activeGameInstance.playerIndex,
      activeGameInstance
    );
  }

  // Function to start the timer in the client side after dice roll.
  startTimer() {
    if (this.gameState.shouldStopTimer) {
      this.gameState.isRollDiceAllowed = false;
      return;
    }
    this.timeInSeconds += 1;
    setTimeout(() => {
      this.startTimer();
    }, 1000);
  }

  // Function to shuffle the array of tiles.
  shuffle(array) {
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

  // Function to roll the dice.
  rollDice() {
    const max = diceColors.length - 1;
    const min = 0;
    const range = max - min + 1;
    const randomNumber = Math.floor(Math.random() * range) + min;
    return diceColors[randomNumber];
  }

  getGameState() {
    return this.gameState;
  }

  getTimeInSeconds() {
    return this.timeInSeconds;
  }
}

module.exports = {
  MultiPlayerGame,
};
