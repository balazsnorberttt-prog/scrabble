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
    name: "Royal Mahogany",
    isDark: true,
    bgBase: 0x1a1a1a,
    fogColor: 0x1a1a1a,
    tableParams: { color1: '#4a2c20', color2: '#1a120b' },
    woodColor: '#5d4037',
    frameColor: 0xffffff,
    boardField: 0x1e5128,
    special: { tw: 0xb91c1c, dw: 0xc084fc, tl: 0x1d4ed8, dl: 0x60a5fa, start: 0xb91c1c }
  },
  nordic: {
    name: "Nordic Frost",
    isDark: false,
    bgBase: 0xd1d5db,
    fogColor: 0xd1d5db,
    tableParams: { color1: '#f3f4f6', color2: '#e5e7eb' },
    woodColor: '#d1d5db',
    frameColor: 0x9ca3af,
    boardField: 0xffffff,
    special: { tw: 0xfca5a5, dw: 0xfcd34d, tl: 0x93c5fd, dl: 0xc4b5fd, start: 0xfca5a5 }
  },
  cyber: {
    name: "Cyberpunk Neon",
    isDark: true,
    bgBase: 0x020617,
    fogColor: 0x020617,
    tableParams: { color1: '#0f172a', color2: '#000000' },
    woodColor: '#1e293b',
    frameColor: 0x334155,
    boardField: 0x0f172a,
    special: { tw: 0xff0055, dw: 0xaa00ff, tl: 0x00ccff, dl: 0x00ffaa, start: 0xff0055 }
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
  
  // --- ÁLLAPOTOK ---
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
  const [globalTempData, setGlobalTempData] = useState<any[]>([]);

  // Stabilitási flag a felesleges Canvas renderelések megakadályozására
  const prevBoardRef = useRef<string>('');

  useEffect(() => {
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
        const activePlayerName = config.playerNames[currentPlayer];
        gameRef.current.state.isMyTurn = (activePlayerName === playerName);
    }
  }, [currentPlayer, playerName, config.playerNames]);

  // --- AZ OPTIMALIZÁLT SZINKRONIZÁTOR ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    
    const serialized = JSON.stringify(globalBoardData);
    if (serialized === prevBoardRef.current) return; // ← Semmi nem változott, skippeljük!
    prevBoardRef.current = serialized;
    
    const trySync = () => {
        if (gameRef.current) {
            gameRef.current.syncBoardFromFirebase(globalBoardData);
        } else {
            setTimeout(trySync, 200);
        }
    };
    trySync();
  }, [globalBoardData, gameState]);

  useEffect(() => {
    if (gameRef.current && gameState === 'playing') {
        gameRef.current.syncOpponentPlacements(globalTempData);
    }
  }, [globalTempData, gameState]);

  // --- MULTIPLAYER LOGIKA ---
  const createRoom = async () => {
    if (!playerName.trim()) return showToast('Kérlek add meg a neved!', true);
    
    const newRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const roomRef = ref(db, `rooms/${newRoomId}`);
    
    await set(roomRef, {
      status: 'lobby',
      config: { ...config, playerNames: [playerName] },
      players: [{ name: playerName, score: 0 }],
      currentTurn: 0,
      hostName: playerName,
      boardData: JSON.stringify([]),
      tempPlacements: JSON.stringify([]) 
    });

    setRoomId(newRoomId);
    setIsHost(true);
    listenToRoom(newRoomId);
  };

  const joinRoom = async () => {
    if (!playerName.trim()) return showToast('Kérlek add meg a neved!', true);
    if (roomCodeInput.length !== 4) return showToast('A kód 4 karakter hosszú!', true);

    const roomRef = ref(db, `rooms/${roomCodeInput}`);
    const snapshot = await get(roomRef);

    if (snapshot.exists()) {
      const roomData = snapshot.val();
      if (roomData.status !== 'lobby') return showToast('A játék már elkezdődött!', true);
      
      const currentPlayers = roomData.players || [];
      if (currentPlayers.length >= 4) return showToast('A szoba megtelt!', true);

      const updatedPlayers = [...currentPlayers, { name: playerName, score: 0 }];
      await update(roomRef, { players: updatedPlayers });

      setRoomId(roomCodeInput);
      listenToRoom(roomCodeInput);
    } else {
      showToast('Nem létezik ilyen szoba!', true);
    }
  };

  const listenToRoom = (id: string) => {
    const roomRef = ref(db, `rooms/${id}`);
    onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const playersData = data.players || [];
        const names = playersData.map((p: any) => p.name);
        const syncedScores = playersData.map((p: any) => p.score || 0);

        setConfig(prev => ({ ...prev, ...data.config, playerNames: names }));
        setScores(syncedScores);
        setCurrentPlayer(data.currentTurn || 0);

        if (data.boardData) {
            const parsedBoard = typeof data.boardData === 'string' ? JSON.parse(data.boardData) : data.boardData;
            setGlobalBoardData(parsedBoard);
        }

        if (data.tempPlacements) {
            const parsedTemp = typeof data.tempPlacements === 'string' ? JSON.parse(data.tempPlacements) : data.tempPlacements;
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
  };

  const startMultiplayerGame = async () => {
    if (!roomId) return;
    await update(ref(db, `rooms/${roomId}`), { status: 'playing' });
  };

  const backToMenu = () => {
    setGameState('menu');
    setRoomId('');
    if(gameRef.current) gameRef.current.transitionToMenuView();
  };

  const onTempPlaceSync = (placements: any[]) => {
    if (roomIdRef.current) {
      update(ref(db, `rooms/${roomIdRef.current}`), { 
          tempPlacements: JSON.stringify(placements) 
      });
    }
  };

  // --- 3D GAME ENGINE ---
  useEffect(() => {
    if (!containerRef.current) return;

    class Game {
      scene: any; camera: any; renderer: any; controls: any; raycaster: any; mouse: any; dragPlane: any;
      dragging: any = null; selectedTile: any = null; textureCache: any = {};
      woodTexture: any = null; tableTexture: any = null;
      activeTheme: any = THEMES['luxus'];
      currentBoardType: string = 'normal';
      specialMap = new Map();
      opponentTempTiles: any[] = [];
      onTempPlaceCallback: (placements: any[]) => void;
      
      state = {
        rack: [] as any[],
        boardGrid: Array(15).fill(null).map(() => Array(15).fill(null)),
        logicalBoard: [] as {r: number, c: number, char: string}[],
        placedThisTurn: [] as any[],
        turnCount: 0,
        isMyTurn: false
      };

      constructor(container: HTMLElement, syncCallback: any) {
        this.onTempPlaceCallback = syncCallback;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 1, 100);
        this.camera.position.set(25, 15, 25); 

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.shadowMap.enabled = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        container.appendChild(this.renderer.domElement);

        this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4);
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.maxPolarAngle = Math.PI / 2.1;

        this.updateThemeColors();
        this.loadTextures();
        this.initLights();
        this.createTable();
        this.generateBoardLayout(this.currentBoardType);
        this.initBoard();
        this.fillRack();
        this.addEvents();
        this.animate();
      }

      updateConfig(newConfig: any) {
          const newTheme = (THEMES as any)[newConfig.theme] || THEMES['luxus'];
          if (this.activeTheme.name !== newTheme.name || this.currentBoardType !== newConfig.boardType) {
              this.activeTheme = newTheme;
              this.currentBoardType = newConfig.boardType;
              this.updateThemeColors();
              this.loadTextures();
              this.createTable(); 
              this.generateBoardLayout(this.currentBoardType);
              this.initBoard(); 
          }
      }

      updateThemeColors() {
        this.scene.background = new THREE.Color(this.activeTheme.bgBase);
        this.scene.fog = new THREE.Fog(this.activeTheme.fogColor, 20, 80);
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
                this.controls.enabled = true; this.controls.minDistance = 10; this.controls.maxDistance = 50;
            }
        });
      }

      transitionToMenuView() {
        this.controls.enabled = false;
        gsap.to(this.camera.position, {
            x: 25, y: 15, z: 25, duration: 2, ease: "power3.inOut",
            onComplete: () => { this.controls.enabled = true; this.controls.autoRotate = true; }
        });
      }

      initLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(15, 30, 10);
        dirLight.castShadow = true;
        this.scene.add(dirLight);
        this.camera.add(new THREE.PointLight(0xffffff, 0.4));
        this.scene.add(this.camera);
      }

      loadTextures() {
        const cvs = document.createElement('canvas'); cvs.width = 1024; cvs.height = 1024;
        const ctx = cvs.getContext('2d')!;
        const grd = ctx.createRadialGradient(512, 512, 100, 512, 512, 900);
        grd.addColorStop(0, this.activeTheme.tableParams.color1); 
        grd.addColorStop(1, this.activeTheme.tableParams.color2); 
        ctx.fillStyle = grd; ctx.fillRect(0,0,1024,1024);
        this.tableTexture = new THREE.CanvasTexture(cvs);
        
        const cvsW = document.createElement('canvas'); cvsW.width = 512; cvsW.height = 512;
        const ctxW = cvsW.getContext('2d')!;
        ctxW.fillStyle = this.activeTheme.woodColor; ctxW.fillRect(0,0,512,512);
        this.woodTexture = new THREE.CanvasTexture(cvsW);
      }

      createTable() {
        const oldTable = this.scene.getObjectByName("tableMesh");
        if(oldTable) this.scene.remove(oldTable);
        const geo = new THREE.PlaneGeometry(150, 150);
        const mat = new THREE.MeshStandardMaterial({ map: this.tableTexture, roughness: 0.5, metalness: 0.1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = "tableMesh";
        mesh.rotation.x = -Math.PI / 2; mesh.position.y = -2; mesh.receiveShadow = true;
        this.scene.add(mesh);
      }

      generateBoardLayout(type: string) {
        this.specialMap.clear();
        this.specialMap.set('7_7', { lines:['★', 'START'], color: this.activeTheme.special.start });
        if (type === 'normal') {
            const setSym = (arr: any[], val: any) => arr.forEach(p => this.specialMap.set(`${p[0]}_${p[1]}`, val));
            setSym([[0,0], [0,7], [0,14], [7,0], [7,14], [14,0], [14,7], [14,14]], { lines:['TRIPLA', 'SZÓ'], color: this.activeTheme.special.tw });
            setSym([[1,1], [2,2], [3,3], [4,4], [1,13], [2,12], [3,11], [4,10], [13,1], [12,2], [11,3], [10,4], [13,13], [12,12], [11,11], [10,10]], { lines:['DUPLA', 'SZÓ'], color: this.activeTheme.special.dw });
            setSym([[1,5], [1,9], [5,1], [5,5], [5,9], [5,13], [9,1], [9,5], [9,9], [9,13], [13,5], [13,9]], { lines:['TRIPLA', 'BETŰ'], color: this.activeTheme.special.tl });
            setSym([[0,3], [0,11], [2,6], [2,8], [3,0], [3,7], [3,14], [6,2], [6,6], [6,8], [6,12], [7,3], [7,11], [8,2], [8,6], [8,8], [8,12], [11,0], [11,7], [11,14], [12,6], [12,8], [14,3], [14,11]], { lines:['DUPLA', 'BETŰ'], color: this.activeTheme.special.dl });
        }
      }

      getCellInfo(r: number, c: number) {
        const key = `${r}_${c}`;
        if (this.specialMap.has(key)) return this.specialMap.get(key);
        return { lines:[], color: this.activeTheme.boardField };
      }

      // --- TEXTURE MEMÓRIA JAVÍTÁS (Canvas Cache & Szabadítás) ---
      getTexture(lines: string[], color: string | null, isTile: boolean) {
        const id = isTile ? lines[0] : lines.join('_') + color + this.activeTheme.name;
        if (this.textureCache[id]) return this.textureCache[id];

        const size = 256; // MOBILON KRITIKUS: felezzük a felbontást
        const cvs = document.createElement('canvas'); 
        cvs.width = size; cvs.height = size;
        const ctx = cvs.getContext('2d')!;

        if (isTile) {
            const grd = ctx.createLinearGradient(0,0,size,size);
            ctx.fillStyle = '#fceabb'; ctx.fillRect(0,0,size,size);
        } else {
            ctx.fillStyle = '#' + new THREE.Color(color!).getHexString(); ctx.fillRect(0,0,size,size);
            ctx.strokeStyle = "rgba(0,0,0,0.1)"; ctx.lineWidth = 5; ctx.strokeRect(0,0,size,size);
        }

        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        let textColor = isTile ? '#111' : (this.activeTheme.isDark ? '#fff' : '#111');
        
        if (isTile) {
            // Skálázott fontméretek a 256-os canvas-hoz
            ctx.fillStyle = textColor; ctx.font = 'bold 140px "Arial", sans-serif';
            ctx.fillText(lines[0], size/2, size/2 - 12);
            ctx.font = 'bold 40px "Arial", sans-serif'; ctx.fillText("1", size - 35, size - 35);
        } else if (lines.length > 0) {
            ctx.fillStyle = textColor; ctx.font = `900 32px "Arial", sans-serif`;
            lines.forEach((line, i) => { ctx.fillText(line, size/2, 110 + i * 40); });
        }
        
        const texture = new THREE.CanvasTexture(cvs);
        this.textureCache[id] = texture;

        // CANVAS FELSZABADÍTÁSA MEMÓRIÁBÓL
        cvs.width = 0;
        cvs.height = 0;

        return texture;
      }

      initBoard() {
        const oldGroup = this.scene.getObjectByName("boardGroup");
        if(oldGroup) this.scene.remove(oldGroup);
        const group = new THREE.Group(); group.name = "boardGroup";

        const frameGeo = new RoundedBoxGeometry(17.2, 1.0, 17.2, 4, 0.2);
        const frameMat = new THREE.MeshPhysicalMaterial({ map: this.woodTexture, color: this.activeTheme.frameColor, roughness: 0.5 });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.y = -0.55; frame.receiveShadow = true; group.add(frame);

        const cellGeo = new RoundedBoxGeometry(0.96, 0.1, 0.96, 2, 0.05);
        for(let r=0; r<15; r++) {
            for(let c=0; c<15; c++) {
                const info = this.getCellInfo(r, c);
                const tex = this.getTexture(info.lines, info.color, false);
                const matTop = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.8 });
                const matBody = new THREE.MeshPhysicalMaterial({ color: info.color });
                const cell = new THREE.Mesh(cellGeo, [matBody, matBody, matTop, matBody, matBody, matBody]);
                cell.position.set((c-7)*1.05, 0.05, (r-7)*1.05); cell.userData = { isSlot: true, r, c }; group.add(cell);
            }
        }
        this.scene.add(group);
      }

      createTileMesh(char: string) {
        const geo = new RoundedBoxGeometry(0.95, 0.25, 0.95, 4, 0.08);
        const tex = this.getTexture([char], null, true);
        const matTop = new THREE.MeshPhysicalMaterial({ map: tex, color: 0xffffff, roughness: 0.2 });
        const matBody = new THREE.MeshPhysicalMaterial({ color: 0xccaa88 });
        const mesh = new THREE.Mesh(geo, [matBody, matBody, matTop, matBody, matBody, matBody]);
        mesh.castShadow = true; mesh.userData = { isTile: true, char: char };
        return mesh;
      }
      
      fillRack() {
        while(this.state.rack.length < 7) {
            const char = HUNGARIAN_LETTERS[Math.floor(Math.random() * HUNGARIAN_LETTERS.length)];
            const tile = this.createTileMesh(char);
            tile.position.set(0, 8, 15);
            this.scene.add(tile);
            this.state.rack.push(tile);
            tile.userData.isPlaced = false;
        }
        this.arrangeRack();
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

      addEvents() {
        const el = this.renderer.domElement;
        el.style.touchAction = 'none';

        const onPointerDown = (e: PointerEvent) => {
            if (!this.state.isMyTurn) return; 
            
            const rect = el.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const hits = this.raycaster.intersectObjects(this.scene.children, true);
            
            const hitTile = hits.find((i:any)=>i.object.userData.isTile);
            if(hitTile) {
                const t = hitTile.object;
                const fixed = this.state.logicalBoard.some(lb => lb.r === t.userData.boardR && lb.c === t.userData.boardC) && !this.state.placedThisTurn.some(p=>p.tile===t);
                
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
                return;
            }
            const hitSlot = hits.find((i:any)=>i.object.userData.isSlot);
            if(hitSlot && this.selectedTile) {
                if (e.cancelable) e.preventDefault();
                const r = hitSlot.object.userData.r; const c = hitSlot.object.userData.c;
                this.placeTileToGrid(this.selectedTile, r, c);
                this.selectedTile = null;
            }
            if(!hitTile && !hitSlot && this.selectedTile) {
                this.returnToRack(this.selectedTile); 
                this.selectedTile = null;
            }
        };

        const onPointerMove = (e: PointerEvent) => {
            if(!this.dragging || !this.state.isMyTurn) return;
            if (e.cancelable) e.preventDefault(); 
            
            const rect = el.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const target = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(this.dragPlane, target);
            if(target) {
                this.dragging.position.x = target.x;
                this.dragging.position.z = target.z;
            }
        };

        const onPointerUp = () => {
            if(!this.dragging || !this.state.isMyTurn) return;
            const gx = Math.round(this.dragging.position.x/1.05); const gz = Math.round(this.dragging.position.z/1.05);
            if(Math.abs(gx)<=7 && Math.abs(gz)<=7) {
                this.placeTileToGrid(this.dragging, gz+7, gx+7);
                this.selectedTile = null;
            } else {
                this.returnToRack(this.dragging);
                this.selectedTile = null;
            }
            this.dragging = null; 
            this.controls.enabled = true; 
        };

        el.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp); 
        window.addEventListener('resize', this.onResize);
      }

      placeTileToGrid(tile: any, r: number, c: number) {
        const fixed = this.state.logicalBoard.some(lb => lb.r === r && lb.c === c);
        const current = this.state.placedThisTurn.some(p=>p.r===r && p.c===c && p.tile!==tile);
        if(!fixed && !current) {
            gsap.to(tile.position, {x:(c-7)*1.05, y:0.18, z:(r-7)*1.05, duration:0.4, ease:"back.out(1.5)"});
            const idx = this.state.rack.indexOf(tile); if(idx>-1) this.state.rack.splice(idx,1);
            this.state.placedThisTurn = this.state.placedThisTurn.filter(p=>p.tile!==tile);
            this.state.placedThisTurn.push({tile, r, c});
            tile.userData.isPlaced = true;
            this.triggerTempSync(); 
        } else this.returnToRack(tile);
      }

      returnToRack(tile: any) {
        if(!this.state.rack.includes(tile)) this.state.rack.push(tile);
        this.state.placedThisTurn = this.state.placedThisTurn.filter(p=>p.tile!==tile);
        tile.userData.isPlaced=false; this.arrangeRack();
        this.triggerTempSync(); 
      }

      async validateTurn() {
        const placed = this.state.placedThisTurn;
        if (placed.length === 0) return { success: false, msg: "Nincs lerakott betű!" };

        const rows = new Set(placed.map(p => p.r));
        const cols = new Set(placed.map(p => p.c));
        const isHoriz = rows.size === 1;
        const isVert = cols.size === 1;
        if (!isHoriz && !isVert) return { success: false, msg: "Csak egy vonalban!" };

        let mainWord = "";

        if (isHoriz) {
            const r = placed[0].r;
            placed.sort((a,b) => a.c - b.c); 
            let startC = placed[0].c;
            while(startC > 0 && (this.state.boardGrid[r][startC - 1] !== null || this.state.logicalBoard.some(lb => lb.r === r && lb.c === startC - 1))) startC--;
            let endC = placed[placed.length-1].c;
            while(endC < 14 && (this.state.boardGrid[r][endC + 1] !== null || this.state.logicalBoard.some(lb => lb.r === r && lb.c === endC + 1))) endC++;

            for(let c = startC; c <= endC; c++) {
                const pTile = placed.find(p => p.c === c);
                if (pTile) { mainWord += pTile.tile.userData.char; }
                else {
                    const lbTile = this.state.logicalBoard.find(lb => lb.r === r && lb.c === c);
                    if (lbTile) mainWord += lbTile.char;
                    else return { success: false, msg: "Lyukas szó!" };
                }
            }
        } else { 
            const c = placed[0].c;
            placed.sort((a,b) => a.r - b.r); 
            let startR = placed[0].r;
            while(startR > 0 && (this.state.boardGrid[startR - 1][c] !== null || this.state.logicalBoard.some(lb => lb.r === startR - 1 && lb.c === c))) startR--;
            let endR = placed[placed.length-1].r;
            while(endR < 14 && (this.state.boardGrid[endR + 1][c] !== null || this.state.logicalBoard.some(lb => lb.r === endR + 1 && lb.c === c))) endR++;

            for(let r = startR; r <= endR; r++) {
                const pTile = placed.find(p => p.r === r);
                if (pTile) { mainWord += pTile.tile.userData.char; }
                else {
                    const lbTile = this.state.logicalBoard.find(lb => lb.r === r && lb.c === c);
                    if (lbTile) mainWord += lbTile.char;
                    else return { success: false, msg: "Lyukas szó!" };
                }
            }
        }
        return { mainWord, placed };
      }

      finalizeTurn(placed: any[], points: number) {
        placed.forEach(p => {
            this.state.boardGrid[p.r][p.c] = p.tile;
            p.tile.userData.boardR = p.r;
            p.tile.userData.boardC = p.c;
            
            this.state.logicalBoard = this.state.logicalBoard.filter(lb => !(lb.r === p.r && lb.c === p.c));
            this.state.logicalBoard.push({ r: p.r, c: p.c, char: p.tile.userData.char });

            const glow = new THREE.PointLight(0x00ff00, 2, 3);
            glow.position.copy(p.tile.position); glow.position.y=1;
            this.scene.add(glow);
            gsap.to(glow, {intensity:0, duration:1.5, onComplete:()=>this.scene.remove(glow)});
        });
        this.state.placedThisTurn = []; this.state.turnCount++;
        return points;
      }

      getBoardSnapshot() {
        return this.state.logicalBoard;
      }

      // --- JAVÍTOTT TÁBLA FRISSÍTÉS ---
      syncBoardFromFirebase(boardData: any[]) {
        this.state.logicalBoard = boardData;
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
                        newTile.rotation.set(0, 0, 0); // JAVÍTÁS: Alaphelyzetbe forgatás
                        newTile.userData.boardR = r;
                        newTile.userData.boardC = c;
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
            if (!this.state.logicalBoard.some(lb => lb.r === p.r && lb.c === p.c)) {
                const mesh = this.createTileMesh(p.char);
                mesh.material.forEach((mat: any) => { 
                    mat.transparent = true; 
                    mat.opacity = 0.5; 
                    if(mat.color) mat.color.setHex(0xaaaaaa); 
                });
                mesh.position.set((p.c - 7) * 1.05, 0.25, (p.r - 7) * 1.05);
                mesh.rotation.set(0, 0, 0); // JAVÍTÁS: Rotáció biztosítása szellem betűnél is
                this.scene.add(mesh);
                this.opponentTempTiles.push(mesh);
            }
        });
      }

      recall() { [...this.state.placedThisTurn].forEach(p => this.returnToRack(p.tile)); }
      shuffle() { this.state.rack.sort(() => Math.random() - 0.5); this.arrangeRack(); }

      animate = () => {
        requestAnimationFrame(this.animate);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
      }
      dispose() {
        window.removeEventListener('resize', this.onResize);
        this.renderer.domElement.removeEventListener('pointerdown', () => {});
        window.removeEventListener('pointermove', () => {});
        window.removeEventListener('pointerup', () => {});
        window.removeEventListener('pointercancel', () => {});
        this.renderer.dispose();
      }
      onResize = () => {
          this.camera.aspect = window.innerWidth / window.innerHeight;
          this.camera.updateProjectionMatrix();
          this.renderer.setSize(window.innerWidth, window.innerHeight);
          this.arrangeRack(); 
      }
    }

    const gameInstance = new Game(containerRef.current, onTempPlaceSync);
    gameRef.current = gameInstance;
    
    return () => {
        gameInstance.dispose();
        gameRef.current = null;
    };
  }, []);

  // --- LERAKÁS ÉS API ---
  const handleValidate = async () => {
    if(!gameRef.current || validating) return;
    setValidating(true);
    
    const check = await gameRef.current.validateTurn();
    
    if(check.success === false) { 
        showToast(check.msg, true);
        setValidating(false);
        return;
    }

    const { mainWord, placed } = check;
    const exists = await checkHungarianWordAPI(mainWord);

    if (exists) {
        completeTurn(mainWord, placed);
    } else {
        setPopupData({
            word: mainWord,
            onAccept: () => {
                WORD_CACHE.add(mainWord); 
                completeTurn(mainWord, placed);
                setPopupData(null);
            },
            onReject: () => {
                showToast(`Nincs ilyen szó: ${mainWord}`, true);
                setValidating(false);
                setPopupData(null);
            }
        });
    }
  };

  const completeTurn = async (word: string, placed: any[]) => {
    const pts = word.length * 10;
    gameRef.current.finalizeTurn(placed, pts);
    
    const boardSnapshot = gameRef.current.getBoardSnapshot();
    
    const nextTurn = (currentPlayer + 1) % config.playerNames.length;
    const newPlayers = config.playerNames.map((n, i) => ({ 
        name: n, 
        score: i === currentPlayer ? (scores[i] || 0) + pts : (scores[i] || 0) 
    }));

    try {
        await update(ref(db, `rooms/${roomId}`), { 
            currentTurn: nextTurn, 
            players: newPlayers,
            boardData: JSON.stringify(boardSnapshot),
            tempPlacements: JSON.stringify([]) 
        });
        showToast(`Kész! +${pts}`, false);
    } catch(err) {
        showToast('Hálózati hiba!', true);
    }
    
    setTimeout(() => { 
        if (gameRef.current) gameRef.current.fillRack(); 
        setValidating(false); 
    }, 800);
  };

  return (
    <>
      <style jsx global>{`
        body { 
            margin: 0; 
            overflow: hidden; 
            font-family: 'Inter', sans-serif; 
            background: #000;
            touch-action: none; 
            -webkit-user-select: none;
            user-select: none;
        }
        .app-container { position: fixed; inset: 0; pointer-events: none; z-index: 10; display: flex; flex-direction: column; }
        
        .popup-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            display: flex; align-items: center; justify-content: center; pointer-events: auto; z-index: 100;
        }
        .popup-box {
            background: linear-gradient(145deg, #1e1e1e, #2a2a2a);
            border: 2px solid #ffcc00; padding: 25px; border-radius: 20px;
            text-align: center; color: white; box-shadow: 0 0 50px rgba(255, 204, 0, 0.3);
            width: 90%; max-width: 350px;
        }
        
        .glass-panel {
            pointer-events: auto; background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 25px 20px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); color: white; 
            width: 92%; max-width: 400px; box-sizing: border-box;
        }
        .menu-title { font-size: 32px; font-weight: 900; text-align: center; margin-bottom: 20px; background: linear-gradient(to right, #facc15, #f59e0b); -webkit-background-clip: text; color: transparent; }
        
        .modern-btn { padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: white; cursor: pointer; transition: all 0.2s; font-weight: 600; font-size: 14px;}
        .modern-btn.active { background: white; color: black; border-color: white; }
        .play-btn { width: 100%; margin-top: 15px; padding: 16px; border-radius: 16px; border: none; background: linear-gradient(135deg, #eab308, #ca8a04); color: white; font-size: 16px; font-weight: 800; cursor: pointer; transition: all 0.3s; }
        
        .game-header { position: absolute; top: 0; left: 0; display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; padding: 10px; width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); backdrop-filter: blur(5px); z-index: 20; }
        .player-pill { background: rgba(0,0,0,0.6); padding: 6px 16px; border-radius: 50px; border: 1px solid rgba(255,255,255,0.1); color: white; text-align: center; }
        .player-pill.active { background: rgba(234, 179, 8, 0.8); border-color: #fde047; transform: scale(1.05); }
        
        .bottom-bar { position: absolute; bottom: 25px; width: 100%; display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; pointer-events: none; padding: 0 10px; box-sizing: border-box; z-index: 20; }
        .action-btn { pointer-events: auto; padding: 12px 18px; border-radius: 14px; border: none; font-weight: 700; cursor: pointer; font-size: 13px; backdrop-filter: blur(10px); }
        .btn-glass { background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); }
        .btn-primary { background: #10b981; color: white; }
        
        .toast { position: absolute; top: 80px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: white; padding: 12px 20px; border-radius: 50px; font-weight: 600; opacity: 0; transition: opacity 0.3s; z-index: 1000; text-align: center; width: max-content; max-width: 90%; }
        .toast.show { opacity: 1; }
        
        .input-group { margin-bottom: 15px; }
        .input-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7; margin-bottom: 5px; }
        .option-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; }
        .modern-input { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 12px; color: white; margin-bottom: 5px; font-weight: 600; box-sizing: border-box;}

        @media (max-width: 600px) {
            .menu-title { font-size: 26px; }
            .glass-panel { padding: 20px 15px; }
            .play-btn { padding: 14px; font-size: 14px; }
            .bottom-bar { bottom: 35px; } 
        }
      `}</style>
      
      <div ref={containerRef} style={{position:'fixed', inset:0, zIndex:-1}} />

      {popupData && (
        <div className="popup-overlay">
            <div className="popup-box">
                <h2 style={{margin:'0 0 10px 0', fontSize:'20px'}}>ISMERETLEN SZÓ</h2>
                <div style={{fontSize:'28px', fontWeight:'bold', color:'#ffcc00', marginBottom:'20px'}}>"{popupData.word}"</div>
                <div style={{display:'flex', gap:'10px', justifyContent:'center'}}>
                    <button className="action-btn btn-glass" onClick={popupData.onReject} style={{background:'rgba(255,50,50,0.2)', flex:1}}>NEM</button>
                    <button className="action-btn btn-primary" onClick={popupData.onAccept} style={{flex:1}}>ELFOGAD</button>
                </div>
            </div>
        </div>
      )}

      <div className="app-container">
        {gameState === 'menu' && (
            <div style={{height:'100%', display:'flex', alignItems:'center', justifyContent:'center'}}>
                <div className="glass-panel">
                    <div className="menu-title">WORD MASTER</div>
                    
                    {!roomId ? (
                      <>
                        <div className="input-group">
                          <label className="input-label">Játékos neved</label>
                          <input className="modern-input" placeholder="Pl.: Anna" value={playerName} onChange={(e) => setPlayerName(e.target.value.toUpperCase())} />
                        </div>

                        <button className="play-btn" onClick={createRoom}>ÚJ SZOBA LÉTREHOZÁSA</button>

                        <div style={{display:'flex', gap:'10px', marginTop:'15px', alignItems:'center'}}>
                          <input className="modern-input" style={{marginBottom:0}} placeholder="KÓD" value={roomCodeInput} maxLength={4} onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())} />
                          <button className="modern-btn active" onClick={joinRoom} style={{height:'100%'}}>CSATLAKOZÁS</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{textAlign:'center', marginBottom:'15px'}}>
                          <p style={{opacity:0.7, margin:0}}>Szoba kódja:</p>
                          <h2 style={{fontSize:'36px', color:'#facc15', letterSpacing:'5px', margin:'5px 0'}}>{roomId}</h2>
                        </div>

                        {isHost && (
                          <div className="input-group">
                              <label className="input-label">Téma (Host beállítás)</label>
                              <div className="option-grid-3">
                                  <button className={`modern-btn ${config.theme==='luxus'?'active':''}`} onClick={()=>update(ref(db, `rooms/${roomId}/config`), {theme: 'luxus'})}>Luxus</button>
                                  <button className={`modern-btn ${config.theme==='nordic'?'active':''}`} onClick={()=>update(ref(db, `rooms/${roomId}/config`), {theme: 'nordic'})}>Nordic</button>
                                  <button className={`modern-btn ${config.theme==='cyber'?'active':''}`} onClick={()=>update(ref(db, `rooms/${roomId}/config`), {theme: 'cyber'})}>Cyber</button>
                              </div>
                          </div>
                        )}

                        <div className="input-group">
                            <label className="input-label">Játékosok ({config.playerNames.length}/4)</label>
                            <div style={{display:'flex', flexDirection:'column', gap:'5px'}}>
                              {config.playerNames.map((name, i) => (
                                  <div key={i} className="modern-input" style={{textAlign:'center', backgroundColor: 'rgba(234, 179, 8, 0.2)', borderColor: '#eab308'}}>{name}</div>
                              ))}
                            </div>
                        </div>

                        {isHost ? (
                          <button className="play-btn" onClick={startMultiplayerGame}>JÁTÉK INDÍTÁSA ▶</button>
                        ) : (
                          <div style={{textAlign:'center', opacity:0.6, padding:'15px'}}>Várakozás a házigazdára...</div>
                        )}
                      </>
                    )}
                </div>
            </div>
        )}

        {gameState === 'playing' && (
            <>
                <div className="game-header">
                    {config.playerNames.map((name, i) => (
                        <div key={i} className={`player-pill ${currentPlayer===i?'active':''}`}>
                            <div style={{fontSize:'10px', opacity:0.7, textTransform:'uppercase'}}>{name}</div>
                            <div style={{fontSize:'16px', fontWeight:'800'}}>{scores[i] || 0}</div>
                        </div>
                    ))}
                </div>

                <div className={`toast ${toastMsg.text?'show':''} ${toastMsg.type}`}>
                    {toastMsg.text}
                </div>

                <div className="bottom-bar">
                    {config.playerNames[currentPlayer] !== playerName ? (
                        <div style={{ padding: '10px 16px', background: 'rgba(239, 68, 68, 0.9)', backdropFilter: 'blur(10px)', color: 'white', borderRadius: '50px', fontWeight: '800', border: '2px solid rgba(255,255,255,0.2)', pointerEvents:'auto', fontSize:'13px' }}>
                            ⏳ Várakozás {config.playerNames[currentPlayer]} lépésére...
                        </div>
                    ) : (
                        <>
                            <button className="action-btn btn-glass" onClick={()=>gameRef.current?.recall()}>Vissza</button>
                            <button className="action-btn btn-glass" onClick={()=>gameRef.current?.shuffle()}>Keverés</button>
                            <button className="action-btn btn-primary" onClick={handleValidate} disabled={validating}>
                                {validating ? '...' : 'LERAKÁS'}
                            </button>
                        </>
                    )}
                </div>
            </>
        )}
      </div>
    </>
  );
}