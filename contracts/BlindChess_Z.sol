pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BlindChess is ZamaEthereumConfig {
    struct EncryptedPiece {
        euint32 position; 
        uint8 pieceType;  
        bool isWhite;     
        bool isCaptured;  
    }

    struct Move {
        uint8 fromX;
        uint8 fromY;
        uint8 toX;
        uint8 toY;
        euint32 encryptedFrom;
        euint32 encryptedTo;
        bytes proof;
    }

    mapping(uint8 => mapping(uint8 => EncryptedPiece)) public board;
    mapping(address => bool) public playerRegistered;
    mapping(address => uint8) public playerColor;
    address[] public players;
    uint8 public currentPlayer;
    bool public gameActive;

    event PlayerRegistered(address indexed player, uint8 color);
    event MoveMade(address indexed player, uint8 fromX, uint8 fromY, uint8 toX, uint8 toY);
    event GameOver(uint8 winner);

    constructor() ZamaEthereumConfig() {
        currentPlayer = 0;
    }

    function registerPlayer() external {
        require(!playerRegistered[msg.sender], "Player already registered");
        require(players.length < 2, "Game full");

        playerRegistered[msg.sender] = true;
        playerColor[msg.sender] = uint8(players.length);
        players.push(msg.sender);

        if (players.length == 2) {
            gameActive = true;
            currentPlayer = 0;
        }

        emit PlayerRegistered(msg.sender, playerColor[msg.sender]);
    }

    function initializeBoard(EncryptedPiece[8][8] calldata initialPieces) external {
        require(msg.sender == players[0], "Only white player can initialize");
        require(!gameActive, "Game already started");

        for (uint8 x = 0; x < 8; x++) {
            for (uint8 y = 0; y < 8; y++) {
                board[x][y] = initialPieces[x][y];
            }
        }

        gameActive = true;
        currentPlayer = 0;
    }

    function makeMove(Move calldata move) external {
        require(gameActive, "Game not active");
        require(playerRegistered[msg.sender], "Player not registered");
        require(playerColor[msg.sender] == currentPlayer, "Not your turn");

        EncryptedPiece storage fromPiece = board[move.fromX][move.fromY];
        require(!fromPiece.isCaptured, "Piece is captured");
        require(fromPiece.isWhite == (currentPlayer == 0), "Wrong color piece");

        require(FHE.eq(move.encryptedFrom, fromPiece.position), "Invalid encrypted from position");
        require(FHE.eq(move.encryptedTo, board[move.toX][move.toY].position), "Invalid encrypted to position");

        bool isValidMove = verifyMove(
            fromPiece.pieceType,
            fromPiece.isWhite,
            move.fromX,
            move.fromY,
            move.toX,
            move.toY
        );

        require(isValidMove, "Invalid move");

        board[move.toX][move.toY] = fromPiece;
        board[move.fromX][move.fromY].isCaptured = true;

        currentPlayer = 1 - currentPlayer;
        emit MoveMade(msg.sender, move.fromX, move.fromY, move.toX, move.toY);

        if (isCheckmate()) {
            gameActive = false;
            emit GameOver(currentPlayer);
        }
    }

    function verifyMove(
        uint8 pieceType,
        bool isWhite,
        uint8 fromX,
        uint8 fromY,
        uint8 toX,
        uint8 toY
    ) private pure returns (bool) {
        int256 dx = int256(toX) - int256(fromX);
        int256 dy = int256(toY) - int256(fromY);

        if (pieceType == 0) { 
            return abs(dx) == 1 && abs(dy) == 0; 
        } else if (pieceType == 1) { 
            return abs(dx) == 1 && abs(dy) == 1; 
        } else if (pieceType == 2) { 
            return abs(dx) == 0 && abs(dy) == 1; 
        } else if (pieceType == 3) { 
            return abs(dx) == abs(dy); 
        } else if (pieceType == 4) { 
            return abs(dx) == 0 || abs(dy) == 0; 
        } else if (pieceType == 5) { 
            return (abs(dx) == 1 && abs(dy) == 0) || (abs(dx) == 0 && abs(dy) == 1);
        } else if (pieceType == 6) { 
            return abs(dx) <= 1 && abs(dy) <= 1; 
        }

        return false;
    }

    function isCheckmate() private view returns (bool) {
        bool canMove = false;
        for (uint8 x = 0; x < 8; x++) {
            for (uint8 y = 0; y < 8; y++) {
                if (!board[x][y].isCaptured && board[x][y].isWhite == (currentPlayer == 0)) {
                    for (uint8 dx = 0; dx < 8; dx++) {
                        for (uint8 dy = 0; dy < 8; dy++) {
                            if (verifyMove(
                                board[x][y].pieceType,
                                board[x][y].isWhite,
                                x, y, dx, dy
                            )) {
                                canMove = true;
                                break;
                            }
                        }
                        if (canMove) break;
                    }
                }
                if (canMove) break;
            }
            if (canMove) break;
        }
        return !canMove;
    }

    function abs(int256 x) private pure returns (int256) {
        return x >= 0 ? x : -x;
    }

    function getBoard() external view returns (EncryptedPiece[8][8] memory) {
        return board;
    }

    function getCurrentPlayer() external view returns (address) {
        return players[currentPlayer];
    }

    function isGameOver() external view returns (bool) {
        return !gameActive;
    }
}


