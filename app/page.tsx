'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { db } from '../firebase'; 
import { ref, set, onValue, get, update } from 'firebase/database';
import gsap from 'gsap';

// --- TÉMÁK ---
const THEMES = {
    luxus: {
        name: "Royal Mahogany", isDark: true, bgBase: 0x1a1a1a, fogColor: 0x1a1a1a,
        tableParams: { color1: '#4a2c20', color2: '#1a120b' }, woodColor: '#5d4037',
        frameColor: 0xffffff, boardField: 0x1e5128,
        special: { tw: 0xb91c1c, dw: 0xc084fc, tl: 0x1d4ed8, dl: 0x60a5fa, start: 0xb91c1c }
    },
    nordic: {
        name: "Nordic Frost", isDark: false, bgBase: 0xd1d5db, fogColor: 0xd1d5db,
        tableParams: { color1: '#f3f4f6', color2: '#e5e7eb' }, woodColor: '#d1d5db',
        frameColor: 0x9ca3af, boardField: 0xffffff,
        special: { tw: 0xfca5a5, dw: 0xfcd34d, tl: 0x93c5fd, dl: 0xc4b5fd, start: 0xfca5a5 }
    },
    cyber: {
        name: "Cyberpunk Neon", isDark: true, bgBase: 0x020617, fogColor: 0x020617,
        tableParams: { color1: '#0f172a', color2: '#000000' }, woodColor: '#1e293b',
        frameColor: 0x334155, boardField: 0x0f172a,
        special: { tw: 0xff0055, dw: 0xaa00ff, tl: 0x00ccff, dl: 0x00ffaa, start: 0xff0055 }
    }
};

// --- MAGYAR SCRABBLE BETŰKÉSZLET ÉS PONTOK ---
// A hivataloshoz közelítő, egykarakteres megvalósítás
const LETTER_DEF = {
    'A': { count: 6, value: 1 }, 'E': { count: 6, value: 1 }, 'K': { count: 6, value: 1 }, 'T': { count: 5, value: 1 },
    'Á': { count: 4, value: 1 }, 'L': { count: 4, value: 1 }, 'N': { count: 4, value: 1 }, 'R': { count: 4, value: 1 },
    'I': { count: 3, value: 1 }, 'M': { count: 3, value: 1 }, 'O': { count: 3, value: 1 }, 'S': { count: 3, value: 1 },
    'B': { count: 3, value: 2 }, 'D': { count: 3, value: 2 }, 'G': { count: 3, value: 2 }, 'Ó': { count: 3, value: 2 },
    'É': { count: 3, value: 3 }, 'H': { count: 2, value: 3 }, 'V': { count: 2, value: 3 },
    'F': { count: 2, value: 4 }, 'J': { count: 2, value: 4 }, 'Ö': { count: 2, value: 4 }, 'P': { count: 2, value: 4 },
    'U': { count: 2, value: 4 }, 'Ü': { count: 2, value: 4 }, 'Z': { count: 2, value: 4 },
    'C': { count: 1, value: 5 }, 'Í': { count: 1, value: 5 },
    'Ő': { count: 1, value: 7 }, 'Ú': { count: 1, value: 7 }, 'Ű': { count: 1, value: 7 }
};

// Zsák generálása
function generateInitialBag() {
    let bag: string[] = [];
    Object.entries(LETTER_DEF).forEach(([letter, data]) => {
        for (let i = 0; i < data.count; i++) bag.push(letter);
    });
    // Fisher-Yates keverés
    for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
}

const WORD_CACHE = new Set(["ALMA", "KÖRTE", "HÁZ", "LÓ", "KÉZ", "VÍZ", "TŰZ", "SZÓ", "JÁTÉK", "ASZTAL"]);

async function checkHungarianWordAPI(word: string) {
    const cleanWord = word.trim().toUpperCase();
    if (!cleanWord || cleanWord.length < 2) return false;
    if (WORD_CACHE.has(cleanWord)) return true;
    try {
        const response = await fetch(`https://hu.wiktionary.org/w/api.php?action=query&titles=${encodeURIComponent(cleanWord.toLowerCase())}&format=json&origin=*`);
        const data = await response.json();
        const exists = Object.keys(data.query.pages)[0] !== "-1";
        if (exists) WORD_CACHE.add(cleanWord);
        return exists;
    } catch (error) { return false; } 
}

export default function WordMasterGame() {
    const containerRef = useRef<HTMLDivElement>(null);
    const gameRef = useRef<any>(null);
    const roomIdRef = useRef<string>('');

    // --- ÁLLAPOTOK ---
    const [gameState, setGameState] = useState('menu');
    const [scores, setScores] = useState<number[]>([]);
    const [currentPlayer, setCurrentPlayer] = useState(0);
    const [toastMsg, setToastMsg] = useState({ text: '', type: '' });
    const [validating, setValidating] = useState(false);
    
    const [roomId, setRoomId] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [isHost, setIsHost] = useState(false);
    const [roomCodeInput, setRoomCodeInput] = useState('');

    const [config, setConfig] = useState({ theme: 'luxus', boardType: 'normal', playerNames: [] as string[] });

    // Globális adatszinkron
    const [globalBoardData, setGlobalBoardData] = useState<any[]>([]);
    const [globalTempData, setGlobalTempData] = useState<any[]>([]);
    const [globalLetterBag, setGlobalLetterBag] = useState<string[]>([]); // VÉGES ZSÁK

    useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

    const showToast = (msg: string, isError: boolean) => {
        setToastMsg({ text: msg, type: isError ? 'error' : 'success' });
        setTimeout(() => setToastMsg({ text: '', type: '' }), 3000);
    };

    // --- MULTIPLAYER LOGIKA ---
    const createRoom = async () => {
        if (!playerName.trim()) return showToast('Kérlek add meg a neved!', true);
        const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const initialBag = generateInitialBag(); // Legeneráljuk a teljes készletet
        
        await set(ref(db, `rooms/${newRoomId}`), {
            host: playerName,
            status: 'waiting',
            config: config,
            currentTurn: 0,
            letterBag: initialBag, 
            players: [{ name: playerName, score: 0 }]
        });
        
        setRoomId(newRoomId); setIsHost(true); setGameState('lobby');
    };

    const joinRoom = async () => {
        if (!playerName.trim() || !roomCodeInput.trim()) return showToast('Név és szobakód kötelező!', true);
        const code = roomCodeInput.trim().toUpperCase();
        const roomRef = ref(db, `rooms/${code}`);
        const snapshot = await get(roomRef);
        
        if (snapshot.exists()) {
            const data = snapshot.val();
            if (data.status !== 'waiting') return showToast('A játék már elkezdődött!', true);
            const players = data.players || [];
            if (players.length >= 4) return showToast('A szoba megtelt!', true);
            
            players.push({ name: playerName, score: 0 });
            await update(roomRef, { players });
            setRoomId(code); setIsHost(false); setGameState('lobby');
        } else {
            showToast('Nem létező szoba!', true);
        }
    };

    const startGame = async () => {
        if (!isHost) return;
        await update(ref(db, `rooms/${roomId}`), { status: 'playing' });
    };

    // Firebase Listener
    useEffect(() => {
        if (!roomId) return;
        const roomRef = ref(db, `rooms/${roomId}`);
        const unsub = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const playersData = data.players || [];
                const names = playersData.map((p: any) => p.name);
                const syncedScores = playersData.map((p: any) => p.score || 0);

                setConfig(prev => ({ ...prev, ...data.config, playerNames: names }));
                setScores(syncedScores);
                setCurrentPlayer(data.currentTurn || 0);
                
                if (data.letterBag) setGlobalLetterBag(data.letterBag);

                // Tábla frissítése
                if (data.boardData && gameRef.current) {
                    const parsedBoard = typeof data.boardData === 'string' ? JSON.parse(data.boardData) : data.boardData;
                    gameRef.current.syncBoardFromFirebase(parsedBoard);
                    setGlobalBoardData(parsedBoard);
                }

                // Szellem betűk
                if (data.tempPlacements && gameRef.current) {
                    const parsedTemp = typeof data.tempPlacements === 'string' ? JSON.parse(data.tempPlacements) : data.tempPlacements;
                    gameRef.current.syncOpponentPlacements(parsedTemp);
                    setGlobalTempData(parsedTemp);
                }
                
                if (data.status === 'playing' && gameState !== 'playing') {
                    setGameState('playing');
                    setTimeout(() => {
                        if(gameRef.current) {
                            gameRef.current.updateConfig({ ...data.config, playerNames: names });
                            gameRef.current.transitionToGameView();
                        }
                    }, 100);
                }
            }
        });
        return () => unsub();
    }, [roomId, gameState]);

    useEffect(() => {
        if (gameState === 'playing' && containerRef.current && !gameRef.current) {
            gameRef.current = new GameEngine(containerRef.current, config);
            
            // Ha a mi körünk van a kezdetekkor, és üres a rack, húzzunk betűt a zsákból
            gameRef.current.onNeedsLetters = (count: number) => {
                let currentBag = [...globalLetterBag];
                const drawn = currentBag.splice(0, count);
                update(ref(db, `rooms/${roomIdRef.current}`), { letterBag: currentBag });
                return drawn;
            };

            gameRef.current.onTempPlaceCallback = (placements: any[]) => {
                if(roomIdRef.current) {
                    update(ref(db, `rooms/${roomIdRef.current}`), { tempPlacements: JSON.stringify(placements) });
                }
            };
        }
    }, [gameState]);

    // Turn Update
    useEffect(() => {
        if (gameRef.current && gameState === 'playing') {
            const isMyTurnNow = config.playerNames[currentPlayer] === playerName;
            gameRef.current.state.isMyTurn = isMyTurnNow;
            
            // Ha ránk kerül a sor és kevesebb mint 7 betűnk van, feltöltjük
            if (isMyTurnNow && gameRef.current.state.rack.length < 7) {
                 const needed = 7 - gameRef.current.state.rack.length;
                 const newLetters = gameRef.current.onNeedsLetters(needed);
                 newLetters.forEach((char: string) => {
                     const tile = gameRef.current.createTileMesh(char);
                     gameRef.current.scene.add(tile);
                     gameRef.current.state.rack.push(tile);
                 });
                 gameRef.current.arrangeRack();
            }
        }
    }, [currentPlayer, playerName, config.playerNames]);

    const handleTurnAction = async (action: 'submit' | 'pass') => {
        if (!gameRef.current) return;
        
        if (action === 'submit') {
            setValidating(true);
            const { valid, points, error } = await gameRef.current.validateTurn();
            setValidating(false);

            if (!valid) {
                gameRef.current.recallTiles();
                return showToast(error || 'Érvénytelen lépés!', true);
            }
            
            // Sikeres lerakás véglegesítése
            gameRef.current.finalizeTurn();
            
            const boardSnapshot = gameRef.current.getBoardSnapshot();
            const myIndex = config.playerNames.indexOf(playerName);
            const newPlayers = [...scores].map((s, i) => ({
                name: config.playerNames[i],
                score: i === myIndex ? s + points : s
            }));
            
            const nextTurn = (currentPlayer + 1) % config.playerNames.length;

            await update(ref(db, `rooms/${roomId}`), { 
                currentTurn: nextTurn, 
                players: newPlayers,
                boardData: JSON.stringify(boardSnapshot),
                tempPlacements: []
            });

            showToast(`Szép lépés! +${points} pont`, false);

        } else if (action === 'pass') {
            gameRef.current.recallTiles();
            const nextTurn = (currentPlayer + 1) % config.playerNames.length;
            await update(ref(db, `rooms/${roomId}`), { currentTurn: nextTurn, tempPlacements: [] });
            showToast('Passzoltál.', false);
        }
    };


    return (
        <div className="app-container">
            <style>{`
                :root { --glass-bg: rgba(255, 255, 255, 0.1); --glass-border: rgba(255, 255, 255, 0.2); }
                body { margin: 0; overflow: hidden; font-family: 'Inter', sans-serif; background: #000; touch-action: none; overscroll-behavior: none; user-select: none; -webkit-user-select: none; }
                .app-container { position: fixed; inset: 0; pointer-events: none; z-index: 10; display: flex; flex-direction: column; }
                
                /* MOBILRA OPTIMALIZÁLT MENÜ */
                .menu-view { 
                    position: absolute; inset: 0; z-index: 50; display: flex; flex-direction: column; 
                    justify-content: flex-start; /* Fentebb kezdődik a tartalom */
                    align-items: center; 
                    padding-top: 15dvh; /* dvh a mobil billentyűzet miatt */
                    height: 100dvh; overflow-y: auto; 
                    background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); pointer-events: auto;
                }
                
                .glass-panel { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 24px; padding: 40px; text-align: center; color: white; width: 90%; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); }
                .menu-title { font-size: 32px; font-weight: 900; margin-bottom: 30px; letter-spacing: 2px; text-transform: uppercase; }
                .input-field { width: 100%; padding: 14px; border-radius: 12px; border: 1px solid var(--glass-border); background: rgba(0,0,0,0.3); color: white; margin-bottom: 15px; font-size: 16px; outline: none; box-sizing: border-box; text-align: center;}
                .input-field:focus { border-color: #10b981; }
                
                .play-btn { width: 100%; padding: 16px; border-radius: 12px; border: none; font-weight: 800; font-size: 16px; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 15px; transition: transform 0.2s; }
                .play-btn:active { transform: scale(0.96); }
                .btn-green { background: #10b981; color: white; }
                .btn-blue { background: #3b82f6; color: white; }
                
                /* HUD ÉS GOMBOK */
                .top-hud { position: absolute; top: 20px; left: 0; right: 0; display: flex; justify-content: center; gap: 15px; z-index: 20; }
                .player-pill { background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); padding: 8px 16px; border-radius: 20px; color: white; text-align: center; min-width: 80px; transition: all 0.3s; }
                .player-pill.active { background: rgba(234, 179, 8, 0.8); border-color: #fde047; transform: scale(1.05); }
                
                .bottom-bar { position: absolute; bottom: 25px; width: 100%; display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; pointer-events: none; padding: 0 10px; box-sizing: border-box; z-index: 20; }
                .action-btn { pointer-events: auto; padding: 12px 18px; border-radius: 14px; border: none; font-weight: 700; cursor: pointer; font-size: 14px; backdrop-filter: blur(10px); }
                .btn-glass { background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); }
                .btn-primary { background: #10b981; color: white; }
                
                .toast { position: fixed; top: 80px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 50px; font-weight: bold; color: white; z-index: 100; animation: fadeIn 0.3s ease; }
                .toast.error { background: #ef4444; } .toast.success { background: #10b981; }
                
                @keyframes fadeIn { from { opacity: 0; transform: translate(-50%, -20px); } to { opacity: 1; transform: translate(-50%, 0); } }
            `}</style>

            <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: gameState === 'playing' ? 'auto' : 'none' }} />

            {gameState === 'menu' && (
                <div className="menu-view">
                    <div className="glass-panel">
                        <div className="menu-title">Word Master</div>
                        <input className="input-field" placeholder="Beceneved" value={playerName} onChange={e=>setPlayerName(e.target.value)} maxLength={12}/>
                        <button className="play-btn btn-green" onClick={createRoom}>Új Szoba Létrehozása</button>
                        <div style={{margin: '20px 0', opacity: 0.5, fontSize: '14px'}}>VAGY</div>
                        <input className="input-field" placeholder="Szobakód" value={roomCodeInput} onChange={e=>setRoomCodeInput(e.target.value)} maxLength={6}/>
                        <button className="play-btn btn-blue" onClick={joinRoom}>Csatlakozás</button>
                    </div>
                </div>
            )}

            {gameState === 'lobby' && (
                <div className="menu-view">
                    <div className="glass-panel">
                        <h2>Szobakód: <span style={{color:'#fde047'}}>{roomId}</span></h2>
                        <div style={{margin: '20px 0', textAlign:'left'}}>
                            <h3 style={{fontSize:'14px', opacity:0.7, textTransform:'uppercase'}}>Játékosok ({config.playerNames.length}/4):</h3>
                            {config.playerNames.map((n, i) => (
                                <div key={i} style={{padding:'10px', background:'rgba(255,255,255,0.1)', borderRadius:'8px', marginBottom:'5px', fontWeight:'bold'}}>{n}</div>
                            ))}
                        </div>
                        {isHost ? (
                            <button className="play-btn btn-green" onClick={startGame}>Játék Indítása</button>
                        ) : (
                            <div style={{opacity:0.7}}>Várakozás a házigazdára...</div>
                        )}
                    </div>
                </div>
            )}

            {gameState === 'playing' && (
                <>
                    <div className="top-hud">
                        {config.playerNames.map((name, i) => (
                            <div key={i} className={`player-pill ${currentPlayer===i?'active':''}`}>
                                <div style={{fontSize:'10px', opacity:0.7, textTransform:'uppercase'}}>{name}</div>
                                <div style={{fontSize:'18px', fontWeight:'800'}}>{scores[i] || 0}</div>
                            </div>
                        ))}
                    </div>

                    <div className="bottom-bar">
                        {config.playerNames[currentPlayer] !== playerName ? (
                             <div style={{ padding: '12px 20px', background: 'rgba(239, 68, 68, 0.9)', backdropFilter: 'blur(10px)', color: 'white', borderRadius: '50px', fontWeight: '800', border: '2px solid rgba(255,255,255,0.2)', pointerEvents:'auto', fontSize:'14px' }}>
                                 ⏳ Várakozás {config.playerNames[currentPlayer]} lépésére...
                             </div>
                        ) : (
                            <>
                                <button className="action-btn btn-glass" onClick={() => handleTurnAction('pass')} disabled={validating}>🔄 Passzolás</button>
                                <button className="action-btn btn-glass" onClick={() => gameRef.current?.recallTiles()} disabled={validating}>🔙 Visszahív</button>
                                <button className="action-btn btn-primary" onClick={() => handleTurnAction('submit')} disabled={validating}>
                                    {validating ? 'Ellenőrzés...' : 'LÉPÉS KÉSZ'}
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}

            {toastMsg.text && <div className={`toast ${toastMsg.type}`}>{toastMsg.text}</div>}
        </div>
    );
}

// ==========================================
// 3D JÁTÉKMOTOR (GameEngine)
// ==========================================
class GameEngine {
    container: HTMLElement;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    intersectPoint = new THREE.Vector3();
    
    activeTheme: any;
    currentBoardType: string;
    
    dragging: any = null;
    selectedTile: any = null;
    specialMap = new Map();
    opponentTempTiles: any[] = [];
    latestBoardData: any[] = [];
    
    onTempPlaceCallback: (placements: any[]) => void;
    onNeedsLetters: (count: number) => string[];

    state = {
        rack: [] as any[],
        boardGrid: Array(15).fill(null).map(() => Array(15).fill(null)),
        placedThisTurn: [] as any[],
        isMyTurn: false
    };

    constructor(container: HTMLElement, config: any) {
        this.container = container;
        this.activeTheme = (THEMES as any)[config.theme] || THEMES['luxus'];
        this.currentBoardType = config.boardType;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.activeTheme.bgBase);
        this.scene.fog = new THREE.FogExp2(this.activeTheme.fogColor, 0.015);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 40, 30);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enablePan = false; 
        this.controls.maxPolarAngle = Math.PI / 2.2;
        this.controls.autoRotate = true; 
        this.controls.autoRotateSpeed = 1.5;

        this.initLighting();
        this.createTable(); 
        this.generateBoardLayout(this.currentBoardType);
        this.initBoard();
        this.addEvents();

        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
        
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.arrangeRack();
        });
    }

    updateConfig(newConfig: any) {
        const newTheme = (THEMES as any)[newConfig.theme] || THEMES['luxus'];
        if (this.activeTheme.name !== newTheme.name || this.currentBoardType !== newConfig.boardType) {
            this.activeTheme = newTheme;
            this.currentBoardType = newConfig.boardType;
            this.scene.background = new THREE.Color(this.activeTheme.bgBase);
            this.scene.fog = new THREE.FogExp2(this.activeTheme.fogColor, 0.015);
            // Ha újraépül a tábla, utána szinkronizáljuk a betűket
            this.createTable(); 
            this.generateBoardLayout(this.currentBoardType);
            this.initBoard(); 
            this.syncBoardFromFirebase(this.latestBoardData);
        }
    }

    transitionToGameView() {
        this.controls.autoRotate = false;
        this.controls.enabled = false;
        
        const aspect = window.innerWidth / window.innerHeight;
        const targetY = aspect < 1 ? 34 : 24; 
        const targetZ = aspect < 1 ? 22 : 16; 

        gsap.to(this.camera.position, {
            x: 0, y: targetY, z: targetZ, duration: 2, ease: "power3.inOut",
            onUpdate: () => this.controls.update(),
            onComplete: () => {
                this.controls.enabled = true; 
                this.controls.minDistance = 10; 
                this.controls.maxDistance = 50;
            }
        });
    }

    /* =========================================================
       IDE JÖNNEK A KORÁBBI TÁBLA- ÉS 3D MODELL GENERÁLÓ FÜGGVÉNYEID:
       - initLighting()
       - createTable()
       - generateBoardLayout(type)
       - initBoard()
       - createTileMesh(char)
       Ezeket kérlek másold át a korábbi kódodból, 
       hogy a kinézet (szöveg rajzolás stb.) teljesen megegyezzen!
       ========================================================= */
       
    initLighting() { /* Korábbi kódod */ }
    createTable() { /* Korábbi kódod */ }
    generateBoardLayout(type: string) { /* Korábbi kódod */ }
    initBoard() { /* Korábbi kódod */ }
    
    // A BETŰ LÉTREHOZÁSÁHOZ EGY EGYSZERŰSÍTETT PÉLDA (cseréld a tiédre!):
    createTileMesh(char: string) {
        const geo = new RoundedBoxGeometry(0.9, 0.2, 0.9, 4, 0.1);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffddaa });
        const mesh = new THREE.Mesh(geo, mat) as any;
        mesh.userData = { isTile: true, char: char, isPlaced: false };
        mesh.castShadow = true;
        
        // Itt jönne a CanvasText logika, ami rárajzolja a betűt és a számot (LETTER_DEF[char].value)
        
        return mesh;
    }


    arrangeRack() {
        const spacing = window.innerWidth < 600 ? 0.95 : 1.1; 
        this.state.rack.forEach((tile, i) => {
            if(tile.userData.isPlaced) return;
            const x = (i - (this.state.rack.length-1)/2) * spacing;
            if(!this.dragging && tile !== this.selectedTile) {
                gsap.to(tile.position, { x: x, y: 1.2, z: 10.5, duration: 0.6 });
                gsap.to(tile.rotation, { x: Math.PI / 3, y: 0, z: 0, duration: 0.6 });
            }
        });
    }

    triggerTempSync() {
        if(this.onTempPlaceCallback) {
            const tempMap = this.state.placedThisTurn.map(p => ({ r: p.r, c: p.c, char: p.tile.userData.char }));
            this.onTempPlaceCallback(tempMap);
        }
    }

    // --- MOBIL & EGÉR TOUCH ESEMÉNYEK ---
    addEvents() {
        const el = this.renderer.domElement;

        const getPointer = (e: any) => {
            const isTouch = e.touches && e.touches.length > 0;
            const clientX = isTouch ? e.touches[0].clientX : e.clientX;
            let clientY = isTouch ? e.touches[0].clientY : e.clientY;

            // FAT-FINGER FIX: Mobilos húzásnál feljebb toljuk a kamerához képest a tárgyat
            if (isTouch && this.dragging && e.type === 'touchmove') {
                clientY += 60; 
            }

            const rect = el.getBoundingClientRect();
            return {
                x: ((clientX - rect.left) / rect.width) * 2 - 1,
                y: -((clientY - rect.top) / rect.height) * 2 + 1
            };
        };

        const onDown = (e: any) => {
            if(!this.state.isMyTurn) return;
            
            const pointer = getPointer(e);
            this.mouse.x = pointer.x;
            this.mouse.y = pointer.y;

            this.raycaster.setFromCamera(this.mouse, this.camera);
            const hits = this.raycaster.intersectObjects(this.scene.children, true);
            
            const hitTile = hits.find((i:any)=>i.object.userData.isTile);
            const hitSlot = hits.find((i:any)=>i.object.userData.isSlot);

            if (!hitTile && !hitSlot && this.selectedTile) {
                this.returnToRack(this.selectedTile);
                this.selectedTile = null;
                return;
            }

            // TAP-TO-PLACE: Ha kiválasztottunk egy betűt, és üres mezőre bökünk
            if(hitSlot && this.selectedTile && (!hitTile || hitTile.object === this.selectedTile)) {
                if (e.cancelable) e.preventDefault();
                const r = hitSlot.object.userData.r; 
                const c = hitSlot.object.userData.c;
                this.placeTileToGrid(this.selectedTile, r, c);
                this.selectedTile = null;
                this.dragging = null;
                return;
            }

            if(hitTile) {
                const t = hitTile.object;
                const fixed = this.state.boardGrid.some((r: any)=>r.includes(t)) && !this.state.placedThisTurn.some((p: any)=>p.tile===t);
                
                if(!fixed) {
                    if (e.cancelable) e.preventDefault(); 
                    if(this.selectedTile && this.selectedTile !== t && !this.selectedTile.userData.isPlaced) {
                        gsap.to(this.selectedTile.position, {y:1.2, duration:0.2}); 
                    }
                    this.dragging = t; 
                    this.selectedTile = t; 
                    this.controls.enabled = false;
                    gsap.to(t.position, {y:3, duration:0.2}); 
                    gsap.to(t.rotation, {x:0, z:0, duration:0.2});
                }
            }
        };

        const onMove = (e: any) => {
            if(!this.dragging || !this.state.isMyTurn) return;
            if (e.cancelable) e.preventDefault(); 

            const pointer = getPointer(e);
            this.mouse.x = pointer.x;
            this.mouse.y = pointer.y;

            this.raycaster.setFromCamera(this.mouse, this.camera);
            const hits = this.raycaster.intersectObjects(this.scene.children, true);
            const hitSlot = hits.find((i:any)=>i.object.userData.isSlot);

            if(hitSlot) {
                this.dragging.position.x = hitSlot.object.position.x;
                this.dragging.position.z = hitSlot.object.position.z;
                this.dragging.position.y = 1.5; 
            } else {
                this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0), -2), this.intersectPoint);
                this.dragging.position.copy(this.intersectPoint);
            }
        };

        const onUp = () => {
            if(this.dragging) {
                const hits = this.raycaster.intersectObjects(this.scene.children, true);
                const hitSlot = hits.find((i:any)=>i.object.userData.isSlot);
                
                if(hitSlot) {
                    const r = hitSlot.object.userData.r; 
                    const c = hitSlot.object.userData.c;
                    this.placeTileToGrid(this.dragging, r, c);
                    this.selectedTile = null;
                } 
                this.dragging = null; 
            }
            this.controls.enabled = true; 
        };

        el.addEventListener('mousedown', onDown); el.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        el.addEventListener('touchstart', onDown, { passive: false }); el.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onUp);
    }

    placeTileToGrid(tile: any, r: number, c: number) {
        if(!this.state.boardGrid[r][c] || this.state.placedThisTurn.some(p=>p.tile===this.state.boardGrid[r][c])) {
            const oldP = this.state.placedThisTurn.find(p=>p.tile===tile);
            if(oldP) this.state.boardGrid[oldP.r][oldP.c] = null;
            
            gsap.to(tile.position, { x: (c - 7) * 1.05, y: 0.18, z: (r - 7) * 1.05, duration: 0.2 });
            this.state.boardGrid[r][c] = tile;
            this.state.placedThisTurn = this.state.placedThisTurn.filter(p=>p.tile!==tile);
            this.state.placedThisTurn.push({tile, r, c});
            tile.userData.isPlaced = true;
            this.triggerTempSync(); 
        } else this.returnToRack(tile);
    }

    returnToRack(tile: any) {
        if(!this.state.rack.includes(tile)) this.state.rack.push(tile);
        this.state.placedThisTurn = this.state.placedThisTurn.filter(p=>p.tile!==tile);
        
        // Töröljük a tábláról, ha ott volt
        for(let r=0; r<15; r++){
            for(let c=0; c<15; c++){
                if(this.state.boardGrid[r][c] === tile) this.state.boardGrid[r][c] = null;
            }
        }
        
        tile.userData.isPlaced=false; 
        this.arrangeRack();
        this.triggerTempSync();
    }

    recallTiles() {
        [...this.state.placedThisTurn].forEach(p => this.returnToRack(p.tile));
    }

    // SZABÁLYOS SCRABBLE VALIDÁCIÓ (Mindig Balról-Jobbra és Fentről-Lefelé olvasva!)
    async validateTurn() {
        if (this.state.placedThisTurn.length === 0) return { valid: false, error: 'Nem raktál le betűt!' };

        // 1. Ellenőrizzük, hogy egyvonalban vannak-e
        const rows = this.state.placedThisTurn.map(p => p.r);
        const cols = this.state.placedThisTurn.map(p => p.c);
        const isHorizontal = rows.every(r => r === rows[0]);
        const isVertical = cols.every(c => c === cols[0]);

        if (!isHorizontal && !isVertical) return { valid: false, error: 'A betűket egy vonalba kell rakni!' };

        // 2. Kigyűjtjük az összes újonnan keletkezett szót.
        // A Scrabble szabály: a fő irányban alkotott szó, PLUSZ a merőlegesen érintkező szavak.
        let wordsToCheck: { word: string, points: number }[] = [];
        let totalScore = 0;

        // Segédfüggvény: megkeresi egy adott pontból kiindulva a teljes szót és kiszámolja a pontját
        const extractWord = (startR: number, startC: number, dr: number, dc: number) => {
            // Visszalépünk a szó legelejére
            let r = startR, c = startC;
            while (r - dr >= 0 && c - dc >= 0 && r - dr < 15 && c - dc < 15 && this.state.boardGrid[r - dr][c - dc]) {
                r -= dr; c -= dc;
            }
            
            // Innen olvassuk végig (Mindig balról jobbra / fentről lefelé!)
            let word = "";
            let wordMultiplier = 1;
            let wordScore = 0;
            let lettersCount = 0;

            while (r >= 0 && c >= 0 && r < 15 && c < 15 && this.state.boardGrid[r][c]) {
                const tile = this.state.boardGrid[r][c];
                const char = tile.userData.char;
                const letterValue = LETTER_DEF[char as keyof typeof LETTER_DEF]?.value || 1;
                
                let letterMultiplier = 1;
                
                // Ha ez a betű most lett lerakva, megnézzük a szorzómezőt
                const isNew = this.state.placedThisTurn.some(p => p.r === r && p.c === c);
                if (isNew) {
                    const special = this.specialMap.get(`${r}_${c}`);
                    if (special === 'dl') letterMultiplier = 2;
                    if (special === 'tl') letterMultiplier = 3;
                    if (special === 'dw' || special === 'start') wordMultiplier *= 2;
                    if (special === 'tw') wordMultiplier *= 3;
                }

                word += char;
                wordScore += (letterValue * letterMultiplier);
                lettersCount++;
                
                r += dr; c += dc;
            }

            return { word, points: wordScore * wordMultiplier, length: lettersCount };
        };

        // FŐ SZÓ kinyerése (Abban az irányban, amerre a betűk többsége áll, vagy ha csak 1 betű, mindkét irányt megnézzük)
        const firstP = this.state.placedThisTurn[0];
        
        if (isHorizontal || this.state.placedThisTurn.length === 1) {
            const hWord = extractWord(firstP.r, firstP.c, 0, 1); // 0, 1: Balról Jobbra
            if (hWord.length > 1) { wordsToCheck.push(hWord); totalScore += hWord.points; }
        }
        
        if (isVertical || this.state.placedThisTurn.length === 1) {
            const vWord = extractWord(firstP.r, firstP.c, 1, 0); // 1, 0: Fentről Lefelé
            if (vWord.length > 1) { wordsToCheck.push(vWord); totalScore += vWord.points; }
        }

        // MERŐLEGES SZAVAK kinyerése
        this.state.placedThisTurn.forEach(p => {
            if (isHorizontal) {
                const v = extractWord(p.r, p.c, 1, 0);
                if (v.length > 1) { wordsToCheck.push(v); totalScore += v.points; }
            } else {
                const h = extractWord(p.r, p.c, 0, 1);
                if (h.length > 1) { wordsToCheck.push(h); totalScore += h.points; }
            }
        });

        // 3. API Validáció
        if (wordsToCheck.length === 0) return { valid: false, error: 'A szónak legalább 2 betűből kell állnia!' };

        for (const item of wordsToCheck) {
            const isValid = await checkHungarianWordAPI(item.word);
            if (!isValid) return { valid: false, error: `Nincs ilyen magyar szó: ${item.word}` };
        }

        // Bónusz 7 lerakott betűért (BINGO)
        if (this.state.placedThisTurn.length === 7) totalScore += 50;

        return { valid: true, points: totalScore };
    }

    finalizeTurn() {
        this.state.rack = this.state.rack.filter(t => !this.state.placedThisTurn.some(p => p.tile === t));
        this.state.placedThisTurn = [];
    }

    getBoardSnapshot() {
        const data: any[] = [];
        for(let r=0; r<15; r++) {
            for(let c=0; c<15; c++) {
                const tile = this.state.boardGrid[r][c];
                if(tile && tile.userData && tile.userData.char) {
                    data.push({ r, c, char: tile.userData.char });
                }
            }
        }
        return data;
    }

    syncBoardFromFirebase(boardData: any[]) {
        this.latestBoardData = boardData;
        const incomingMap = new Map();
        boardData.forEach(item => incomingMap.set(`${item.r}_${item.c}`, item.char));

        for(let r=0; r<15; r++) {
            for(let c=0; c<15; c++) {
                const existingTile = this.state.boardGrid[r][c];
                const incomingChar = incomingMap.get(`${r}_${c}`);

                if (incomingChar) {
                    if (!existingTile || existingTile.userData.char !== incomingChar) {
                        if (existingTile) this.scene.remove(existingTile);
                        const newTile = this.createTileMesh(incomingChar);
                        newTile.position.set((c - 7) * 1.05, 0.18, (r - 7) * 1.05);
                        this.scene.add(newTile);
                        this.state.boardGrid[r][c] = newTile;
                        newTile.userData.isPlaced = true;
                    }
                } else {
                    if (existingTile) {
                        this.scene.remove(existingTile);
                        this.state.boardGrid[r][c] = null;
                    }
                }
            }
        }
    }

    syncOpponentPlacements(placements: any[]) {
        this.opponentTempTiles.forEach((t: any) => this.scene.remove(t));
        this.opponentTempTiles = [];
        if (this.state.isMyTurn) return; 

        placements.forEach(p => {
            const mesh = this.createTileMesh(p.char);
            mesh.material.forEach((mat: any) => { 
                mat.transparent = true; 
                mat.opacity = 0.5; 
                if(mat.color) mat.color.setHex(0xaaaaaa); 
            });
            mesh.position.set((p.c - 7) * 1.05, 0.25, (p.r - 7) * 1.05);
            this.scene.add(mesh);
            this.opponentTempTiles.push(mesh);
        });
    }

    animate() {
        requestAnimationFrame(this.animate);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}