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
  ZoomOut
  
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
  id: number;
  name: string;
  start: number;
  duration: number;
  color: string;
  trackId: number;
}

interface ProjectFileData {
  projectName: string;
  assets: string[];
  clips: Clip[];
  lastModified: number;
  copyOf?: string; // Pointer to another main{timestamp}.project file
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
  const [assets, setAssets] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [tracks, setTracks] = useState<number[]>([0]);

  //deleteClipId is used to store the id of a clip that is changed of track
  const [deleteClipId, setDeleteClipId] = useState<number | null>(null);

  const currentProjectPath = localStorage.getItem("current_project_path");
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);





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
  const [selectedClipIds, setSelectedClipIds] = useState<number[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);



  //snap function
  const [isSnapEnabled, setIsSnapEnabled] = useState(true);


  const [isPlaying, setIsPlaying] = useState(false);
  const requestRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);


  /**
   * History Manager with a 100-step limit.
   * Uses a simple array-based stack to track clips and assets.
   */
  const [history, setHistory] = useState<{ clips: Clip[], assets: string[] }[]>([]);
  const [redoStack, setRedoStack] = useState<{ clips: Clip[], assets: string[] }[]>([]);


  // This ref prevents the useEffect from saving history during an Undo/Redo operation
  const isUndoRedoAction = useRef(false);

  const MAX_HISTORY_STEPS = 100;


  // Default zoom: 100 pixels represents 1 second
  const [pixelsPerSecond, setPixelsPerSecond] = useState(100);

  // Limits to prevent the timeline from disappearing or becoming infinite
  const MIN_ZOOM = 100;
  const MAX_ZOOM = 1000;


    /**
   * Adjusts the timeline scale.
   * @param factor - Positive to zoom in, negative to zoom out
   */
  const handleZoom = (factor: number) => {
    setPixelsPerSecond(prev => {
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + factor));
      return newZoom;
    });
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
        handleZoom(50);
      }
      // Zoom out with Ctrl + "-" or just "-"
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        handleZoom(-50);
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
  const saveHistory = (currentClips: Clip[], currentAssets: string[]) => {
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
  const getClipBoundaries = (clipId: number) => {
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



 



  // Code to make the clip resizable 
  const handleResize = (id: number, deltaX: number, side: 'left' | 'right') => {
    const { minStart, maxEndTimestamp } = getClipBoundaries(id);

    deltaX = 0.2 * deltaX
    const deltaSeconds = deltaX / PIXELS_PER_SECOND;

    setClips(prev => prev.map(clip => {
      if (clip.id !== id) return clip;

      if (side === 'right') {
        // Limit: current start + new duration cannot exceed next clip's start
        const newDuration = Math.max(0.5, clip.duration + deltaSeconds);
        const finalDuration = (clip.start + newDuration > maxEndTimestamp) 
          ? (maxEndTimestamp - clip.start) 
          : newDuration;

        return { ...clip, duration: finalDuration };
      } else {
        // Limit: new start cannot be less than previous clip's end
        let newStart = clip.start + deltaSeconds;
        if (newStart < minStart) newStart = minStart;

        // Adjust duration so the end point stays fixed while moving the start
        const endPoint = clip.start + clip.duration;
        const finalDuration = Math.max(0.5, endPoint - newStart);

        return { ...clip, start: newStart, duration: finalDuration };
      }
    }));
  };



  //function to help handleResize cause Drag won't work because the Drag of Parent Element
  const startResizing = (e: React.MouseEvent, clipId: number, side: 'left' | 'right') => {
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
  const toggleAssetSelection = (assetName: string, isShift: boolean) => {
    setSelectedClipIds([]); // Clear clips when selecting assets
    setSelectedAssets(prev => {
      if (isShift) {
        return prev.includes(assetName) 
          ? prev.filter(a => a !== assetName) 
          : [...prev, assetName];
      }
      return [assetName];
    });
  };

  /**
 * Manages multiple clip selection.
 * If shiftKey is pressed, it toggles the clip in the current selection.
 * Otherwise, it selects only the clicked clip.
 */
  const toggleClipSelection = (clipId: number, isMultiSelect: boolean) => {
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
      setClips(prev => prev.filter(c => !selectedAssets.includes(c.name)));
      setSelectedAssets([]);
    }

    showNotify("Selection purged", "success");
  };

  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
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

        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          handleSplit();
        }


        //Space (Player Needle move)  
        if (e.code === 'Space') {
          e.preventDefault(); // Impede o scroll da página
          togglePlay();
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
  const playheadTime = playheadPos / PIXELS_PER_SECOND;

  // 1. Find ALL clips under the playhead at this moment
  const clipsAtPlayhead = clips.filter(c => 
    playheadTime > c.start && 
    playheadTime < (c.start + c.duration)
  );

  let targetClip: Clip | undefined;

  // 2. Selection Logic
  if (selectedClipId !== null) {
    targetClip = clipsAtPlayhead.find(c => c.id === selectedClipId);
    
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

  // 3. CRITICAL: Save history ONLY after all checks pass
  // This ensures we don't save a history state if the function returns early
  saveHistory(clips, assets);

  // 4. Calculate new segments
  const firstPartDuration = playheadTime - targetClip.start;
  const secondPartDuration = targetClip.duration - firstPartDuration;

  // Create the two new clip pieces
  const firstClip = { ...targetClip, duration: firstPartDuration };
  const secondClip = { 
    ...targetClip, 
    id: Date.now() + Math.random(), 
    start: playheadTime, 
    duration: secondPartDuration 
  };

  // 5. Update state
  setClips(prev => [
    ...prev.filter(c => c.id !== targetClip!.id),
    firstClip,
    secondClip
  ]);

  setSelectedClipId(secondClip.id);
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
  const getSnappedTime = (currentTime: number, excludeId: number | null = null, trackId: number | null = null) => {
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



    //Function to navigate between .project versions
    const handleFileHistoryNavigation = (direction:number) =>
    {
      

    }










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

const createClipOnNewTrack = (assetName: string, dropTime: number, isAtTop: boolean) => {
  
  //Higher Track more one
  const newTrackId = tracks.length > 0 ? Math.max(...tracks) + 1 : 0;
  
  // 2. Atualizar Tracks com Higienização
  setTracks(prevTracks => {
    const updatedTracks = [...prevTracks, newTrackId];
    return Array.from(new Set(updatedTracks));
  });

  // 3. Criar o Clip usando o ID que acabamos de gerar (newTrackId)
  const newClip: Clip = {
    id: clips.length,
    name: assetName,
    start: dropTime,
    duration: 40,
    color: getRandomColor(),
    trackId: newTrackId // <-- Crucial: usar a variável, não tracks.length
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
  const dropTime = Math.max(0, x / PIXELS_PER_SECOND);

  const TRACK_HEIGHT = 80;
  const totalTracksHeight = tracks.length * TRACK_HEIGHT;
  const margin = 20;

  // Se soltar acima ou abaixo, a função centralizada resolve
  if (relativeY < -margin) {
    createClipOnNewTrack(assetName, dropTime, true);
  } else if (relativeY > totalTracksHeight + margin) {
    createClipOnNewTrack(assetName, dropTime, false);
  }
};

  // Function to lead with Drag direct from OS

  const handleNativeDrop = async (paths: string[], mouseX: number, mouseY: number) => {
  if (!currentProjectPath) return;

  const timelineBounds = timelineContainerRef.current?.getBoundingClientRect();
  
  // 1. Verificação: O drop foi fora da área de tracks?
  const isOutsideTimeline = !timelineBounds || 
    mouseX < timelineBounds.left || 
    mouseX > timelineBounds.right || 
    mouseY < timelineBounds.top || 
    mouseY > timelineBounds.bottom;

  if (isOutsideTimeline) {
    for (const path of paths) {
      try {
        await invoke('import_asset', { projectPath: currentProjectPath, filePath: path });
      } catch (err) {
        console.error("Import error:", err);
      }
    }
    loadAssets();
    showNotify("Assets imported", "success");
    return;
  }

  // 2. Cálculos de posição na Timeline
  const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  const relativeX = mouseX - timelineBounds.left + scrollLeft;
  const dropTime = Math.max(0, relativeX / PIXELS_PER_SECOND);
  const relativeY = mouseY - timelineBounds.top;

  const TRACK_HEIGHT = 80;
  const defaultDuration = 10; // Duração padrão para arquivos externos

  for (const path of paths) {
    try {
      // Importa para o backend
      await invoke('import_asset', { projectPath: currentProjectPath, filePath: path });
      const fileName = path.split(/[\\/]/).pop() || "Asset";

      const totalTracksHeight = tracks.length * TRACK_HEIGHT;

      // 3. Lógica de destino (Nova Track ou Track Existente)
      if (relativeY < 0 || relativeY > totalTracksHeight) {
        // Drop nas extremidades vazias -> Sempre cria nova track
        createClipOnNewTrack(fileName, dropTime, relativeY < 0);
      } else {
        // Drop sobre a área de tracks existentes
        const targetTrackIndex = Math.floor(relativeY / TRACK_HEIGHT);
        const targetTrackId = tracks[targetTrackIndex];

        // 4. Verificação de Colisão: Se a track alvo já tem algo nesse tempo
        const occupied = clips.some(clip => {
          if (clip.trackId !== targetTrackId) return false;
          const clipEnd = clip.start + clip.duration;
          const newEnd = dropTime + defaultDuration;
          return dropTime < clipEnd && newEnd > clip.start;
        });

        if (occupied) {
          // Espaço ocupado? Cria uma nova track para não sobrescrever
          createClipOnNewTrack(fileName, dropTime, false);
        } else {
          // Espaço livre? Adiciona o clip na track existente
          new Promise(resolve => setTimeout(resolve, 1));

          const newClip: Clip = {
            id: Date.now() + Math.random(),
            name: fileName,
            start: dropTime,
            duration: defaultDuration,
            color: getRandomColor(),
            trackId: targetTrackId
          };
          setClips(prev => [...prev, newClip]);
        }
      }
    } catch (err) {
      console.error("Native drop processing error:", err);
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
      const list = await invoke('list_assets', { projectPath: currentProjectPath });
      setAssets(list as string[]);
    } catch (e) { console.error(e); }
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

    const maxTrackId = parsed.clips.reduce((max, clip) => 
      clip.trackId > max ? clip.trackId : max, 
      0
    );
    const indices = Array.from({ length: maxTrackId + 1 }, (_, i) => i);
    //updates tracks
    setTracks(indices)
    
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

  const handleDragStart = (e: React.DragEvent, color:string, trackId:number, duration:number, assetName: string, deletePrevious: boolean = false, idToDelete: number = 0 ) => {
    
    
    
    e.dataTransfer.setData("assetName", assetName);
    
    e.dataTransfer.setData("color", color);

    e.dataTransfer.setData("previousTrack", trackId.toString())

    e.dataTransfer.setData("duration", duration.toString())


    e.dataTransfer.effectAllowed = "copy";

    if(deletePrevious)
      setDeleteClipId(idToDelete)

  };

const isSpaceOccupied = (trackId: number, start: number, duration: number, excludeId: number | null = null) => {
  const newEnd = start + duration;
  const TOLERANCE = 0.05; // Slightly increased for stability

  return clips.some(clip => {
    if (excludeId !== null && clip.id === excludeId) return false;
    if (clip.trackId !== trackId) return false;

    const clipEnd = clip.start + clip.duration;
    
    // Collision only if they overlap more than the tolerance
    return start < (clipEnd - TOLERANCE) && newEnd > (clip.start + TOLERANCE);
  });
};


const handleDropOnTimeline = (e: React.DragEvent, trackId: number) => {
  e.preventDefault();
  e.stopPropagation();

  const assetName = e.dataTransfer.getData("assetName");

  const color = e.dataTransfer.getData("color");

  const previousTrackRaw = e.dataTransfer.getData("previousTrack");
  const previousTrack = previousTrackRaw ? Number(previousTrackRaw) : null;


  
  if (!assetName) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  
  // 1. Calculate raw time from mouse
  const rawDropTime = (e.clientX - rect.left + scrollLeft) / PIXELS_PER_SECOND;

  // 2. Apply Snap (Strict or with Threshold)
  const dropTime = getSnappedTime(rawDropTime, deleteClipId, trackId);

  const durationRaw = e.dataTransfer.getData("duration");
  const preferredDuration = durationRaw && Number(durationRaw) > 0 ? Number(durationRaw) : 40;

  // 3. Check for REAL collision (using the tolerance logic)
  // If the snap point causes a real overlap, we move to a new track
  if (isSpaceOccupied(trackId, dropTime, preferredDuration, deleteClipId)) {
    // If it truly doesn't fit even with snapping, create new track
    createClipOnNewTrack(assetName, dropTime, false);
    return;
  }

  // 4. If it fits (or just touches), place it on the current track
  const newClip: Clip = {
    id: Date.now() + Math.random(),
    name: assetName,
    start: dropTime,
    duration: preferredDuration,
    color: previousTrack != trackId ?  getRandomColor() : color, //change the color only when change the track
    trackId: trackId
  };

  setClips(prev => {
    const filtered = deleteClipId !== null ? prev.filter(c => c.id !== deleteClipId) : prev;
    return [...filtered, newClip];
  });

  setDeleteClipId(null);


  updatehistory()
  
};



  const handleImportFile = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'mp3', 'wav'] }]
    });
    if (selected && Array.isArray(selected)) {
      for (const path of selected) {
        await invoke('import_asset', { projectPath: currentProjectPath, filePath: path });
      }
      loadAssets();
    }
  };

  const handleRulerClick = (e: React.MouseEvent) => {
    if (timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setPlayheadPos(x);
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
    <div className="flex flex-col h-screen w-screen bg-black text-zinc-300 font-sans overflow-hidden">

      {/* Notifications */}
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
        /* PROJECT MANAGER (Mantido conforme original) */
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
        /* EDITOR VIEW */
        <div className="flex flex-col h-full">
          <header className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 bg-[#111] z-10 shadow-md">
            <div className="flex items-center gap-4">
              <button  onClick={() => setIsSetupOpen(true)}  className="text-zinc-500 hover:text-white text-[10px] font-bold">BACK</button>
              <h1 className="text-[11px] font-black uppercase text-white">{projectName}</h1>
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

          <main className="flex-1 flex overflow-hidden">
            <aside className="w-64 border-r border-zinc-800 bg-[#0c0c0c] flex flex-col hidden lg:flex">
              <div className="p-4 border-b border-zinc-900 flex justify-between items-center">
                <h2 className="text-[10px] font-black text-zinc-500 uppercase">Assets</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div onClick={handleImportFile} className="aspect-video border border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center group cursor-pointer hover:bg-zinc-900/50">
                  <Plus size={20} className="text-zinc-700 group-hover:text-red-500" />
                  <h2 className="text-[10px] font-black text-zinc-500 uppercase"> Import Media </h2>
                </div>
                {assets.map((asset, index) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={index}
                   onClick={(e) => toggleAssetSelection(asset, e.shiftKey || e.ctrlKey)}
                    
                    className={`bg-[#151515] border border-zinc-800 p-2 rounded-lg flex items-center gap-3 group hover:border-zinc-600 transition-all cursor-grab active:cursor-grabbing ${
                      selectedAssets.includes(asset) ? 'bg-red-500/20 border-red-500' : 'border-zinc-800'
                    }`}
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, null, null, null, asset, false, null)}
                  >
                    <div className="w-12 h-8 bg-black rounded flex items-center justify-center">
                      <Play size={10} className="text-zinc-700 group-hover:text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-zinc-300 truncate">{asset}</p>
                      <p className="text-[8px] text-zinc-600 uppercase font-black">Video Clip</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </aside>

            <section className="flex-1 bg-black flex flex-col items-center justify-center p-8">
              <div className="w-full max-w-4xl aspect-video bg-[#050505] rounded-xl border border-zinc-800 flex items-center justify-center relative"
              onClick={togglePlay} >
                {/* Ícone Central Dinâmico */}
                {isPlaying ? (
                  <Pause size={56} className="text-white/10 group-hover:text-white/40 transition-all" />
                ) : (
                  <Play size={56} className="text-white/10 group-hover:text-white/40 transition-all" />
                )}
              </div>

              {/* CONTROLES ABAIXO DO PLAYER */}
              <div className="flex items-center gap-8 mt-6">
                <button className="text-zinc-500 hover:text-white transition-colors"><SkipBack size={24} fill="currentColor"/></button>
                
                <button 
                  onClick={togglePlay}
                  className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-black hover:scale-110 active:scale-95 transition-all shadow-xl"
                >
                  {isPlaying ? <Pause size={28} fill="black" /> : <Play size={28} fill="black" className="ml-1" />}
                </button>
                
                <button className="text-zinc-500 hover:text-white transition-colors"><SkipForward size={24} fill="currentColor"/></button>
              </div>
            </section>
          </main>

          <footer className="h-80 bg-[#0c0c0c] border-t border-zinc-800 flex flex-col z-20">
            {/* Toolbar */}
            <div className="h-10 border-b border-zinc-900 flex items-center px-4 justify-between bg-[#0e0e0e]">
              <div className="flex items-center gap-6">
                <button 
                  onClick={handleSplit} 
                  className="flex items-center gap-2 text-[10px] font-black text-zinc-500 hover:text-red-500 uppercase transition-colors"
                >
                  <Scissors size={14}/> Split (S)
                </button>
                
                <button 
                  onClick={() => {
                    const newState = !isSnapEnabled;
                    setIsSnapEnabled(newState);
                    showNotify(`Snap: ${newState ? 'ON' : 'OFF'}`, "success");
                  }}
                  className={`flex items-center gap-2 text-[10px] font-black uppercase transition-all ${
                    isSnapEnabled ? 'text-red-500' : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  <LayoutGrid size={14} className={isSnapEnabled ? "animate-pulse" : ""} />
                  Snap {isSnapEnabled ? 'On' : 'Off'}
                </button>

                <div className="flex items-center gap-3 bg-zinc-900 px-4 py-2 rounded-lg border border-zinc-800">
                  <ZoomOut size={16} className="text-zinc-500" />
                  <input 
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    value={pixelsPerSecond}
                    onChange={(e) => setPixelsPerSecond(Number(e.target.value))}
                    className="w-32 h-1 bg-zinc-300 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                  <ZoomIn size={16} className="text-zinc-500" />
                  <span className="text-[10px] font-mono text-zinc-500 w-10">
                    {Math.round((pixelsPerSecond / 100) * 100)}%
                  </span>
                </div>

                <div className="text-[10px] font-mono text-zinc-400 flex items-center gap-2">
                  <Clock size={12} className="text-zinc-600" />
                  POS: <span className="text-white font-bold w-16">
                    {formatTime(playheadPos / PIXELS_PER_SECOND)}
                  </span>
                </div>
              </div>
            </div>

            {/* Timeline Viewport */}
            <div 
              ref={timelineContainerRef}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropOnEmptyArea}
              onMouseDown={(e) => {
                // Seek if clicking empty space in the timeline area
                if (e.target === e.currentTarget) seekTo(e.clientX);
              }}
              className="flex-1 overflow-x-auto relative bg-[#080808] scrollbar-thin scrollbar-thumb-zinc-800"
            >
              {/* Ruler */}
              <div 
                className="h-7 border-b border-zinc-900 sticky top-0 bg-[#080808]/90 backdrop-blur-md z-50 cursor-crosshair select-none"
                onMouseDown={handlePlayheadDrag}
              >
               {[...Array(100)].map((_, i) => {
                    const timeInSeconds = i * 10; // Rótulos a cada 10 segundos
                    return (
                      <div 
                        key={i} 
                        className="absolute border-l border-zinc-800 h-full text-[8px] pl-1.5 pt-1 text-zinc-600 font-mono" 
                        style={{ left: timeInSeconds * pixelsPerSecond }}
                      >
                        {formatTime(timeInSeconds)}
                      </div>
                    );
                  })}
              </div>

              {/* Content Area */}
              <div className="p-4 min-w-[10000px] relative h-full flex flex-col gap-1">
                
                {/* Playhead Line */}
                <div 
                  className="absolute top-0 bottom-0 w-[2px] bg-red-600 z-40 pointer-events-none" 
                  style={{ left: playheadPos + 16 }} // +16 for padding
                >
                  <div className="w-3 h-3 bg-red-600 rounded-full -ml-[5.5px] -mt-1 shadow-[0_0_10px_rgba(220,38,38,0.5)]" />
                </div>

                {/* Tracks Rendering */}
                {tracks.map((trackId) => (
                  <div 
                    key={trackId}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDropOnTimeline(e, trackId)}
                    className="h-20 bg-zinc-900/10 border border-zinc-800/30 rounded-lg relative group hover:bg-zinc-900/20 transition-colors"
                  >
                    <div className="absolute left-2 top-1 text-[8px] font-black text-zinc-800 uppercase tracking-widest pointer-events-none">
                      Track {trackId + 1}
                    </div>

                    {clips.filter(c => c.trackId === trackId).map((clip) => (
                      <motion.div 
                        key={clip.id}
                        draggable="true"
                        onDragStart={(e) => handleDragStart(e, clip.color, trackId, clip.duration, clip.name, true, clip.id)}
                        onClick={(e) => {
                          e.stopPropagation(); // Prevents the timeline background click from deselecting
                          toggleClipSelection(clip.id, e.shiftKey || e.ctrlKey || e.metaKey);
                        }}
                        className={`absolute inset-y-2 ${clip.color} rounded-lg flex items-center shadow-xl group z-10   ${
                          selectedClipIds.includes(clip.id) 
                             ? 'ring-2 ring-white' : ''
                        }`}
                        //style={{ width: clip.duration * PIXELS_PER_SECOND, left: clip.start * PIXELS_PER_SECOND }}
                        style={{
                          left: clip.start * pixelsPerSecond,
                          width: clip.duration * pixelsPerSecond,
                        }}
                      >
                        {/* Resize Handles */}
                        <div 
                          className="absolute left-0 inset-y-0 w-2 cursor-ew-resize bg-black/10 hover:bg-white/30 rounded-l-lg transition-colors"
                          onMouseDown={(e) => startResizing(e, clip.id, 'left')}
                        />
                        
                        <span className="text-[10px] font-black text-white truncate uppercase italic pointer-events-none">
                          {clip.name}
                        </span>

                        <div 
                          className="absolute right-0 inset-y-0 w-2 cursor-ew-resize bg-black/10 hover:bg-white/30 rounded-r-lg transition-colors"
                          onMouseDown={(e) => startResizing(e, clip.id, 'right')}
                        />
                      </motion.div>
                    ))}
                  </div>
                ))}

                <button 
                  onClick={() => setTracks(prev => [...prev, Math.max(...prev, -1) + 1])}
                  className="mt-4 w-fit flex items-center gap-2 text-[9px] font-black text-zinc-700 hover:text-zinc-400 uppercase tracking-widest transition-colors px-2 py-1"
                >
                  <Plus size={12} /> Add Track
                </button>
              </div>
            </div>
          </footer>
        </div>
      )}

      {/* Modals e Confirmações (Mantidos conforme original) */}
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

      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 bg-black/90 z-[400] flex items-center justify-center p-4">
            <motion.div initial={{ y: 20 }} animate={{ y: 0 }} className="bg-[#18181b] border border-zinc-800 p-8 rounded-3xl w-full max-w-md">
              <h2 className="text-xl font-black flex items-center gap-3 text-white mb-6"><Youtube className="text-red-600" /> IMPORT</h2>
              <input type="text" placeholder="https://youtube.com/..." value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)}
                className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-4 text-sm font-bold text-white outline-none focus:border-red-600 mb-6" />
              <button disabled={isDownloading} onClick={handleYoutubeDownload}
                className={`w-full py-4 rounded-xl font-black text-xs text-white ${isDownloading ? 'bg-zinc-800' : 'bg-red-600 hover:bg-red-700'}`}>
                {isDownloading ? "DOWNLOADING..." : "FETCH MEDIA"}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                You are about to delete <span className="text-white font-bold">{projectToDelete.name}</span>. 
              </p>
              <div className="flex gap-3">
                <button onClick={() => setProjectToDelete(null)} className="flex-1 py-3 text-[10px] font-black text-zinc-500 hover:text-white uppercase tracking-widest">Cancel</button>
                <button onClick={handleDeleteProject} className="flex-1 bg-red-600 hover:bg-red-700 py-3 rounded-xl font-black text-xs text-white uppercase shadow-lg shadow-red-900/20">Delete Project</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}