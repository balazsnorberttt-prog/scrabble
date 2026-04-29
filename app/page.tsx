'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { db } from '../firebase'; 
import { ref, set, onValue, get, update } from 'firebase/database';
import gsap from 'gsap';

// --- GLOBÁLIS DEBUG LOGGER MOBILRA ---
let globalLogs: string[] = [];
let updateLogs: any = null;
const dLog = (msg: string) => {
  const time = new Date().toLocaleTimeString().split(' ')[0];
  globalLogs = [`[${time}] ${msg}`, ...globalLogs].slice(0, 8);
  if(updateLogs) updateLogs([...globalLogs]);
  console.log(`[DEBUG] ${msg}`);
};

// --- TÉMÁK ---
const THEMES = {
  luxus: {
    name: "Royal Mahogany",
    isDark: true,
    bgBase: 0x1a1a1a,
    fogColor: 0x1a1a1a,
    tableParams: { color1: '#4a2c20', color2: '#1a120b' },
    woodColor: '#5d4037',
    frameColor: 0xffffff,
    boardField: 0x1e5128,
    special: { tw: 0xb91c1c, dw: 0xc084fc, tl: 0x1d4ed8, dl: 0x60a5fa, start: 0xb91c1c }
  }
};

const HUNGARIAN_LETTERS = "AÁBCDEÉFGHIÍJKLMNOÓÖŐPRSTUÚÜŰVZ";
const WORD_CACHE = new Set(["ALMA", "KÖRTE", "HÁZ", "LÓ", "KÉZ", "VÍZ", "TŰZ", "SZÓ", "JÁTÉK", "ASZTAL"]);

async function checkHungarianWordAPI(word: string) {
  const cleanWord = word.trim().toUpperCase();
  if (!cleanWord) return false;
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
  
  const [debugLogList, setDebugLogList] = useState<string[]>([]);
  const [gameState, setGameState] = useState('menu');
  const [scores, setScores] = useState<number[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [toastMsg, setToastMsg] = useState({ text: '', type: '' });
  const [validating, setValidating] = useState(false);
  const [popupData, setPopupData] = useState<any>(null); 
  
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  
  const [config, setConfig] = useState({
    theme: 'luxus',
    boardType: 'normal',
    playerNames: [] as string[]
  });

  const [globalBoardData, setGlobalBoardData] = useState<any[]>([]);
  const prevBoardRef = useRef<string>('');

  useEffect(() => {
    updateLogs = setDebugLogList;
    dLog("App elindult.");
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  const showToast = (msg: string, isError: boolean) => {
    setToastMsg({ text: msg, type: isError ? 'error' : 'success' });
    setTimeout(() => setToastMsg({ text: '', type: '' }), 3000);
  };

  useEffect(() => {
    if (gameRef.current && config.playerNames.length > 0) {
        gameRef.current.state.isMyTurn = (config.playerNames[currentPlayer] === playerName);
    }
  }, [currentPlayer, playerName, config.playerNames]);

  // --- KÖZPONTI SZINKRONIZÁLÓ ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    const serialized = JSON.stringify(globalBoardData);
    if (serialized === prevBoardRef.current) return; 
    
    dLog(`[FIREBASE] Új tábla adat érkezett! (${globalBoardData.length} betű)`);
    prevBoardRef.current = serialized;
    
    if (gameRef.current) {
        gameRef.current.syncBoardFromFirebase(globalBoardData);
    } else {
        dLog(`[HIBA] gameRef még nincs betöltve!`);
    }
  }, [globalBoardData, gameState]);

  // --- MULTIPLAYER LOGIKA ---
  const createRoom = async () => {
    if (!playerName.trim()) return showToast('Add meg a neved!', true);
    dLog("Szoba létrehozása...");
    const newRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    await set(ref(db, `rooms/${newRoomId}`), {
      status: 'lobby',
      config: { ...config, playerNames: [playerName] },
      players: [{ name: playerName, score: 0 }],
      currentTurn: 0,
      hostName: playerName,
      boardData: JSON.stringify([])
    });
    setRoomId(newRoomId); setIsHost(true); listenToRoom(newRoomId);
  };

  const joinRoom = async () => {
    if (!playerName.trim() || roomCodeInput.length !== 4) return showToast('Hibás adat!', true);
    dLog(`Csatlakozás: ${roomCodeInput}...`);
    const roomRef = ref(db, `rooms/${roomCodeInput}`);
    const snapshot = await get(roomRef);
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (data.status !== 'lobby') return showToast('Már megy!', true);
      const players = data.players || [];
      await update(roomRef, { players: [...players, { name: playerName, score: 0 }] });
      setRoomId(roomCodeInput); listenToRoom(roomCodeInput);
    } else showToast('Nincs szoba!', true);
  };

  const listenToRoom = (id: string) => {
    onValue(ref(db, `rooms/${id}`), (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const names = (data.players || []).map((p: any) => p.name);
      setConfig(prev => ({ ...prev, ...data.config, playerNames: names }));
      setScores((data.players || []).map((p: any) => p.score || 0));
      setCurrentPlayer(data.currentTurn || 0);

      if (data.boardData) {
          try {
              const parsed = typeof data.boardData === 'string' ? JSON.parse(data.boardData) : data.boardData;
              setGlobalBoardData(parsed);
          } catch (e) { dLog("[HIBA] JSON Parse fail!"); }
      }
      
      if (data.status === 'playing' && gameState !== 'playing') {
          dLog("Játék indítása...");
          setGameState('playing');
          setTimeout(() => {
              if(gameRef.current) {
                  gameRef.current.updateConfig({ ...data.config, playerNames: names });
                  gameRef.current.transitionToGameView();
              }
          }, 300);
      }
    });
  };

  const startMultiplayerGame = async () => {
    await update(ref(db, `rooms/${roomId}`), { status: 'playing' });
  };

  // --- 3D GAME ENGINE ---
  useEffect(() => {
    if (!containerRef.current) return;

    class Game {
      scene: any; camera: any; renderer: any; controls: any; raycaster: any; mouse: any; dragPlane: any;
      dragging: any = null; selectedTile: any = null; textureCache: any = {};
      woodTexture: any = null; tableTexture: any = null; activeTheme: any = THEMES['luxus'];
      specialMap = new Map();
      
      state = {
        rack: [] as any[], boardGrid: Array(15).fill(null).map(() => Array(15).fill(null)),
        logicalBoard: [] as {r: number, c: number, char: string}[],
        placedThisTurn: [] as any[], isMyTurn: false
      };

      constructor(container: HTMLElement) {
        dLog("3D Engine Init...");
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 1, 100);
        this.camera.position.set(25, 15, 25); 

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        container.appendChild(this.renderer.domElement);

        this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4);
        this.raycaster = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true; this.controls.autoRotate = true;

        this.updateThemeColors(); this.loadTextures(); this.initLights();
        this.createTable(); this.generateBoardLayout('normal'); this.initBoard();
        this.fillRack(); this.addEvents(); this.animate();
        dLog("3D Engine Ready.");
      }

      updateConfig(c: any) { this.initBoard(); }
      updateThemeColors() { this.scene.background = new THREE.Color(this.activeTheme.bgBase); }
      
      transitionToGameView() {
        this.controls.autoRotate = false;
        const aspect = window.innerWidth / window.innerHeight;
        gsap.to(this.camera.position, { x: 0, y: aspect < 1 ? 34 : 24, z: aspect < 1 ? 22 : 16, duration: 2 });
      }

      initLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(15, 30, 10);
        this.scene.add(dl);
      }

      loadTextures() {
        const cvs = document.createElement('canvas'); cvs.width=512; cvs.height=512; const ctx = cvs.getContext('2d')!;
        ctx.fillStyle='#5d4037'; ctx.fillRect(0,0,512,512); this.woodTexture = new THREE.CanvasTexture(cvs);
      }

      createTable() {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ color: '#2a1a10' }));
        mesh.rotation.x = -Math.PI/2; mesh.position.y = -2; this.scene.add(mesh);
      }

      generateBoardLayout(type: string) { this.specialMap.set('7_7', { color: 0xb91c1c }); }

      getCellInfo(r: number, c: number) { return this.specialMap.get(`${r}_${c}`) || { color: 0x1e5128 }; }

      getTexture(char: string) {
        if (this.textureCache[char]) return this.textureCache[char];
        const size = 256; const cvs = document.createElement('canvas'); cvs.width = size; cvs.height = size;
        const ctx = cvs.getContext('2d')!;
        ctx.fillStyle = '#fceabb'; ctx.fillRect(0,0,size,size);
        ctx.fillStyle = '#111'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.font = 'bold 140px Arial'; ctx.fillText(char, size/2, size/2);
        
        const tex = new THREE.CanvasTexture(cvs);
        tex.needsUpdate = true;
        this.textureCache[char] = tex;
        cvs.width = 0; cvs.height = 0; // GPU-ra küldés után tisztítás
        return tex;
      }

      initBoard() {
        const group = new THREE.Group(); group.name = "boardGroup";
        const frame = new THREE.Mesh(new RoundedBoxGeometry(17.2, 1.0, 17.2, 4, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        frame.position.y = -0.55; group.add(frame);

        const cellGeo = new RoundedBoxGeometry(0.96, 0.1, 0.96, 2, 0.05);
        for(let r=0; r<15; r++) {
            for(let c=0; c<15; c++) {
                const mat = new THREE.MeshStandardMaterial({ color: this.getCellInfo(r,c).color });
                const cell = new THREE.Mesh(cellGeo, mat);
                cell.position.set((c-7)*1.05, 0.05, (r-7)*1.05); cell.userData = { isSlot: true, r, c }; group.add(cell);
            }
        }
        this.scene.add(group);
      }

      createTileMesh(char: string) {
        const mat = new THREE.MeshStandardMaterial({ map: this.getTexture(char), color: 0xffffff, roughness: 0.4 });
        const mesh = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.25, 0.95, 4, 0.08), mat);
        mesh.userData = { isTile: true, char }; return mesh;
      }
      
      fillRack() {
        while(this.state.rack.length < 7) {
            const tile = this.createTileMesh(HUNGARIAN_LETTERS[Math.floor(Math.random() * HUNGARIAN_LETTERS.length)]);
            tile.position.set(0, 8, 15); this.scene.add(tile); this.state.rack.push(tile);
            tile.userData.isPlaced = false;
        }
        this.arrangeRack();
      }

      arrangeRack() {
        const spacing = window.innerWidth < 600 ? 0.95 : 1.1; 
        this.state.rack.forEach((t, i) => {
            if(!t.userData.isPlaced && t !== this.selectedTile) {
                gsap.to(t.position, { x: (i - 3) * spacing, y: 1.2, z: 10.5, duration: 0.6 });
            }
        });
      }

      addEvents() {
        const el = this.renderer.domElement; el.style.touchAction = 'none';
        const onDown = (e: any) => {
            if (!this.state.isMyTurn) return; 
            const p = e.touches ? e.touches[0] : e;
            const r = el.getBoundingClientRect();
            this.mouse.set(((p.clientX - r.left)/r.width)*2-1, -((p.clientY - r.top)/r.height)*2+1);
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const hits = this.raycaster.intersectObjects(this.scene.children, true);
            const hitTile = hits.find((i:any)=>i.object.userData.isTile);
            if(hitTile) {
                const t = hitTile.object;
                if(!this.state.logicalBoard.some(lb => lb.r === t.userData.boardR && lb.c === t.userData.boardC) && !this.state.placedThisTurn.some(p=>p.tile===t)) {
                    if (e.cancelable) e.preventDefault(); 
                    this.dragging = t; this.selectedTile = t; this.controls.enabled = false; 
                    gsap.to(t.position, {y:3, duration:0.2});
                }
                return;
            }
            const hitSlot = hits.find((i:any)=>i.object.userData.isSlot);
            if(hitSlot && this.selectedTile) {
                if (e.cancelable) e.preventDefault();
                this.placeTileToGrid(this.selectedTile, hitSlot.object.userData.r, hitSlot.object.userData.c);
                this.selectedTile = null;
            }
        };

        const onMove = (e: any) => {
            if(!this.dragging || !this.state.isMyTurn) return;
            if (e.cancelable) e.preventDefault(); 
            const p = e.touches ? e.touches[0] : e;
            const r = el.getBoundingClientRect();
            this.mouse.set(((p.clientX - r.left)/r.width)*2-1, -((p.clientY - r.top)/r.height)*2+1);
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const target = new THREE.Vector3(); this.raycaster.ray.intersectPlane(this.dragPlane, target);
            if(target) { this.dragging.position.x = target.x; this.dragging.position.z = target.z; }
        };

        const onUp = () => {
            if(!this.dragging || !this.state.isMyTurn) return;
            const gx = Math.round(this.dragging.position.x/1.05); const gz = Math.round(this.dragging.position.z/1.05);
            if(Math.abs(gx)<=7 && Math.abs(gz)<=7) this.placeTileToGrid(this.dragging, gz+7, gx+7);
            else { this.state.rack.push(this.dragging); this.state.placedThisTurn = this.state.placedThisTurn.filter(p=>p.tile!==this.dragging); this.arrangeRack(); }
            this.dragging = null; this.selectedTile = null; this.controls.enabled = true; 
        };

        el.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
        el.addEventListener('touchstart', onDown, { passive: false }); el.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onUp);
    }

      placeTileToGrid(tile: any, r: number, c: number) {
        gsap.to(tile.position, {x:(c-7)*1.05, y:0.18, z:(r-7)*1.05, duration:0.4});
        const idx = this.state.rack.indexOf(tile); if(idx>-1) this.state.rack.splice(idx,1);
        this.state.placedThisTurn = this.state.placedThisTurn.filter(p=>p.tile!==tile);
        this.state.placedThisTurn.push({tile, r, c}); tile.userData.isPlaced = true;
      }

      async validateTurn() {
        if (this.state.placedThisTurn.length === 0) return { success: false, msg: "Nincs betű!" };
        return { success: true, mainWord: this.state.placedThisTurn.map(p=>p.tile.userData.char).join(''), placed: this.state.placedThisTurn };
      }

      finalizeTurn() {
        this.state.placedThisTurn.forEach(p => {
            this.state.boardGrid[p.r][p.c] = p.tile;
            p.tile.userData.boardR = p.r; p.tile.userData.boardC = p.c;
            this.state.logicalBoard.push({ r: p.r, c: p.c, char: p.tile.userData.char });
        });
        this.state.placedThisTurn = [];
      }

      // --- PANIK ÚJRAÉPÍTŐ FÜGGVÉNY ---
      forceRebuildBoard(boardData: any[]) {
          dLog(`[PANIK] Tábla erőszakos újraépítése (${boardData.length} betű)`);
          this.state.logicalBoard = boardData;
          
          // Letörlünk minden eddigi betűt a tábláról
          for(let r=0; r<15; r++) {
              for(let c=0; c<15; c++) {
                  if (this.state.boardGrid[r][c]) {
                      this.scene.remove(this.state.boardGrid[r][c]);
                      this.state.boardGrid[r][c] = null;
                  }
              }
          }

          // Újraépítjük a Firebase adatok alapján
          let buildCount = 0;
          boardData.forEach(item => {
              const newTile = this.createTileMesh(item.char);
              newTile.position.set((item.c - 7) * 1.05, 0.18, (item.r - 7) * 1.05);
              newTile.rotation.set(0,0,0);
              newTile.userData.boardR = item.r; newTile.userData.boardC = item.c;
              this.scene.add(newTile);
              this.state.boardGrid[item.r][item.c] = newTile;
              newTile.userData.isPlaced = true;
              buildCount++;
          });
          dLog(`[PANIK] Sikeresen lerenderelve: ${buildCount} betű.`);
          this.renderer.render(this.scene, this.camera); // Erőszakos render a mobilnak
      }

      // Hagyományos szinkron
      syncBoardFromFirebase(boardData: any[]) {
        dLog(`[SYNC] ${boardData.length} betű érkezett. Indul a render...`);
        let added = 0;
        this.state.logicalBoard = boardData;
        const incomingMap = new Map();
        boardData.forEach(item => incomingMap.set(`${item.r}_${item.c}`, item.char));

        for(let r=0; r<15; r++) {
            for(let c=0; c<15; c++) {
                const existing = this.state.boardGrid[r][c];
                const incChar = incomingMap.get(`${r}_${c}`);
                if (incChar) {
                    if (!existing || existing.userData.char !== incChar) {
                        if (existing) this.scene.remove(existing);
                        const newT = this.createTileMesh(incChar);
                        newT.position.set((c-7)*1.05, 0.18, (r-7)*1.05);
                        newT.userData.boardR = r; newT.userData.boardC = c;
                        this.scene.add(newT);
                        this.state.boardGrid[r][c] = newT; newT.userData.isPlaced = true;
                        added++;
                    }
                }
            }
        }
        if (added > 0) dLog(`[SYNC] KÉSZ! ${added} új mesh hozzáadva.`);
      }

      recall() { [...this.state.placedThisTurn].forEach(p => { p.tile.userData.isPlaced=false; this.state.rack.push(p.tile); }); this.state.placedThisTurn=[]; this.arrangeRack(); }
      shuffle() { this.state.rack.sort(() => Math.random() - 0.5); this.arrangeRack(); }
      animate = () => { requestAnimationFrame(this.animate); this.controls.update(); this.renderer.render(this.scene, this.camera); }
    }

    gameRef.current = new Game(containerRef.current);
  }, []);

  // --- KÉZIFOGÁSOS (HANDSHAKE) LERAKÁS ---
  const handleValidate = async () => {
    if(!gameRef.current || validating) return;
    setValidating(true);
    const check = await gameRef.current.validateTurn();
    if(!check.success) { showToast(check.msg, true); setValidating(false); return; }

    const exists = await checkHungarianWordAPI(check.mainWord);
    if (exists) { completeTurn(check.placed); } 
    else {
        setPopupData({
            word: check.mainWord,
            onAccept: () => { completeTurn(check.placed); setPopupData(null); },
            onReject: () => { setValidating(false); setPopupData(null); }
        });
    }
  };

  const completeTurn = async (placed: any[]) => {
    dLog("Lerakás indítva...");
    const pts = placed.length * 10;
    gameRef.current.finalizeTurn(placed, pts);
    const boardSnapshot = JSON.parse(JSON.stringify(gameRef.current.state.logicalBoard));
    
    const nextTurn = (currentPlayer + 1) % config.playerNames.length;
    const newPlayers = config.playerNames.map((n, i) => ({ name: n, score: i === currentPlayer ? (scores[i] || 0) + pts : (scores[i] || 0) }));

    try {
        dLog(`Küldés a Firebase-be (${boardSnapshot.length} betű)...`);
        await update(ref(db, `rooms/${roomId}`), { 
            boardData: JSON.stringify(boardSnapshot), // ELŐSZÖR AZ ADATOT KÜLDJÜK!
        });
        
        // HANDSHAKE: VÁRUNK 1 MÁSODPERCET, HOGY A MOBIL BIZTOSAN MEGEméssze
        setTimeout(async () => {
            dLog("Kör átadása a következő játékosnak.");
            await update(ref(db, `rooms/${roomId}`), { currentTurn: nextTurn, players: newPlayers });
            showToast(`Kész! +${pts}`, false);
            gameRef.current.fillRack(); 
            setValidating(false); 
        }, 1000);

    } catch(err) { showToast('Hiba!', true); setValidating(false); }
  };

  return (
    <>
      <style jsx global>{`
        body { margin: 0; overflow: hidden; font-family: 'Inter', sans-serif; background: #000; touch-action: none; user-select: none; }
        .app-container { position: fixed; inset: 0; pointer-events: none; z-index: 10; display: flex; flex-direction: column; }
        .glass-panel { pointer-events: auto; background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 25px 20px; color: white; width: 92%; max-width: 400px; }
        .modern-btn { padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: white; cursor: pointer; }
        .modern-btn.active { background: white; color: black; }
        .play-btn { width: 100%; margin-top: 15px; padding: 16px; border-radius: 16px; border: none; background: linear-gradient(135deg, #eab308, #ca8a04); color: white; font-weight: 800; cursor: pointer; }
        .game-header { position: absolute; top: 0; left: 0; display: flex; justify-content: center; gap: 8px; padding: 10px; width: 100%; background: rgba(0,0,0,0.5); z-index: 20; }
        .player-pill { background: rgba(0,0,0,0.6); padding: 6px 16px; border-radius: 50px; color: white; }
        .player-pill.active { background: #eab308; color: black;}
        .bottom-bar { position: absolute; bottom: 25px; width: 100%; display: flex; justify-content: center; gap: 8px; pointer-events: none; z-index: 20; }
        .action-btn { pointer-events: auto; padding: 12px 18px; border-radius: 14px; border: none; font-weight: 700; cursor: pointer; background: rgba(255,255,255,0.1); color: white; }
        .btn-primary { background: #10b981; }
        .toast { position: absolute; top: 80px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: white; padding: 12px 20px; border-radius: 50px; opacity: 0; z-index: 1000; }
        .toast.show { opacity: 1; }
        .modern-input { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 12px; color: white; margin-bottom: 5px;}
        /* DEBUG ABLAK */
        .debug-console { position: absolute; top: 70px; left: 10px; background: rgba(0,0,0,0.8); border: 1px solid #0f0; color: #0f0; padding: 10px; font-family: monospace; font-size: 10px; z-index: 9999; pointer-events: none; width: 250px; border-radius: 8px;}
      `}</style>
      
      <div ref={containerRef} style={{position:'fixed', inset:0, zIndex:-1}} />

      {/* HIBAKERESŐ ABLAK A MOBILON */}
      {gameState === 'playing' && (
          <div className="debug-console">
              <b>DEBUG LOG:</b><br/>
              {debugLogList.map((log, i) => <div key={i}>{log}</div>)}
          </div>
      )}

      <div className="app-container">
        {gameState === 'menu' && (
            <div style={{height:'100%', display:'flex', alignItems:'center', justifyContent:'center'}}>
                <div className="glass-panel">
                    <h1 style={{textAlign: 'center', color: '#facc15'}}>WORD MASTER</h1>
                    {!roomId ? (
                      <>
                        <input className="modern-input" placeholder="Játékos Neved" value={playerName} onChange={(e) => setPlayerName(e.target.value.toUpperCase())} />
                        <button className="play-btn" onClick={createRoom}>ÚJ SZOBA</button>
                        <div style={{display:'flex', gap:'10px', marginTop:'15px'}}>
                          <input className="modern-input" placeholder="KÓD" value={roomCodeInput} maxLength={4} onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())} />
                          <button className="modern-btn active" onClick={joinRoom}>BELÉPÉS</button>
                        </div>
                      </>
                    ) : (
                      <div style={{textAlign:'center'}}>
                        <h2 style={{fontSize:'36px', color:'#facc15'}}>{roomId}</h2>
                        {config.playerNames.map((n, i) => <div key={i} className="modern-input">{n}</div>)}
                        {isHost ? <button className="play-btn" onClick={startMultiplayerGame}>INDÍTÁS</button> : <p>Várakozás a Hostra...</p>}
                      </div>
                    )}
                </div>
            </div>
        )}

        {gameState === 'playing' && (
            <>
                <div className="game-header">
                    {config.playerNames.map((name, i) => (
                        <div key={i} className={`player-pill ${currentPlayer===i?'active':''}`}>
                            <b>{name}</b> | {scores[i] || 0}
                        </div>
                    ))}
                    {/* PÁNIK GOMB */}
                    <button style={{background:'red', color:'white', border:'none', borderRadius:'5px', padding:'5px', pointerEvents:'auto'}} 
                            onClick={() => gameRef.current?.forceRebuildBoard(globalBoardData)}>
                        TÁBLA ÚJRATÖLTÉSE
                    </button>
                </div>

                <div className={`toast ${toastMsg.text?'show':''}`}>{toastMsg.text}</div>

                <div className="bottom-bar">
                    {config.playerNames[currentPlayer] !== playerName ? (
                        <div style={{ padding: '10px 16px', background: 'rgba(239, 68, 68, 0.9)', color: 'white', borderRadius: '50px', pointerEvents:'auto' }}>
                            ⏳ Várakozás {config.playerNames[currentPlayer]} lépésére...
                        </div>
                    ) : (
                        <>
                            <button className="action-btn" onClick={()=>gameRef.current?.recall()}>Vissza</button>
                            <button className="action-btn" onClick={()=>gameRef.current?.shuffle()}>Keverés</button>
                            <button className="action-btn btn-primary" onClick={handleValidate} disabled={validating}>LERAKÁS</button>
                        </>
                    )}
                </div>
            </>
        )}
      </div>
    </>
  );
}