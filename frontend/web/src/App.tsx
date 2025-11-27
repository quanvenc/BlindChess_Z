import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ChessGame {
  id: string;
  name: string;
  boardState: string;
  player1: string;
  player2: string;
  timestamp: number;
  publicValue1: number;
  publicValue2: number;
  isVerified: boolean;
  decryptedValue: number;
  creator: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [games, setGames] = useState<ChessGame[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingGame, setCreatingGame] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newGameData, setNewGameData] = useState({ name: "", position: "", move: "" });
  const [selectedGame, setSelectedGame] = useState<ChessGame | null>(null);
  const [decryptedPosition, setDecryptedPosition] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("games");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const gamesPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
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
      const gamesList: ChessGame[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          gamesList.push({
            id: businessId,
            name: businessData.name,
            boardState: businessId,
            player1: businessData.creator,
            player2: "",
            timestamp: Number(businessData.timestamp),
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            creator: businessData.creator
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setGames(gamesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createGame = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingGame(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating blind chess game with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const positionValue = parseInt(newGameData.position) || 0;
      const businessId = `chess-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, positionValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newGameData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newGameData.move) || 0,
        0,
        "Blind Chess Game"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Chess game created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewGameData({ name: "", position: "", move: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingGame(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Position already verified on-chain" });
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying position decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Position decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Position is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      setTransactionStatus({ visible: true, status: "pending", message: "Checking availability..." });
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredGames = games.filter(game => 
    game.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    game.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const indexOfLastGame = currentPage * gamesPerPage;
  const indexOfFirstGame = indexOfLastGame - gamesPerPage;
  const currentGames = filteredGames.slice(indexOfFirstGame, indexOfLastGame);
  const totalPages = Math.ceil(filteredGames.length / gamesPerPage);

  const stats = {
    totalGames: games.length,
    verifiedGames: games.filter(g => g.isVerified).length,
    activeGames: games.filter(g => Date.now()/1000 - g.timestamp < 86400).length,
    avgMoveCount: games.length > 0 ? games.reduce((sum, g) => sum + g.publicValue1, 0) / games.length : 0
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🎯 Blind Chess FHE</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🎯</div>
            <h2>Connect to Start Blind Chess</h2>
            <p>Encrypted chess positions with FHE verification</p>
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
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted chess games...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🎯 Blind Chess FHE</h1>
        </div>
        
        <nav className="main-nav">
          <button className={activeTab === "games" ? "active" : ""} onClick={() => setActiveTab("games")}>Games</button>
          <button className={activeTab === "stats" ? "active" : ""} onClick={() => setActiveTab("stats")}>Statistics</button>
          <button className={activeTab === "about" ? "active" : ""} onClick={() => setActiveTab("about")}>About</button>
        </nav>
        
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn">New Game</button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        {activeTab === "games" && (
          <div className="games-tab">
            <div className="games-header">
              <h2>Active Blind Chess Games</h2>
              <div className="games-controls">
                <input 
                  type="text" 
                  placeholder="Search games..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
                <button onClick={callIsAvailable} className="check-btn">Check Availability</button>
              </div>
            </div>
            
            <div className="games-grid">
              {currentGames.length === 0 ? (
                <div className="no-games">
                  <p>No chess games found</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-btn">Create First Game</button>
                </div>
              ) : currentGames.map((game) => (
                <div key={game.id} className="game-card" onClick={() => setSelectedGame(game)}>
                  <div className="game-header">
                    <h3>{game.name}</h3>
                    <span className={`status ${game.isVerified ? 'verified' : 'encrypted'}`}>
                      {game.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </span>
                  </div>
                  <div className="game-info">
                    <p>Move: {game.publicValue1}</p>
                    <p>Created: {new Date(game.timestamp * 1000).toLocaleDateString()}</p>
                    <p>By: {game.creator.substring(0, 6)}...{game.creator.substring(38)}</p>
                  </div>
                </div>
              ))}
            </div>
            
            {totalPages > 1 && (
              <div className="pagination">
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(currentPage - 1)}>Previous</button>
                <span>Page {currentPage} of {totalPages}</span>
                <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(currentPage + 1)}>Next</button>
              </div>
            )}
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-tab">
            <h2>Game Statistics</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Total Games</h3>
                <div className="stat-value">{stats.totalGames}</div>
              </div>
              <div className="stat-card">
                <h3>Verified Positions</h3>
                <div className="stat-value">{stats.verifiedGames}</div>
              </div>
              <div className="stat-card">
                <h3>Active Games</h3>
                <div className="stat-value">{stats.activeGames}</div>
              </div>
              <div className="stat-card">
                <h3>Avg Moves</h3>
                <div className="stat-value">{stats.avgMoveCount.toFixed(1)}</div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "about" && (
          <div className="about-tab">
            <h2>About Blind Chess FHE</h2>
            <div className="about-content">
              <p>Blind Chess uses FHE to encrypt chess positions, creating a fog of war experience.</p>
              <div className="feature-list">
                <h3>Features:</h3>
                <ul>
                  <li>Encrypted position storage</li>
                  <li>Homomorphic move verification</li>
                  <li>Real-time game statistics</li>
                  <li>Secure multiplayer gameplay</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New Blind Chess Game</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <input 
                type="text" 
                placeholder="Game name..." 
                value={newGameData.name}
                onChange={(e) => setNewGameData({...newGameData, name: e.target.value})}
              />
              <input 
                type="number" 
                placeholder="Starting position (integer)..." 
                value={newGameData.position}
                onChange={(e) => setNewGameData({...newGameData, position: e.target.value})}
              />
              <input 
                type="number" 
                placeholder="First move..." 
                value={newGameData.move}
                onChange={(e) => setNewGameData({...newGameData, move: e.target.value})}
              />
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button onClick={createGame} disabled={creatingGame || isEncrypting}>
                {creatingGame ? "Creating..." : "Create Game"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedGame && (
        <div className="modal-overlay">
          <div className="game-detail-modal">
            <div className="modal-header">
              <h2>{selectedGame.name}</h2>
              <button onClick={() => setSelectedGame(null)} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="game-detail">
                <p><strong>Game ID:</strong> {selectedGame.id}</p>
                <p><strong>Current Move:</strong> {selectedGame.publicValue1}</p>
                <p><strong>Position Status:</strong> {selectedGame.isVerified ? 'Verified' : 'Encrypted'}</p>
                {selectedGame.isVerified && (
                  <p><strong>Decrypted Position:</strong> {selectedGame.decryptedValue}</p>
                )}
              </div>
              <button 
                onClick={async () => {
                  const result = await decryptData(selectedGame.id);
                  if (result !== null) setDecryptedPosition(result);
                }}
                disabled={isDecrypting}
                className="decrypt-btn"
              >
                {isDecrypting ? "Decrypting..." : "Decrypt Position"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;