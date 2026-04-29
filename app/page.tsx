'use client';
import './globals.css';
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

function generateInitialBag() {
    let bag: string[] = [];
    Object.entries(LETTER_DEF).forEach(([letter, data]) => {
        for (let i = 0; i < data.count; i++) bag.push(letter);
    });
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

    const [globalBoardData, setGlobalBoardData] = useState<any[]>([]);
    const [globalTempData, setGlobalTempData] = useState<any[]>([]);
    const [globalLetterBag, setGlobalLetterBag] = useState<string[]>([]);

    useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

    const showToast = (msg: string, isError: boolean) => {
        setToastMsg({ text: msg, type: isError ? 'error' : 'success' });
        setTimeout(() => setToastMsg({ text: '', type: '' }), 3000);
    };

    const createRoom = async () => {
        if (!playerName.trim()) return showToast('Kérlek add meg a neved!', true);
        const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const initialBag = generateInitialBag(); 
        
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

                if (data.boardData && gameRef.current) {
                    const parsedBoard = typeof data.boardData === 'string' ? JSON.parse(data.boardData) : data.boardData;
                    gameRef.current.syncBoardFromFirebase(parsedBoard);
                    setGlobalBoardData(parsedBoard);
                }

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

    // --- AZONNALI 3D MOTOR INDÍTÁS A HÁTTÉRBEN (MENÜHÖZ) ---
    useEffect(() => {
        if (containerRef.current && !gameRef.current) {
            gameRef.current = new GameEngine(containerRef.current, config);
            
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
    }, []); // Üres array: azonnal lefut, betölt a 3D asztal a menü mögé!

    // Turn Update
    useEffect(() => {
        if (gameRef.current && gameState === 'playing') {
            const isMyTurnNow = config.playerNames[currentPlayer] === playerName;
            gameRef.current.state.isMyTurn = isMyTurnNow;
            
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

    // --- SAJÁT 3D GENERÁLÓ FÜGGVÉNYEK HELYE ---
    // Ide nyugodtan beillesztheted a korábbi initLighting, createTable, stb. kódodat,
    // ha voltak benne egyedi anyagok/textúrák. Ha nem, ezek az alapok is tökéletesek!

    initLighting() { 
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        this.scene.add(dirLight);
    }
    
    createTable() { 
        const geo = new THREE.BoxGeometry(20, 1, 20);
        const mat = new THREE.MeshStandardMaterial({ color: this.activeTheme.woodColor });
        const table = new THREE.Mesh(geo, mat);
        table.position.y = -0.5;
        table.receiveShadow = true;
        this.scene.add(table);
    }
    
    generateBoardLayout(type: string) { 
        // Egyszerűsített szorzó kiosztás példa
        this.specialMap.set("7_7", "start");
        this.specialMap.set("0_0", "tw"); this.specialMap.set("0_14", "tw");
    }
    
    initBoard() { 
        for(let r=0; r<15; r++) {
            for(let c=0; c<15; c++) {
                const geo = new THREE.BoxGeometry(1, 0.1, 1);
                const mat = new THREE.MeshStandardMaterial({ color: this.activeTheme.boardField });
                const mesh = new THREE.Mesh(geo, mat) as any;
                mesh.position.set((c - 7) * 1.05, 0.05, (r - 7) * 1.05);
                mesh.userData = { isSlot: true, r, c };
                mesh.receiveShadow = true;
                this.scene.add(mesh);
            }
        }
    }
    
    createTileMesh(char: string) {
        const geo = new RoundedBoxGeometry(0.9, 0.2, 0.9, 4, 0.1);
        
        // Canvas textúra rajzolása a betűnek
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#f3e5ab'; ctx.fillRect(0, 0, 128, 128);
            ctx.fillStyle = '#000000'; 
            ctx.font = 'bold 70px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(char, 64, 64);
            
            // Pontérték a sarokba
            const val = LETTER_DEF[char as keyof typeof LETTER_DEF]?.value || 1;
            ctx.font = 'bold 24px Arial';
            ctx.fillText(val.toString(), 100, 100);
        }
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff });
        const mesh = new THREE.Mesh(geo, mat) as any;
        mesh.userData = { isTile: true, char: char, isPlaced: false };
        mesh.castShadow = true;
        
        return mesh;
    }
    // ------------------------------------------

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

            if (isTouch && this.dragging && e.type === 'touchmove') {
                clientY += 60; // FAT-FINGER FIX: feljebb tolja az ujj fölé
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

    async validateTurn() {
        if (this.state.placedThisTurn.length === 0) return { valid: false, error: 'Nem raktál le betűt!' };

        const rows = this.state.placedThisTurn.map(p => p.r);
        const cols = this.state.placedThisTurn.map(p => p.c);
        const isHorizontal = rows.every(r => r === rows[0]);
        const isVertical = cols.every(c => c === cols[0]);

        if (!isHorizontal && !isVertical) return { valid: false, error: 'A betűket egy vonalba kell rakni!' };

        let wordsToCheck: { word: string, points: number }[] = [];
        let totalScore = 0;

        const extractWord = (startR: number, startC: number, dr: number, dc: number) => {
            let r = startR, c = startC;
            while (r - dr >= 0 && c - dc >= 0 && r - dr < 15 && c - dc < 15 && this.state.boardGrid[r - dr][c - dc]) {
                r -= dr; c -= dc;
            }
            let word = "", wordMultiplier = 1, wordScore = 0, lettersCount = 0;

            while (r >= 0 && c >= 0 && r < 15 && c < 15 && this.state.boardGrid[r][c]) {
                const tile = this.state.boardGrid[r][c];
                const char = tile.userData.char;
                const letterValue = LETTER_DEF[char as keyof typeof LETTER_DEF]?.value || 1;
                let letterMultiplier = 1;
                
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

        const firstP = this.state.placedThisTurn[0];
        
        if (isHorizontal || this.state.placedThisTurn.length === 1) {
            const hWord = extractWord(firstP.r, firstP.c, 0, 1); 
            if (hWord.length > 1) { wordsToCheck.push(hWord); totalScore += hWord.points; }
        }
        
        if (isVertical || this.state.placedThisTurn.length === 1) {
            const vWord = extractWord(firstP.r, firstP.c, 1, 0); 
            if (vWord.length > 1) { wordsToCheck.push(vWord); totalScore += vWord.points; }
        }

        this.state.placedThisTurn.forEach(p => {
            if (isHorizontal) {
                const v = extractWord(p.r, p.c, 1, 0);
                if (v.length > 1) { wordsToCheck.push(v); totalScore += v.points; }
            } else {
                const h = extractWord(p.r, p.c, 0, 1);
                if (h.length > 1) { wordsToCheck.push(h); totalScore += h.points; }
            }
        });

        if (wordsToCheck.length === 0) return { valid: false, error: 'A szónak legalább 2 betűből kell állnia!' };

        for (const item of wordsToCheck) {
            const isValid = await checkHungarianWordAPI(item.word);
            if (!isValid) return { valid: false, error: `Nincs ilyen magyar szó: ${item.word}` };
        }

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