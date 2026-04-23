'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
// Ha az app mappában vagy, a firebase.ts pedig kint van:
import { db } from '../firebase'; 
import { ref, set, onValue, get, update } from 'firebase/database';
import gsap from 'gsap';

// --- TÉMÁK (Eredeti, teljes verzió) ---
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
  
  // UI State
  const [gameState, setGameState] = useState('menu');
  const [scores, setScores] = useState<number[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [toastMsg, setToastMsg] = useState({ text: '', type: '' });
  const [validating, setValidating] = useState(false);
  const [popupData, setPopupData] = useState<any>(null); 
  
  // Multiplayer State
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  
  const [config, setConfig] = useState({
    theme: 'luxus',
    boardType: 'normal',
    playerNames: [] as string[]
  });

  const showToast = (msg: string, isError: boolean) => {
    setToastMsg({ text: msg, type: isError ? 'error' : 'success' });
    setTimeout(() => setToastMsg({ text: '', type: '' }), 3000);
  };

  // Turn Sync Effect
  useEffect(() => {
    if (gameRef.current && config.playerNames.length > 0) {
        const activeName = config.playerNames[currentPlayer];
        gameRef.current.state.isMyTurn = (activeName === playerName);
    }
  }, [currentPlayer, playerName, config.playerNames]);

  // --- FIREBASE LOGIKA ---
  const createRoom = async () => {
    if (!playerName.trim()) return showToast('Add meg a neved!', true);
    const newId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const roomRef = ref(db, `rooms/${newId}`);
    await set(roomRef, {
      status: 'lobby',
      config: { theme: config.theme, boardType: config.boardType },
      players: [{ name: playerName, score: 0 }],
      currentTurn: 0,
      hostName: playerName
    });
    setRoomId(newId);
    setIsHost(true);
    listenToRoom(newId);
  };

  const joinRoom = async () => {
    if (!playerName.trim()) return showToast('Add meg a neved!', true);
    if (roomCodeInput.length !== 4) return showToast('4 karakteres kód kell!', true);
    const roomRef = ref(db, `rooms/${roomCodeInput}`);
    const snap = await get(roomRef);
    if (snap.exists()) {
      const data = snap.val();
      if (data.status !== 'lobby') return showToast('Már megy a játék!', true);
      const players = data.players || [];
      if (players.length >= 4) return showToast('Tele van!', true);
      await update(roomRef, { players: [...players, { name: playerName, score: 0 }] });
      setRoomId(roomCodeInput);
      listenToRoom(roomCodeInput);
    } else showToast('Nincs ilyen szoba!', true);
  };

  const listenToRoom = (id: string) => {
    onValue(ref(db, `rooms/${id}`), (snap) => {
      const data = snap.val();
      if (!data) return;
      const names = data.players.map((p: any) => p.name);
      const syncedScores = data.players.map((p: any) => p.score || 0);
      setConfig(prev => ({ ...prev, ...data.config, playerNames: names }));
      setScores(syncedScores);
      setCurrentPlayer(data.currentTurn || 0);
      if (data.status === 'playing' && gameState !== 'playing') {
        setGameState('playing');
        setTimeout(() => {
          if (gameRef.current) {
            gameRef.current.updateConfig({ ...data.config, playerNames: names });
            gameRef.current.transitionToGameView();
          }
        }, 300);
      }
    });
  };

  const startGameBtn = async () => {
    if (roomId) await update(ref(db, `rooms/${roomId}`), { status: 'playing' });
  };

  // --- 3D ENGINE (Eredeti, teljes logika) ---
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    class Game {
      scene: any; camera: any; renderer: any; controls: any; raycaster: any; mouse: any; dragPlane: any;
      dragging: any = null; selectedTile: any = null; textureCache: any = {};
      woodTexture: any = null; tableTexture: any = null;
      activeTheme: any = THEMES['luxus'];
      specialMap = new Map();
      state = { 
        rack: [] as any[], 
        boardGrid: Array(15).fill(null).map(() => Array(15).fill(null)), 
        placedThisTurn: [] as any[], 
        isMyTurn: false 
      };

      constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 1, 100);
        this.camera.position.set(25, 15, 25); 
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        container.appendChild(this.renderer.domElement);
        this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4);
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.maxPolarAngle = Math.PI / 2.1;
        this.initLights();
        this.updateThemeColors();
        this.loadTextures();
        this.createTable();
        this.generateBoardLayout('normal');
        this.initBoard();
        this.fillRack();
        this.addEvents();
        this.animate();
      }

      updateConfig(newConfig: any) {
        this.activeTheme = (THEMES as any)[newConfig.theme] || THEMES['luxus'];
        this.updateThemeColors();
        this.loadTextures();
        this.createTable(); 
        this.generateBoardLayout(newConfig.boardType);
        this.initBoard(); 
      }

      updateThemeColors() {
        this.scene.background = new THREE.Color(this.activeTheme.bgBase);
        this.scene.fog = new THREE.Fog(this.activeTheme.fogColor, 20, 80);
      }

      transitionToGameView() {
        this.controls.autoRotate = false;
        gsap.to(this.camera.position, { x: 0, y: 24, z: 16, duration: 2, ease: "power3.inOut" });
      }

      transitionToMenuView() {
        gsap.to(this.camera.position, { x: 25, y: 15, z: 25, duration: 2, ease: "power3.inOut", onComplete: () => this.controls.autoRotate = true });
      }

      initLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(15, 30, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.set(2048, 2048);
        this.scene.add(dirLight);
        this.camera.add(new THREE.PointLight(0xffffff, 0.4));
        this.scene.add(this.camera);
      }

      loadTextures() {
        const cvs = document.createElement('canvas'); cvs.width = 1024; cvs.height = 1024;
        const ctx = cvs.getContext('2d')!;
        const grd = ctx.createRadialGradient(512, 512, 100, 512, 512, 900);
        grd.addColorStop(0, this.activeTheme.tableParams.color1); grd.addColorStop(1, this.activeTheme.tableParams.color2); 
        ctx.fillStyle = grd; ctx.fillRect(0,0,1024,1024);
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        for(let i=0;i<1000;i++) ctx.fillRect(Math.random()*1024, Math.random()*1024, 2, 2);
        this.tableTexture = new THREE.CanvasTexture(cvs);
        const cvsW = document.createElement('canvas'); cvsW.width = 512; cvsW.height = 512;
        const ctxW = cvsW.getContext('2d')!;
        ctxW.fillStyle = this.activeTheme.woodColor; ctxW.fillRect(0,0,512,512);
        this.woodTexture = new THREE.CanvasTexture(cvsW);
      }

      createTable() {
        const old = this.scene.getObjectByName("tableMesh"); if(old) this.scene.remove(old);
        const geo = new THREE.PlaneGeometry(150, 150);
        const mat = new THREE.MeshStandardMaterial({ map: this.tableTexture, roughness: 0.5, metalness: 0.1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = "tableMesh"; mesh.rotation.x = -Math.PI / 2; mesh.position.y = -2; mesh.receiveShadow = true;
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
        return this.specialMap.get(`${r}_${c}`) || { lines:[], color: this.activeTheme.boardField };
      }

      getTexture(lines: string[], color: string | null, isTile: boolean) {
        const id = isTile ? lines[0] : lines.join('_') + color + this.activeTheme.name;
        if (this.textureCache[id]) return this.textureCache[id];
        const size = 512; const cvs = document.createElement('canvas'); cvs.width = size; cvs.height = size;
        const ctx = cvs.getContext('2d')!;
        if (isTile) {
          const grd = ctx.createLinearGradient(0,0,size,size);
          if(this.activeTheme.name === 'Nordic Frost') { grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#f3f4f6'); }
          else if(this.activeTheme.name === 'Cyberpunk Neon') { grd.addColorStop(0, '#1e293b'); grd.addColorStop(1, '#0f172a'); }
          else { grd.addColorStop(0, '#fceabb'); grd.addColorStop(1, '#f8b500'); }
          ctx.fillStyle = grd; ctx.fillRect(0,0,size,size);
        } else {
          ctx.fillStyle = '#' + new THREE.Color(color!).getHexString(); ctx.fillRect(0,0,size,size);
          ctx.strokeStyle = "rgba(0,0,0,0.1)"; ctx.lineWidth = 10; ctx.strokeRect(0,0,size,size);
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        let tCol = (isTile || !this.activeTheme.isDark) ? '#111' : '#fff';
        if (this.activeTheme.name === 'Cyberpunk Neon' && isTile) tCol = '#00ffcc';
        if (isTile) {
          ctx.fillStyle = tCol; ctx.font = 'bold 280px "Segoe UI", sans-serif'; ctx.fillText(lines[0], size/2, size/2 - 25);
          ctx.font = 'bold 80px "Segoe UI", sans-serif'; ctx.fillText("1", size - 70, size - 70);
        } else if (lines.length > 0) {
          ctx.fillStyle = tCol; ctx.strokeStyle = this.activeTheme.isDark ? '#000' : '#fff'; ctx.lineWidth = 8;
          ctx.font = `900 70px "Arial Black", sans-serif`;
          lines.forEach((line, i) => { ctx.strokeText(line, size/2, 180 + i*120); ctx.fillText(line, size/2, 180 + i*120); });
        }
        const tex = new THREE.CanvasTexture(cvs); this.textureCache[id] = tex; return tex;
      }

      initBoard() {
        const old = this.scene.getObjectByName("boardGroup"); if(old) this.scene.remove(old);
        const group = new THREE.Group(); group.name = "boardGroup";
        const frame = new THREE.Mesh(new RoundedBoxGeometry(17.2, 1, 17.2, 4, 0.2), new THREE.MeshPhysicalMaterial({ map: this.woodTexture, color: this.activeTheme.frameColor, roughness: 0.5, clearcoat: 0.3 }));
        frame.position.y = -0.55; frame.receiveShadow = true; group.add(frame);
        for(let r=0; r<15; r++) {
          for(let c=0; c<15; c++) {
            const info = this.getCellInfo(r, c); const tex = this.getTexture(info.lines, info.color, false);
            const matTop = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.8 });
            const cell = new THREE.Mesh(new RoundedBoxGeometry(0.96, 0.1, 0.96, 2, 0.05), [matTop, matTop, matTop, matTop, matTop, matTop]);
            cell.position.set((c-7)*1.05, 0.05, (r-7)*1.05); cell.userData = { isSlot: true, r, c }; group.add(cell);
          }
        }
        this.scene.add(group);
      }

      createTileMesh(char: string) {
        const tex = this.getTexture([char], null, true);
        const matTop = new THREE.MeshPhysicalMaterial({ map: tex, color: 0xffffff, roughness: 0.2, clearcoat: 1.0 });
        const mesh = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.25, 0.95, 4, 0.08), [matTop, matTop, matTop, matTop, matTop, matTop]);
        mesh.castShadow = true; mesh.userData = { isTile: true, char }; return mesh;
      }

      fillRack() {
        while(this.state.rack.length < 7) {
          const char = HUNGARIAN_LETTERS[Math.floor(Math.random()*HUNGARIAN_LETTERS.length)];
          const tile = this.createTileMesh(char); tile.position.set(20, 8, 15);
          this.scene.add(tile); this.state.rack.push(tile);
        }
        this.arrangeRack();
      }

      arrangeRack() {
        this.state.rack.forEach((t, i) => {
          if(t.userData.isPlaced) return;
          gsap.to(t.position, { x: (i - 3) * 1.1, y: 1.2, z: 10.5, duration: 0.6 });
          gsap.to(t.rotation, { x: Math.PI / 3, y: 0, z: 0, duration: 0.6 });
        });
      }

      addEvents() {
        const el = this.renderer.domElement;
        el.addEventListener('mousedown', (e: any) => {
          if(!this.state.isMyTurn) return;
          const rect = el.getBoundingClientRect();
          this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          this.raycaster.setFromCamera(this.mouse, this.camera);
          const hits = this.raycaster.intersectObjects(this.scene.children, true);
          const tileHit = hits.find((h: any) => h.object.userData.isTile);
          if(tileHit) { 
            this.dragging = tileHit.object; this.controls.enabled = false; 
            gsap.to(this.dragging.position, { y: 3, duration: 0.2 });
            gsap.to(this.dragging.rotation, { x: 0, duration: 0.2 });
          }
        });
        window.addEventListener('mousemove', (e) => {
          if(!this.dragging) return;
          const rect = el.getBoundingClientRect();
          this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          this.raycaster.setFromCamera(this.mouse, this.camera);
          const pos = new THREE.Vector3(); this.raycaster.ray.intersectPlane(this.dragPlane, pos);
          if(pos) this.dragging.position.copy(pos);
        });
        window.addEventListener('mouseup', () => {
          if(!this.dragging) return;
          const gx = Math.round(this.dragging.position.x/1.05); const gz = Math.round(this.dragging.position.z/1.05);
          if(Math.abs(gx)<=7 && Math.abs(gz)<=7 && !this.state.boardGrid[gz+7][gx+7]) {
            const r = gz+7, c = gx+7;
            gsap.to(this.dragging.position, { x: gx*1.05, y: 0.18, z: gz*1.05, duration: 0.3 });
            this.state.placedThisTurn.push({ tile: this.dragging, r, c, char: this.dragging.userData.char });
            this.state.rack = this.state.rack.filter(t => t !== this.dragging);
            this.dragging.userData.isPlaced = true;
          } else { this.arrangeRack(); }
          this.dragging = null; this.controls.enabled = true;
        });
      }

      animate = () => { requestAnimationFrame(this.animate); this.controls.update(); this.renderer.render(this.scene, this.camera); }
      
      validateTurn() {
        if(this.state.placedThisTurn.length === 0) return { success: false, msg: "Nincs betű!" };
        const word = this.state.placedThisTurn.map((p: any) => p.char).join('');
        return { success: true, mainWord: word, placed: [...this.state.placedThisTurn] };
      }
      
      finalizeTurn() {
        this.state.placedThisTurn.forEach(p => { this.state.boardGrid[p.r][p.c] = p.tile; });
        this.state.placedThisTurn = [];
      }

      recall() {
        this.state.placedThisTurn.forEach(p => { p.tile.userData.isPlaced = false; this.state.rack.push(p.tile); });
        this.state.placedThisTurn = []; this.arrangeRack();
      }
    }

    gameRef.current = new Game(containerRef.current);
    return () => gameRef.current.renderer.dispose();
  }, []);

  // --- LERAKÁS LOGIKA ---
  const handleValidate = async () => {
    if(!gameRef.current || validating) return;
    setValidating(true);
    const res = gameRef.current.validateTurn();
    if(!res.success) { showToast(res.msg, true); setValidating(false); return; }

    const exists = await checkHungarianWordAPI(res.mainWord);
    if(exists) { completeTurn(res.mainWord, res.placed); }
    else {
      setPopupData({
        word: res.mainWord,
        onAccept: () => { completeTurn(res.mainWord, res.placed); setPopupData(null); },
        onReject: () => { setValidating(false); setPopupData(null); }
      });
    }
  };

  const completeTurn = async (word: string, placed: any[]) => {
    const pts = word.length * 10;
    gameRef.current.finalizeTurn();
    const nextIdx = (currentPlayer + 1) % config.playerNames.length;
    const newPlayers = config.playerNames.map((n, i) => ({
      name: n, score: i === currentPlayer ? (scores[i] || 0) + pts : (scores[i] || 0)
    }));
    await update(ref(db, `rooms/${roomId}`), { currentTurn: nextIdx, players: newPlayers });
    showToast(`Szuper! +${pts}`, false);
    gameRef.current.fillRack(); setValidating(false);
  };

  return (
    <>
      <style jsx global>{`
        body { margin: 0; overflow: hidden; font-family: 'Inter', sans-serif; background: #000; }
        .glass-panel { background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 40px; box-shadow: 0 25px 50px rgba(0,0,0,0.5); color: white; width: 400px; }
        .modern-input { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 12px; color: white; font-weight: 600; margin: 10px 0; box-sizing: border-box; }
        .play-btn { width: 100%; padding: 16px; border-radius: 16px; border: none; background: linear-gradient(135deg, #eab308, #ca8a04); color: white; font-weight: 800; cursor: pointer; transition: 0.3s; margin-top: 10px; }
        .play-btn:hover { transform: scale(1.05); box-shadow: 0 0 20px rgba(234, 179, 8, 0.4); }
        .player-pill { padding: 10px 20px; border-radius: 50px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.1); color: white; margin: 0 10px; }
        .player-pill.active { border-color: #facc15; background: rgba(234, 179, 8, 0.2); }
      `}</style>

      <div ref={containerRef} style={{ position: 'fixed', inset: 0 }} />

      {/* UI RÉTEG */}
      <div style={{ position: 'relative', zIndex: 10, pointerEvents: 'none', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        
        {gameState === 'menu' && (
          <div style={{ pointerEvents: 'auto', marginTop: '15vh' }} className="glass-panel">
            <h1 style={{ textAlign: 'center', margin: '0 0 30px 0', background: 'linear-gradient(to right, #facc15, #f59e0b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>WORD MASTER</h1>
            <input className="modern-input" placeholder="NEVED" value={playerName} onChange={e => setPlayerName(e.target.value.toUpperCase())} />
            {!roomId ? (
              <>
                <button className="play-btn" onClick={createRoom}>ÚJ JÁTÉK LÉTREHOZÁSA</button>
                <div style={{ display: 'flex', gap: '10px', marginTop: '20px', alignItems: 'center' }}>
                  <input className="modern-input" style={{ margin: 0 }} placeholder="KÓD" value={roomCodeInput} onChange={e => setRoomCodeInput(e.target.value.toUpperCase())} maxLength={4} />
                  <button className="play-btn" style={{ margin: 0, width: 'auto' }} onClick={joinRoom}>OK</button>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <h2 style={{ color: '#facc15' }}>KÓD: {roomId}</h2>
                <div style={{ margin: '20px 0' }}>
                  {config.playerNames.map(n => <div key={n} style={{ padding: '5px' }}>• {n}</div>)}
                </div>
                {isHost && <button className="play-btn" onClick={startGameBtn}>INDÍTÁS ▶</button>}
              </div>
            )}
          </div>
        )}

        {gameState === 'playing' && (
          <>
            <div style={{ display: 'flex', padding: '20px', pointerEvents: 'auto' }}>
              {config.playerNames.map((n, i) => (
                <div key={n} className={`player-pill ${currentPlayer === i ? 'active' : ''}`}>
                  {n}: {scores[i] || 0}
                </div>
              ))}
            </div>

            <div style={{ position: 'absolute', bottom: 40, pointerEvents: 'auto', display: 'flex', gap: '20px' }}>
              {config.playerNames[currentPlayer] === playerName ? (
                <>
                  <button className="play-btn" style={{ width: 'auto', padding: '16px 40px' }} onClick={() => gameRef.current.recall()}>VISSZA</button>
                  <button className="play-btn" style={{ width: 'auto', padding: '16px 60px', background: 'linear-gradient(135deg, #10b981, #059669)' }} onClick={handleValidate}>LERAKÁS</button>
                </>
              ) : (
                <div style={{ background: 'rgba(239, 68, 68, 0.8)', padding: '15px 30px', borderRadius: '15px', color: 'white', fontWeight: 'bold' }}>
                  VÁRAKOZÁS: {config.playerNames[currentPlayer]}
                </div>
              )}
            </div>
          </>
        )}

        {popupData && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto' }}>
            <div className="glass-panel" style={{ textAlign: 'center' }}>
              <h2>ISMERETLEN SZÓ: {popupData.word}</h2>
              <p>Elfogadod?</p>
              <div style={{ display: 'flex', gap: '20px' }}>
                <button className="play-btn" style={{ background: '#444' }} onClick={popupData.onReject}>NEM</button>
                <button className="play-btn" onClick={popupData.onAccept}>IGEN</button>
              </div>
            </div>
          </div>
        )}

        {toastMsg.text && (
          <div style={{ position: 'fixed', top: 100, background: 'rgba(0,0,0,0.9)', color: '#fff', padding: '15px 40px', borderRadius: '50px', pointerEvents: 'auto', border: '1px solid #facc15' }}>
            {toastMsg.text}
          </div>
        )}

      </div>
    </>
  );
}