'use client';
import { db } from './firebase'; // Ez a te fájlod!
import { ref, set, onValue, get, update } from 'firebase/database'; // Ezek a Firebase parancsai
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import gsap from 'gsap';

// --- TÉMÁK (Kibővített, eltérő táblákkal) ---
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
// Globális szótár cache
const WORD_CACHE = new Set(["ALMA", "KÖRTE", "HÁZ", "LÓ", "KÉZ", "VÍZ", "TŰZ", "SZÓ", "JÁTÉK", "ASZTAL"]);

async function checkHungarianWordAPI(word) {
  const cleanWord = word.trim().toUpperCase();
  if (!cleanWord) return false;
  if (WORD_CACHE.has(cleanWord)) return true;
  try {
    const response = await fetch(`https://hu.wiktionary.org/w/api.php?action=query&titles=${encodeURIComponent(cleanWord.toLowerCase())}&format=json&origin=*`);
    const data = await response.json();
    const exists = Object.keys(data.query.pages)[0] !== "-1";
    if (exists) WORD_CACHE.add(cleanWord);
    return exists;
  } catch (error) { return false; } // API hiba esetén most FALSE, hogy feljöjjön az ablak
}

export default function WordMasterGame() {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  
  // UI State
  const [gameState, setGameState] = useState('menu');
  const [scores, setScores] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [toastMsg, setToastMsg] = useState({ text: '', type: '' });
  const [validating, setValidating] = useState(false);
  const [popupData, setPopupData] = useState(null);
  
  // --- ÚJ MULTIPLAYER VÁLTOZÓK IDE JÖNNEK ---
  const [roomId, setRoomId] = useState(''); 
  const [playerName, setPlayerName] = useState(''); 
  const [isHost, setIsHost] = useState(false); 
  const [roomCodeInput, setRoomCodeInput] = useState(''); 
  
  // Config
  const [config, setConfig] = useState({
    theme: 'luxus',
    boardType: 'normal',
    playerNames: ['Anna', 'Béla']
  });

  
  // --- 3D GAME ENGINE ---
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    class Game {
      scene; camera; renderer; controls; raycaster; mouse; dragPlane;
      dragging = null; selectedTile = null; textureCache = {};
      woodTexture = null; tableTexture = null;
      activeTheme = THEMES['luxus'];
      specialMap = new Map();
      
      state = {
        rack: [],
        boardGrid: Array(15).fill(null).map(() => Array(15).fill(null)),
        placedThisTurn: [],
        turnCount: 0
      };

      constructor(container) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 1, 100);
        this.camera.position.set(25, 15, 25); // Menu view

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

        // Init defaults
        this.updateThemeColors();
        this.loadTextures();
        this.initLights();
        this.createTable();
        this.generateBoardLayout('normal');
        this.initBoard();
        this.fillRack();
        this.addEvents();
        this.animate();
      }

      // Kívülről hívható konfig frissítés
      updateConfig(newConfig) {
          this.activeTheme = THEMES[newConfig.theme];
          this.updateThemeColors();
          this.loadTextures();
          this.createTable(); // Új asztal
          this.generateBoardLayout(newConfig.boardType);
          this.initBoard(); // Új tábla
      }

      updateThemeColors() {
        this.scene.background = new THREE.Color(this.activeTheme.bgBase);
        this.scene.fog = new THREE.Fog(this.activeTheme.fogColor, 20, 80);
      }

      transitionToGameView() {
        this.controls.autoRotate = false;
        this.controls.enabled = false;
        gsap.to(this.camera.position, {
            x: 0, y: 24, z: 16, duration: 2, ease: "power3.inOut",
            onUpdate: () => this.controls.update(),
            onComplete: () => {
                this.controls.enabled = true; this.controls.minDistance = 10; this.controls.maxDistance = 40;
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
        dirLight.shadow.mapSize.set(2048, 2048);
        this.scene.add(dirLight);
        this.camera.add(new THREE.PointLight(0xffffff, 0.4));
        this.scene.add(this.camera);
      }

      loadTextures() {
        // Asztal
        const cvs = document.createElement('canvas'); cvs.width = 1024; cvs.height = 1024;
        const ctx = cvs.getContext('2d');
        const grd = ctx.createRadialGradient(512, 512, 100, 512, 512, 900);
        grd.addColorStop(0, this.activeTheme.tableParams.color1); 
        grd.addColorStop(1, this.activeTheme.tableParams.color2); 
        ctx.fillStyle = grd; ctx.fillRect(0,0,1024,1024);
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        for(let i=0;i<1000;i++) ctx.fillRect(Math.random()*1024, Math.random()*1024, 2, 2);
        this.tableTexture = new THREE.CanvasTexture(cvs);
        
        // Keret
        const cvsW = document.createElement('canvas'); cvsW.width = 512; cvsW.height = 512;
        const ctxW = cvsW.getContext('2d');
        ctxW.fillStyle = this.activeTheme.woodColor; ctxW.fillRect(0,0,512,512);
        this.woodTexture = new THREE.CanvasTexture(cvsW);
      }

      createTable() {
        // Előző törlése
        const oldTable = this.scene.getObjectByName("tableMesh");
        if(oldTable) this.scene.remove(oldTable);

        const geo = new THREE.PlaneGeometry(150, 150);
        const mat = new THREE.MeshStandardMaterial({ map: this.tableTexture, roughness: 0.5, metalness: 0.1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = "tableMesh";
        mesh.rotation.x = -Math.PI / 2; mesh.position.y = -2; mesh.receiveShadow = true;
        this.scene.add(mesh);
      }

      generateBoardLayout(type) {
        this.specialMap.clear();
        this.specialMap.set('7_7', { lines:['★', 'START'], color: this.activeTheme.special.start });

        if (type === 'normal') {
            const setSym = (arr, val) => arr.forEach(p => this.specialMap.set(`${p[0]}_${p[1]}`, val));
            const tw = [[0,0], [0,7], [0,14], [7,0], [7,14], [14,0], [14,7], [14,14]];
            const dw = [[1,1], [2,2], [3,3], [4,4], [1,13], [2,12], [3,11], [4,10], [13,1], [12,2], [11,3], [10,4], [13,13], [12,12], [11,11], [10,10]];
            const tl = [[1,5], [1,9], [5,1], [5,5], [5,9], [5,13], [9,1], [9,5], [9,9], [9,13], [13,5], [13,9]];
            const dl = [[0,3], [0,11], [2,6], [2,8], [3,0], [3,7], [3,14], [6,2], [6,6], [6,8], [6,12], [7,3], [7,11], [8,2], [8,6], [8,8], [8,12], [11,0], [11,7], [11,14], [12,6], [12,8], [14,3], [14,11]];
            
            setSym(tw, { lines:['TRIPLA', 'SZÓ'], color: this.activeTheme.special.tw });
            setSym(dw, { lines:['DUPLA', 'SZÓ'], color: this.activeTheme.special.dw });
            setSym(tl, { lines:['TRIPLA', 'BETŰ'], color: this.activeTheme.special.tl });
            setSym(dl, { lines:['DUPLA', 'BETŰ'], color: this.activeTheme.special.dl });
        } else {
            // Random layout generálás
            for(let r=0; r<15; r++) {
                for(let c=0; c<15; c++) {
                    if (r===7 && c===7) continue;
                    const rand = Math.random();
                    if (rand < 0.05) this.specialMap.set(`${r}_${c}`, { lines:['TRIPLA', 'SZÓ'], color: this.activeTheme.special.tw });
                    else if (rand < 0.1) this.specialMap.set(`${r}_${c}`, { lines:['DUPLA', 'SZÓ'], color: this.activeTheme.special.dw });
                    else if (rand < 0.15) this.specialMap.set(`${r}_${c}`, { lines:['TRIPLA', 'BETŰ'], color: this.activeTheme.special.tl });
                    else if (rand < 0.2) this.specialMap.set(`${r}_${c}`, { lines:['DUPLA', 'BETŰ'], color: this.activeTheme.special.dl });
                }
            }
        }
      }

      getCellInfo(r, c) {
        const key = `${r}_${c}`;
        if (this.specialMap.has(key)) return this.specialMap.get(key);
        return { lines:[], color: this.activeTheme.boardField };
      }

      getTexture(lines, color, isTile) {
        const id = isTile ? lines[0] : lines.join('_') + color + this.activeTheme.name;
        if (this.textureCache[id]) return this.textureCache[id];

        const size = 512; const cvs = document.createElement('canvas'); cvs.width = size; cvs.height = size;
        const ctx = cvs.getContext('2d');

        if (isTile) {
            const grd = ctx.createLinearGradient(0,0,size,size);
            if(this.activeTheme.name === 'Nordic Frost') { grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#f3f4f6'); }
            else if(this.activeTheme.name === 'Cyberpunk Neon') { grd.addColorStop(0, '#1e293b'); grd.addColorStop(1, '#0f172a'); }
            else { grd.addColorStop(0, '#fceabb'); grd.addColorStop(1, '#f8b500'); }
            ctx.fillStyle = grd; ctx.fillRect(0,0,size,size);
        } else {
            const hex = '#' + new THREE.Color(color).getHexString();
            ctx.fillStyle = hex; ctx.fillRect(0,0,size,size);
            ctx.strokeStyle = "rgba(0,0,0,0.1)"; ctx.lineWidth = 10; ctx.strokeRect(0,0,size,size);
        }

        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        let textColor, strokeColor;
        
        if (isTile) {
            textColor = this.activeTheme.name === 'Cyberpunk Neon' ? '#00ffcc' : '#111';
            strokeColor = 'transparent';
        } else {
            if (this.activeTheme.isDark) { textColor = '#ffffff'; strokeColor = '#000000'; }
            else { textColor = '#1f2937'; strokeColor = '#ffffff'; }
        }

        if (isTile) {
            ctx.fillStyle = textColor; ctx.font = 'bold 280px "Segoe UI", sans-serif';
            ctx.fillText(lines[0], size/2, size/2 - 25);
            ctx.font = 'bold 80px "Segoe UI", sans-serif'; ctx.fillText("1", size - 70, size - 70);
        } else if (lines.length > 0) {
            ctx.fillStyle = textColor; ctx.strokeStyle = strokeColor; ctx.lineWidth = 8;
            let fontSize = 70;
            const longest = lines.reduce((a, b) => a.length > b.length ? a : b, "");
            if (longest.length > 8) fontSize = 55;
            ctx.font = `900 ${fontSize}px "Arial Black", sans-serif`;
            const lh = fontSize * 1.1;
            let startY = (size - (lines.length * lh)) / 2 + lh/2;
            lines.forEach((line, i) => {
                const y = startY + i * lh; ctx.strokeText(line, size/2, y); ctx.fillText(line, size/2, y);
            });
        }
        const tex = new THREE.CanvasTexture(cvs);
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        this.textureCache[id] = tex;
        return tex;
      }

      initBoard() {
        const oldGroup = this.scene.getObjectByName("boardGroup");
        if(oldGroup) this.scene.remove(oldGroup);

        const group = new THREE.Group();
        group.name = "boardGroup";

        const frameGeo = new RoundedBoxGeometry(17.2, 1.0, 17.2, 4, 0.2);
        const frameMat = new THREE.MeshPhysicalMaterial({ map: this.woodTexture, color: this.activeTheme.frameColor, roughness: 0.5, clearcoat: 0.3 });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.y = -0.55; frame.receiveShadow = true; group.add(frame);

        const cellGeo = new RoundedBoxGeometry(0.96, 0.1, 0.96, 2, 0.05);
        for(let r=0; r<15; r++) {
            for(let c=0; c<15; c++) {
                const info = this.getCellInfo(r, c);
                const tex = this.getTexture(info.lines, info.color, false);
                const matBody = new THREE.MeshPhysicalMaterial({ color: info.color, roughness: 0.8 });
                const matTop = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.8, clearcoat: 0 });
                const cell = new THREE.Mesh(cellGeo, [matBody, matBody, matTop, matBody, matBody, matBody]);
                cell.position.set((c-7)*1.05, 0.05, (r-7)*1.05);
                cell.receiveShadow = true; cell.userData = { isSlot: true, r, c };
                group.add(cell);
            }
        }
        this.scene.add(group);
      }

      createTileMesh(char) {
        const geo = new RoundedBoxGeometry(0.95, 0.25, 0.95, 4, 0.08);
        const tex = this.getTexture([char], null, true);
        const matBody = new THREE.MeshPhysicalMaterial({ color: 0xccaa88, roughness: 0.4 });
        const matTop = new THREE.MeshPhysicalMaterial({ map: tex, color: 0xffffff, roughness: 0.2, clearcoat: 1.0 });
        const mesh = new THREE.Mesh(geo, [matBody, matBody, matTop, matBody, matBody, matBody]);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData = { isTile: true, char: char };
        return mesh;
      }
      
      fillRack() {
        const needed = 7 - this.state.rack.length;
        if(needed <= 0) return;
        for(let i=0; i<needed; i++) {
            const char = HUNGARIAN_LETTERS[Math.floor(Math.random() * HUNGARIAN_LETTERS.length)];
            const tile = this.createTileMesh(char);
            tile.position.set((Math.random()>0.5?20:-20), 8, 15);
            this.scene.add(tile);
            this.state.rack.push(tile);
            tile.userData.isPlaced = false;
        }
        this.arrangeRack();
      }

      arrangeRack() {
        this.state.rack.forEach((tile, i) => {
            if(tile.userData.isPlaced) return;
            const x = (i - (this.state.rack.length-1)/2) * 1.1;
            const targetPos = new THREE.Vector3(x, 1.2, 10.5);
            if(!this.dragging && tile !== this.selectedTile) {
                gsap.to(tile.position, { x: targetPos.x, y: targetPos.y, z: targetPos.z, duration: 0.6 });
                gsap.to(tile.rotation, { x: Math.PI / 3, y: 0, z: 0, duration: 0.6 });
            }
            tile.userData.homePos = targetPos;
        });
      }

      addEvents() {
        const el = this.renderer.domElement;
        el.addEventListener('mousedown', this.onDown);
        el.addEventListener('mousemove', this.onMove);
        el.addEventListener('mouseup', this.onUp);
        window.addEventListener('resize', this.onResize);
      }

      onDown = (e) => {
        const x = (e.clientX/window.innerWidth)*2-1; const y = -(e.clientY/window.innerHeight)*2+1;
        this.mouse.set(x,y); this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObjects(this.scene.children, true);
        
        const hitTile = hits.find(i=>i.object.userData.isTile);
        if(hitTile) {
            const t = hitTile.object;
            const fixed = this.state.boardGrid.some(r=>r.includes(t)) && !this.state.placedThisTurn.some(p=>p.tile===t);
            if(!fixed) {
                if(this.selectedTile && this.selectedTile !== t && !this.selectedTile.userData.isPlaced) gsap.to(this.selectedTile.position, {y:1.2, duration:0.2}); 
                this.dragging = t; this.selectedTile = t; this.controls.enabled = false;
                gsap.to(t.position, {y:3, duration:0.2}); gsap.to(t.rotation, {x:0, z:0, duration:0.2});
            }
            return;
        }
        const hitSlot = hits.find(i=>i.object.userData.isSlot);
        if(hitSlot && this.selectedTile) {
            const r = hitSlot.object.userData.r; const c = hitSlot.object.userData.c;
            this.placeTileToGrid(this.selectedTile, r, c);
            this.selectedTile = null;
        }
        if(!hitTile && !hitSlot && this.selectedTile) {
            this.returnToRack(this.selectedTile); this.selectedTile = null;
        }
      }

      onMove = (e) => {
        if(!this.dragging) return;
        const x = (e.clientX/window.innerWidth)*2-1; const y = -(e.clientY/window.innerHeight)*2+1;
        this.mouse.set(x,y); this.raycaster.setFromCamera(this.mouse, this.camera);
        const target = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this.dragPlane, target);
        if(target) this.dragging.position.copy(target);
      }

      onUp = () => {
        if(!this.dragging) return;
        const gx = Math.round(this.dragging.position.x/1.05); const gz = Math.round(this.dragging.position.z/1.05);
        if(Math.abs(gx)<=7 && Math.abs(gz)<=7) {
            this.placeTileToGrid(this.dragging, gz+7, gx+7);
            this.selectedTile = null;
        }
        this.dragging=null; this.controls.enabled=true;
      }

      placeTileToGrid(tile, r, c) {
        const fixed = this.state.boardGrid[r][c]!==null;
        const current = this.state.placedThisTurn.some(p=>p.r===r && p.c===c && p.tile!==tile);
        if(!fixed && !current) {
            gsap.to(tile.position, {x:(c-7)*1.05, y:0.18, z:(r-7)*1.05, duration:0.4, ease:"back.out(1.5)"});
            const idx = this.state.rack.indexOf(tile); if(idx>-1) this.state.rack.splice(idx,1);
            this.state.placedThisTurn = this.state.placedThisTurn.filter(p=>p.tile!==tile);
            this.state.placedThisTurn.push({tile, r, c, char:tile.userData.char});
            tile.userData.isPlaced = true;
        } else this.returnToRack(tile);
      }

      returnToRack(tile) {
        if(!this.state.rack.includes(tile)) this.state.rack.push(tile);
        this.state.placedThisTurn = this.state.placedThisTurn.filter(p=>p.tile!==tile);
        tile.userData.isPlaced=false; this.arrangeRack();
      }

      // --- JAVÍTOTT SZÓ ÉRTELMEZÉS (Fentről lefelé mindig!) ---
      async validateTurn() {
        const placed = this.state.placedThisTurn;
        if (placed.length === 0) return { success: false, msg: "Nincs lerakott betű!" };

        const rows = new Set(placed.map(p => p.r));
        const cols = new Set(placed.map(p => p.c));
        const isHoriz = rows.size === 1;
        const isVert = cols.size === 1;
        if (!isHoriz && !isVert) return { success: false, msg: "Csak egy vonalban!" };

        let mainWord = "";
        let collectedTiles = [];

        if (isHoriz) {
            const r = placed[0].r;
            placed.sort((a,b) => a.c - b.c); // Mindig balról jobbra!
            let startC = placed[0].c;
            while(startC > 0 && this.state.boardGrid[r][startC - 1] !== null) startC--;
            let endC = placed[placed.length-1].c;
            while(endC < 14 && this.state.boardGrid[r][endC + 1] !== null) endC++;

            for(let c = startC; c <= endC; c++) {
                const pTile = placed.find(p => p.c === c);
                if (pTile) { mainWord += pTile.char; collectedTiles.push(pTile); }
                else {
                    const bTile = this.state.boardGrid[r][c];
                    if (bTile) mainWord += bTile.userData.char;
                    else return { success: false, msg: "Lyukas szó!" };
                }
            }
        } else { 
            const c = placed[0].c;
            placed.sort((a,b) => a.r - b.r); // Mindig FENTRŐL LEFELÉ!
            let startR = placed[0].r;
            while(startR > 0 && this.state.boardGrid[startR - 1][c] !== null) startR--;
            let endR = placed[placed.length-1].r;
            while(endR < 14 && this.state.boardGrid[endR + 1][c] !== null) endR++;

            for(let r = startR; r <= endR; r++) {
                const pTile = placed.find(p => p.r === r);
                if (pTile) { mainWord += pTile.char; collectedTiles.push(pTile); }
                else {
                    const bTile = this.state.boardGrid[r][c];
                    if (bTile) mainWord += bTile.userData.char;
                    else return { success: false, msg: "Lyukas szó!" };
                }
            }
        }

        // Külső hívással kezeljük az eredményt
        return { mainWord, placed };
      }

      // Véglegesítés logikája
      finalizeTurn(placed, points) {
        placed.forEach(p => {
            this.state.boardGrid[p.r][p.c] = p.tile;
            const glow = new THREE.PointLight(0x00ff00, 2, 3);
            glow.position.copy(p.tile.position); glow.position.y=1;
            this.scene.add(glow);
            gsap.to(glow, {intensity:0, duration:1.5, onComplete:()=>this.scene.remove(glow)});
        });
        this.state.placedThisTurn = []; this.state.turnCount++;
        return points;
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
        this.renderer.dispose();
      }
      onResize = () => {
          this.camera.aspect = window.innerWidth / window.innerHeight;
          this.camera.updateProjectionMatrix();
          this.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    }

    const gameInstance = new Game(containerRef.current);
    gameRef.current = gameInstance;
    return () => gameInstance.dispose();
  }, []);

  // --- VALIDATION HANDLER (Popup logikával) ---
  const handleValidate = async () => {
    if(!gameRef.current || validating) return;
    setValidating(true);
    
    // 1. Megkapjuk a szót és a betűket a Game classból
    const check = await gameRef.current.validateTurn();
    
    if(check.success === false) { // Hiba (pl. lyukas szó)
        showToast(check.msg, true);
        setValidating(false);
        return;
    }

    const { mainWord, placed } = check;

    // 2. API Ellenőrzés
    const exists = await checkHungarianWordAPI(mainWord);

    if (exists) {
        completeTurn(mainWord, placed);
    } else {
        // 3. POPUP MEGJELENÍTÉSE
        setPopupData({
            word: mainWord,
            onAccept: () => {
                WORD_CACHE.add(mainWord); // Tanulás
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

  const completeTurn = (word, placed) => {
    const points = word.length * 10; // Egyszerű pontozás
    gameRef.current.finalizeTurn(placed, points);
    
    showToast(`✓ ${word} (+${points})`, false);
    setScores(prev => { 
        const next = [...prev]; 
        next[currentPlayer] += points; 
        return next; 
    });
    setCurrentPlayer(prev => (prev + 1) % scores.length);
    setTimeout(() => { gameRef.current.fillRack(); setValidating(false); }, 800);
  };

  return (
    <>
      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;900&display=swap');
        .app-container { font-family: 'Inter', sans-serif; position: fixed; inset: 0; pointer-events: none; z-index: 10; }
        
        /* 3D POPUP */
        .popup-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            display: flex; align-items: center; justify-content: center; pointer-events: auto; z-index: 100;
        }
        .popup-box {
            background: linear-gradient(145deg, #1e1e1e, #2a2a2a);
            border: 2px solid #ffcc00; padding: 40px; border-radius: 20px;
            text-align: center; color: white; box-shadow: 0 0 50px rgba(255, 204, 0, 0.3);
            transform: perspective(1000px) rotateX(10deg);
            animation: popupAnim 0.4s ease-out forwards;
        }
        @keyframes popupAnim { from { opacity:0; transform: perspective(1000px) rotateX(40deg) translateY(50px); } to { opacity:1; transform: perspective(1000px) rotateX(0) translateY(0); } }
        
        .glass-panel {
            pointer-events: auto; background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 40px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); color: white; width: 400px;
        }
        .menu-title { font-size: 48px; font-weight: 900; text-align: center; margin-bottom: 30px; background: linear-gradient(to right, #facc15, #f59e0b); -webkit-background-clip: text; color: transparent; text-shadow: 0 5px 15px rgba(0,0,0,0.3); }
        .modern-btn { padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: white; cursor: pointer; transition: all 0.2s; font-weight: 600; }
        .modern-btn:hover { background: rgba(255,255,255,0.1); transform: translateY(-2px); }
        .modern-btn.active { background: white; color: black; border-color: white; }
        .play-btn { width: 100%; margin-top: 20px; padding: 16px; border-radius: 16px; border: none; background: linear-gradient(135deg, #eab308, #ca8a04); color: white; font-size: 18px; font-weight: 800; cursor: pointer; transition: all 0.3s; }
        .play-btn:hover { transform: scale(1.05); box-shadow: 0 0 30px rgba(234, 179, 8, 0.4); }
        .game-header { display: flex; justify-content: space-between; padding: 30px; width: 100%; box-sizing: border-box; }
        .player-pill { background: rgba(0,0,0,0.6); backdrop-filter: blur(10px); padding: 10px 25px; border-radius: 50px; border: 1px solid rgba(255,255,255,0.1); color: white; text-align: center; transition: all 0.3s; }
        .player-pill.active { background: rgba(234, 179, 8, 0.8); border-color: #fde047; transform: scale(1.1); box-shadow: 0 0 20px rgba(234, 179, 8,0.4); }
        .bottom-bar { position: absolute; bottom: 40px; width: 100%; display: flex; justify-content: center; gap: 15px; pointer-events: none; }
        .action-btn { pointer-events: auto; padding: 14px 28px; border-radius: 14px; border: none; font-weight: 700; cursor: pointer; backdrop-filter: blur(10px); transition: all 0.2s; display: flex; align-items: center; gap: 8px; box-shadow: 0 10px 20px rgba(0,0,0,0.2); }
        .action-btn:hover { transform: translateY(-3px); }
        .btn-glass { background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); }
        .btn-primary { background: #10b981; color: white; }
        .toast { position: absolute; top: 100px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: white; padding: 12px 30px; border-radius: 50px; font-weight: 600; opacity: 0; transition: opacity 0.3s; }
        .toast.show { opacity: 1; }
        .input-group { margin-bottom: 20px; }
        .input-label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.7; margin-bottom: 10px; }
        .option-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .option-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        .glass-btn { padding: 8px 16px; border-radius: 8px; background: rgba(255,255,255,0.1); color: white; border: none; cursor: pointer; font-weight: bold; transition: all 0.2s; }
        .glass-btn:hover { background: rgba(255,255,255,0.2); }
        .modern-input { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 12px; color: white; margin-bottom: 8px; font-weight: 600; }
      `}</style>
      
      <div ref={containerRef} style={{position:'fixed', inset:0, zIndex:-1}} />

      {/* POPUP ABLAK */}
      {popupData && (
        <div className="popup-overlay">
            <div className="popup-box">
                <h2 style={{margin:'0 0 10px 0', fontSize:'24px'}}>ISMERETLEN SZÓ</h2>
                <div style={{fontSize:'36px', fontWeight:'bold', color:'#ffcc00', marginBottom:'20px'}}>"{popupData.word}"</div>
                <p style={{marginBottom:'30px', opacity:0.8}}>Szeretnéd elfogadni és felvenni a szótárba?</p>
                <div style={{display:'flex', gap:'20px', justifyContent:'center'}}>
                    <button className="action-btn btn-glass" onClick={popupData.onReject} style={{background:'rgba(255,50,50,0.2)'}}>NEM</button>
                    <button className="action-btn btn-primary" onClick={popupData.onAccept}>IGEN, ELFOGADOM</button>
                </div>
            </div>
        </div>
      )}

      <div className="app-container">
        {gameState === 'menu' && (
            <div style={{height:'100%', display:'flex', alignItems:'center', justifyContent:'center'}}>
                <div className="glass-panel">
                    <div className="menu-title">ULTIMATE<br/>WORD MASTER</div>
                    
                    <div className="input-group">
                        <label className="input-label">Téma</label>
                        <div className="option-grid-3">
                            <button className={`modern-btn ${config.theme==='luxus'?'active':''}`} onClick={()=>setConfig({...config, theme:'luxus'})}>Luxus</button>
                            <button className={`modern-btn ${config.theme==='nordic'?'active':''}`} onClick={()=>setConfig({...config, theme:'nordic'})}>Nordic</button>
                            <button className={`modern-btn ${config.theme==='cyber'?'active':''}`} onClick={()=>setConfig({...config, theme:'cyber'})}>Cyber</button>
                        </div>
                    </div>

                    <div className="input-group">
                        <label className="input-label">Pálya</label>
                        <div className="option-grid">
                            <button className={`modern-btn ${config.boardType==='normal'?'active':''}`} onClick={()=>setConfig({...config, boardType:'normal'})}>Normál</button>
                            <button className={`modern-btn ${config.boardType==='random'?'active':''}`} onClick={()=>setConfig({...config, boardType:'random'})}>Bónuszözön</button>
                        </div>
                    </div>

                    <div className="input-group">
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
                             <label className="input-label" style={{margin:0}}>Játékosok</label>
                             <div style={{display:'flex', gap:'5px'}}>
                                <button className="glass-btn" onClick={removePlayer} disabled={config.playerNames.length<=2}>-</button>
                                <button className="glass-btn" onClick={addPlayer} disabled={config.playerNames.length>=4}>+</button>
                             </div>
                        </div>
                        {config.playerNames.map((name, i) => (
                            <input key={i} className="modern-input" value={name} onChange={(e)=>{
                                const n = [...config.playerNames]; n[i]=e.target.value; setConfig({...config, playerNames:n});
                            }} />
                        ))}
                    </div>

                    <button className="play-btn" onClick={startGame}>JÁTÉK INDÍTÁSA ▶</button>
                </div>
            </div>
        )}

        {gameState === 'playing' && (
            <>
                <div className="game-header">
                    {config.playerNames.map((name, i) => (
                        <div key={i} className={`player-pill ${currentPlayer===i?'active':''}`}>
                            <div style={{fontSize:'10px', opacity:0.7, textTransform:'uppercase'}}>{name}</div>
                            <div style={{fontSize:'24px', fontWeight:'800'}}>{scores[i]}</div>
                        </div>
                    ))}
                </div>

                <div className={`toast ${toastMsg.text?'show':''} ${toastMsg.type}`}>
                    {toastMsg.text}
                </div>

                <div className="bottom-bar">
                    <button className="action-btn btn-glass" onClick={backToMenu}>Menü</button>
                    <button className="action-btn btn-glass" onClick={()=>gameRef.current?.recall()}>Vissza</button>
                    <button className="action-btn btn-glass" onClick={()=>gameRef.current?.shuffle()}>Keverés</button>
                    <button className="action-btn btn-primary" onClick={handleValidate} disabled={validating}>
                        {validating ? '...' : 'LERAKÁS'}
                    </button>
                </div>
            </>
        )}
      </div>
    </>
  );
}