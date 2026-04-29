'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { db } from '../firebase';
import { ref, set, onValue, get, update } from 'firebase/database';
import gsap from 'gsap';

// ---------- TÉMÁK ----------
const THEMES: Record<string, any> = {
  luxus: {
    name: "Royal Mahogany", isDark: true,
    bgBase: 0x1a1a1a, fogColor: 0x1a1a1a,
    tableParams: { color1: '#4a2c20', color2: '#1a120b' },
    woodColor: '#5d4037', frameColor: 0xffffff, boardField: 0x1e5128,
    special: { tw: 0xb91c1c, dw: 0xc084fc, tl: 0x1d4ed8, dl: 0x60a5fa, start: 0xb91c1c }
  },
  nordic: {
    name: "Nordic Frost", isDark: false,
    bgBase: 0xd1d5db, fogColor: 0xd1d5db,
    tableParams: { color1: '#f3f4f6', color2: '#e5e7eb' },
    woodColor: '#d1d5db', frameColor: 0x9ca3af, boardField: 0xffffff,
    special: { tw: 0xfca5a5, dw: 0xfcd34d, tl: 0x93c5fd, dl: 0xc4b5fd, start: 0xfca5a5 }
  },
  cyber: {
    name: "Cyberpunk Neon", isDark: true,
    bgBase: 0x020617, fogColor: 0x020617,
    tableParams: { color1: '#0f172a', color2: '#000000' },
    woodColor: '#1e293b', frameColor: 0x334155, boardField: 0x0f172a,
    special: { tw: 0xff0055, dw: 0xaa00ff, tl: 0x00ccff, dl: 0x00ffaa, start: 0xff0055 }
  }
};

const HUNGARIAN_LETTERS = "AÁBCDEÉFGHIÍJKLMNOÓÖŐPRSTUÚÜŰVZ";
const WORD_CACHE = new Set(["ALMA","KÖRTE","HÁZ","LÓ","KÉZ","VÍZ","TŰZ","SZÓ","JÁTÉK","ASZTAL"]);

async function checkHungarianWordAPI(word: string) {
  const w = word.trim().toUpperCase();
  if (!w) return false;
  if (WORD_CACHE.has(w)) return true;
  try {
    const r = await fetch(`https://hu.wiktionary.org/w/api.php?action=query&titles=${encodeURIComponent(w.toLowerCase())}&format=json&origin=*`);
    const d = await r.json();
    const exists = Object.keys(d.query.pages)[0] !== "-1";
    if (exists) WORD_CACHE.add(w);
    return exists;
  } catch { return false; }
}

export default function WordMasterGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef      = useRef<any>(null);

  const gameStateRef  = useRef('menu');
  const roomIdRef     = useRef('');
  const playerNameRef = useRef('');

  const [gameState,      setGameState]      = useState('menu');
  const [scores,         setScores]         = useState<number[]>([]);
  const [currentPlayer,  setCurrentPlayer]  = useState(0);
  const [toastMsg,       setToastMsg]       = useState({ text:'', type:'' });
  const [validating,     setValidating]     = useState(false);
  const [popupData,      setPopupData]      = useState<any>(null);
  const [opponentMoving, setOpponentMoving] = useState(false);

  const [roomId,        setRoomId]        = useState('');
  const [playerName,    setPlayerName]    = useState('');
  const [isHost,        setIsHost]        = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [config,        setConfig]        = useState({ theme:'luxus', boardType:'normal', playerNames:[] as string[] });

  useEffect(() => { gameStateRef.current  = gameState;  }, [gameState]);
  useEffect(() => { roomIdRef.current     = roomId;     }, [roomId]);
  useEffect(() => { playerNameRef.current = playerName; }, [playerName]);

  const showToast = useCallback((msg: string, isError: boolean) => {
    setToastMsg({ text: msg, type: isError ? 'error' : 'success' });
    setTimeout(() => setToastMsg({ text:'', type:'' }), 3000);
  }, []);

  useEffect(() => {
    if (gameRef.current && config.playerNames.length > 0)
      gameRef.current.state.isMyTurn = config.playerNames[currentPlayer] === playerNameRef.current;
  }, [currentPlayer, config.playerNames]);

  // ---------- MULTIPLAYER ----------
  const createRoom = async () => {
    if (!playerName.trim()) return showToast('Kérlek add meg a neved!', true);
    const id = Math.random().toString(36).substring(2,6).toUpperCase();
    await set(ref(db, `rooms/${id}`), {
      status: 'lobby',
      config: { ...config, playerNames: [playerName] },
      players: [{ name: playerName, score: 0 }],
      currentTurn: 0, hostName: playerName,
      boardData: '[]', tempPlacements: '[]'
    });
    setRoomId(id); roomIdRef.current = id;
    setIsHost(true);
    listenToRoom(id, playerName);
  };

  const joinRoom = async () => {
    if (!playerName.trim()) return showToast('Kérlek add meg a neved!', true);
    if (roomCodeInput.length !== 4) return showToast('A kód 4 karakter!', true);
    const snap = await get(ref(db, `rooms/${roomCodeInput}`));
    if (!snap.exists()) return showToast('Nem létezik ilyen szoba!', true);
    const d = snap.val();
    if (d.status !== 'lobby') return showToast('A játék már elindult!', true);
    const players = d.players || [];
    if (players.length >= 4) return showToast('Tele a szoba!', true);
    await update(ref(db, `rooms/${roomCodeInput}`), { players:[...players,{name:playerName,score:0}] });
    setRoomId(roomCodeInput); roomIdRef.current = roomCodeInput;
    listenToRoom(roomCodeInput, playerName);
  };

  const listenToRoom = (id: string, myName: string) => {
    onValue(ref(db, `rooms/${id}`), snap => {
      const data = snap.val();
      if (!data) return;
      const players   = data.players || [];
      const names     = players.map((p: any) => p.name);
      const newScores = players.map((p: any) => p.score || 0);
      setConfig(prev => ({ ...prev, ...data.config, playerNames: names }));
      setScores(newScores);
      setCurrentPlayer(data.currentTurn || 0);

      if (data.boardData && gameRef.current) {
        const parsed = typeof data.boardData === 'string' ? JSON.parse(data.boardData) : data.boardData;
        gameRef.current.syncBoardFromFirebase(parsed);
      }
      if (data.tempPlacements && gameRef.current) {
        const parsed = typeof data.tempPlacements === 'string' ? JSON.parse(data.tempPlacements) : data.tempPlacements;
        const active  = names[data.currentTurn || 0];
        if (active !== myName) {
          gameRef.current.syncOpponentPlacements(parsed);
          setOpponentMoving(parsed.length > 0);
        } else {
          gameRef.current.syncOpponentPlacements([]);
          setOpponentMoving(false);
        }
      }
      if (data.status === 'playing' && gameStateRef.current !== 'playing') {
        setGameState('playing');
        gameStateRef.current = 'playing';
        setTimeout(() => {
          if (gameRef.current) {
            gameRef.current.updateConfig({ ...data.config, playerNames: names });
            gameRef.current.transitionToGameView();
          }
        }, 400);
      }
    });
  };

  const startMultiplayerGame = async () => {
    if (!roomId) return;
    await update(ref(db,`rooms/${roomId}`),{status:'playing'});
  };

  // ---------- 3D ENGINE ----------
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    class Game {
      scene!: THREE.Scene;
      camera!: THREE.PerspectiveCamera;
      renderer!: THREE.WebGLRenderer;
      controls!: OrbitControls;
      raycaster   = new THREE.Raycaster();
      mouse       = new THREE.Vector2();
      dragPlane   = new THREE.Plane(new THREE.Vector3(0,1,0), -0.4);

      activeTheme: any     = THEMES['luxus'];
      currentBoardType     = 'normal';
      specialMap           = new Map<string,any>();
      textureCache: Record<string,THREE.Texture> = {};
      woodTex!: THREE.Texture;
      tableTex!: THREE.Texture;

      // Interaction state
      dragging:     any = null;   // tile being dragged
      selectedTile: any = null;   // tap-selected tile
      hoveredSlot:  string|null = null; // grid key of cell under drag
      snapGhost:    any = null;
      opponentTempTiles: any[] = [];
      isDragging    = false;
      downPos       = { x:0, y:0 };

      onTempPlaceCallback!: (p: any[]) => void;

      state = {
        rack:           [] as any[],
        boardGrid:      Array(15).fill(null).map(() => Array(15).fill(null)) as (any|null)[][],
        placedThisTurn: [] as { tile:any; r:number; c:number }[],
        turnCount:      0,
        isMyTurn:       false,
      };

      constructor(container: HTMLElement) {
        this.scene  = new THREE.Scene();
        const mob   = window.innerWidth < 768;
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 1, 100);
        this.camera.position.set(25, mob?22:15, 25);

        this.renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.shadowMap.enabled = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping  = true;
        this.controls.autoRotate     = true;
        this.controls.maxPolarAngle  = Math.PI/2.1;

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

      // ----- THEME -----
      updateThemeColors() {
        this.scene.background = new THREE.Color(this.activeTheme.bgBase);
        this.scene.fog = new THREE.Fog(this.activeTheme.fogColor, 20, 80);
      }
      updateConfig(cfg: any) {
        const t = THEMES[cfg.theme] || THEMES['luxus'];
        if (this.activeTheme.name !== t.name || this.currentBoardType !== (cfg.boardType||'normal')) {
          this.activeTheme = t; this.currentBoardType = cfg.boardType||'normal';
          this.textureCache = {};
          this.updateThemeColors(); this.loadTextures(); this.createTable();
          this.generateBoardLayout(this.currentBoardType); this.initBoard();
          this.syncBoardFromFirebase(this.getBoardSnapshot());
        }
      }

      transitionToGameView() {
        const port = window.innerWidth < window.innerHeight;
        const mob  = window.innerWidth < 768;
        this.controls.autoRotate = false; this.controls.enabled = false;
        gsap.to(this.camera.position, {
          x:0, y: port?34 : mob?26:24, z: port?13 : mob?18:16,
          duration:2, ease:'power3.inOut',
          onUpdate: () => this.controls.update(),
          onComplete: () => {
            this.controls.enabled = true;
            this.controls.minDistance = 10;
            this.controls.maxDistance = 55;
          }
        });
      }
      transitionToMenuView() {
        this.controls.enabled = false;
        gsap.to(this.camera.position, {
          x:25, y:15, z:25, duration:2, ease:'power3.inOut',
          onComplete: () => { this.controls.enabled=true; this.controls.autoRotate=true; }
        });
      }

      initLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 1.5);
        dir.position.set(15,30,10); dir.castShadow = true; this.scene.add(dir);
        this.camera.add(new THREE.PointLight(0xffffff, 0.4)); this.scene.add(this.camera);
      }

      loadTextures() {
        const tc = document.createElement('canvas'); tc.width = tc.height = 1024;
        const tctx = tc.getContext('2d')!;
        const g = tctx.createRadialGradient(512,512,100,512,512,900);
        g.addColorStop(0, this.activeTheme.tableParams.color1);
        g.addColorStop(1, this.activeTheme.tableParams.color2);
        tctx.fillStyle = g; tctx.fillRect(0,0,1024,1024);
        this.tableTex = new THREE.CanvasTexture(tc);

        const wc = document.createElement('canvas'); wc.width = wc.height = 512;
        const wctx = wc.getContext('2d')!;
        wctx.fillStyle = this.activeTheme.woodColor; wctx.fillRect(0,0,512,512);
        this.woodTex = new THREE.CanvasTexture(wc);
      }

      createTable() {
        const old = this.scene.getObjectByName('tbl'); if (old) this.scene.remove(old);
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(150,150),
          new THREE.MeshStandardMaterial({ map:this.tableTex, roughness:0.5, metalness:0.1 })
        );
        m.name='tbl'; m.rotation.x=-Math.PI/2; m.position.y=-2; m.receiveShadow=true;
        this.scene.add(m);
      }

      generateBoardLayout(type: string) {
        this.specialMap.clear();
        this.specialMap.set('7_7',{lines:['★','START'],color:this.activeTheme.special.start});
        if (type==='normal') {
          const s = (arr:number[][],v:any) => arr.forEach(p=>this.specialMap.set(`${p[0]}_${p[1]}`,v));
          s([[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]],{lines:['TRIPLA','SZÓ'],color:this.activeTheme.special.tw});
          s([[1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],[13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10]],{lines:['DUPLA','SZÓ'],color:this.activeTheme.special.dw});
          s([[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]],{lines:['TRIPLA','BETŰ'],color:this.activeTheme.special.tl});
          s([[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]],{lines:['DUPLA','BETŰ'],color:this.activeTheme.special.dl});
        }
      }

      cellInfo(r:number,c:number) {
        return this.specialMap.get(`${r}_${c}`) ?? { lines:[], color:this.activeTheme.boardField };
      }

      getTex(lines:string[], color:string|null, isTile:boolean) {
        const id = isTile ? `t_${lines[0]}` : `c_${lines.join('')}_${color}_${this.activeTheme.name}`;
        if (this.textureCache[id]) return this.textureCache[id];
        const S=512, cv=document.createElement('canvas'); cv.width=cv.height=S;
        const cx=cv.getContext('2d')!;
        if (isTile) {
          cx.fillStyle='#fceabb'; cx.fillRect(0,0,S,S);
          cx.fillStyle='#1a0e00'; cx.textAlign='center'; cx.textBaseline='middle';
          cx.font='bold 270px Georgia'; cx.fillText(lines[0],S/2,S/2-18);
          cx.font='bold 78px Arial'; cx.fillStyle='rgba(0,0,0,0.4)';
          cx.fillText('1',S-68,S-62);
        } else {
          cx.fillStyle='#'+new THREE.Color(color!).getHexString(); cx.fillRect(0,0,S,S);
          cx.strokeStyle='rgba(0,0,0,0.12)'; cx.lineWidth=12; cx.strokeRect(0,0,S,S);
          if (lines.length) {
            cx.fillStyle=this.activeTheme.isDark?'#fff':'#111';
            cx.textAlign='center'; cx.textBaseline='middle';
            cx.font='900 60px Arial';
            lines.forEach((l,i)=>cx.fillText(l,S/2,210+i*84));
          }
        }
        return (this.textureCache[id]=new THREE.CanvasTexture(cv));
      }

      mkMats(lines:string[],color:string|null,isTile:boolean,alpha=1) {
        const top  = new THREE.MeshPhysicalMaterial({ map:this.getTex(lines,color,isTile), roughness:isTile?0.2:0.8, transparent:alpha<1, opacity:alpha });
        const body = new THREE.MeshPhysicalMaterial({ color:isTile?0xccaa88:(color?new THREE.Color(color):0x888888), transparent:alpha<1, opacity:alpha });
        return [body,body,top,body,body,body];
      }

      initBoard() {
        const old=this.scene.getObjectByName('bg'); if(old) this.scene.remove(old);
        const grp=new THREE.Group(); grp.name='bg';
        const frame=new THREE.Mesh(
          new RoundedBoxGeometry(17.2,1.0,17.2,4,0.2),
          new THREE.MeshPhysicalMaterial({map:this.woodTex,color:this.activeTheme.frameColor,roughness:0.5})
        );
        frame.position.y=-0.55; frame.receiveShadow=true; grp.add(frame);
        const geo=new RoundedBoxGeometry(0.96,0.1,0.96,2,0.05);
        for(let r=0;r<15;r++) for(let c=0;c<15;c++) {
          const info=this.cellInfo(r,c);
          const cell=new THREE.Mesh(geo,this.mkMats(info.lines,info.color,false));
          cell.position.set((c-7)*1.05,0.05,(r-7)*1.05);
          cell.userData={isSlot:true,r,c}; grp.add(cell);
        }
        this.scene.add(grp);
        for(let r=0;r<15;r++) for(let c=0;c<15;c++) {
          const t=this.state.boardGrid[r][c];
          if(t && !this.scene.children.includes(t)) this.scene.add(t);
        }
      }

      mkTile(char:string,alpha=1) {
        const geo=new RoundedBoxGeometry(0.95,0.25,0.95,4,0.08);
        const m=new THREE.Mesh(geo,this.mkMats([char],null,true,alpha));
        m.castShadow=alpha===1;
        m.userData={isTile:true,char,isPlaced:false,ghost:alpha<1};
        return m;
      }

      fillRack() {
        while(this.state.rack.length<7) {
          const ch=HUNGARIAN_LETTERS[Math.floor(Math.random()*HUNGARIAN_LETTERS.length)];
          const t=this.mkTile(ch); t.position.set(0,8,15);
          this.scene.add(t); this.state.rack.push(t);
        }
        this.arrangeRack();
      }

      arrangeRack() {
        const mob=window.innerWidth<600;
        const spc=mob?1.05:1.12, zPos=mob?10.2:10.5;
        this.state.rack.forEach((t,i)=>{
          if(t.userData.isPlaced) return;
          const x=(i-(this.state.rack.length-1)/2)*spc;
          if(t!==this.dragging && t!==this.selectedTile) {
            gsap.to(t.position,{x,y:1.2,z:zPos,duration:0.5,ease:'back.out(1.3)'});
            gsap.to(t.rotation,{x:Math.PI/3,y:0,z:0,duration:0.5});
          }
        });
      }

      // ----- SNAP GHOST -----
      showSnap(r:number,c:number) {
        const key=`${r}_${c}`;
        if(this.hoveredSlot===key) return;
        this.hideSnap();
        this.hoveredSlot=key;
        if(this.state.boardGrid[r][c]) return;
        const g=new THREE.Mesh(
          new RoundedBoxGeometry(0.95,0.14,0.95,4,0.04),
          new THREE.MeshPhysicalMaterial({color:0x00ff99,transparent:true,opacity:0.4,emissive:0x00ff99,emissiveIntensity:0.7})
        );
        g.position.set((c-7)*1.05,0.22,(r-7)*1.05); g.name='snapGhost';
        this.scene.add(g); this.snapGhost=g;
      }
      hideSnap() {
        if(this.snapGhost){this.scene.remove(this.snapGhost);this.snapGhost=null;}
        this.hoveredSlot=null;
      }

      // ----- SELECTION -----
      setSelected(tile:any|null) {
        if(this.selectedTile && this.selectedTile!==tile) {
          // deselect old: drop back if it was being held up
          if(!this.selectedTile.userData.isPlaced)
            gsap.to(this.selectedTile.position,{y:1.2,duration:0.2});
          this.selectedTile.material?.forEach?.((m:any)=>{if(m.emissive) m.emissive.setHex(0x000000);});
        }
        this.selectedTile=tile;
        if(tile) {
          tile.material?.forEach?.((m:any)=>{if(m.emissive) m.emissive.setHex(0xffcc00);});
        }
      }

      // ----- EVENTS -----
      addEvents() {
        const el=this.renderer.domElement;
        const pt=(e:any)=>e.touches?.length?e.touches[0]:e.changedTouches?.length?e.changedTouches[0]:e;
        const toMouse=(e:any)=>{
          const p=pt(e),rect=el.getBoundingClientRect();
          this.mouse.x= ((p.clientX-rect.left)/rect.width)*2-1;
          this.mouse.y=-((p.clientY-rect.top)/rect.height)*2+1;
          this.raycaster.setFromCamera(this.mouse,this.camera);
        };

        // ---- DOWN ----
        const onDown=(e:any)=>{
          if(!this.state.isMyTurn) return;
          const p=pt(e);
          this.downPos={x:p.clientX,y:p.clientY};
          this.isDragging=false;
          toMouse(e);
          const hits=this.raycaster.intersectObjects(this.scene.children,true);

          const hitTile=hits.find(h=>h.object.userData.isTile&&!h.object.userData.ghost);
          if(hitTile) {
            const t=hitTile.object;
            const confirmed=this.state.boardGrid.some(row=>row.includes(t))
              &&!this.state.placedThisTurn.some(pp=>pp.tile===t);
            if(confirmed) return;
            if(e.cancelable) e.preventDefault();

            // If same tile tapped again → deselect it back to rack
            if(this.selectedTile===t && t.userData.isPlaced) {
              // pick it back (it was placed this turn)
              this.returnToRack(t); this.setSelected(null);
              return;
            }

            this.dragging=t; this.controls.enabled=false;
            this.setSelected(t);
            gsap.to(t.position,{y:3.0,duration:0.12});
            gsap.to(t.rotation,{x:0,z:0,duration:0.12});
            return;
          }

          // Board slot tap while tile is selected → place
          const hitSlot=hits.find(h=>h.object.userData.isSlot);
          if(hitSlot&&this.selectedTile&&!this.dragging) {
            if(e.cancelable) e.preventDefault();
            const {r,c}=hitSlot.object.userData;
            this.placeTile(this.selectedTile,r,c);
            this.setSelected(null);
            return;
          }

          // Tap empty space → deselect
          if(!hitTile&&!hitSlot&&this.selectedTile&&!this.selectedTile.userData.isPlaced) {
            this.setSelected(null);
          }
        };

        // ---- MOVE ----
        const onMove=(e:any)=>{
          if(!this.dragging||!this.state.isMyTurn) return;
          if(e.cancelable) e.preventDefault();
          const p=pt(e);
          const dx=p.clientX-this.downPos.x, dy=p.clientY-this.downPos.y;
          if(!this.isDragging && Math.sqrt(dx*dx+dy*dy)>10) this.isDragging=true;
          if(!this.isDragging) return;

          toMouse(e);
          const tgt=new THREE.Vector3();
          this.raycaster.ray.intersectPlane(this.dragPlane,tgt);
          if(!tgt) return;
          this.dragging.position.x=tgt.x;
          this.dragging.position.z=tgt.z;
          this.dragging.position.y=3.2;

          const gc=Math.round(tgt.x/1.05), gr=Math.round(tgt.z/1.05);
          if(Math.abs(gc)<=7&&Math.abs(gr)<=7) this.showSnap(gr+7,gc+7);
          else this.hideSnap();
        };

        // ---- UP ----
        const onUp=()=>{
          if(!this.dragging||!this.state.isMyTurn) return;
          const t=this.dragging; this.dragging=null;

          if(this.isDragging) {
            this.isDragging=false; this.hideSnap();
            const gx=Math.round(t.position.x/1.05), gz=Math.round(t.position.z/1.05);
            if(Math.abs(gx)<=7&&Math.abs(gz)<=7) {
              this.placeTile(t,gz+7,gx+7); this.setSelected(null);
            } else {
              this.returnToRack(t); this.setSelected(null);
            }
            this.controls.enabled=true;
          } else {
            // Short tap (no significant move) → keep selectedTile for tap-to-place
            // Don't re-enable controls yet so board tap can fire
            this.controls.enabled=true;
          }
        };

        el.addEventListener('mousedown',onDown);
        el.addEventListener('mousemove',onMove);
        window.addEventListener('mouseup',onUp);
        el.addEventListener('touchstart',onDown,{passive:false});
        el.addEventListener('touchmove', onMove,{passive:false});
        window.addEventListener('touchend',onUp);
        window.addEventListener('resize',this.onResize);
      }

      // ----- PLACE TILE -----
      placeTile(tile:any,r:number,c:number) {
        if(this.state.boardGrid[r][c]){this.returnToRack(tile);return;}
        if(this.state.placedThisTurn.some(p=>p.r===r&&p.c===c&&p.tile!==tile)){this.returnToRack(tile);return;}
        const idx=this.state.rack.indexOf(tile); if(idx>-1) this.state.rack.splice(idx,1);
        this.state.placedThisTurn=this.state.placedThisTurn.filter(p=>p.tile!==tile);
        this.state.placedThisTurn.push({tile,r,c});
        tile.userData.isPlaced=true;
        tile.material?.forEach?.((m:any)=>{if(m.emissive) m.emissive.setHex(0x000000);});
        gsap.to(tile.position,{x:(c-7)*1.05,y:0.32,z:(r-7)*1.05,duration:0.28,ease:'back.out(1.5)'});
        gsap.to(tile.rotation,{x:0,y:0,z:0,duration:0.28});
        const pl=new THREE.PointLight(0x00ff88,3,2.5);
        pl.position.set((c-7)*1.05,1,(r-7)*1.05); this.scene.add(pl);
        gsap.to(pl,{intensity:0,duration:0.9,onComplete:()=>this.scene.remove(pl)});
        this.triggerTempSync();
      }

      returnToRack(tile:any) {
        if(!this.state.rack.includes(tile)) this.state.rack.push(tile);
        this.state.placedThisTurn=this.state.placedThisTurn.filter(p=>p.tile!==tile);
        tile.userData.isPlaced=false;
        tile.material?.forEach?.((m:any)=>{if(m.emissive) m.emissive.setHex(0x000000);});
        this.arrangeRack();
        this.triggerTempSync();
      }

      triggerTempSync() {
        if(this.onTempPlaceCallback)
          this.onTempPlaceCallback(this.state.placedThisTurn.map(p=>({r:p.r,c:p.c,char:p.tile.userData.char})));
      }

      syncOpponentPlacements(placements:any[]) {
        this.opponentTempTiles.forEach(t=>this.scene.remove(t));
        this.opponentTempTiles=[];
        if(this.state.isMyTurn) return;
        placements.forEach(p=>{
          if(this.state.boardGrid[p.r]?.[p.c]) return;
          const m=this.mkTile(p.char,0.45);
          m.position.set((p.c-7)*1.05,0.32,(p.r-7)*1.05); this.scene.add(m);
          this.opponentTempTiles.push(m);
        });
      }

      async validateTurn():Promise<{success:false;msg:string}|{mainWord:string;placed:any[]}> {
        const placed=this.state.placedThisTurn;
        if(!placed.length) return {success:false,msg:'Nincs lerakott betű!'};
        const rows=new Set(placed.map(p=>p.r)),cols=new Set(placed.map(p=>p.c));
        if(rows.size>1&&cols.size>1) return {success:false,msg:'Csak egy vonalban!'};
        let word='';
        if(rows.size===1) {
          const r=placed[0].r; placed.sort((a,b)=>a.c-b.c);
          let sc=placed[0].c; while(sc>0&&this.state.boardGrid[r][sc-1]) sc--;
          let ec=placed[placed.length-1].c; while(ec<14&&this.state.boardGrid[r][ec+1]) ec++;
          for(let c=sc;c<=ec;c++){
            const p=placed.find(x=>x.c===c);
            if(p) word+=p.tile.userData.char;
            else if(this.state.boardGrid[r][c]) word+=this.state.boardGrid[r][c].userData.char;
            else return {success:false,msg:'Lyukas szó!'};
          }
        } else {
          const c=placed[0].c; placed.sort((a,b)=>a.r-b.r);
          let sr=placed[0].r; while(sr>0&&this.state.boardGrid[sr-1]?.[c]) sr--;
          let er=placed[placed.length-1].r; while(er<14&&this.state.boardGrid[er+1]?.[c]) er++;
          for(let r=sr;r<=er;r++){
            const p=placed.find(x=>x.r===r);
            if(p) word+=p.tile.userData.char;
            else if(this.state.boardGrid[r][c]) word+=this.state.boardGrid[r][c].userData.char;
            else return {success:false,msg:'Lyukas szó!'};
          }
        }
        return {mainWord:word,placed};
      }

      finalizeTurn(placed:any[],_pts:number) {
        placed.forEach(p=>{
          this.state.boardGrid[p.r][p.c]=p.tile;
          p.tile.material?.forEach?.((m:any)=>{if(m.emissive) m.emissive.setHex(0x000000);});
          const gl=new THREE.PointLight(0x00ff88,3,3.5);
          gl.position.set((p.c-7)*1.05,1,(p.r-7)*1.05); this.scene.add(gl);
          gsap.to(gl,{intensity:0,duration:2,onComplete:()=>this.scene.remove(gl)});
        });
        this.syncOpponentPlacements([]);
        this.state.placedThisTurn=[];
        this.state.turnCount++;
      }

      getBoardSnapshot() {
        const d:any[]=[];
        for(let r=0;r<15;r++) for(let c=0;c<15;c++){
          const t=this.state.boardGrid[r][c];
          if(t?.userData?.char) d.push({r,c,char:t.userData.char});
        }
        return d;
      }

      syncBoardFromFirebase(boardData:any[]) {
        const map=new Map<string,string>();
        boardData.forEach(item=>map.set(`${item.r}_${item.c}`,item.char));
        for(let r=0;r<15;r++) for(let c=0;c<15;c++){
          const existing=this.state.boardGrid[r][c];
          const incoming=map.get(`${r}_${c}`);
          if(incoming){
            if(!existing||existing.userData.char!==incoming){
              if(existing) this.scene.remove(existing);
              const nt=this.mkTile(incoming);
              nt.position.set((c-7)*1.05,0.32,(r-7)*1.05);
              nt.userData.isPlaced=true; this.scene.add(nt);
              this.state.boardGrid[r][c]=nt;
              const gl=new THREE.PointLight(0x4499ff,3,3);
              gl.position.set((c-7)*1.05,1,(r-7)*1.05); this.scene.add(gl);
              gsap.to(gl,{intensity:0,duration:2.5,onComplete:()=>this.scene.remove(gl)});
            }
          } else {
            if(existing){this.scene.remove(existing);this.state.boardGrid[r][c]=null;}
          }
        }
      }

      recall()  { [...this.state.placedThisTurn].forEach(p=>this.returnToRack(p.tile)); }
      shuffle() { this.state.rack.sort(()=>Math.random()-.5); this.arrangeRack(); }

      animate=()=>{
        requestAnimationFrame(this.animate);
        this.controls.update();
        this.renderer.render(this.scene,this.camera);
      };
      dispose() { window.removeEventListener('resize',this.onResize); this.renderer.dispose(); }
      onResize=()=>{
        this.camera.aspect=window.innerWidth/window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth,window.innerHeight);
        this.arrangeRack();
      };
    }

    const g=new Game(containerRef.current!);
    gameRef.current=g;
    g.onTempPlaceCallback=(placements)=>{
      const rid=roomIdRef.current;
      if(rid) update(ref(db,`rooms/${rid}`),{tempPlacements:JSON.stringify(placements)}).catch(console.error);
    };
    return ()=>g.dispose();
  }, []);

  // ---------- VALIDATE ----------
  const handleValidate=async()=>{
    if(!gameRef.current||validating) return;
    setValidating(true);
    const check=await gameRef.current.validateTurn();
    if('success' in check && check.success===false){showToast(check.msg,true);setValidating(false);return;}
    const {mainWord,placed}=check as any;
    const exists=await checkHungarianWordAPI(mainWord);
    if(exists){ completeTurn(mainWord,placed); }
    else {
      setPopupData({
        word:mainWord,
        onAccept:()=>{WORD_CACHE.add(mainWord);completeTurn(mainWord,placed);setPopupData(null);},
        onReject:()=>{showToast(`Nem fogadva: ${mainWord}`,true);setValidating(false);setPopupData(null);}
      });
    }
  };

  const completeTurn=async(word:string,placed:any[])=>{
    const pts=word.length*10;
    gameRef.current.finalizeTurn(placed,pts);
    const next=  (currentPlayer+1)%config.playerNames.length;
    const players=config.playerNames.map((n,i)=>({name:n,score:i===currentPlayer?(scores[i]||0)+pts:(scores[i]||0)}));
    const snap=  gameRef.current.getBoardSnapshot();
    await update(ref(db,`rooms/${roomId}`),{currentTurn:next,players,boardData:JSON.stringify(snap),tempPlacements:'[]'});
    showToast(`${word} ✓  +${pts} pont!`,false);
    setTimeout(()=>{gameRef.current.fillRack();setValidating(false);},800);
  };

  const isMyTurn = config.playerNames[currentPlayer] === playerName;

  // ---------- RENDER ----------
  return (
    <>
      <style jsx global>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{
          height:100%;overflow:hidden;
          font-family:'Georgia',serif;background:#000;
          touch-action:none;overscroll-behavior:none;
          -webkit-user-select:none;user-select:none;
          -webkit-tap-highlight-color:transparent;
        }

        /* ===== PANEL ===== */
        .app{position:fixed;inset:0;pointer-events:none;z-index:10;}
        .panel{
          pointer-events:auto;
          background:rgba(6,6,8,0.93);
          backdrop-filter:blur(28px);
          border:1px solid rgba(255,255,255,0.08);
          border-radius:28px;
          padding:clamp(20px,5vw,32px) clamp(18px,5vw,28px);
          color:#fff;
          width:min(94vw,420px);
          max-height:92dvh;
          overflow-y:auto;
          -webkit-overflow-scrolling:touch;
          box-shadow:0 40px 80px -20px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.04);
        }
        .panel-title{
          font-family:'Georgia',serif;
          font-size:clamp(28px,8vw,42px);font-weight:700;
          text-align:center;letter-spacing:4px;
          background:linear-gradient(135deg,#f5d060,#e08a00);
          -webkit-background-clip:text;color:transparent;
          margin-bottom:clamp(16px,4vw,24px);
        }
        .divider{height:1px;background:rgba(255,255,255,0.07);margin:14px 0;}
        .lbl{display:block;font-size:10px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,.35);margin-bottom:7px;font-family:Arial,sans-serif;}

        /* ===== INPUTS ===== */
        .inp{
          width:100%;display:block;
          background:rgba(255,255,255,.05);
          border:1.5px solid rgba(255,255,255,.09);
          border-radius:14px;padding:13px 16px;
          color:#fff;font-size:16px;font-weight:600;font-family:Arial,sans-serif;
          transition:border-color .15s,background .15s;
        }
        .inp::placeholder{color:rgba(255,255,255,.22);}
        .inp:focus{outline:none;border-color:rgba(245,208,96,.55);background:rgba(255,255,255,.07);}
        .row{display:flex;gap:8px;align-items:stretch;}

        /* ===== BUTTONS ===== */
        .btn{border:none;border-radius:14px;font-weight:700;cursor:pointer;transition:all .15s;font-family:Arial,sans-serif;}
        .btn:active{transform:scale(0.95);}
        .btn-ghost{background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.75);font-size:13px;padding:10px 12px;}
        .btn-ghost.sel{background:#fff;color:#111;border-color:#fff;font-weight:800;}
        .btn-gold{
          background:linear-gradient(135deg,#f5d060,#ca8a04);
          color:#1a0e00;font-size:15px;padding:15px;
          width:100%;margin-top:12px;
          border-radius:16px;
          box-shadow:0 4px 20px rgba(245,208,96,.25);
        }
        .btn-gold:disabled{opacity:.45;cursor:not-allowed;transform:none;}
        .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;}

        /* ===== ROOM CODE ===== */
        .roomcode{font-size:clamp(38px,12vw,54px);font-weight:900;letter-spacing:10px;color:#f5d060;font-family:Georgia,serif;text-align:center;margin:4px 0;}
        .pe{padding:10px 14px;border-radius:12px;font-size:14px;font-weight:600;color:#fff;font-family:Arial,sans-serif;}

        /* ===== HUD ===== */
        .hud{display:flex;justify-content:center;flex-wrap:wrap;gap:6px;padding:10px 10px 0;width:100%;}
        .pill{background:rgba(0,0,0,.72);backdrop-filter:blur(14px);padding:6px 14px;border-radius:50px;border:1.5px solid rgba(255,255,255,.07);color:#fff;text-align:center;min-width:52px;transition:all .25s;}
        .pill.on{background:rgba(245,208,96,.88);border-color:#fde047;color:#1a0e00;transform:scale(1.07);box-shadow:0 0 20px rgba(245,208,96,.5);}
        .pname{font-size:10px;letter-spacing:.5px;text-transform:uppercase;white-space:nowrap;max-width:72px;overflow:hidden;text-overflow:ellipsis;font-family:Arial,sans-serif;}
        .pscore{font-size:clamp(16px,4.5vw,22px);font-weight:900;line-height:1.1;}

        /* ===== TOAST ===== */
        .toast{position:absolute;top:66px;left:50%;transform:translateX(-50%);background:rgba(4,4,6,.94);color:#fff;padding:10px 22px;border-radius:50px;font-weight:700;font-size:clamp(13px,3.5vw,15px);opacity:0;pointer-events:none;transition:opacity .3s;z-index:300;white-space:nowrap;max-width:92vw;font-family:Arial,sans-serif;}
        .toast.show{opacity:1;}
        .toast.error{border:1px solid rgba(239,68,68,.55);}
        .toast.success{border:1px solid rgba(16,185,129,.55);}

        /* ===== OPPONENT BADGE ===== */
        .opp-badge{position:absolute;top:66px;right:12px;background:rgba(59,130,246,.85);backdrop-filter:blur(10px);color:#fff;padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;pointer-events:none;border:1px solid rgba(147,197,253,.4);font-family:Arial,sans-serif;animation:opp-pulse 1.4s ease-in-out infinite;}
        @keyframes opp-pulse{0%,100%{opacity:1}50%{opacity:.5}}

        /* ===== BOTTOM BAR ===== */
        .bar{
          position:absolute;bottom:0;width:100%;
          display:flex;justify-content:center;align-items:center;
          gap:8px;pointer-events:none;
          padding:10px 16px;
          padding-bottom:max(18px,env(safe-area-inset-bottom,18px));
          background:linear-gradient(to top,rgba(0,0,0,.65) 0%,transparent 100%);
          flex-wrap:nowrap;
        }
        .abtn{pointer-events:auto;border:none;border-radius:50px;font-weight:700;cursor:pointer;font-size:clamp(13px,3.8vw,15px);backdrop-filter:blur(14px);transition:all .15s;padding:clamp(11px,3vw,14px) clamp(16px,5vw,24px);white-space:nowrap;font-family:Arial,sans-serif;}
        .abtn:active{transform:scale(0.93);}
        .abtn-glass{background:rgba(255,255,255,.12);color:#fff;border:1.5px solid rgba(255,255,255,.18);}
        .abtn-green{background:#10b981;color:#fff;box-shadow:0 4px 18px rgba(16,185,129,.4);}
        .abtn-green:disabled{background:#065f46;opacity:.6;cursor:not-allowed;transform:none;}
        .wait-pill{pointer-events:auto;padding:12px 22px;background:rgba(12,12,16,.9);backdrop-filter:blur(14px);color:rgba(255,255,255,.8);border-radius:50px;font-weight:700;border:1.5px solid rgba(255,255,255,.1);font-size:clamp(12px,3.5vw,14px);white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis;font-family:Arial,sans-serif;}

        /* ===== POPUP ===== */
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;pointer-events:auto;z-index:400;padding:20px;}
        .popup{background:linear-gradient(150deg,#1a1a1e,#27272e);border:2px solid #f5d060;border-radius:24px;padding:30px 24px;text-align:center;color:#fff;box-shadow:0 0 80px rgba(245,208,96,.2);width:100%;max-width:340px;font-family:Arial,sans-serif;}
      `}</style>

      <div ref={containerRef} style={{position:'fixed',inset:0,zIndex:-1}}/>

      {popupData&&(
        <div className="overlay">
          <div className="popup">
            <p style={{fontSize:10,letterSpacing:2,opacity:.4,textTransform:'uppercase',marginBottom:8}}>Ismeretlen szó</p>
            <div style={{fontSize:'clamp(26px,8vw,36px)',fontWeight:900,color:'#f5d060',marginBottom:10}}>
              "{popupData.word}"
            </div>
            <p style={{opacity:.45,fontSize:13,marginBottom:22}}>Az ellenőrző nem ismeri fel. Elfogadod?</p>
            <div style={{display:'flex',gap:10}}>
              <button className="abtn abtn-glass" onClick={popupData.onReject} style={{flex:1,borderRadius:14,background:'rgba(239,68,68,.16)'}}>✕ Nem</button>
              <button className="abtn abtn-green" onClick={popupData.onAccept} style={{flex:1,borderRadius:14}}>✓ Igen</button>
            </div>
          </div>
        </div>
      )}

      <div className="app">
        {/* ===== MENU ===== */}
        {gameState==='menu'&&(
          <div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
            <div className="panel">
              <div className="panel-title">WORD MASTER</div>
              {!roomId?(
                <>
                  <div style={{marginBottom:14}}>
                    <label className="lbl">Neved</label>
                    <input className="inp" placeholder="Pl.: Anna" maxLength={12}
                      value={playerName} onChange={e=>setPlayerName(e.target.value.toUpperCase())}/>
                  </div>
                  <button className="btn btn-gold" onClick={createRoom}>+ Új szoba</button>
                  <div className="divider"/>
                  <div>
                    <label className="lbl">Csatlakozás kóddal</label>
                    <div className="row">
                      <input className="inp" style={{flex:1,textTransform:'uppercase',letterSpacing:6,textAlign:'center'}}
                        placeholder="KÓDE" maxLength={4} value={roomCodeInput}
                        onChange={e=>setRoomCodeInput(e.target.value.toUpperCase())}/>
                      <button className="btn btn-ghost sel" onClick={joinRoom} style={{padding:'13px 18px',flexShrink:0}}>Belép</button>
                    </div>
                  </div>
                </>
              ):(
                <>
                  <div style={{textAlign:'center',marginBottom:16}}>
                    <p style={{fontSize:10,letterSpacing:2,opacity:.35,textTransform:'uppercase'}}>Szoba kódja</p>
                    <div className="roomcode">{roomId}</div>
                    <p style={{fontSize:12,opacity:.3,marginTop:4}}>Oszd meg barátaiddal</p>
                  </div>
                  {isHost&&(
                    <div style={{marginBottom:14}}>
                      <label className="lbl">Téma</label>
                      <div className="grid3">
                        {(['luxus','nordic','cyber'] as const).map(t=>(
                          <button key={t} className={`btn btn-ghost${config.theme===t?' sel':''}`}
                            onClick={()=>update(ref(db,`rooms/${roomId}/config`),{theme:t})}>
                            {t==='luxus'?'♟ Luxus':t==='nordic'?'❄ Nordic':'⚡ Cyber'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{marginBottom:8}}>
                    <label className="lbl">Játékosok ({config.playerNames.length}/4)</label>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {config.playerNames.map((n,i)=>(
                        <div key={i} className="pe"
                          style={{background:n===playerName?'rgba(245,208,96,.1)':'rgba(255,255,255,.04)',
                            border:`1.5px solid ${n===playerName?'rgba(245,208,96,.4)':'rgba(255,255,255,.07)'}`}}>
                          {n===playerName?'👤':'🎮'} {n}
                        </div>
                      ))}
                    </div>
                  </div>
                  {isHost
                    ?<button className="btn btn-gold" onClick={startMultiplayerGame} disabled={config.playerNames.length<2}>
                       {config.playerNames.length<2?'Várakozás...':'▶ Játék indítása'}
                     </button>
                    :<p style={{textAlign:'center',opacity:.35,padding:16,fontSize:14}}>⏳ Várakozás a házigazdára...</p>
                  }
                </>
              )}
            </div>
          </div>
        )}

        {/* ===== IN-GAME ===== */}
        {gameState==='playing'&&(
          <>
            <div className="hud">
              {config.playerNames.map((n,i)=>(
                <div key={i} className={`pill${currentPlayer===i?' on':''}`}>
                  <div className="pname">{n}</div>
                  <div className="pscore">{scores[i]||0}</div>
                </div>
              ))}
            </div>

            <div className={`toast${toastMsg.text?' show':''} ${toastMsg.type}`}>{toastMsg.text}</div>
            {opponentMoving&&<div className="opp-badge">✏ lép...</div>}

            <div className="bar">
              {!isMyTurn?(
                <div className="wait-pill">⏳ {config.playerNames[currentPlayer]} lép...</div>
              ):(
                <>
                  <button className="abtn abtn-glass" onClick={()=>gameRef.current?.recall()}>↩ Vissza</button>
                  <button className="abtn abtn-glass" onClick={()=>gameRef.current?.shuffle()}>🔀 Kever</button>
                  <button className="abtn abtn-green" onClick={handleValidate} disabled={validating}>
                    {validating?'⏳':'✓ Lerak'}
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