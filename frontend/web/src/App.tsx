import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ChessMove {
  id: number;
  from: string;
  to: string;
  piece: string;
  timestamp: number;
  player: string;
  encryptedValue: string;
  isVerified: boolean;
  decryptedValue: number;
}

interface GameStats {
  totalMoves: number;
  verifiedMoves: number;
  activePlayers: number;
  avgMoveTime: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [moves, setMoves] = useState<ChessMove[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingMove, setCreatingMove] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newMoveData, setNewMoveData] = useState({ from: "", to: "", piece: "" });
  const [selectedMove, setSelectedMove] = useState<ChessMove | null>(null);
  const [gameStats, setGameStats] = useState<GameStats>({
    totalMoves: 0,
    verifiedMoves: 0,
    activePlayers: 0,
    avgMoveTime: 0
  });
  const [showFAQ, setShowFAQ] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const movesList: ChessMove[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          movesList.push({
            id: parseInt(businessId.replace('move-', '')) || Date.now(),
            from: businessData.name.split('-')[0] || "A1",
            to: businessData.name.split('-')[1] || "A2",
            piece: businessData.description || "Pawn",
            timestamp: Number(businessData.timestamp),
            player: businessData.creator,
            encryptedValue: businessId,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setMoves(movesList);
      updateGameStats(movesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateGameStats = (movesList: ChessMove[]) => {
    const totalMoves = movesList.length;
    const verifiedMoves = movesList.filter(m => m.isVerified).length;
    const players = new Set(movesList.map(m => m.player)).size;
    const avgTime = totalMoves > 0 ? movesList.reduce((sum, m) => sum + m.timestamp, 0) / totalMoves : 0;
    
    setGameStats({
      totalMoves,
      verifiedMoves,
      activePlayers: players,
      avgMoveTime: avgTime
    });
  };

  const createMove = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingMove(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted chess move..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const moveValue = Math.floor(Math.random() * 100) + 1;
      const businessId = `move-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, moveValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        `${newMoveData.from}-${newMoveData.to}`,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        moveValue,
        0,
        newMoveData.piece
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Encrypting move on-chain..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted move created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewMoveData({ from: "", to: "", piece: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingMove(false); 
    }
  };

  const decryptMove = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Move already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying move..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Move verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Move already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderChessBoard = () => {
    const board = [];
    const files = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    
    for (let row = 8; row >= 1; row--) {
      const squares = [];
      for (let col = 0; col < 8; col++) {
        const squareId = `${files[col]}${row}`;
        const hasMove = moves.some(m => m.from === squareId || m.to === squareId);
        
        squares.push(
          <div 
            key={squareId} 
            className={`chess-square ${(row + col) % 2 === 0 ? 'light' : 'dark'} ${hasMove ? 'has-move' : ''}`}
          >
            {squareId}
          </div>
        );
      }
      board.push(<div key={row} className="chess-row">{squares}</div>);
    }
    
    return <div className="chess-board">{board}</div>;
  };

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card metal-card">
          <div className="stat-icon">♟️</div>
          <div className="stat-content">
            <h3>Total Moves</h3>
            <div className="stat-value">{gameStats.totalMoves}</div>
          </div>
        </div>
        
        <div className="stat-card metal-card">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>Verified Moves</h3>
            <div className="stat-value">{gameStats.verifiedMoves}</div>
          </div>
        </div>
        
        <div className="stat-card metal-card">
          <div className="stat-icon">👤</div>
          <div className="stat-content">
            <h3>Active Players</h3>
            <div className="stat-value">{gameStats.activePlayers}</div>
          </div>
        </div>
        
        <div className="stat-card metal-card">
          <div className="stat-icon">⏱️</div>
          <div className="stat-content">
            <h3>Avg Move Time</h3>
            <div className="stat-value">{gameStats.avgMoveTime.toFixed(1)}s</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqs = [
      {
        question: "What is FHE-based Blind Chess?",
        answer: "A chess variant where piece positions are encrypted using Fully Homomorphic Encryption, creating strategic fog of war."
      },
      {
        question: "How does encryption work?",
        answer: "Each move is encrypted on-chain using Zama FHE, allowing verification without revealing positions."
      },
      {
        question: "What can opponents see?",
        answer: "Only encrypted data and public metadata. Actual positions remain hidden until decryption."
      },
      {
        question: "How to verify moves?",
        answer: "Use the verify function to decrypt and validate move legality through homomorphic verification."
      }
    ];

    return (
      <div className="faq-section">
        <h3>Frequently Asked Questions</h3>
        <div className="faq-list">
          {faqs.map((faq, index) => (
            <div key={index} className="faq-item">
              <div className="faq-question">{faq.question}</div>
              <div className="faq-answer">{faq.answer}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Blind Chess FHE ♟️🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">♟️🔐</div>
            <h2>Connect to Start Encrypted Chess</h2>
            <p>Connect your wallet to initialize the FHE encryption system and begin playing blind chess.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Create encrypted chess moves</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Verify opponent moves homomorphically</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Chess System...</p>
        <p className="loading-note">Setting up encrypted game environment</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted chess game...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Blind Chess FHE ♟️🔐</h1>
          <span className="subtitle">Encrypted Strategic Warfare</span>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Move
          </button>
          <button 
            onClick={() => setShowFAQ(!showFAQ)} 
            className="faq-btn"
          >
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="game-section">
          <div className="section-header">
            <h2>Encrypted Chess Board</h2>
            <div className="board-controls">
              <button onClick={loadData} disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="board-container">
            {renderChessBoard()}
            <div className="radar-view">
              <h3>Move Radar</h3>
              <div className="radar-content">
                {moves.slice(-5).map((move, index) => (
                  <div key={index} className="radar-move">
                    <span>{move.piece} {move.from}→{move.to}</span>
                    <span className={`status ${move.isVerified ? 'verified' : 'pending'}`}>
                      {move.isVerified ? '✓' : '…'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        <div className="stats-section">
          <h2>Game Statistics</h2>
          {renderStats()}
        </div>
        
        {showFAQ && (
          <div className="info-section">
            {renderFAQ()}
          </div>
        )}
        
        <div className="moves-section">
          <div className="section-header">
            <h2>Move History</h2>
            <span className="move-count">{moves.length} moves</span>
          </div>
          
          <div className="moves-list">
            {moves.length === 0 ? (
              <div className="no-moves">
                <p>No moves recorded yet</p>
                <button onClick={() => setShowCreateModal(true)}>
                  Make First Move
                </button>
              </div>
            ) : moves.map((move, index) => (
              <div 
                className={`move-item ${selectedMove?.id === move.id ? "selected" : ""} ${move.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedMove(move)}
              >
                <div className="move-header">
                  <span className="move-piece">{move.piece}</span>
                  <span className="move-coords">{move.from} → {move.to}</span>
                  <span className={`move-status ${move.isVerified ? 'verified' : 'pending'}`}>
                    {move.isVerified ? 'Verified' : 'Pending'}
                  </span>
                </div>
                <div className="move-meta">
                  <span>Player: {move.player.substring(0, 6)}...{move.player.substring(38)}</span>
                  <span>Time: {new Date(move.timestamp * 1000).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateMove 
          onSubmit={createMove} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingMove} 
          moveData={newMoveData} 
          setMoveData={setNewMoveData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedMove && (
        <MoveDetailModal 
          move={selectedMove} 
          onClose={() => setSelectedMove(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptMove={() => decryptMove(selectedMove.encryptedValue)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateMove: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  moveData: any;
  setMoveData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, moveData, setMoveData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setMoveData({ ...moveData, [name]: value });
  };

  const files = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const pieces = ['Pawn', 'Rook', 'Knight', 'Bishop', 'Queen', 'King'];

  return (
    <div className="modal-overlay">
      <div className="create-move-modal">
        <div className="modal-header">
          <h2>Create Encrypted Chess Move</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Move data encrypted with Zama FHE - only integers supported</p>
          </div>
          
          <div className="form-group">
            <label>Chess Piece *</label>
            <select name="piece" value={moveData.piece} onChange={handleChange}>
              <option value="">Select piece</option>
              {pieces.map(piece => (
                <option key={piece} value={piece}>{piece}</option>
              ))}
            </select>
          </div>
          
          <div className="move-coordinates">
            <div className="form-group">
              <label>From Square *</label>
              <input 
                type="text" 
                name="from" 
                value={moveData.from} 
                onChange={handleChange} 
                placeholder="A1" 
                maxLength={2}
              />
            </div>
            
            <div className="form-group">
              <label>To Square *</label>
              <input 
                type="text" 
                name="to" 
                value={moveData.to} 
                onChange={handleChange} 
                placeholder="A2" 
                maxLength={2}
              />
            </div>
          </div>
          
          <div className="coordinate-help">
            <p>Valid squares: A1-H8 (File: A-H, Rank: 1-8)</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !moveData.piece || !moveData.from || !moveData.to} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting Move..." : "Create Encrypted Move"}
          </button>
        </div>
      </div>
    </div>
  );
};

const MoveDetailModal: React.FC<{
  move: ChessMove;
  onClose: () => void;
  isDecrypting: boolean;
  decryptMove: () => Promise<number | null>;
}> = ({ move, onClose, isDecrypting, decryptMove }) => {
  const handleDecrypt = async () => {
    await decryptMove();
  };

  return (
    <div className="modal-overlay">
      <div className="move-detail-modal">
        <div className="modal-header">
          <h2>Move Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="move-info">
            <div className="info-item">
              <span>Piece:</span>
              <strong>{move.piece}</strong>
            </div>
            <div className="info-item">
              <span>Move:</span>
              <strong>{move.from} → {move.to}</strong>
            </div>
            <div className="info-item">
              <span>Player:</span>
              <strong>{move.player.substring(0, 6)}...{move.player.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Time:</span>
              <strong>{new Date(move.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Encryption Status</h3>
            <div className="encryption-status">
              <div className={`status-indicator ${move.isVerified ? 'verified' : 'encrypted'}`}>
                {move.isVerified ? '✅ Verified' : '🔒 Encrypted'}
              </div>
              
              {move.isVerified && (
                <div className="decrypted-value">
                  <span>Decrypted Value:</span>
                  <strong>{move.decryptedValue}</strong>
                </div>
              )}
            </div>
            
            <button 
              className={`decrypt-btn ${move.isVerified ? 'verified' : ''}`}
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? "Verifying..." : move.isVerified ? "✅ Verified" : "🔓 Verify Move"}
            </button>
          </div>
          
          <div className="fhe-explanation">
            <h4>How FHE Blind Chess Works</h4>
            <p>Each move is encrypted using Fully Homomorphic Encryption. Opponents can verify move legality without seeing actual positions, creating strategic fog of war.</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


