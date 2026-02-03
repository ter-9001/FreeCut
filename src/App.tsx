import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scissors, Plus, Play, SkipBack, Youtube,
  Settings, Share2, FolderOpen, Save, X,
  LayoutGrid, List, Clock,
  Import
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

  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

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




  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete') {
          // Scenario A: Deleting a specific clip from timeline
          if (selectedClipId !== null) {
            setClips(prev => prev.filter(c => c.id !== selectedClipId));
            setSelectedClipId(null);
            showNotify("Clip removed", "success");
          } 
          // Scenario B: Deleting an Asset and ALL its clips (your logic)
          else if (selectedAsset !== null) {
            setAssets(prev => prev.filter(asset => asset !== selectedAsset));
            setClips(prev => prev.filter(c => c.name !== selectedAsset));
            setSelectedAsset(null);
            showNotify("Asset and associated clips removed", "success");
          }
        }


        // CTRL + Z (Undo)
        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          console.log("Z")
          handleFileHistoryNavigation(-1);
        }
        // CTRL + Y (Redo)
        if (e.ctrlKey && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handleFileHistoryNavigation(+1);
        }
      





      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedClipId, clips]);









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

  return clips.some(clip => {
    // 1. Ignora se for o próprio clip que estamos movendo
    if (excludeId !== null && clip.id === excludeId) return false;
    
    // 2. Ignora se estiver em outra track
    if (clip.trackId !== trackId) return false;

    const clipEnd = clip.start + clip.duration;

    // 3. Lógica de Sobreposição Matemática:
    // Há colisão se o (Início A < Fim B) E (Fim A > Início B)
    const collision = start < clipEnd && newEnd > clip.start;
    
    return collision;
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
  const dropTime = (e.clientX - rect.left + scrollLeft) / PIXELS_PER_SECOND;

  // 1. O mouse caiu EXATAMENTE em cima de algum clip existente?
  const clipUnderMouse = clips.find(c => 
    c.trackId === trackId && 
    c.id !== deleteClipId && 
    dropTime >= c.start && 
    dropTime <= (c.start + c.duration)
  );

  // 2. Se caiu em cima de alguém, aí sim criamos nova track
  if (clipUnderMouse) {
    createClipOnNewTrack(assetName, dropTime, false);
    return;
  }

  // 3. Se caiu no vazio, vamos ver quanto espaço temos até o PRÓXIMO clip
  const nextClip = clips
    .filter(c => c.trackId === trackId && c.start > dropTime && c.id !== deleteClipId)
    .reduce((prev, curr) => (prev === null || curr.start < prev.start ? curr : prev), null as Clip | null);

  const durationRaw = e.dataTransfer.getData("duration");
  const preferredDuration = durationRaw && Number(durationRaw) > 0 ? Number(durationRaw) : 40;
  
  // LÓGICA DE ENCAIXE:
  // Se houver um clip na frente, a duração será o menor valor entre o preferido e o buraco disponível
  let finalDuration = preferredDuration;
  if (nextClip) {
    const gap = nextClip.start - dropTime;
    finalDuration = Math.min(preferredDuration, gap);
  }

  // 4. Segurança: Se por erro de cálculo o gap for minúsculo, criamos nova track
  if (finalDuration < 0.2) {
    createClipOnNewTrack(assetName, dropTime, false);
    return;
  }

  const newClip: Clip = {
    id: Date.now() + Math.random(),
    name: assetName,
    start: dropTime,
    duration: finalDuration,
    color: previousTrack != trackId ?  getRandomColor() : color, //change the color only when change the track
    trackId: trackId
  };

  setClips(prev => {
    const filtered = deleteClipId !== null ? prev.filter(c => c.id !== deleteClipId) : prev;
    return [...filtered, newClip];
  });

  setDeleteClipId(null);
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
        /* PROJECT MANAGER */
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
                    onClick={() => setSelectedAsset(asset)}
                    className={`bg-[#151515] border border-zinc-800 p-2 rounded-lg flex items-center gap-3 group hover:border-zinc-600 transition-all cursor-grab active:cursor-grabbing
                    ${selectedAsset === asset ? 'ring-2 ring-white' : ''}`}
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
              <div className="w-full max-w-4xl aspect-video bg-[#050505] rounded-xl border border-zinc-800 flex items-center justify-center relative">
                <Play size={56} className="text-white/10" />
              </div>
            </section>
          </main>
          <footer className="h-80 bg-[#0c0c0c] border-t border-zinc-800 flex flex-col z-20">
            <div className="h-10 border-b border-zinc-900 flex items-center px-4 justify-between bg-[#0e0e0e]">
              <div className="flex items-center gap-6">
                <button className="flex items-center gap-2 text-[10px] font-black text-zinc-500 hover:text-red-500 uppercase"><Scissors size={14}/> Split</button>
                <div className="text-[10px] font-mono text-zinc-400">POS: <span className="text-white">{(playheadPos / PIXELS_PER_SECOND).toFixed(2)}s</span></div>
              </div>
            </div>

            <div 
              ref={timelineContainerRef}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropOnEmptyArea}
              className="flex-1 overflow-x-auto relative bg-[#080808] scrollbar-thin scrollbar-thumb-zinc-800"
            >
              <div className="h-7 border-b border-zinc-900 sticky top-0 bg-[#080808]/80 backdrop-blur-md z-30 cursor-crosshair" onClick={handleRulerClick}>
                {[...Array(60)].map((_, i) => (
                  <div key={i} className="absolute border-l border-zinc-800 h-full text-[8px] pl-2 pt-1.5 text-zinc-700 font-mono" style={{left: i * 20 * PIXELS_PER_SECOND}}>{i * 20}s</div>
                ))}
              </div>

              <div className="p-4 min-w-[6000px] relative h-full flex flex-col gap-1">
                <div className="absolute top-0 bottom-0 w-[1px] bg-red-600 z-40 pointer-events-none" style={{left: playheadPos + 16}}>
                  <div className="w-2.5 h-2.5 bg-red-600 rounded-full -ml-[4.5px] -mt-0.5 shadow-lg" />
                </div>

                {tracks.map((trackId) => (
                  <div 
                    key={trackId}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDropOnTimeline(e, trackId)}
                    

                    className="h-20 bg-zinc-900/20 border border-zinc-800/50 rounded-lg relative overflow-hidden group hover:border-zinc-700 transition-colors"
                  >
                    <div className="absolute left-2 top-1 text-[8px] font-black text-zinc-700 uppercase tracking-widest pointer-events-none">
                      Track {trackId + 1}
                    </div>

                    {clips.filter(c => c.trackId === trackId).map((clip) => (
                      <motion.div 
                        key={clip.id}
                        draggable = "true"
                        onDragStart={(e) => handleDragStart(e, clip.color, trackId, clip.duration ,clip.name, true , clip.id)}
                        onClick={() => setSelectedClipId(clip.id)}
                        className={`absolute inset-y-2 ${clip.color} rounded-lg flex items-center shadow-xl group z-10 
                        ${selectedClipId === clip.id ? 'ring-2 ring-white' : ''}`}
                        style={{ width: clip.duration * PIXELS_PER_SECOND, left: clip.start * PIXELS_PER_SECOND }}
                      >


                        {/* Left Resize Handle */}
                        <div 
                          className="absolute left-0 inset-y-0 w-2 cursor-ew-resize bg-black/20 hover:bg-white/40 z-20"
                          onClick={()=> {console.log('left active')}}
                         
                          onMouseDown={(e) => startResizing(e, clip.id, 'left')}

                          
                        />
                        <span className="text-[10px] font-black text-white truncate uppercase italic" >{clip.name}</span>

                        <div 
                           className="absolute right-0 inset-y-0 w-2 cursor-ew-resize bg-black/20 hover:bg-white/40 z-20"
                         
                          onMouseDown={(e) => startResizing(e, clip.id, 'right')}

                        />

                      </motion.div>
                    ))}


                    
                  </div>
                ))}

                <button 
                  onClick={() => setTracks(prev => [...prev, prev.length])}
                  className="mt-2 flex items-center gap-2 text-[9px] font-black text-zinc-700 hover:text-zinc-500 uppercase tracking-widest transition-colors"
                >
                  <Plus size={12} /> Add Track
                </button>
              </div>
            </div>
          </footer>
        </div>
      )}


      

      {/* New Project Modal */}
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

      {/* YouTube Import Modal */}
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

      {/* DELETE CONFIRMATION MODAL */}
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
                This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setProjectToDelete(null)}
                  className="flex-1 py-3 text-[10px] font-black text-zinc-500 hover:text-white uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDeleteProject}
                  className="flex-1 bg-red-600 hover:bg-red-700 py-3 rounded-xl font-black text-xs text-white uppercase shadow-lg shadow-red-900/20"
                >
                  Delete Project
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}