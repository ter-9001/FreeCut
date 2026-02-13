/*
 * Copyright (C) 2026  Gabriel Martins Nunes
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */



import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  // ... outros ícones que já estavam lá
  Play, 
  Pause, 
  Scissors, 
  SkipBack,    // Adicione este
  SkipForward, // Adicione este
  LayoutGrid,
  Plus,
  Settings,
  Clock,
  FolderOpen,
  X,
  Youtube,
  Share2,
  Import,
  ZoomIn,      // Substituindo SearchPlus
  ZoomOut,
  Music,
  Sparkles
  
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { track } from 'framer-motion/client';



// --- INTERFACES ---

interface Project {
  name: string;
  path: string;
}

interface Clip {
  id: string;
  name: string;
  start: number;
  duration: number;
  color: string;
  trackId: number;
  maxduration: number;
  beginmoment: number;
}

interface ProjectFileData {
  projectName: string;
  assets: Asset[];
  clips: Clip[];
  lastModified: number;
  copyOf?: string; // Pointer to another main{timestamp}.project file
}

interface Asset {
  name: string;
  path: string;       // Caminho completo no sistema
  duration: number;   // Duração real em segundos
  type: 'video' | 'audio' | 'image';
  thumbnail?: string; // URL da imagem gerada pelo FFmpeg
}

interface Tracks
{
  id: number;
  type:  'audio' | 'video' | 'effects'
}

const PIXELS_PER_SECOND = 5;

export default function App() {
  // --- STATE MANAGEMENT ---
  const [rootPath, setRootPath] = useState<string | null>(localStorage.getItem("freecut_root"));
  const [isSetupOpen, setIsSetupOpen] = useState(true);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [projectName, setProjectName] = useState("My Awesome Project");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [playheadPos, setPlayheadPos] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [tracks, setTracks] = useState<Tracks[]>([0]);

  //deleteClipId is used to store the id of a clip that is changed of track
  const [deleteClipId, setDeleteClipId] = useState<string | null>(null);

  const currentProjectPath = localStorage.getItem("current_project_path");
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  const playheadRef = useRef<HTMLDivElement>(null);

  const imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
  const audioExtensions = ['mp3', 'wav', 'ogg'];
  const videoExtensions = ['mp4', 'mkv', 'avi', 'mov'];





  const [isProjectLoaded, setIsProjectLoaded] = useState(false);
  
  //color for clips
  const CLIP_COLORS = [
    'bg-blue-600',   // Ocean
    'bg-emerald-600', // Forest
    'bg-violet-600',  // Royal
    'bg-amber-600',   // Gold
    'bg-rose-600',    // Wine
    'bg-cyan-600',    // Sky
    'bg-indigo-600'   // Galaxy
  ];

  // Helper to get a random color
  const getRandomColor = () => CLIP_COLORS[Math.floor(Math.random() * CLIP_COLORS.length)];

  // Change from null to empty arrays
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);



  //snap function
  const [isSnapEnabled, setIsSnapEnabled] = useState(false);


  const [isPlaying, setIsPlaying] = useState(false);
  const requestRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);


  /**
   * History Manager with a 100-step limit.
   * Uses a simple array-based stack to track clips and assets.
   */
  const [history, setHistory] = useState<{ clips: Clip[], assets: Asset[] }[]>([]);
  const [redoStack, setRedoStack] = useState<{ clips: Clip[], assets: Asset[] }[]>([]);


  const [timelineHeight, setTimelineHeight] = useState(300); // Default height
  const isResizingTimeline = useRef(false);

  //States for Box Selection, make a box with mouse to select severals clips
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [boxStart, setBoxStart] = useState({ x: 0, y: 0 });
  const [boxEnd, setBoxEnd] = useState({ x: 0, y: 0 });


  const clipboardRef = useRef<Clip[]>([]);

// Delete clean tracks
useEffect(() => {
  if (!isSetupOpen) {
    // 1. Pega os IDs das tracks que possuem ao menos um clip
    const activeTrackIds = [...new Set(clips.map(c => c.trackId))];

    // 2. Filtramos o array de tracks atual para manter apenas as que têm clips
    // Ou seja, removemos as que não estão na lista de IDs ativos
    const filteredTracks = tracks.filter(t => activeTrackIds.includes(t.id));

    // 3. Verificamos se houve mudança real (comparando IDs) para evitar loops de render
    const hasChanged = 
      filteredTracks.length !== tracks.length || 
      tracks.some((t, i) => filteredTracks[i] && t.id !== filteredTracks[i].id);

    if (hasChanged) {
      setTracks(filteredTracks);
    }
  }
}, [clips, isSetupOpen]); // 'tracks' continua fora para evitar loop infinito


  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingTimeline.current) return;
      
      // Calculate new height from the bottom of the screen
      const newHeight = window.innerHeight - e.clientY;
      
      // Limits: Min 150px, Max 80% of screen
      if (newHeight > 150 && newHeight < window.innerHeight * 0.8) {
        setTimelineHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      isResizingTimeline.current = false;
      document.body.style.cursor = 'default';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);


    // Function to Delete Project
  const handleDeleteProject = async () => {
    if (projectToDelete) {
      try {
        await invoke('delete_project', { path: projectToDelete.path });
        showNotify("Project deleted", "success");
        setProjectToDelete(null);
        loadProjects(); // Recarrega a lista
        setAssets([])
        setClips([])
        setTracks([])
      } catch (e) {
        showNotify("Error deleting project", "error");
      }
    }
  };


    /**
   * Automatically prunes empty tracks whenever the clips array changes.
   * This keeps the timeline clean by removing tracks with no content.
   */
useEffect(() => {
  if (clips.length === 0) return;

  const uniqueClips = clips.reduce((acc: Clip[], current) => {
    // 1. Verifica se já existe um clip com o mesmo ID
    const duplicateId = acc.find(c => c.id === current.id);
    
    // 2. Verifica se já existe um clip na mesma Track e mesmo Start
    const duplicateSlot = acc.find(c => 
      c.trackId === current.trackId && c.start === current.start
    );

    if (duplicateId || duplicateSlot) {
      // Se houver conflito, mantemos o que tem o menor ID (o mais antigo/original)
      // e descartamos o de ID maior (o mais recente/duplicado)
      const existing = duplicateId || duplicateSlot;
      
      if (current.id > existing!.id) {
        return acc; // Ignora o atual (maior ID)
      } else {
        // Caso o atual seja menor (raro), removemos o anterior e colocamos este
        return [...acc.filter(c => c !== existing), current];
      }
    }

    return [...acc, current];
  }, []);

  // Só atualiza o estado se o tamanho do array mudou (evita loop infinito)
  if (uniqueClips.length !== clips.length) {
    setClips(uniqueClips);
  }
}, [clips]);


  // This ref prevents the useEffect from saving history during an Undo/Redo operation
  const isUndoRedoAction = useRef(false);

  const MAX_HISTORY_STEPS = 100;


  // Default zoom: 100 pixels represents 1 second
  const [pixelsPerSecond, setPixelsPerSecond] = useState(10);

  // Limits to prevent the timeline from disappearing or becoming infinite
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 200;


    /**
   * Adjusts the timeline scale.
   * @param factor - Positive to zoom in, negative to zoom out
   */

 


  const handleZoom = (factor: number) => {
    
    

    setPixelsPerSecond(prev => {
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + factor));


      ///code to make the playhead on the same position (time)
      const pixelsFromLeft = playheadRef.current.offsetLeft;
      console.log("Pixels via offsetLeft:", pixelsFromLeft);


      const variation = newZoom / (prev == 0 ? 1 : prev)
      console.log("var", prev, factor, variation)
      console.log(playheadPos, variation)


      setPlayheadPos( pixelsFromLeft * variation);

      timelineContainerRef.current.scrollLeft = factor < 0 ? 0 : pixelsFromLeft

      
      return newZoom;
    });



    




  };

//functions to make the Box Selection
const handleTimelineMouseDown = (e: React.MouseEvent) => {
  // Apenas inicia se clicar no fundo da timeline (não em clips)
  if (e.target !== e.currentTarget) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const startX = e.clientX - rect.left;
  const startY = e.clientY - rect.top;

  setIsBoxSelecting(true);
  setBoxStart({ x: startX, y: startY });
  setBoxEnd({ x: startX, y: startY });

  // Limpa seleção anterior a menos que use Shift
  if (!e.shiftKey) setSelectedClipIds([]);
};


//Function to rename assets
const handleRenameAsset = async (oldName: string, newName: string) => {
  if (!newName || oldName === newName || !currentProjectPath) return;

  // Guardamos o estado anterior para reversão
  const previousClips = [...clips];
  const previousAssets = [...assets];

  // Atualização Otimista (UI muda na hora)
  setClips(prev => prev.map(c => c.name === oldName ? { ...c, name: newName } : c));
  setAssets(prev => prev.map(a => a.name === oldName ? { ...a, name: newName } : a));

  try {
    await invoke('rename_file', { 
      oldPath: `${currentProjectPath}/videos/${oldName}`, 
      newPath: `${currentProjectPath}/videos/${newName}` 
    });
    showNotify("Asset renamed", "success");
  } catch (err) {
    showNotify("Error renaming file", "error");
    // Reverte em caso de erro no backend (ex: arquivo em uso ou nome inválido)
    setClips(previousClips);
    setAssets(previousAssets);
  }
};


const handleRenameAsset_old = async (oldName: string, newName: string) => {

  const clip_now = [...clips]
  const assets_now = [...assets]
  
  try {
    
  if (!newName || oldName === newName) return;

  setClips(prevClips => prevClips.map(clip => 
    clip.name === oldName ? { ...clip, name: newName } : clip
  ));

  setAssets(prevAssets => prevAssets.map(asset => 
    asset.name === oldName ? {...asset, name: newName} : asset
  ));

  await invoke('rename_file', { oldPath: `${currentProjectPath}/videos/${oldName}`, newPath: `${currentProjectPath}/videos/${newName}` });
  showNotify("Asset renamed", "success");

  } catch (err) {
    showNotify("Error renaming physical file", "error");
    setClips(clip_now)
    setAssets(assets_now)
  }
  

};

//Function to copy and paste clips
const handleCopy = () => {
  if (selectedClipIds.length === 0) return;
  
  const selectedClips = clips.filter(c => selectedClipIds.includes(c.id));
  
  // Atualiza o REF imediatamente (síncrono)
  clipboardRef.current = selectedClips;
  
  showNotify(`${selectedClips.length} clips copied`, "success");
};

const handlePaste = () => {
  // 1. Acessamos o valor via Ref para garantir que pegamos o dado MAIS RECENTE
  const clipsToPaste = clipboardRef.current;
  
  if (clipsToPaste.length === 0) {
    showNotify("Clipboard is empty", "error");
    return;
  }

  const playheadTime = playheadPos / pixelsPerSecond;
  
  // Salva no histórico antes de alterar
  saveHistory(clips, assets);

  // 2. Encontramos o ponto inicial do grupo (o clip mais à esquerda no clipboard)
  const minStart = Math.min(...clipsToPaste.map(c => c.start));

  let newClipsList = [...clips];
  let currentTracks = [...tracks];

  let currentTracksIds = tracks.map(t => t.id)
  const pastedIds: string[] = [];

  // 3. Processamos cada clip para colagem
  clipsToPaste.forEach(originalClip => {
    // Mantém a distância relativa entre os clips colados em relação à agulha
    const relativeOffset = originalClip.start - minStart;
    const targetStart = playheadTime + relativeOffset;
    
    let targetTrack = originalClip.trackId;

    // 4. Lógica de "Smart Track": Procura espaço ou cria nova track
    // Verifica se o espaço está ocupado na track atual
    const isOccupied = (tId: number, start: number, dur: number) => {
      const end = start + dur;
      return newClipsList.some(c => 
        c.trackId === tId && 
        start < (c.start + c.duration - 0.01) && 
        end > (c.start + 0.01)
      );
    };

    // Se estiver ocupado, desce para a próxima track até achar vazio
    while (isOccupied(targetTrack, targetStart, originalClip.duration)) {
      targetTrack++;
      // Se a track não existe no estado, adicionamos ela
      if (!currentTracksIds.includes(targetTrack)) {
        currentTracksIds.push(targetTrack);
        currentTracksIds.sort((a, b) => a - b);
      }
    }

    const newClipId = crypto.randomUUID()

    const pastedClip: Clip = {
      ...originalClip,
      id: newClipId,
      start: targetStart,
      trackId: targetTrack
    };

    let type = knowTypeByAssetName(pastedClip.name, true)
    



    currentTracks.push({id: targetTrack, type: type  as 'video' | 'audio' | 'effects'})

    newClipsList.push(pastedClip);
    pastedIds.push(newClipId);
  });



  // 6. Atualiza os estados de uma vez só
  setTracks(currentTracks);
  setClips(newClipsList);
  
  // Seleciona os novos clips colados para facilitar o ajuste imediato
  setSelectedClipIds(pastedIds);
  
  showNotify(`Pasted ${clipsToPaste.length} clips`, "success");
};


const handleTimelineMouseMove = (e: React.MouseEvent) => {
  if (!isBoxSelecting) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;

  setBoxEnd({ x: currentX, y: currentY });

  // Cálculo do retângulo
  const left = Math.min(boxStart.x, currentX);
  const right = Math.max(boxStart.x, currentX);
  const top = Math.min(boxStart.y, currentY);
  const bottom = Math.max(boxStart.y, currentY);

  // Detetar clips dentro do retângulo
  const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  
  const collidingClips = clips.filter(clip => {
    const clipLeft = (clip.start * pixelsPerSecond) - scrollLeft;
    const clipRight = clipLeft + (clip.duration * pixelsPerSecond);
    const clipTop = (clip.trackId * 64) + 30; // 64px altura track + margem ruler
    const clipBottom = clipTop + 60;

    return (
      clipRight > left &&
      clipLeft < right &&
      clipBottom > top &&
      clipTop < bottom
    );
  }).map(c => c.id);

  setSelectedClipIds(collidingClips);
};

const handleTimelineMouseUp = () => {
  setIsBoxSelecting(false);
};




  //logic to zoom with scroll
    useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Only zoom if Alt key is pressed
      if (e.altKey) {
        e.preventDefault();
        const zoomAmount = e.deltaY > 0 ? -20 : 20;
        handleZoom(zoomAmount);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Zoom in with Ctrl + "+" or just "+"
      if ((e.ctrlKey || e.metaKey) && e.key === '=') {
        e.preventDefault();
        handleZoom(10);
      }
      // Zoom out with Ctrl + "-" or just "-"
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        handleZoom(-10);
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  /**
   * Manually pushes a snapshot to history.
   * Should be called BEFORE the state is updated with the new change.
   */
  const saveHistory = (currentClips: Clip[], currentAssets: Asset[]) => {
    setHistory(prev => {
      const newHistory = [...prev, { clips: currentClips, assets: currentAssets }];
      return newHistory.length > MAX_HISTORY_STEPS ? newHistory.slice(1) : newHistory;
    });
    setRedoStack([]); // New action invalidates the redo path
  };

  const handleUndo = () => {
  if (history.length === 0) return;

  // 1. Lock history saving
  isUndoRedoAction.current = true;

  const previousState = history[history.length - 1];
  const newHistory = history.slice(0, -1);

  setRedoStack(prev => [...prev, { clips, assets }]);
  
  setClips(previousState.clips);
  setAssets(previousState.assets);
  setHistory(newHistory);
  
  showNotify("Undo", "success");
};

  const handleRedo = () => {
    if (redoStack.length === 0) return;

    // 1. Lock history saving
    isUndoRedoAction.current = true;

    const nextState = redoStack[redoStack.length - 1];
    const newRedoStack = redoStack.slice(0, -1);

    setHistory(prev => [...prev, { clips, assets }]);

    setClips(nextState.clips);
    setAssets(nextState.assets);
    setRedoStack(newRedoStack);
    
    showNotify("Redo", "success");
  };

//Code to make player needle walk
  const togglePlay = () => {
    setIsPlaying(prev => !prev);
  };

  const animate = (time: number) => {
    if (lastTimeRef.current !== null) {
      const deltaTime = (time - lastTimeRef.current) / 1000; // Segundos passados
      
      setPlayheadPos(prev => {
        const nextPos = prev + (deltaTime * PIXELS_PER_SECOND);
        // Opcional: Auto-scroll da timeline para seguir a agulha
        if (timelineContainerRef.current) {
          const container = timelineContainerRef.current;
          const scrollRight = container.scrollLeft + container.clientWidth;
          if (nextPos > scrollRight - 50) {
            container.scrollLeft += 5; // Scroll suave
          }
        }
        return nextPos;
      });
    }
    lastTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  };


  const lastSavedState = useRef(JSON.stringify({ clips, assets }));

  useEffect(() => {
  const currentState = JSON.stringify({ clips, assets });
  
  if (currentState !== lastSavedState.current) {
    // 1. Check if this change was triggered by Undo/Redo
    if (isUndoRedoAction.current) {
      // If it was, we just update the ref and reset the lock
      lastSavedState.current = currentState;
      isUndoRedoAction.current = false;
      return;
    }

    const timer = setTimeout(() => {
      const oldState = JSON.parse(lastSavedState.current);
      
      setHistory(prev => {
        const newHistory = [...prev, oldState];
        return newHistory.length > MAX_HISTORY_STEPS ? newHistory.slice(1) : newHistory;
      });
      
      setRedoStack([]);
      lastSavedState.current = currentState;
    }, 500); 

      return () => clearTimeout(timer);
    }
    }, [clips, assets]);
  

  useEffect(() => {
    if (isPlaying) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      lastTimeRef.current = null;
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying]);

  /**
 * Calculates the boundaries for a specific clip
 */
  const getClipBoundaries = (clipId: string) => {
    const targetClip = clips.find(c => c.id === clipId);
    if (!targetClip) return { minStart: 0, maxDuration: 40 };

    // 1. Get all other clips on the same track
    const trackClips = clips
      .filter(c => c.trackId === targetClip.trackId && c.id !== clipId)
      .sort((a, b) => a.start - b.start);

    // 2. Find the neighbor immediately before (Left)
    const previousClip = [...trackClips]
      .reverse()
      .find(c => c.start <= targetClip.start);

    // 3. Find the neighbor immediately after (Right)
    const nextClip = trackClips.find(c => c.start >= (targetClip.start + targetClip.duration));

    // --- CALCULATIONS ---

    // Boundary Left: The end of the previous clip or 0
    const minStart = previousClip ? (previousClip.start + previousClip.duration) : 0;

    // Boundary Right: The start of the next clip or a fixed maximum (e.g., 2 hours)
    const absoluteLimit = 7200; // 2 hours in seconds
    const maxEndTimestamp = nextClip ? nextClip.start : absoluteLimit;

    // Max Duration is the space between our current start and the next obstacle
    const maxDuration = maxEndTimestamp - targetClip.start;

    return {
      minStart,    // How far back the clip can go
      maxDuration, // Maximum length it can have at current start position
      maxEndTimestamp // Absolute point it cannot cross
    };
  };

const handleResize = (id: string, deltaX: number, side: 'left' | 'right') => {
  const { minStart, maxEndTimestamp } = getClipBoundaries(id);
  const deltaSeconds = deltaX / PIXELS_PER_SECOND; // Remova o 0.2 se quiser precisão real do mouse

  setClips(prev => prev.map(clip => {
    if (clip.id !== id) return clip;

    const asset = assets.find(a => a.name === clip.name);
    const isImage = asset?.type === 'image';

    if (side === 'right') {
      // Se for imagem, o limite é apenas o próximo clip. Se for vídeo, é o fim do arquivo.
      const remainingAssetTime = isImage ? Infinity : (clip.maxduration - (clip.beginmoment + clip.duration));
      
      const maxPossibleExpansion = Math.min(
        remainingAssetTime, 
        maxEndTimestamp - (clip.start + clip.duration)
      );

      // Nova duração (mínimo de 0.1s para não sumir)
      const addedDuration = Math.max(-clip.duration + 0.1, Math.min(deltaSeconds, maxPossibleExpansion));
      
      return { 
        ...clip, 
        duration: clip.duration + addedDuration 
      };

    } else {
      // LADO ESQUERDO
      const maxRetractionTimeline = clip.start - minStart;
      // Se for imagem, pode expandir para a esquerda infinitamente (até o clip anterior)
      const maxRetractionAsset = isImage ? Infinity : clip.beginmoment;

      const maxLeftExpansion = Math.min(maxRetractionTimeline, maxRetractionAsset);

      let safeDelta = Math.max(-maxLeftExpansion, deltaSeconds);

      // Evita encolher demais
      if (safeDelta > clip.duration - 0.1) safeDelta = clip.duration - 0.1;

      return {
        ...clip,
        start: clip.start + safeDelta,
        duration: clip.duration - safeDelta,
        // Imagens não progridem no "tempo interno", então beginmoment só muda para vídeos
        beginmoment: isImage ? 0 : clip.beginmoment + safeDelta
      };
    }
  }));
};




  // Code to make the clip resizable 



  //function to help handleResize cause Drag won't work because the Drag of Parent Element
  const startResizing = (e: React.MouseEvent, clipId: string, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;

    const onMouseMove = (moveEvent: MouseEvent) => {
      // Calcula quanto o mouse moveu desde o clique inicial
      const deltaX = moveEvent.clientX - startX;
      
      // Chama sua função (que já está correta!)
      handleResize(clipId, deltaX, side);
    };

    const onMouseUp = () => {
      // Limpa os eventos quando soltar o mouse
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };





  // Effect to handle automatic saving whenever project data changes
  useEffect(() => {

    
    


    const saveProject = async () => {
      // DO NOT save if the project hasn't finished loading yet
      console.log(clips)

      if (!isProjectLoaded || !currentProjectPath) return;

      

     

     const projectData: ProjectFileData = {
        projectName,
        assets,
        clips,
        lastModified: Date.now()
      };

      

      


      


      try {
        await invoke('save_project_data', {
          projectPath: currentProjectPath,
          data: JSON.stringify(projectData),
          timestamp: Date.now()
        });
        console.log("Project saved successfully.");
        
      } catch (err) {
        console.error("Auto-save failed:", err);
      }



    };

    const timeoutId = setTimeout(saveProject, 500); // 0.5 second debounce
    return () => clearTimeout(timeoutId);
  }, [clips, assets, projectName, isProjectLoaded]);  

  //Formating pos lable for min and segs

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);

    // Formato HH:MM:SS se tiver mais de uma hora, senão MM:SS
    const parts = [];
    if (h > 0) parts.push(h.toString().padStart(2, '0'));
    parts.push(m.toString().padStart(2, '0'));
    parts.push(s.toString().padStart(2, '0'));

    return `${parts.join(':')}.${ms.toString().padStart(2, '0')}`;
  };

  //allow multiples selections with shift and ctrl
  const toggleAssetSelection = (asset: Asset, isShift: boolean) => {
    setSelectedClipIds([]); // Clear clips when selecting assets

    

    setSelectedAssets(prev => {

      if (isShift) {
        return prev.includes(asset) 
          ? prev.filter(a => a.name !== asset.name) 
          : [...prev, asset];
      }
      return [asset];
    });
  };

  /**
 * Manages multiple clip selection.
 * If shiftKey is pressed, it toggles the clip in the current selection.
 * Otherwise, it selects only the clicked clip.
 */
  const toggleClipSelection = (clipId: string, isMultiSelect: boolean) => {
    // Clear asset selection when interacting with clips
    setSelectedAssets([]);

    setSelectedClipIds(prev => {
      // If Shift/Ctrl is held, add/remove from existing list
      if (isMultiSelect) {
        return prev.includes(clipId) 
          ? prev.filter(id => id !== clipId) 
          : [...prev, clipId];
      }
      // Otherwise, select ONLY this clip
      return [clipId];
    });
  };

  //delete several clips or assets in one time
  const handleDeleteEverything = () => {
    // 1. Check if there's anything to delete
    if (selectedClipIds.length === 0 && selectedAssets.length === 0) return;

    // 2. Save snapshot for the 100-step history
    saveHistory(clips, assets);

    // 3. Delete selected CLIPS
    if (selectedClipIds.length > 0) {
      setClips(prev => prev.filter(c => !selectedClipIds.includes(c.id)));
      setSelectedClipIds([]);
    }

    // 4. Delete selected ASSETS and all their timeline instances
    if (selectedAssets.length > 0) {
      setAssets(prev => prev.filter(a => !selectedAssets.includes(a)));
      
      const selectedAssetsNames = selectedAssets.map(sa => sa.name )
      setClips(prev => prev.filter( (c) => !(selectedAssetsNames.includes(c.name))))


      setSelectedAssets([]);
    }

    showNotify("Selection purged", "success");
  };

  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {

        //Avoid Write rename asset trigger the delete asset  
        if (
        e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement || 
        (e.target as HTMLElement).isContentEditable // Adicione isso aqui!
      ) {
        return; 
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteEverything();
      }
      


        // Undo: Ctrl+Z or Cmd+Z
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          handleUndo();
        }

        // Redo: Ctrl+Y / Cmd+Shift+Z / Ctrl+Shift+Z
        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
          e.preventDefault();
          handleRedo();
        }


        // CTRL + T (Toggle Snap)
        if (e.ctrlKey && e.key.toLowerCase() === 't') {
          e.preventDefault();
          setIsSnapEnabled(prev => !prev);
          showNotify(`Magnetic Snap: ${!isSnapEnabled ? 'ON' : 'OFF'}`, "success");
        }


        //ALT + S split tool
        if (e.altKey && e.key.toLowerCase() === 's') {
          e.preventDefault();
          handleSplit();
        }


        //Space (Player Needle move)  
        if (e.code === 'Space') {
          e.preventDefault(); // Impede o scroll da página
          togglePlay();
        }

        // Ctrl + Q (Select Left)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
          e.preventDefault();
          handleMassSplitAndSelect('left');
        }

        // Ctrl + W (Select Right)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
          e.preventDefault();
          handleMassSplitAndSelect('right');
        }



        // Ctrl + C
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          handleCopy();
        }

        // Ctrl + V
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
          e.preventDefault();
          handlePaste();
        }



      





      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedClipIds, selectedAssets , clips, isSnapEnabled, assets, history, redoStack]);


    /**
     * Moves the playhead to a specific X position and updates the state
     * @param clientX Raw mouse X coordinate
     */
    const seekTo = (clientX: number) => {
      if (!timelineContainerRef.current) return;
      
      const rect = timelineContainerRef.current.getBoundingClientRect();
      const scrollLeft = timelineContainerRef.current.scrollLeft;
      
      // Calculate X relative to the timeline content
      const newX = clientX - rect.left + scrollLeft;
      
      // Ensure the playhead doesn't go into negative values
      setPlayheadPos(Math.max(0, newX));
    };

    /**
     * Handles the mouse down event on the ruler to start dragging the playhead
     */
    const handlePlayheadDrag = (e: React.MouseEvent) => {
      seekTo(e.clientX);

      const onMouseMove = (moveEvent: MouseEvent) => {
        seekTo(moveEvent.clientX);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    /**
     * Splits the selected clip (or clip under playhead) into two parts
     * based on the current playhead position.
     */
    /**
     * Advanced Split Logic:
     * 1. If a clip is selected, only split that one (even if others are below/above).
     * 2. If NO clip is selected, but multiple clips are under the playhead, 
     * prevent splitting and warn the user to avoid accidental cuts.
     * 3. Only split without selection if exactly ONE clip is found under the playhead.
     */

const handleSplit = () => {
  const playheadTime = playheadPos / pixelsPerSecond;


  console.log('playheadtime', playheadTime)

  // 1. Encontrar clips sob a agulha
  const clipsAtPlayhead = clips.filter(c => 
    playheadTime > c.start && 
    playheadTime < (c.start + c.duration)
  );

  let targetClip: Clip | undefined;

  // 2. Lógica de Seleção
  if (selectedClipIds.length > 0) {
    targetClip = clipsAtPlayhead.find(c => selectedClipIds.includes(c.id));


    console.log('targetclipstart', targetClip)
    
    if (!targetClip) {
      showNotify("Selected clip is not under the playhead", "error");
      return;
    }
  } else {
    if (clipsAtPlayhead.length > 1) {
      showNotify("Multiple clips found! Select one to split.", "error");
      return;
    }
    if (clipsAtPlayhead.length === 0) {
      showNotify("No clip under the playhead", "error");
      return;
    }
    targetClip = clipsAtPlayhead[0];
  }

  saveHistory(clips, assets);

  // --- LÓGICA DE CÁLCULO DE TEMPO ---

  // Quanto tempo passou desde o início do CLIP na timeline até a agulha
  const timeOffsetFromClipStart = playheadTime - targetClip.start;

  // Primeira parte: mantém o beginmoment original, mas encurta a duração
  const firstClip: Clip = { 
    ...targetClip, 
    duration: timeOffsetFromClipStart 
  };

  // Segunda parte: 
  // - O start na timeline é a posição da agulha.
  // - A duração é o que restava do clip original.
  // - O novo beginmoment é o original + o tempo que "andamos" dentro do clip.
  new Promise(resolve => setTimeout(resolve, 1));

  const secondClip: Clip = { 
    ...targetClip, 
    id: crypto.randomUUID(), 
    start: playheadTime, 
    duration: targetClip.duration - timeOffsetFromClipStart,
    beginmoment: targetClip.beginmoment + timeOffsetFromClipStart
  };

  setClips(prev => [
    ...prev.filter(c => c.id !== targetClip!.id),
    firstClip,
    secondClip
  ].sort((a, b) => a.start - b.start)); // Boa prática manter ordenado

  // Atualiza a seleção para o novo clip criado (parte da direita)
  setSelectedClipIds([secondClip.id]);
  showNotify("Clip split!", "success");
};

  //Function to snap
    // Helper to calculate the magnetic snap point
      /**
   /**
   * Context-Aware Infinity Snap:
   * Only snaps to the immediate left or right neighbors on the track.
   * This prevents the clip from jumping over other clips to reach a distant edge.
   */
  const getSnappedTime = (currentTime: number, excludeId: string | null = null, trackId: number | null = null) => {
    if (!isSnapEnabled || trackId === null) return currentTime;

    // 1. Get all other clips on this track
    const trackClips = clips
      .filter(c => c.trackId === trackId && c.id !== excludeId)
      .sort((a, b) => a.start - b.start);

    if (trackClips.length === 0) return currentTime;

    // 2. Find the immediate neighbor to the left
    const leftNeighbor = [...trackClips].reverse().find(c => c.start <= currentTime);
    // 3. Find the immediate neighbor to the right
    const rightNeighbor = trackClips.find(c => c.start > currentTime);

    let candidatePoints: number[] = [];
    
    // Only snap to the end of the clip on the left
    if (leftNeighbor) candidatePoints.push(leftNeighbor.start + leftNeighbor.duration);
    // Only snap to the start of the clip on the right
    if (rightNeighbor) candidatePoints.push(rightNeighbor.start);

    if (candidatePoints.length === 0) return currentTime;

    // 4. Find which of these two neighbors is closer
    let closestPoint = currentTime;
    let minDistance = Infinity;

    candidatePoints.forEach(point => {
      const distance = Math.abs(currentTime - point);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = point;
      }
    });

    return closestPoint;
  };













  // --- TAURI V2 NATIVE DRAG & DROP LISTENER FOR FILES FROM OS (NOT ASSETS) ---
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupDropListener = async () => {
      // Armazena a função de desinscrição retornada pela Promise
      const unsubscribe = await getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          const { paths, position } = event.payload;
          const timelineBounds = timelineContainerRef.current?.getBoundingClientRect();
          const isTimelineZone = timelineBounds &&
            position.y >= timelineBounds.top &&
            position.y <= timelineBounds.bottom;

          handleNativeDrop(paths, position.x, position.y);
        }
      });
      unlisten = unsubscribe;
    };

    if (!isSetupOpen) {
      setupDropListener();
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [isSetupOpen, currentProjectPath]);


    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    };


//avoid clip over another

useEffect(() => {
  if (clips.length === 0) return;

  const lastClip = clips[clips.length - 1];
  const lastClipType = knowTypeByAssetName(lastClip.name,true)

  let currentTrackId = lastClip.trackId;
  let currentTrack = tracks.find( t => t.id === currentTrackId) 


    while (isSpaceOccupied(currentTrackId, lastClip.start, lastClip.duration, lastClip.id) || ( lastClipType !== currentTrack?.type) ) {
      currentTrackId++;
      currentTrack = tracks.find( t => t.id === currentTrackId)


      if(!currentTrack)
      {
        //create a track of the correct type if don't exist
        setTracks(prev => [... prev, {id: currentTrackId, type: lastClipType as 'video' | 'audio' | 'effects'}])
          setClips(prevClips => 
          prevClips.map(c => 
            c.id === lastClip.id ? { ...c, trackId: currentTrackId } : c
          )
        );
        break
      }  

      
      setClips(prevClips => 
        prevClips.map(c => 
          c.id === lastClip.id ? { ...c, trackId: currentTrackId } : c
        )
      );

      
      
      console.log(`Clip "${lastClip.name}" movido para Track ${currentTrackId} por colisão ou incompatibilidade de tipo, seu tipo é ${lastClipType}.`);
  }
}, clips); // Importante: monitorar apenas o .length para evitar loop infinito ao mudar o trackId    


const knowTypeByAssetName = (assetName: string, typeTrack: boolean = false) => 
{
   const extension = assetName.split('.').pop()?.toLowerCase() || '';

    // 2. Define allowed extensions for each type
    

    // 3. Check if the extension is valid
    const isImage = imageExtensions.includes(extension);
    const isAudio = audioExtensions.includes(extension);
    const isVideo = videoExtensions.includes(extension);

    if (!isImage && !isAudio && !isVideo) {
      showNotify("Invalid file type: Only video, audio, and images are allowed", "error");
      return;
    }

    // 4. Assign the correct media type
    let type: 'video' | 'audio' | 'image' = 'video';
    if (isImage) type = 'image';
    if (isAudio) type = 'audio';


    const finalType = typeTrack 
    ? (type === 'audio' ? 'audio' : 'video') 
    : type;

    return finalType

}

const createClipOnNewTrack = (assetName: string, dropTime: number) => {
  
  
  //Higher Track more one
  const trackids = tracks.map(t => t.id) 
  const newTrackId = tracks.length > 0 ? Math.max(...trackids) + 1 : 0;
  const type = knowTypeByAssetName(assetName, true)
  

  
  // 2. Update Tracks with Sanitization (New Logic)
  setTracks( prevTracks => {
    // Check if the track ID already exists to avoid duplicates
    const exists = prevTracks.some(t => t.id === newTrackId);
    
    if (exists) return prevTracks;

    // Add the new track object and keep the list sorted by ID
    const updatedTracks = [...prevTracks, { id: newTrackId, type: type as 'video' | 'audio' | 'effects' }];
    
    return updatedTracks.sort((a, b) => a.id - b.id);
  });
  
  var refAsset = assets.find( a => a.name == assetName );

  var deleteClip = clips.find( c => c.id == deleteClipId)

  //var duration = refAsset && refAsset.duration >= 10  ? 10 : refAsset.duration

  //refAsset && refAsset.type != 'image' ? refAsset.duration : 10
  
  

  // 3. Criar o Clip usando o ID que acabamos de gerar (newTrackId)
  const newClip: Clip = {
    id: crypto.randomUUID(),
    name: assetName,
    start: dropTime,
    duration: deleteClip ? deleteClip.duration :  10 ,
    color: getRandomColor(),
    trackId: newTrackId,
    maxduration: refAsset && refAsset.type != 'image' ? refAsset.duration : 10,
    beginmoment: deleteClip ? deleteClip.beginmoment : 0
  };

  setClips(prevClips => {
    const filtered = deleteClipId !== null 
      ? prevClips.filter(c => c.id !== deleteClipId) 
      : prevClips;
    return [...filtered, newClip];
  });

  setDeleteClipId(null);
  showNotify("New track created", "success");
  
};




//create new timelines dropping assets close of a track
const handleDropOnEmptyArea = (e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();

  if (e.dataTransfer.files.length > 0) return;

  const assetName = e.dataTransfer.getData("assetName");
  if (!assetName) return;

  const container = e.currentTarget.getBoundingClientRect();
  const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  
  const relativeY = e.clientY - container.top;
  const x = e.clientX - container.left + scrollLeft;

  //last term to calibrate with  zoom
  const dropTime = Math.max(0, x / PIXELS_PER_SECOND) * (2/pixelsPerSecond);

  const TRACK_HEIGHT = 80;
  const totalTracksHeight = tracks.length * TRACK_HEIGHT;
  const margin = 20;

  // Se soltar acima ou abaixo, a função centralizada resolve
  if (relativeY < -margin) {
    createClipOnNewTrack(assetName, dropTime);
  } else if (relativeY > totalTracksHeight + margin) {
    createClipOnNewTrack(assetName, dropTime);
  }




};

  // Function to lead with Drag direct from OS
const handleNativeDrop = async (paths: string[], mouseX: number, mouseY: number) => {
  if (!currentProjectPath) return;

  const timelineBounds = timelineContainerRef.current?.getBoundingClientRect();
  if (!timelineBounds) return;

  //const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  //const relativeX = mouseX - timelineBounds.left + scrollLeft;
  //const dropTime = Math.max(0, relativeX / PIXELS_PER_SECOND);

  const rect = timelineContainerRef.current.getBoundingClientRect();
  
  // 1. Diferença entre o clique e o início da área visível da timeline
  // Usamos Math.floor para evitar sub-pixels que causam drifts
  const scrollLeft = timelineContainerRef.current.scrollLeft;
  // 2. Ajuste: Se você tiver uma sidebar de tracks (ex: 200px), subtraia aqui
  const trackSidebarWidth = 0; // Altere se houver uma barra lateral interna à timeline
  const relativeX = mouseX - rect.left - trackSidebarWidth + scrollLeft;
  // 3. Cálculo do tempo com o valor atualizado de PIXELS_PER_SECOND
  // last term is to calibrate with newzoom
  const dropTime = Math.max(0, relativeX / PIXELS_PER_SECOND) * (2/pixelsPerSecond);
  
  console.log(`Mouse X: ${mouseX}, Rect Left: ${rect.left}, Scroll: ${scrollLeft}, Final Time: ${dropTime}`);

  for (const path of paths) {
    try {
      await invoke('import_asset', { projectPath: currentProjectPath, filePath: path });
      const fileName = path.split(/[\\/]/).pop() || "Asset";

      var meta
      
      try
      {
        meta = await invoke<{duration: number}>('get_video_metadata', { path: path });
      }
      catch (err)
      {
        meta = {duration: 10}
      }
      
      const duration = meta.duration

      // Lógica de detecção de Track
      const TRACK_HEIGHT = 80;
      const relativeY = mouseY - timelineBounds.top;
      const targetTrackIndex = Math.floor(relativeY / TRACK_HEIGHT);

      // Se soltar abaixo da última track existente, cria uma nova


      const isBusy = (isSpaceOccupied(targetTrackIndex, dropTime, Math.min(duration, 10), null))
      const isNotType = tracks[targetTrackIndex].type !== knowTypeByAssetName(fileName,true)

      if ((targetTrackIndex >= tracks.length || targetTrackIndex < 0) ||  isBusy  || isNotType) {
        await loadAssets();
        createClipOnNewTrack(fileName, dropTime)
        return
      } else {
        
         // Drop em track existente
          const targetTrackId = tracks[targetTrackIndex].id;
          await new Promise(resolve => setTimeout(resolve, 1));

          setClips(prev => [...prev, {
            id: crypto.randomUUID() ,
            name: fileName,
            start: dropTime,
            duration: Math.min(duration, 10),
            color: getRandomColor(),
            trackId: targetTrackId,
            maxduration: duration ? duration : 10,
            beginmoment: 0
          }]);
        



      }
    } catch (err) {
      console.error("Native Import Error:", err);
    }
  }
  loadAssets();
};

  useEffect(() => {
    const preventDefault = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("dragover", preventDefault, false);
    window.addEventListener("drop", preventDefault, false);

    return () => {
      window.removeEventListener("dragover", preventDefault, false);
      window.removeEventListener("drop", preventDefault, false);
    };
  }, []);


  // --- PROJECT METHODS ---


  const loadProjects = async () => {
    if (!rootPath) return;
    try {
      const list = await invoke('list_projects', { rootPath });
      setProjects(list as Project[]);
    } catch (e) { console.error(e); }
  };

  const loadAssets = async () => {
  if (!currentProjectPath) return;
  try {
    const list = await invoke<string[]>('list_assets', { projectPath: currentProjectPath });
    
    // Usamos .map para criar um array de promessas
    const assetPromises = list.map(async (filename) => {
      const extension = filename.split('.').pop()?.toLowerCase();
      const filePath = `${currentProjectPath}/videos/${filename}`;
  
      let type: 'video' | 'audio' | 'image' = 'video';
      if (['jpg', 'jpeg', 'png', 'webp'].includes(extension || '')) type = 'image';
      if (['mp3', 'wav', 'ogg'].includes(extension || '')) type = 'audio';

      let duration = 10;

      if (type !== 'image') {
        try {
          const meta = await invoke<{duration: number}>('get_video_metadata', { path: filePath });
          duration = meta.duration;
        } catch (err) {
          console.warn(`Não foi possível ler meta de ${filename}`, err);
        }
      }

      return {
        name: filename,
        path: filePath,
        duration: duration,
        type: type
      } as Asset;
    });

    // Aguarda todas as metadatas serem lidas em paralelo
    const resolvedAssets = await Promise.all(assetPromises);
    
    if (resolvedAssets.length > 0) {
      setAssets(resolvedAssets);
    }
  } catch (e) { 
    console.error("Falha ao carregar assets:", e); 
  }
};

  const handleSelectRoot = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Select Workspace" });
    if (selected) setRootPath(selected as string);
  };



  const handleFinishSetup = async () => {
    if (rootPath && projectName) {
      try {
        const finalPath = await invoke('create_project_folder', { rootPath, projectName });
        localStorage.setItem("current_project_path", finalPath as string);
        setIsCreatingNew(false);
        loadProjects();
        showNotify("Project Created!", "success");
      } catch (e) {
        showNotify("Error creating project", "error");
      }
    }
  };

const openProject = async (path: string) => {

  console.log('path puro', path)
  localStorage.setItem("current_project_path", path);
  
  try
  {
      
    
    const rawData = await invoke('load_latest_project', { projectPath: path });
    var parsed = JSON.parse(rawData as string);
    setProjectName(parsed.projectName)



    // Update states first
    setClips(parsed.clips || []);
    setAssets(parsed.assets || []);
    setProjectName(parsed.projectName || "Unnamed Project");

    // 1. Encontrar o ID máximo de track de forma segura
    const maxTrackId = (parsed.clips || []).reduce((max, clip) => 
      clip.trackId > max ? clip.trackId : max, 
      0
    );

    // 2. Gerar o array de tracks baseado nos objetos {id, type}
    const newTracks = Array.from({ length: maxTrackId + 1 }, (_, id) => {
      // Busca o primeiro clip desta track para definir o tipo
      const firstClip = parsed.clips.find(c => c.trackId === id);

      // Se a track tiver clip, descobre o tipo. Se estiver vazia, define como 'video' por padrão.
      const trackType = firstClip 
        ? (knowTypeByAssetName(firstClip.name, true) as 'video' | 'audio' | 'effects')
        : 'video';

      return { id, type: trackType };
    });

    setTracks(newTracks);
    
    // Now allow saving
    setIsProjectLoaded(true); 
    setIsSetupOpen(false);
  } catch (err) {
    console.log("No previous project file found, starting fresh.");
    setIsProjectLoaded(true); // Allow saving for new projects too
    setIsSetupOpen(false);
  }
};

  // --- EDITOR HANDLERS ---

  const handleYoutubeDownload = async () => {
    if (!youtubeUrl || !currentProjectPath) return;
    setIsDownloading(true);
    showNotify("Downloading...", "success");
    try {
      await invoke('download_youtube_video', { projectPath: currentProjectPath, url: youtubeUrl });
      showNotify("Download Complete!", "success");
      setIsImportModalOpen(false);
      setYoutubeUrl("");
      loadAssets();
    } catch (e) {
      showNotify("YT-DLP Error: Check your JS Runtime", "error");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDragStart = (
  e: React.DragEvent, 
  color: string | null, 
  trackId: number | null, 
  duration: number | null, 
  assetName: string, 
  isTimelineClip: boolean, 
  clipId: string | null
) => {

  console.log('clipid',clipId)
  // Se o clip arrastado não estiver na seleção atual, selecionamos apenas ele
  if (clipId !== null && !selectedClipIds.includes(clipId)) {
    setSelectedClipIds([clipId]);
  }

  const presentclip = clips.find(c => c.id == clipId )

  var start = presentclip ? presentclip.start : null

  if (isTimelineClip && start !== null) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Calcula quantos segundos existem entre o início do clip e onde o mouse clicou
    const clickOffset = (e.clientX - rect.left) / pixelsPerSecond;
    e.dataTransfer.setData("clickOffset", clickOffset.toString());
  } else {
    // Para novos assets vindos da barra lateral, geralmente clicamos no início ou centro
    // Podemos definir como 0 ou calcular se desejar
    e.dataTransfer.setData("clickOffset", "0");
  }

  // Guardamos os dados do clip "âncora" (o que o mouse pegou)
  e.dataTransfer.setData("assetName", assetName);
  e.dataTransfer.setData("isTimelineClip", isTimelineClip.toString());

  if(trackId)
    e.dataTransfer.setData("previousTrackId", trackId.toString());

  if(color)
    e.dataTransfer.setData("previousColor", color.toString());
  
  if (isTimelineClip && clipId !== null) {
    setDeleteClipId(clipId);
    
    // Guardamos o tempo de início do clip âncora para calcular o deslocamento dos outros
    const anchorClip = clips.find(c => c.id === clipId);
    if (anchorClip) {
      e.dataTransfer.setData("anchorStart", anchorClip.start.toString());
    }
  }
};


  // --- TAURI V2 NATIVE DRAG & DROP LISTENER FOR FILES FROM OS (NOT ASSETS) ---
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupDropListener = async () => {
      // Armazena a função de desinscrição retornada pela Promise
      const unsubscribe = await getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          const { paths, position } = event.payload;
          const timelineBounds = timelineContainerRef.current?.getBoundingClientRect();
          const isTimelineZone = timelineBounds &&
            position.y >= timelineBounds.top &&
            position.y <= timelineBounds.bottom;

          handleNativeDrop(paths, position.x, position.y);
        }
      });
      unlisten = unsubscribe;
    };

    if (!isSetupOpen) {
      setupDropListener();
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [isSetupOpen, currentProjectPath]);



  //make function split and selection
 const handleMassSplitAndSelect = (direction: 'left' | 'right') => {
    const playheadTime = playheadPos / pixelsPerSecond;
    
    saveHistory(clips, assets);
    
    // 1. Criamos um novo array para processar
    let processedClips: Clip[] = [];
    
    // Precisamos percorrer todos os clips existentes
    clips.forEach(clip => {
        // Se o clip está sob a agulha, dividimos
        if (playheadTime > clip.start && playheadTime < (clip.start + clip.duration)) {
            const firstPartDuration = playheadTime - clip.start;
            const secondPartDuration = clip.duration - firstPartDuration;

            const firstClip: Clip = { 
                ...clip, 
                duration: firstPartDuration 
            };

               
            const secondClip: Clip = { 
                ...clip, 
                // Geramos um ID que garante unicidade mesmo dentro de um loop rápido
                id: crypto.randomUUID(), 
                start: playheadTime, 
                duration: secondPartDuration,
                beginmoment: clip.beginmoment + firstPartDuration
            };

            processedClips.push(firstClip, secondClip);
        } else {
            // Se não está sob a agulha, apenas mantemos o clip como está
            processedClips.push(clip);
        }
    });

    // 2. Ordenamos para garantir consistência
    processedClips.sort((a, b) => a.start - b.start);

    // 3. Atualizar o estado dos clips
    setClips(processedClips);

    // 4. Lógica de Seleção:
    // Para 'left': selecionamos clips que terminam antes ou exatamente na agulha
    // Para 'right': selecionamos clips que começam a partir da agulha
    const selectedIds = processedClips
        .filter(c => {
            if (direction === 'left') {
                // Consideramos o fim do clip com uma pequena margem (EPSILON)
                return (c.start + c.duration) <= playheadTime + 0.01;
            } else {
                return c.start >= playheadTime - 0.01;
            }
        })
        .map(c => c.id);

    setSelectedClipIds(selectedIds);
    setSelectedAssets([]); 
    
    showNotify(`Split and selected everything to the ${direction}`, "success");
};



const isSpaceOccupied = (trackId: number, start: number, duration: number, excludeId: string | null = null) => {
    const newEnd = start + duration;
    const EPSILON = 0.01; 

    return clips.some(clip => {
      if (excludeId !== null && clip.id === excludeId) return false;
      if (clip.trackId !== trackId) return false;

      const clipEnd = clip.start + clip.duration;
      const isOverlapping = start < (clipEnd - EPSILON) && newEnd > (clip.start + EPSILON);
      
      return isOverlapping;
    });
  };

 
const handleDropOnTimeline = (e: React.DragEvent, trackId: number) => {
  e.preventDefault();
  
  //const isTimelineClip = e.dataTransfer.getData("isTimelineClip") === "true";
  //const anchorStart = parseFloat(e.dataTransfer.getData("anchorStart") || "0");
  
  //const rect = e.currentTarget.getBoundingClientRect();
  //const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  //const rawDropTime = (e.clientX - rect.left + scrollLeft) / pixelsPerSecond;
  //const dropTime = getSnappedTime(rawDropTime, deleteClipId, trackId);

  const previousTrackRaw = e.dataTransfer.getData("previousTrackId");
  const previousTrack = previousTrackRaw ? Number(previousTrackRaw) : null;

  const previousColor = e.dataTransfer.getData("previousColor");

  //const clickOffset = parseFloat(e.dataTransfer.getData("clickOffset") || "0");

  const isTimelineClip = e.dataTransfer.getData("isTimelineClip") === "true";
  const anchorStart = parseFloat(e.dataTransfer.getData("anchorStart") || "0");
  const assetName = e.dataTransfer.getData("assetName");
  
  // PEGUE O OFFSET AQUI
  const clickOffset = parseFloat(e.dataTransfer.getData("clickOffset") || "0");
  
  const rect = e.currentTarget.getBoundingClientRect();
  const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  
  // 1. Posição absoluta do mouse no tempo
  const mouseTime = (e.clientX - rect.left + scrollLeft) / pixelsPerSecond;
  
  // 2. O tempo real de drop é o mouse menos onde você "agarrou" o clip
  const rawDropTime = mouseTime - clickOffset; 
  
  // Aplica o Snap a partir do início real do clip
  const dropTime = getSnappedTime(rawDropTime, deleteClipId, trackId);

    // --- SUA NOVA FUNÇÃO DE ESPAÇO OCUPADO ---
  


  saveHistory(clips, assets);

  if (isTimelineClip && selectedClipIds.length > 0) {
  const timeOffset = dropTime - anchorStart;
  const anchorClip = clips.find(c => c.id === deleteClipId);
  const trackOffset = anchorClip ? trackId - anchorClip.trackId : 0;

  // 1. Clips que NÃO estão na seleção (ficam parados)
  const otherClips = clips.filter(c => !selectedClipIds.includes(c.id));
  
  // 2. Calculamos a nova posição de todos os selecionados
  const tracksid = tracks.map( t => t.id)
  let maxTrackId = Math.max(...tracksid, trackId);
  
  const finalMovedClips = clips
    .filter(c => selectedClipIds.includes(c.id))
    .map(clip => {
      let targetTrack = Math.max(0, clip.trackId + trackOffset);
      const targetStart = Math.max(0, clip.start + timeOffset);

      // Se houver colisão, jogamos para uma track acima das existentes
      if (isSpaceOccupied(targetTrack, targetStart, clip.duration, clip.id)) {
        maxTrackId++;
        targetTrack = maxTrackId;
      }

      return {
        ...clip,
        start: targetStart,
        trackId: targetTrack
      };
    });

  // 3. ATUALIZAÇÃO ÚNICA: Une os clips parados com os novos movidos
  setClips([...otherClips, ...finalMovedClips]);
  
  // 4. Garante que o estado 'tracks' conheça a nova track se ela foi criada
  if (maxTrackId > Math.max(...tracksid)) {
    //setTracks(prev => [...new Set([...prev, maxTrackId])].sort((a,b) => a-b)); old logic
    
    const newTracksCreated = finalMovedClips.map(fc => ({
      id: fc.trackId,
      type: knowTypeByAssetName(fc.name, true) as 'video' | 'audio' | 'effects'
    }));

    setTracks(prev => {
      const allTracks = [...prev, ...newTracksCreated];
      // Remove duplicatas comparando o ID real
      const uniqueTracks = allTracks.filter((track, index, self) =>
        index === self.findIndex((t) => t.id === track.id)
      );
      return uniqueTracks.sort((a, b) => a.id - b.id);
    });
  }
} else {
    // Lógica para NOVO clip (Asset -> Timeline) - permanece igual
    const assetName = e.dataTransfer.getData("assetName");
    //if no have space useeffect with comment 'avoid clip over another'
    // 1. Tenta encontrar o asset correspondente
    const assetNow = assets.find(a => a.name === assetName);
    
    // 2. Define a duração padrão com segurança
    // Se assetNow existir e for > 10, usa 10. Senão usa a duração dele ou 5 (fallback total)
    const defaultDuration = assetNow ? Math.min(assetNow.duration, 10) : 10;
    const totalMaxDuration = assetNow ? assetNow.duration : 10;


    const newClip: Clip = {
      id: crypto.randomUUID(), // ID mais seguro
      name: assetName,
      start: dropTime,
      duration: defaultDuration,
      color: getRandomColor(),
      trackId: trackId,
      maxduration: totalMaxDuration,
      beginmoment: 0
    };

    setClips(prev => [...prev, newClip]);
    setDeleteClipId(null);
  }

  setDeleteClipId(null);
};






const handleImportFile = async () => {
  try {
    // 1. Open native dialog to select a file
    const selected = await open({
      multiple: false,
      filters: [{
        name: 'Media',
        extensions: ['mp4', 'mkv', 'avi', 'mov', 'mp3', 'wav', 'ogg', 'png', 'jpg', 'jpeg', 'webp']
      }]
    });

    if (!selected || Array.isArray(selected)) return; 
    
    const filePath = selected as string;
    const fileName = filePath.split(/[\\/]/).pop() || "File";
    const extension = fileName.split('.').pop()?.toLowerCase() || '';

    // 2. Define allowed extensions for each type
    

    // 3. Check if the extension is valid
    const isImage = imageExtensions.includes(extension);
    const isAudio = audioExtensions.includes(extension);
    const isVideo = videoExtensions.includes(extension);

    if (!isImage && !isAudio && !isVideo) {
      showNotify("Invalid file type: Only video, audio, and images are allowed", "error");
      return;
    }

    // 4. Assign the correct media type
    let type: 'video' | 'audio' | 'image' = 'video';
    if (isImage) type = 'image';
    if (isAudio) type = 'audio';

    let duration = 10; // Default duration for images

    if (type !== 'image') {
      // 5. Call Rust backend to get the real duration for video/audio
      try {
        const meta = await invoke<{duration: number}>('get_video_metadata', { path: filePath });
        duration = meta.duration;
      } catch (metaError) {
        console.error("Failed to fetch metadata, using default duration:", metaError);
        duration = 10; // Fallback duration
      }
    }

    // 6. Create the new asset object
    const newAsset: Asset = {
      name: fileName,
      path: filePath,
      duration: duration,
      type: type
    };

    // 7. Update state and notify the user
    setAssets(prev => [...prev, newAsset]);
    showNotify(`Imported ${type}: ${fileName}`, "success");
    
  } catch (err) {
    console.error(err);
    showNotify("Error selecting or reading file", "error");
  }
};


  const showNotify = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  
  //open main page with projects
  useEffect(() => { if (rootPath) loadProjects(); }, [rootPath]);
  
  //oping project
  useEffect(() => { if (!isSetupOpen && currentProjectPath) loadAssets(); }, [isSetupOpen]);

  // --- RENDER ---
return (
  <div className="flex flex-col h-screen w-screen bg-black text-zinc-300 font-sans overflow-hidden select-none">
    
    {/* NOTIFICATIONS SYSTEM */}
    <AnimatePresence>
      {notification && (
        <motion.div 
          initial={{ y: 50, opacity: 0 }} 
          animate={{ y: 0, opacity: 1 }} 
          exit={{ y: 20, opacity: 0 }}
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[500] px-6 py-3 rounded-full font-bold text-xs shadow-2xl flex items-center gap-3 border ${
            notification.type === 'success' ? 'bg-zinc-900 border-green-500/50 text-green-400' : 'bg-zinc-900 border-red-500/50 text-red-400'
          }`}
        >
          <div className={`w-2 h-2 rounded-full ${notification.type === 'success' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          {notification.message.toUpperCase()}
        </motion.div>
      )}
    </AnimatePresence>

    {isSetupOpen ? (
      /* --- PROJECT MANAGER VIEW --- */
      <div className="flex flex-col h-full w-full bg-[#0a0a0a]">
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-8 bg-[#111]">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center font-black text-white">FC</div>
            <h1 className="text-lg font-bold italic text-white">FREECUT <span className="text-zinc-500 font-light text-sm not-italic">MANAGER</span></h1>
          </div>
          <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400"><Settings size={20} /></button>
        </header>

        <main className="flex-1 flex overflow-hidden">
          <aside className="w-64 border-r border-zinc-800 p-6 space-y-2 bg-[#0d0d0d]">
            <button className="w-full flex items-center gap-3 px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-bold"><Clock size={18} /> Recent</button>
            <button onClick={handleSelectRoot} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-zinc-900 text-zinc-500 rounded-lg text-sm transition-colors"><FolderOpen size={18} /> Workspace</button>
          </aside>

          <section className="flex-1 p-10 overflow-y-auto">
            <div className="flex justify-between items-end mb-10">
              <div>
                <h2 className="text-3xl font-black text-white mb-1">Your Productions</h2>
                <p className="text-zinc-600 text-[10px] font-mono uppercase">{rootPath || 'Select a workspace'}</p>
              </div>
              <button onClick={() => setIsCreatingNew(true)} className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-xl font-black text-xs flex items-center gap-2 transition-all shadow-xl shadow-red-900/40">
                <Plus size={20} strokeWidth={3} /> NEW PROJECT
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {projects.map((proj) => (
                <motion.div 
                  key={proj.path} 
                  whileHover={{ scale: 1.02 }} 
                  onClick={() => openProject(proj.path)}
                  className="group bg-[#121212] border border-zinc-800/50 rounded-2xl overflow-hidden cursor-pointer hover:border-red-600 transition-all relative"
                >
                  <button 
                    onClick={(e) => { e.stopPropagation(); setProjectToDelete(proj); }}
                    className="absolute top-2 right-2 z-50 p-2 bg-black/50 hover:bg-red-600 text-zinc-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X size={14} /> 
                  </button>
                  <div className="aspect-video bg-[#1a1a1a] flex items-center justify-center border-b border-zinc-800">
                    <LayoutGrid size={40} className="text-zinc-800 group-hover:text-red-600/20" />
                  </div>
                  <div className="p-5">
                    <h3 className="font-bold text-zinc-100 truncate text-sm uppercase">{proj.name}</h3>
                  </div>
                </motion.div>
              ))}
            </div>
          </section>
        </main>
      </div>
    ) : (
      /* --- EDITOR VIEW --- */
      <div className="flex flex-col h-full">
        {/* Editor Header */}
        <header className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 bg-[#111] z-10 shadow-md">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSetupOpen(true)} className="text-zinc-500 hover:text-white text-[10px] font-bold">BACK</button>
            <h1 className="text-[11px] font-black uppercase text-white tracking-widest">{projectName}</h1>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all active:scale-95 shadow-lg shadow-red-900/20"
            >
              <Youtube size={14} /> Download
            </button>
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400"><Share2 size={16}/></button>
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400"><Settings size={16}/></button>
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400"><Import size={16}/></button>
          </div>
        </header>

        {/* Top Section: Sidebar + Preview */}
        <main className="flex-1 flex overflow-hidden min-h-0">
          <aside className="w-64 border-r border-zinc-800 bg-[#0c0c0c] flex flex-col hidden lg:flex">
            <div className="p-4 border-b border-zinc-900">
              <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Media Library</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <div onClick={handleImportFile} className="aspect-video border border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center group cursor-pointer hover:bg-zinc-900/50 mb-4 transition-colors">
                <Plus size={20} className="text-zinc-700 group-hover:text-red-500 transition-colors" />
                <h2 className="text-[9px] font-black text-zinc-500 uppercase mt-2">Import Media</h2>
              </div>
              
              {assets.map((asset, index) => (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={index}
                  onClick={(e) => toggleAssetSelection(asset, e.shiftKey || e.ctrlKey)}
                  className={`p-2 rounded-lg flex items-center gap-3 group transition-all cursor-grab active:cursor-grabbing border ${
                    selectedAssets.includes(asset) ? 'bg-red-500/10 border-red-500' : 'bg-[#151515] border-zinc-800 hover:border-zinc-600'
                  }`}
                  draggable="true"
                  onDragStart={(e) => handleDragStart(e, null, null, null, asset.name, false, null)}
                >
                  <div className="w-10 h-7 bg-black rounded flex items-center justify-center">
                    <Play size={10} className={selectedAssets.includes(asset) ? "text-red-500" : "text-zinc-700"} />
                  </div>
                  <div className="flex-1 min-w-0" >
                    <p className="text-[10px] outline-none font-bold text-zinc-300 truncate" contentEditable
                      suppressContentEditableWarning={true}
                      onDoubleClick={(e) => {
                        // Garante que o texto seja selecionado ao dar duplo clique
                        e.stopPropagation();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.target as HTMLElement).blur(); // Dispara o onBlur
                        }

                        if (e.key === 'Escape') {
                          // Cancel edit
                          e.currentTarget.innerText = asset.name;
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const newName = e.target.innerText.trim();
                        handleRenameAsset(asset.name, newName);
                      }}
                      >{asset.name}</p>
                    <p className="text-[8px] text-zinc-600 uppercase font-black">
                      {asset.type} • {asset.duration.toFixed(1)}s
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </aside>

          {/* PREVIEW PLAYER */}
          <section className="flex-1 bg-black flex flex-col items-center justify-center p-8 relative">
            <div 
              className="w-full max-w-4xl aspect-video bg-[#050505] rounded-xl border border-zinc-800 flex items-center justify-center relative group cursor-pointer overflow-hidden shadow-2xl"
              onClick={togglePlay}
            >
              {isPlaying ? (
                <Pause size={56} className="text-white/5 group-hover:text-white/30 transition-all scale-90 group-hover:scale-100" />
              ) : (
                <Play size={56} className="text-white/5 group-hover:text-white/30 transition-all scale-90 group-hover:scale-100" />
              )}
            </div>

            {/* PLAYER CONTROLS */}
            <div className="flex items-center gap-8 mt-6">
              <button className="text-zinc-600 hover:text-white transition-colors"><SkipBack size={24} fill="currentColor"/></button>
              <button 
                onClick={togglePlay}
                className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-black hover:scale-110 active:scale-95 transition-all shadow-xl shadow-white/5"
              >
                {isPlaying ? <Pause size={28} fill="black" /> : <Play size={28} fill="black" className="ml-1" />}
              </button>
              <button className="text-zinc-600 hover:text-white transition-colors"><SkipForward size={24} fill="currentColor"/></button>
            </div>
          </section>
        </main>

        {/* --- DYNAMIC TIMELINE SECTION --- */}
        <footer 
          className="bg-[#0c0c0c] border-t border-zinc-800 flex flex-col relative"
          style={{ height: `${timelineHeight}px` }}
        >
          {/* TOP RESIZER HANDLE */}
          <div 
            onMouseDown={() => {
              isResizingTimeline.current = true;
              document.body.style.cursor = 'row-resize';
            }}
            className="absolute -top-1 left-0 w-full h-2 cursor-row-resize z-[60] hover:bg-blue-500/40 transition-colors"
          />

          {/* Timeline Toolbar */}
          <div className="h-10 border-b border-zinc-900 flex items-center px-4 justify-between bg-[#0e0e0e] shrink-0">
            <div className="flex items-center gap-6">
              <button onClick={handleSplit} className="flex items-center gap-2 text-[10px] font-black text-zinc-500 hover:text-red-500 uppercase transition-colors">
                <Scissors size={14}/> Split (S)
              </button>
              
              <button 
                onClick={() => {
                  const newState = !isSnapEnabled;
                  setIsSnapEnabled(newState);
                  showNotify(`Snap: ${newState ? 'ON' : 'OFF'}`, "success");
                }}
                className={`flex items-center gap-2 text-[10px] font-black uppercase transition-all ${isSnapEnabled ? 'text-red-500' : 'text-zinc-500 hover:text-white'}`}
                title="Snap (Ctrl + T)"
              >
                <LayoutGrid size={14} className={isSnapEnabled ? "animate-pulse" : ""} />
                Snap
              </button>

              {/* Zoom Control */}
              <div className="flex items-center gap-3 bg-zinc-900/50 px-3 py-1.5 rounded-md border border-zinc-800">
                <ZoomOut size={14} className="text-zinc-600" />
                <input
                  type="range" min={MIN_ZOOM} max={MAX_ZOOM} value={pixelsPerSecond}
                  onChange={(e) => setPixelsPerSecond(Number(e.target.value))}
                  className="w-24 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                  [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-none"
                />
                <div className="text-[10px]" > {pixelsPerSecond} </div>
                <ZoomIn size={14} className="text-zinc-600" />
              </div>

              {/* Timecode Display */}
              <div className="text-[10px] font-mono text-zinc-400 flex items-center gap-2 bg-black/40 px-3 py-1 rounded border border-zinc-800/50">
                <Clock size={12} className="text-zinc-600" />
                <span className="text-white font-bold tracking-widest min-w-[80px]">
                  {formatTime(playheadPos / pixelsPerSecond)}
                </span>
              </div>


                {/* Dentro da div da Toolbar, junto com Scissors, Snap, etc */}
                <div className="flex items-center gap-1 border-l border-zinc-800 ml-4 pl-4">
                  <button 
                    onClick={() => handleMassSplitAndSelect('left')}
                    className="flex flex-col items-center gap-0.5 px-2 py-1 rounded hover:bg-zinc-800 group transition-all"
                    title="Split and Select Left (Ctrl+Q)"
                  >
                    <div className="flex items-center text-zinc-500 group-hover:text-blue-400">
                      <SkipBack size={14} className="mr-[-4px]" />
                      <Scissors size={12} />
                    </div>
                    <span className="text-[8px] font-black text-zinc-600 uppercase">Sel Left</span>
                  </button>

                  <button 
                    onClick={() => handleMassSplitAndSelect('right')}
                    className="flex flex-col items-center gap-0.5 px-2 py-1 rounded hover:bg-zinc-800 group transition-all"
                    title="Split and Select Right (Ctrl+W)"
                  >
                    <div className="flex items-center text-zinc-500 group-hover:text-blue-400">
                      <Scissors size={12} />
                      <SkipForward size={14} className="ml-[-4px]" />
                    </div>
                    <span className="text-[8px] font-black text-zinc-600 uppercase">Sel Right</span>
                  </button>
                </div>
            </div>
          </div>

          {/* Timeline Tracks Area */}

          {isBoxSelecting && (
          <div 
            className="absolute border border-blue-500 bg-blue-500/20 z-[100] pointer-events-none"
            style={{
              left: Math.min(boxStart.x, boxEnd.x),
              top: Math.min(boxStart.y, boxEnd.y),
              width: Math.abs(boxEnd.x - boxStart.x),
              height: Math.abs(boxEnd.y - boxStart.y),
            }}
          />
        )}

      
{/* --- TIMELINE SECTION --- */}
<div className="flex flex-col bg-[#09090b] rounded-xl border border-white/5 overflow-hidden relative m-4 shadow-2xl">
  
  {/* 1. RULER HEADER (Fixed Side + Scrolling Ruler) */}
  <div className="flex border-b border-white/5 bg-zinc-900/30">
    {/* Fixed Aside Header */}
    <div className="w-48 shrink-0 border-r border-white/5 flex items-center px-4 bg-zinc-900/50">
      <Clock size={12} className="text-zinc-500 mr-2" />
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Timeline</span>
    </div>

    {/* Scrolling Ruler Area */}
    <div 
      className="flex-1 relative h-10 cursor-pointer overflow-hidden select-none"
      onMouseDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
        const newPos = e.clientX - rect.left + scrollLeft;
        setPlayheadPos(newPos);
      }}
      onMouseMove={(e) => {
        if (e.buttons === 1) {
          const rect = e.currentTarget.getBoundingClientRect();
          const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
          const newPos = Math.max(0, e.clientX - rect.left + scrollLeft);
          setPlayheadPos(newPos);
        }
      }}
    >
      {/* Time Markers */}
      {[...Array(200)].map((_, i) => {
        const timeInSeconds = i * 5;
        const isMajor = timeInSeconds % 30 === 0;
        return (
          <div 
            key={i} 
            className="absolute h-full border-l border-white/5 pointer-events-none" 
            style={{ left: timeInSeconds * pixelsPerSecond }}
          >
            <div className={`h-2 border-l ${isMajor ? 'border-zinc-400' : 'border-zinc-700'}`} />
            {isMajor && (
              <span className="text-[8px] text-zinc-500 font-mono ml-1 mt-1 block">
                {formatTime(timeInSeconds)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  </div>

  {/* 2. TRACKS CONTENT (Fixed Asides + Scrolling Clips) */}
  <div className="flex flex-1 overflow-hidden relative">
    
    {/* Fixed Column for Track Controls */}
    <div className="w-48 shrink-0 flex flex-col gap-1.5 p-2 border-r border-white/5 bg-zinc-900/10 z-20">
      {tracks
        .sort((a, b) => {
          const priority = (type: string) => (type === 'audio' ? 1 : 0);
          return priority(a.type) - priority(b.type) || a.id - b.id;
        })
        .map((track) => (
          <div key={track.id} className="h-16 flex items-center px-3 gap-3 bg-zinc-900/40 border border-zinc-800/40 rounded-md">
            <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center text-zinc-400">
              {track.type === 'audio' && <Music size={14} />}
              {track.type === 'video' && <Play size={14} fill="currentColor" />}
              {track.type === 'effects' && <Sparkles size={14} />}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[9px] font-black text-white/70 uppercase truncate">{track.type}</span>
              <span className="text-[7px] font-bold text-zinc-600 uppercase">Track {track.id + 1}</span>
            </div>
          </div>
        ))}
    </div>

    {/* Scrolling Area for Clips and Playhead */}
    <div 
      ref={timelineContainerRef}
      className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar relative p-2"
      style={{ minHeight: '400px' }}
      onScroll={(e) => {
        // Se quiseres sincronizar a régua se ela estivesse num div separado, farias aqui
      }}
    >
      {/* THE NEEDLE (PLAYHEAD) - Absolute to the scrolling container */}
      <div 
        className="absolute top-0 bottom-0 w-[2px] bg-red-600 z-[100] pointer-events-none" 
        style={{ left: playheadPos}} // O +8 é apenas para compensar o padding (p-2) do container
      >
        <div className="w-4 h-4 bg-red-600 rounded-b-full shadow-[0_0_15px_rgba(220,38,38,0.6)] -ml-[7px]" />
      </div>

      {/* Render Tracks Background/Dropzones */}
      <div className="flex flex-col gap-1.5 min-w-[10000px]">
        {tracks.map((track) => (
          <div 
            key={track.id}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDropOnTimeline(e, track.id)}
            className="h-16 relative bg-zinc-900/5 border border-zinc-800/10 rounded-md hover:bg-zinc-900/20 transition-colors"
          >
            {/* Clips logic */}
            {clips
              .filter(c => c.trackId === track.id)
              .map((clip) => (
                <motion.div 
                  key={clip.id}
                  draggable="true"
                  onDragStart={(e) => handleDragStart(e, clip.color, track.id, clip.duration, clip.name, true, clip.id)}
                  onClick={(e) => { e.stopPropagation(); toggleClipSelection(clip.id, e.shiftKey || e.ctrlKey); }}
                  className={`absolute inset-y-1.5 ${clip.color} rounded-md flex items-center shadow-lg cursor-grab active:cursor-grabbing border-2 ${
                    selectedClipIds.includes(clip.id) ? 'border-white ring-4 ring-white/10 z-30' : 'border-black/20'
                  }`}
                  style={{
                    left: clip.start * pixelsPerSecond,
                    width: clip.duration * pixelsPerSecond,
                  }}
                >
                  <div className="absolute left-0 inset-y-0 w-1.5 cursor-ew-resize hover:bg-white/40 z-10" onMouseDown={(e) => startResizing(e, clip.id, 'left')} />
                  <div className="px-3 w-full overflow-hidden">
                    <p className="text-[9px] font-black text-white truncate uppercase italic leading-none drop-shadow-md">
                      {clip.name}
                    </p>
                  </div>
                  <div className="absolute right-0 inset-y-0 w-1.5 cursor-ew-resize hover:bg-white/40 z-10" onMouseDown={(e) => startResizing(e, clip.id, 'right')} />
                </motion.div>
              ))}
          </div>
        ))}
      </div>
    </div>
  </div>

  {/* Footer with Add Track and Zoom */}
  <div className="flex p-2 bg-zinc-900/50 border-t border-white/5 items-center justify-between">
    <button 
      onClick={() => setTracks(prev => [...prev, { id: Math.max(...prev.map(t => t.id), -1) + 1, type: 'video' }])}
      className="flex items-center gap-2 text-[9px] font-black text-zinc-500 hover:text-white uppercase transition-colors px-3 py-1.5 border border-zinc-800 rounded-lg"
    >
      <Plus size={12} /> Add Track
    </button>

    <div className="flex items-center gap-4 px-4">
       <ZoomOut size={14} className="text-zinc-600 cursor-pointer hover:text-white" onClick={() => setPixelsPerSecond(prev => Math.max(5, prev - 5))} />
       <div className="w-32 h-1 bg-zinc-800 rounded-full relative">
          <div className="absolute top-0 left-0 h-full bg-zinc-500 rounded-full" style={{ width: `${(pixelsPerSecond / 100) * 100}%` }} />
       </div>
       <ZoomIn size={14} className="text-zinc-600 cursor-pointer hover:text-white" onClick={() => setPixelsPerSecond(prev => Math.min(100, prev + 5))} />
    </div>
  </div>
</div>

        </footer>
      </div>
    )}

    {/* MODALS - Mantidos para consistência */}
    <AnimatePresence>
      {isCreatingNew && (
        <div className="fixed inset-0 bg-black/95 z-[300] flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="bg-[#121212] border border-zinc-800 p-10 rounded-3xl w-full max-w-sm shadow-2xl">
            <h2 className="text-2xl font-black mb-8 text-white italic">NEW PROJECT</h2>
            <input type="text" placeholder="Project Title" value={projectName} onChange={(e) => setProjectName(e.target.value)}
              className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-4 text-white font-bold outline-none focus:border-red-600 transition-all" />
            <div className="flex gap-4 mt-6">
              <button onClick={() => setIsCreatingNew(false)} className="flex-1 py-4 text-[10px] font-black text-zinc-500 uppercase">Cancel</button>
              <button onClick={handleFinishSetup} className="flex-1 bg-red-600 py-4 rounded-2xl font-black text-xs text-white uppercase">Create</button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* Import Modal */}
    <AnimatePresence>
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/90 z-[400] flex items-center justify-center p-4">
          <motion.div initial={{ y: 20 }} animate={{ y: 0 }} className="bg-[#18181b] border border-zinc-800 p-8 rounded-3xl w-full max-w-md">
            <h2 className="text-xl font-black flex items-center gap-3 text-white mb-6"><Youtube className="text-red-600" /> YT DOWNLOAD</h2>
            <input type="text" placeholder="URL do vídeo..." value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)}
              className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-4 text-sm font-bold text-white outline-none focus:border-red-600 mb-6" />
            <button disabled={isDownloading} onClick={handleYoutubeDownload}
              className={`w-full py-4 rounded-xl font-black text-xs text-white ${isDownloading ? 'bg-zinc-800' : 'bg-red-600 hover:bg-red-700'}`}>
              {isDownloading ? "DOWNLOADING..." : "FETCH MEDIA"}
            </button>
            <button onClick={() => setIsImportModalOpen(false)} className="w-full mt-4 text-[10px] text-zinc-500 font-bold uppercase">Fechar</button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* Delete Confirmation */}
    <AnimatePresence>
      {projectToDelete && (
        <div className="fixed inset-0 bg-black/90 z-[400] flex items-center justify-center p-4 backdrop-blur-md">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }} 
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-[#121212] border border-red-900/30 p-8 rounded-3xl w-full max-w-sm text-center"
          >
            <div className="w-16 h-16 bg-red-600/10 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <X size={32} />
            </div>
            <h2 className="text-xl font-black text-white mb-2 uppercase italic tracking-tighter">Are you sure?</h2>
            <p className="text-zinc-500 text-xs mb-8">
              Deleting <span className="text-white font-bold">{projectToDelete.name}</span> is permanent.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setProjectToDelete(null)} className="flex-1 py-3 text-[10px] font-black text-zinc-500 hover:text-white uppercase tracking-widest">Cancel</button>
              <button onClick={handleDeleteProject} className="flex-1 bg-red-600 hover:bg-red-700 py-3 rounded-xl font-black text-xs text-white uppercase">Delete</button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  </div>
);
}