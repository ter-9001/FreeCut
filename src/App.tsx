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
import { motion, AnimatePresence, number } from 'framer-motion';
import * as THREE from 'three';

//Icons for the Render
import { 
  
  Play, 
  Pause, 
  Scissors, 
  SkipBack,    
  SkipForward, 
  LayoutGrid,
  Plus,
  Settings,
  Clock,
  FolderOpen,
  X,
  Youtube,
  Share2,
  Import,
  ZoomIn,      
  ZoomOut,
  Music,
  Sparkles,
  VideoOff,
  ImageIcon,
  Search,
  Settings2, 
  Type, 
  Video, 
  Volume2, 
  Layers, 
  Maximize, 
  Rotate3d, 
  Key, 
  Wind,
  Diamond,
  MicOffIcon,
  LockIcon,
  EyeOff,
  BrushCleaning,
  DiamondPlus,
  ChevronDown,
  Crosshair,
  ArrowBigUpDash,
  ArrowUp
  
} from 'lucide-react';

import Waveform from "@/components/Waveform";
import ProjectSettingsModal from "@/components/ProjectSettingsModal";
import { PropertiesAside } from '@/components/PropertiesAside';
import { ItensAside } from './components/ItensAside';



import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { aside, track } from 'framer-motion/client';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';




// --- INTERFACES ---


interface ProjectSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  sampleRate: number;
}

interface Project {
  name: string;
  path: string;
}

interface Keyframe {
  id: string;
  time: number;  
  value: number | Position | Rotation; 
}

interface Position
{
  x: number;
  y: number;
}

interface Rotation
{
  rot: number;
  rot3d: number;
}

interface Clip {
  id: string;
  name: string;
  start: number; // begin of the clip in relation the timeline
  duration: number;
  color: string;
  trackId: number;
  maxduration: number; // max size in the timeline at current position
  beginmoment: number; //begin of the clip in relation of all original clip (asset)
  originalduration: number;
  blendmode?: 'normal' | 'overlay' | 'screen' | 'multiply' | 'lineardodge' | null;
  mute?: boolean;
  fadein?: number;
  fadeout?: number;
  fadeinAudio?: number;
  fadeoutAudio?: number;
  dimentions?: Position | null;
  scale?: number;
  keyframes?: {
  volume?: Keyframe[];
  opacity?: Keyframe[];
  speed?: Keyframe[];
  rotation3d?: Keyframe[];
  position?: Keyframe[];
  zoom?:Keyframe[];
};
  


activeKeyframeView?: 'volume' | 'opacity' | 'speed' | 'rotation3d'| 'position' | 'zoom' | null;


}

interface ProjectFileData {
  projectName: string;
  assets: Asset[];
  clips: Clip[];
  tracks: Tracks[];
  lastModified: number;
  copyOf?: string; // Pointer to another main{timestamp}.project file
  
}

interface Asset {
  name: string;
  path: string;       
  duration: number;   
  type: 'video' | 'audio' | 'image';
  thumbnailUrl?: string; // URL genarate by FFmpeg
  dimentions?: Position
}

interface Tracks
{
  id: number;
  type:  'audio' | 'video' | 'effects';
  lock?: boolean;
  mute?: boolean;

}




// No seu tipo Clip, adicione:


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
  const [tracks, setTracks] = useState<Tracks[]>([]);

  //deleteClipId is used to store the id of a clip that is changed of track
  const [deleteClipId, setDeleteClipId] = useState<string | null>(null);

  //var currentProjectPath = localStorage.getItem("current_project_path");

  const [currentProjectPath, setCurrentProjectPath] = useState < String | null >(null);

  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const asidetrack = useRef<HTMLDivElement>(null);

  const asidetrackwidth = asidetrack.current?.offsetWidth || 192;

  
  const playheadRef = useRef<HTMLDivElement>(null);


  // const to move position grafically
  const [showContextMenu, setShowContextMenu] = useState<{ x: number, y: number } | null>(null);
  const [interactionMode, setInteractionMode] = useState<'none' | 'transform' | 'crop'>('none');

  // Refs para lógica de motor (Não disparam re-render, mantêm a fluidez)
  const selectedClipIdRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const canvasCursor = interactionMode === 'transform' ? 'move' : 'pointer';

// Fechar menu ao clicar fora
useEffect(() => {
  const closeMenu = () => setShowContextMenu(null);
  window.addEventListener('click', closeMenu);
  return () => window.removeEventListener('click', closeMenu);
}, []);

const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
  if(!topClips.current) return

  const rect = canvasRef.current?.getBoundingClientRect();
  if (!rect) return;

  // Coordenadas do mouse convertidas para a escala do Canvas do projeto
  const mouseX = (e.clientX - rect.left) * (projectConfig.width / rect.width);
  const mouseY = (e.clientY - rect.top) * (projectConfig.height / rect.height);

  

  // Percorremos os clipes visíveis (do topo para baixo)
  for (const clip of topClips.current) {
    const pos = getInterpolatedValueWithFades(currentTime, clip, 'position') as Position;
    
    // Precisamos saber a largura/altura do asset (img) que o drawFrame usou
    // Aqui você pode precisar guardar essas dimensões no objeto Clip ou via Ref
    const clipWidth = clip.width || 1920; 
    const clipHeight = clip.height || 1080;

    if (
      mouseX >= pos.x && mouseX <= pos.x + clipWidth &&
      mouseY >= pos.y && mouseY <= pos.y + clipHeight
    ) {
      selectedClipIdRef.current = clip.id;
      // Aqui você dispara a abertura do Context Menu
      setShowContextMenu({ x: e.clientX, y: e.clientY });
      return;
    }


    
  }
  selectedClipIdRef.current = null; // Clicou no vazio
};


const transferClipsToNewTrackZero = (targetTrackId: number) => {
  setTracks(prevTracks => {
    const shiftedTracks = prevTracks.map(track => ({
        ...track,
        id: track.id + 1
      }));
    

    const targetTrack = prevTracks.find(t => t.id === targetTrackId);
    
    const newTrackZero: Tracks = {
      id: 0,
      type: targetTrack?.type || 'video', // Padrão video se não achar
      lock: false,
      mute: false
    };

    return [newTrackZero, ...shiftedTracks];
  });

  setClips(prevClips => {
    return prevClips.map(clip => {
      let currentClipTrackId = clip.trackId;

      let newTrackId = currentClipTrackId + 1;

      if (currentClipTrackId === targetTrackId) {
        newTrackId = 0;
      }

      return {
        ...clip,
        trackId: newTrackId
      };
    });
  });
};


const moveTrackDownAndShiftOthers = (targetTrackId: number) => {
  // 1. Encontrar a track que tem o maior ID, mas que ainda é menor que o ID alvo
  const sortedTracks = [...tracks].sort((a, b) => a.id - b.id);
  
  // Encontra a track que está logo abaixo da alvo na lista ordenada
  const trackAbaixo = sortedTracks
    .filter(t => t.id < targetTrackId)
    .pop(); // Pega a última (maior) das menores

  if (!trackAbaixo) {
    console.warn("Não há track abaixo da alvo para realizar o deslocamento.");
    return;
  }

  const novoIdDaAlvo = trackAbaixo.id;

  // 2. Atualizar as Tracks
  setTracks(prevTracks => {
    return prevTracks.map(track => {
      // A track alvo assume o ID da que estava abaixo
      if (track.id === targetTrackId) {
        return { ...track, id: novoIdDaAlvo };
      }
      
      // As tracks que estão entre o novoId (inclusive) e o targetId (exclusive)
      // devem subir +1 para abrir espaço
      if (track.id >= novoIdDaAlvo && track.id < targetTrackId) {
        return { ...track, id: track.id + 1 };
      }

      return track;
    });
  });

  // 3. Atualizar os Clips para manterem a consistência com os novos IDs das tracks
  setClips(prevClips => {
    return prevClips.map(clip => {
      let currentTrackId = clip.trackId;

      // Se o clip era da track que "caiu" (a alvo)
      if (currentTrackId === targetTrackId) {
        return { ...clip, trackId: novoIdDaAlvo };
      }

      // Se o clip era de uma das tracks que "subiram"
      if (currentTrackId >= novoIdDaAlvo && currentTrackId < targetTrackId) {
        return { ...clip, trackId: currentTrackId + 1 };
      }

      return clip;
    });
  });
};





  //part to Project Config

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 2. Estado para armazenar as configurações do projeto
  const [projectConfig, setProjectConfig] = useState<ProjectSettings>({
    name: "New Project",
    width: 1920,
    height: 1080,
    fps: 24,
    backgroundColor: "#000000",
    sampleRate: 48000
  });

  // Função para salvar vinda do Modal
const handleSaveSettings = async (newSettings: ProjectSettings) => {
  try {
    const newPath = await invoke<string>('save_project_config', { 
      path: currentProjectPath, 
      config: newSettings 
    });

    loadProjects()

    setCurrentProjectPath(newPath)

    setProjectConfig(newSettings);
    setProjectName(newSettings.name);
    
    setIsSettingsOpen(false);
    console.log("Project saved and renamed to:", newPath);

  } catch (err) {
    console.error("Save failed:", err);
    alert(err); 
  }
};


  const canvasRef = useRef<HTMLCanvasElement>(null)


  const imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
  const audioExtensions = ['mp3', 'wav', 'ogg'];
  const videoExtensions = ['mp4', 'mkv', 'avi', 'mov'];

  
    // Default zoom: 100 pixels represents 1 second
  const [pixelsPerSecond, setPixelsPerSecond] = useState(10);

  // Limits to prevent the timeline from disappearing or becoming infinite
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 200;

  //Resizible Aside Asetts 

  const [sidebarWidth, setSidebarWidth] = useState(256); // 256px is default (w-64)
  const isResizingSidebar = useRef(false);


   useEffect(() => {
      const handleMouseMove = (e) => {
        if (!isResizingSidebar.current) return;
        
        // Define limites mínimos e máximos para a largura
        const newWidth = Math.max(180, Math.min(600, e.clientX));
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = () => {
        isResizingSidebar.current = false;

        document.body.style.cursor = 'default';
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }, []);


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

  //conversor for clip colors for hexadecimal

  const COLOR_MAP: Record<string, string> = {
  'bg-blue-600': '#2563eb',    // Ocean
  'bg-emerald-600': '#059669', // Forest
  'bg-violet-600': '#7c3aed',  // Royal
  'bg-amber-600': '#d97706',   // Gold
  'bg-rose-600': '#e11d48',    // Wine
  'bg-cyan-600': '#0891b2',    // Sky
  'bg-indigo-600': '#4f46e5'   // Galaxy
};

  

  // Helper to get a random color
  const getRandomColor = () => CLIP_COLORS[Math.floor(Math.random() * CLIP_COLORS.length)];

  // Change from null to empty arrays
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);



  //snap function
  const [isSnapEnabled, setIsSnapEnabled] = useState(false);

  //const to search assets
  const [searchQuery, setSearchQuery] = useState("");


  /**
   * History Manager with a 100-step limit.
   * Uses a simple array-based stack to track clips and assets.
   */
  const [history, setHistory] = useState<{ clips: Clip[], assets: Asset[], tracks: Tracks[] }[]>([]);
  const [redoStack, setRedoStack] = useState<{ clips: Clip[], assets: Asset[], tracks: Tracks[] }[]>([]);


  const [timelineHeight, setTimelineHeight] = useState(300); // Default height
  const isResizingTimeline = useRef(false);

  //States for Box Selection, make a box with mouse to select severals clips
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [boxStart, setBoxStart] = useState({ x: 0, y: 0 });
  const [boxEnd, setBoxEnd] = useState({ x: 0, y: 0 });


  const clipboardRef = useRef<Clip[]>([]);


  //const to source monitor

const [sourceAsset, setSourceAsset] = useState<Asset | null>(null);
const [inPoint, setInPoint] = useState<number>(0);
const [outPoint, setOutPoint] = useState<number>(0);
const sourceVideoRef = useRef<HTMLVideoElement>(null);

 

//const to put thumbnaisl in clip

const [timelineThumbs, setTimelineThumbs] = useState<Record<string, { start: string, end: string }>>({});


//const to make auxiliar preview resizible
const [sourceWidth, setSourceWidth] = useState(320); // Largura inicial (aprox. w-80)
const isResizingSource = useRef(false);

//const to preview videos



const [currentTime, setCurrentTime] = useState(0); // Playhead time
const [isPlaying, setIsPlaying] = useState(false); 
const requestRef = useRef <number>(); // for loop animation loop of high precision
const lastTimeRef = useRef<number | null>(null);

//const [topClips, setTopClips] = useState<Clip [] | null>(null);
const topClips = useRef<Clip[] | null >([]);
const [topAudios, setTopAudios] = useState<Clip [] | null>(null);


//State management for rendering feedback
const [renderStatus, setRenderStatus] = useState<'idle' | 'rendering' | 'success'>('idle');
const [renderPercent, setRenderPercent] = useState(0);


//code source monitor only work when mouse is over it
const [isMouseOverSource, setIsMouseOverSource] = useState(false);
const [currentTime2, setCurrentTime2] = useState(0); // Playhead time
const [isPlaying2, setIsPlaying2] = useState(false); 




// Dentro do seu componente App
useEffect(() => {
  const unlisten = listen<number>('export-progress', (event) => {
    // Update the state you're using in the progress bar
    console.log("Progresso recebido:", event.payload);
    setRenderPercent(event.payload);
    
      
  });

  return () => {
    unlisten.then(f => f());
  };
}, []);





useEffect(() => 
  {

    if(renderPercent == 100)
      setRenderStatus('success')


  }, [renderPercent])



//context menu of clips (right click mouse)

const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: any, clip: Clip } | null>(null);

const handleContextMenu = (e: React.MouseEvent, type: any, clip: Clip) => {
  e.preventDefault(); // Impede o menu padrão do Windows/Browser
  setContextMenu({ x: e.clientX, y: e.clientY, type: type, clip: clip });
};

// Fecha o menu ao clicar em qualquer outro lugar
useEffect(() => {
  const closeMenu = () => setContextMenu(null);
  window.addEventListener('click', closeMenu);
  return () => window.removeEventListener('click', closeMenu);
}, []);


// context menu option ==> separate audio

const separateAudio = async (clip: Clip) => 
{

  var sourcePath, destPath: string
  const audio = `${clip.name.split('.').slice(0, -1).join('.')}.mp3`

  console.log('clip name', clip)



  //if is not mute it is because the audio is in separate_audio
  if(!clip.mute)
  { 
    sourcePath = `${currentProjectPath}/extracted_audios/${audio}`
    destPath = `${currentProjectPath}/videos/${audio}`

    console.log('sourcePath', sourcePath)

      try
      {
          await invoke<string>('copy_file', { 
          source: sourcePath, 
          destination: destPath 
          });


              setTracks(  (prev) => 
                {
            
                    const newTrackId = prev.length > 0 ? Math.max(...prev.map(t => t.id)) + 1 : 0; 
                    const filename = destPath.replace(/^.*[\\/]/, '');
                  
                    
                    const updatedTracks = [...prev, { 
                      id: newTrackId, 
                      type: 'audio'
                    }];

                    
                    const newClip: Clip = {
                    ...clip, id: crypto.randomUUID(), 
                            name: filename, 
                            color: getRandomColor(),
                            trackId: newTrackId
                    };


                    setClips(prevClips => [...prevClips, newClip] );

                    return updatedTracks










                }


              )

          //if the clip is muted because the audio is out and we wanna undoing it, is just change the mute variable

          const newclip = {... clip, mute: !clip.mute} 
          setClips( prev => prev.map(c => c.id === clip.id ? newclip : c ) )

          await loadAssets()

          showNotify('Audio Extracted', "success") 

      }
      catch (error) {
      
        showNotify('Error in Audio Extract', "error") 
        console.error('Error in copy_file', error);
      }
  }
  else
  {
          try
          {
            const newclip = {... clip, mute: !clip.mute} 
            setClips( prev => prev.map(c => c.id === clip.id ? newclip : c ) )
            showNotify('Audio Restored', "success")
          }
          catch (error)
          {
             showNotify('Error in Audio Restore', "error")
             console.log(error)
          }
  }







}



const handleCancelExport = async () => {
  try {
    // [English Comment] Signal Rust to kill the FFmpeg task
    await invoke('cancel_export');
    setRenderStatus('idle');
    setRenderPercent(0);
    console.log("Export cancelled by user");
  } catch (err) {
    console.error("Failed to cancel export:", err);
  }
};


// Dentro da sua função de exportação no App.tsx
const startExport = async () => {
  try {
    // 1. Ativa a UI de renderização e zera o progresso
    setRenderPercent(0);
    setRenderStatus('rendering'); 


    if(!currentProjectPath)
     return

  const safeName = currentProjectPath.replace(/[^a-z0-0]/gi, '_').toLowerCase();

  const targetPath = await save({
    title: 'Export Final Video',
    filters: [{
      name: 'Video',
      extensions: ['mp4']
    }],
    defaultPath: `${safeName}.mp4`
  });

  // If the user cancels the dialog, targetPath will be null
  if (!targetPath) return;


  const sanitizeNumber = (num: number): number => {
  return Math.round(num * 100) / 100;
};

  const clips_format = clips.map( c => { 
    
    
    return {
    ...c ,path: `${currentProjectPath}/videos/${c.name}` ,
    trackId: c.trackId.toString(),
     type: knowTypeByAssetName(c.name),
      mute: c.mute ?? false,
      beginmoment: sanitizeNumber(c.beginmoment),
  duration: sanitizeNumber(c.duration),
  start: sanitizeNumber(c.start)
    }})





    // 2. Chama o Rust
    await invoke('export_video', {
      projectPath: currentProjectPath,
      exportPath: targetPath, 
      projectDimensions: { width: projectConfig.width || 1980, height: projectConfig.height || 1080 },
      clips: clips_format
    });

    // Se chegar aqui, terminou com sucesso
    // setIsRendering(false); // Opcional: fechar ao terminar

    

  } catch (error) {
    console.error("Export Error:", error);
    setRenderStatus('idle'); // Fecha se der erro
  }
};



//code to video preview


//function to point the track that must be showed in video preview
const updatePreview = async (currentTime: number) => {
  // 1. Filter by time of playhead

 

  const currentClips = clips.filter(clip => 
    currentTime >= clip.start  && 
    currentTime <= (clip.start  + clip.duration) && 
    knowTypeByAssetName(clip.name, true) === 'video'
  );

  if (currentClips.length == 0)
  {
    topClips.current = []
    return
  }  
      
  //2. Order as the are showed in visual render

  const sorted_tracks = order_tracks();
  const sortedTracksId = sorted_tracks.map(t => t.id);

  const sortedClips = currentClips.sort((a, b) => {
    const trackA = sortedTracksId.indexOf(a.trackId);
    const trackB = sortedTracksId.indexOf(b.trackId);
    return trackA - trackB;
  });





  // 3. Set the winner
  //const winner = sortedClips[0] || null;
  topClips.current = sortedClips;

  console.log('winners: ',sortedClips)

  

};


//code to make auxiliar preview resizible

useEffect(() => {
  const handleMouseMove = (e) => {
    // Redimensionar Sidebar (Media Library)
    if (isResizingSidebar.current) {
      const newWidth = Math.max(180, Math.min(500, e.clientX));
      setSidebarWidth(newWidth);
    }
    
    // Redimensionar Source Monitor
    if (isResizingSource.current) {
      // Calculamos a largura baseada na distância entre o mouse e o fim da sidebar
      const newWidth = Math.max(200, Math.min(600, e.clientX - sidebarWidth));
      setSourceWidth(newWidth);
    }
  };

  const handleMouseUp = () => {
    isResizingSidebar.current = false;
    isResizingSource.current = false;
    document.body.style.cursor = 'default';
  };

  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  return () => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };
}, [sidebarWidth]); // Adicione sidebarWidth como dependência para cálculo preciso

//show what audios to play in audio preview
const updateAudio = () => {
  
  //filter images cause it don't has audio

  const currentClips = clips.filter(clip => 
    currentTime >= clip.start  && 
    currentTime <= (clip.start  + clip.duration) && 
    knowTypeByAssetName(clip.name) !== 'image' &&
    (tracks.find(t => t.id === clip.trackId)?.mute === false ||
    !(tracks.find(t => t.id === clip.trackId)?.mute)) &&
    (clip?.mute === false ||
    !(clip?.mute))
  );


  //console.log('cc clips',currentClips)

  if (currentClips.length == 0)
  {
    setTopAudios(null)
    return
  }  
      

  const winner = currentClips || null;

  //console.log('present audios', winner)


  const idsAtuais = topAudios?.map(c => c.id).join(',');
  const idsNovos = winner?.map(c => c.id).join(',');

  if (idsAtuais !== idsNovos) {
    setTopAudios(winner);
    console.log('winner is ', winner)
  }



 


  

  

};


// Map of a lot of <audios>
const audioPlayersRef = useRef<Map<string, HTMLAudioElement>>(new Map());

//Render all audios of the current time

const convertZoom = (input: number): number => {
  // Garantir que o input esteja no limite 0 a 1
  const val = Math.max(0, Math.min(1, input));

  if (val <= 0.5) {
    return val * (1.0 - 0.01) / 0.5 + 0.01;
  } else {
    return (val - 0.5) * (20.0 - 1.0) / (1.0 - 0.5) + 1.0;
  }
};


const reverterZoom = (zoom: number): number => {
  const z = Math.max(0.01, Math.min(20, zoom));

  if (z <= 1.0) {
    return (z - 0.01) * 0.5 / (1.0 - 0.01);
  } else {
    return (z - 1.0) * (1.0 - 0.5) / (20.0 - 1.0) + 0.5;
  }
};


const convertDB = (kfValue: number) => {
    const db = (kfValue * 60) - 30;
    return db;
  };

const reverterVolume = (db: number): number =>
{
   const value = (db + 30)/60;
   return value
}

useEffect(() => {
  if (!topAudios || topAudios.length === 0 || !isPlaying) {
    audioPlayersRef.current.forEach(p => {
      p.pause();
      p.volume = 0;
    });
    return;
  }

  const currentIds = new Set(topAudios.map(clip => clip.id));
  audioPlayersRef.current.forEach((player, id) => {
    if (!currentIds.has(id)) {
      player.pause();
      audioPlayersRef.current.delete(id);
    }
  });

  const keyframeToLinear = (kfValue: number) => {
    const db = (kfValue * 100) - 30;
    return Math.pow(10, db / 20);
  };

  // Função Auxiliar: Calcula em qual segundo do arquivo original o áudio deve estar
  const getAssetTimeAtTimelineTime = (tTime: number, clip: Clip) => {
    if (!clip.keyframes?.speed || clip.keyframes.speed.length === 0) return tTime;
    const speedKfs = [...clip.keyframes.speed].sort((a, b) => a.time - b.time);
    let accumulatedAssetTime = 0;
    let lastT = 0;
    let lastS = speedKfs[0].value;

    for (const kf of speedKfs) {
      if (tTime > kf.time) {
        const dt = kf.time - lastT;
        const avgS = (lastS + kf.value) / 2;
        accumulatedAssetTime += dt * avgS;
        lastT = kf.time;
        lastS = kf.value;
      } else {
        const dt = tTime - lastT;
        const dist = kf.time - lastT || 1;
        const currentS = lastS + (dt / dist) * (kf.value - lastS);
        accumulatedAssetTime += dt * ((lastS + currentS) / 2);
        return accumulatedAssetTime;
      }
    }
    return accumulatedAssetTime + (tTime - lastT) * lastS;
  };

  topAudios.forEach(clip => {
    let player = audioPlayersRef.current.get(clip.id);
    
    const audio = `${clip.name.split('.').slice(0, -1).join('.')}.mp3`;
    const path = knowTypeByAssetName(clip.name) === 'video' 
      ? `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/extracted_audios/${audio}`)}` 
      : `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/videos/${clip.name}`)}`;

    if (!player) {
      player = new Audio(path);
      // Opcional: mantém o tom original (sem voz de esquilo) ao mudar velocidade
      // player.preservesPitch = true; 
      audioPlayersRef.current.set(clip.id, player);
    }

    const timelineRelativeTime = currentTimeRef.current - clip.start;
    // Calcula o tempo distorcido pela velocidade para o áudio original
    const assetRelativeTime = getAssetTimeAtTimelineTime(timelineRelativeTime, clip);
    const targetTime = assetRelativeTime + (clip.beginmoment || 0);

    const applyFadeAndSync = () => {
      // Sincronia inicial
      if (targetTime >= 0 && targetTime < player!.duration) {
        player!.currentTime = targetTime;
      }
      
      if (isPlaying) player!.play().catch(() => {});

      const updateAudioState = () => {
        if (!player || player.paused) return;

        // 1. SPEED UPDATE (PlaybackRate)
        const currentSpeed = getInterpolatedValueWithFades(currentTimeRef.current, clip, 'speed');
        // O HTML5 Audio suporta playbackRate entre 0.06 e 16.0
        player.playbackRate = Math.max(0.06, Math.min(16, currentSpeed));

        //2. VOLUME CALCULATION
        const relativeTime = player.currentTime - (clip.beginmoment || 0);
        const fadein = clip.fadeinAudio || 0;
        const fadeout = clip.fadeoutAudio || 0;
        
        let fadeVol = 1.0;
        if (relativeTime < fadein && fadein > 0) {
          fadeVol = relativeTime / fadein;
        } else if (relativeTime > (clip.duration - fadeout) && fadeout > 0) {
          const timeRemaining = clip.duration - relativeTime;
          fadeVol = timeRemaining / fadeout;
        }

        const kfValue = getInterpolatedValueWithFades(currentTimeRef.current, clip, 'volume');
        const kfLinear = keyframeToLinear(kfValue);
        player.volume = Math.max(0, Math.min(1, kfLinear * fadeVol));

      // 3. DRIFT CHECK (Forced Sync)
      // If the audio deviates by more than 0.1s from what the integral calculates, we force the timing.
      
      const expectedTime = getAssetTimeAtTimelineTime(currentTimeRef.current - clip.start, clip) + (clip.beginmoment || 0);
        if (Math.abs(player.currentTime - expectedTime) > 0.1) {
           player.currentTime = expectedTime;
        }
        
        if (isPlaying) requestAnimationFrame(updateAudioState);
      };

      updateAudioState();
    };

    if (player.readyState >= 1) { 
      applyFadeAndSync();
    } else {
      player.addEventListener('loadedmetadata', applyFadeAndSync, { once: true });
    }
  });

}, [topAudios, isPlaying]);



/*
useEffect(() => {
  if (!topAudios || topAudios.length === 0 || !isPlaying) {
    audioPlayersRef.current.forEach(p => {
      p.pause();
      p.volume = 0;
    });
    return;
  }

  const currentIds = new Set(topAudios.map(clip => clip.id));
  audioPlayersRef.current.forEach((player, id) => {
    if (!currentIds.has(id)) {
      player.pause();
      audioPlayersRef.current.delete(id);
    }
  });

  // Função para converter o valor do Keyframe (0 a 1) para Ganho Linear via dB
  // Mapeamos 0.0 (KF) -> -50dB e 1.0 (KF) -> +50dB
  const keyframeToLinear = (kfValue) => {
    const db = (kfValue * 100) - 50; // Transforma 0...1 em -50...50
    // Fórmula: VolumeLinear = 10^(db / 20)
    const linear = Math.pow(10, db / 20);
    return linear;
  };

  topAudios.forEach(clip => {
    let player = audioPlayersRef.current.get(clip.id);
    
    const audio = `${clip.name.split('.').slice(0, -1).join('.')}.mp3`;
    const path = knowTypeByAssetName(clip.name) === 'video' 
      ? `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/extracted_audios/${audio}`)}` 
      : `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/videos/${clip.name}`)}`;

    if (!player) {
      player = new Audio(path);
      audioPlayersRef.current.set(clip.id, player);
    }

    const targetTime = (currentTimeRef.current - clip.start) + (clip.beginmoment || 0);

    const applyFadeAndSync = () => {
      if (targetTime >= 0 && targetTime < player!.duration) {
        player!.currentTime = targetTime;
      }
      
      if (isPlaying) player!.play().catch(() => {});

      const updateVolume = () => {
        if (!player || player.paused) return;

        const relativeTime = player.currentTime - (clip.beginmoment || 0);
        const fadein = clip.fadeinAudio || 0;
        const fadeout = clip.fadeoutAudio || 0;
        
        // 1. Cálculo do Fade (Linear 0 a 1)
        let fadeVol = 1.0;
        if (relativeTime < fadein && fadein > 0) {
          fadeVol = relativeTime / fadein;
        } else if (relativeTime > (clip.duration - fadeout) && fadeout > 0) {
          const timeRemaining = clip.duration - relativeTime;
          fadeVol = timeRemaining / fadeout;

        }

        // 2. Cálculo do Keyframe (Convertendo dB para Linear)
        const kfValue = getInterpolatedValueWithFades(currentTimeRef.current, clip, 'volume');
        const kfLinear = keyframeToLinear(kfValue);

        // 3. Volume Final
        // Como o player.volume morre em 1.0, limitamos aqui para o preview não quebrar.
        // No Export (FFmpeg), o valor kfLinear completo será usado.
        const combinedVol = kfLinear;
        player.volume = Math.max(0, Math.min(1, combinedVol));
        
        if (isPlaying) requestAnimationFrame(updateVolume);
      };

      updateVolume();
    };

    if (player.readyState >= 1) { 
      applyFadeAndSync();
    } else {
      player.addEventListener('loadedmetadata', applyFadeAndSync, { once: true });
    }
  });

}, [topAudios, isPlaying]);

*/

const getInterpolatedValue = (time: number, keyframes: Keyframe[]): number => {
  // 1. Se não houver keyframes, retorna o valor padrão (meio da escala = 0dB)

  console.log('keys', keyframes)
  if (!keyframes || keyframes.length === 0) return 0.5;

  // 2. Garante que estão ordenados por tempo (importante para a busca)
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // 3. Caso o tempo esteja ANTES do primeiro keyframe
  if (time <= sorted[0].time) return sorted[0].value;

  // 4. Caso o tempo esteja DEPOIS do último keyframe
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

  // 5. Encontra o intervalo entre dois keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    const startKf = sorted[i];
    const endKf = sorted[i + 1];

    console.log('middle', startKf, endKf)

    if (time >= startKf.time && time <= endKf.time) {
      // Cálculo de Interpolação Linear (LERP)
      // Descobre a porcentagem do progresso entre o ponto A e o ponto B
      const rangeTime = endKf.time - startKf.time;
      const progress = (time - startKf.time) / rangeTime;

      // Aplica o progresso à diferença de valores
      const rangeValue = endKf.value - startKf.value;
      return startKf.value + progress * rangeValue;
    }
  }

  return 0.5;
};

const getInterpolatedValueWithFades = (
  timeFull: number, 
  clip: any, 
  type: 'opacity' | 'volume' | 'speed' | 'zoom' | 'position' | 'rotation3d'
): any => {
  
  // 1. Valores Padrão (Fallbacks) - Adicionado rotation3d
  const getDefaultValue = () => {
    switch (type) {
      case 'volume': return convertDB(0.5);
      case 'zoom': return convertZoom(0.5);
      case 'position': return { x: 0, y: 0 };
      case 'rotation3d': return { x: 0, y: 0 }; // x: rot, y: rot3d
      case 'speed': return 1.0;
      case 'opacity': return 1.0;
      default: return 0;
    }
  };

  const time = timeFull - clip.start;
  const kfArray = clip.keyframes?.[type];
  let baseValue = getDefaultValue();

  // Se não houver keyframes, retorna o padrão imediatamente
  if (!kfArray || kfArray.length === 0) {
    return applyFades(baseValue, time, clip, type);
  }

  const sorted = [...kfArray].sort((a, b) => a.time - b.time);

  // 2. Lógica de Interpolação
  if (time <= sorted[0].time) {
    baseValue = sorted[0].value;
  } else if (time >= sorted[sorted.length - 1].time) {
    baseValue = sorted[sorted.length - 1].value;
  } else {
    for (let i = 0; i < sorted.length - 1; i++) {
      const startKf = sorted[i];
      const endKf = sorted[i + 1];

      if (time >= startKf.time && time <= endKf.time) {
        const rangeTime = endKf.time - startKf.time;
        const progress = rangeTime === 0 ? 0 : (time - startKf.time) / rangeTime;

        // LÓGICA PARA OBJETOS (Position e Rotation3D)
        if (type === 'position' || type === 'rotation3d') {
          const start = startKf.value as { x: number, y: number };
          const end = endKf.value as { x: number, y: number };
          baseValue = {
            x: start.x + progress * (end.x - start.x),
            y: start.y + progress * (end.y - start.y)
          };
        } else {
          // LÓGICA PARA NÚMEROS (Opacity, Speed, Zoom, Volume)
          baseValue = (startKf.value as number) + progress * ((endKf.value as number) - (startKf.value as number));
        }
        break;
      }
    }
  }

  return applyFades(baseValue, time, clip, type);
};

/**
 * Função auxiliar isolada para aplicar os Fades de entrada e saída
 */
const applyFades = (value: any, time: number, clip: any, type: string) => {
  if (type === 'opacity' || type === 'volume') {
    const isVideo = type === 'opacity';
    const fadeInDuration = isVideo ? (clip.fadein || 0) : (clip.fadeinAudio || 0);
    const fadeoutDuration = isVideo ? (clip.fadeout || 0) : (clip.fadeoutAudio || 0);
    
    let fadeModifier = 1.0;
    
    if (time < fadeInDuration && fadeInDuration > 0) {
      fadeModifier = time / fadeInDuration;
    } else if (time > (clip.duration - fadeoutDuration) && fadeoutDuration > 0) {
      const timeInFadeOut = time - (clip.duration - fadeoutDuration);
      fadeModifier = 1.0 - (timeInFadeOut / fadeoutDuration);
    }

    fadeModifier = Math.max(0, Math.min(1, fadeModifier));
    return (value as number) * fadeModifier;
  }
  return value;
};

const getInterpolatedValueWithFades_old3 = (
  timeFull: number, 
  clip: any, 
  type: 'opacity' | 'volume' | 'speed' | 'zoom' | 'position'
): any => {
  // 1. Valores Padrão (Fallbacks)
  const getDefaultValue = () => {
    if (type === 'volume') return convertDB(0.5);
    if(type === 'zoom' ) return convertZoom(0.5);
    if (type === 'position') return { x: 0, y: 0 } as Position;
    return 1.0; 
  };

  const time = timeFull - clip.start;
  const kfArray = clip.keyframes?.[type];
  let baseValue = getDefaultValue();

  if (kfArray && kfArray.length > 0) {
    const sorted = [...kfArray].sort((a, b) => a.time - b.time);

    if (time <= sorted[0].time) {
      baseValue = sorted[0].value;
    } else if (time >= sorted[sorted.length - 1].time) {
      baseValue = sorted[sorted.length - 1].value;
    } else {
      for (let i = 0; i < sorted.length - 1; i++) {
        const startKf = sorted[i];
        const endKf = sorted[i + 1];
        if (time >= startKf.time && time <= endKf.time) {
          const rangeTime = endKf.time - startKf.time;
          const progress = rangeTime === 0 ? 0 : (time - startKf.time) / rangeTime;

          // LÓGICA PARA POSITION (Objeto)
          if (type === 'position') {
            const startPos = startKf.value as Position;
            const endPos = endKf.value as Position;
            baseValue = {
              x: startPos.x + progress * (endPos.x - startPos.x),
              y: startPos.y + progress * (endPos.y - startPos.y)
            };
          } else {
            // LÓGICA PARA NÚMEROS (Opacity, Speed, etc)
            baseValue = (startKf.value as number) + progress * ((endKf.value as number) - (startKf.value as number));
          }
          break;
        }
      }
    }
  }

  // 3. Aplicação de Fades (Somente para Opacity e Volume)
  if (type === 'opacity' || type === 'volume') {
    const isVideo = type === 'opacity';
    const fadeInDuration = isVideo ? (clip.fadein || 0) : (clip.fadeinAudio || 0);
    const fadeOutDuration = isVideo ? (clip.fadeout || 0) : (clip.fadeoutAudio || 0);
    
    let fadeModifier = 1.0;
    if (time < fadeInDuration && fadeInDuration > 0) {
      fadeModifier = time / fadeInDuration;
    } else if (time > (clip.duration - fadeOutDuration) && fadeOutDuration > 0) {
      const timeInFadeOut = time - (clip.duration - fadeOutDuration);
      fadeModifier = 1.0 - (timeInFadeOut / fadeOutDuration);
    }

    fadeModifier = Math.max(0, Math.min(1, fadeModifier));
    return (baseValue as number) * fadeModifier;
  }

  return baseValue;
};


useEffect(() => {
  setCurrentTime(playheadPos/pixelsPerSecond)
  
}, [playheadPos])


const lastFrameTimeRef = useRef<number>(0);
const FPS_LIMIT = 1000 / 10; // 30 FPS (aprox 33ms)

const getOpacityAtTime = (clip: Clip) => {
  if (!clip.keyframes || !clip.keyframes.opacity || clip.keyframes.opacity.length === 0) {
    return 1; // Opacidade total se não houver keyframes
  }

  const kfs = [...clip.keyframes.opacity].sort((a, b) => a.time - b.time);
  const relativeTime = (currentTime - clip.start) + (clip.beginmoment || 0);


  console.log('relative time', relativeTime)

  // Antes do primeiro keyframe
  if (relativeTime <= kfs[0].time) return kfs[0].value;
  // Depois do último keyframe
  if (relativeTime >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

  // Encontrar os dois keyframes entre os quais o tempo atual está
  for (let i = 0; i < kfs.length - 1; i++) {
    const current = kfs[i];
    const next = kfs[i + 1];

    console.log('current.value', current.value)

    if (relativeTime >= current.time && relativeTime <= next.time) {
      const range = next.time - current.time;
      const progress = (relativeTime - current.time) / range;
      // Interpolação linear simples
      return current.value + ((next.value - current.value) * progress);
    }
  }
  return 1;
};


//Render main frame



// Objetos do Core Engine

//const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
//const sceneRef = useRef<THREE.Scene | null>(null);
//const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
//const planesRef = useRef<Map<string, THREE.Mesh>>(new Map()); // Guarda os planos de cada clip




//const canvasRef = useRef<HTMLCanvasElement>(null);
const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
const sceneRef = useRef<THREE.Scene | null>(null);
const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
const groupsRef = useRef<Map<string, THREE.Group>>(new Map());
// const lastFrameTimeRef = useRef<number>(0);

useEffect(() => {
  // Se o canvas não existe ou se já inicializamos, não faz nada
  if (!canvasRef.current || rendererRef.current) return;

  const initEngine = () => {
    const width = projectConfig.width;
    const height = projectConfig.height;

    // 1. Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current!,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    // 2. Cena
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 3. Câmera
    const fov = 45;
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 10000);
    const zPos = (height / 2) / Math.tan((fov * Math.PI) / 360);
    camera.position.set(width / 2, -height / 2, zPos);
    camera.lookAt(width / 2, -height / 2, 0);
    cameraRef.current = camera;
    
    console.log("🚀 Three.js Engine Inicializado com Sucesso");
  };

  initEngine();

  return () => {
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }
  };
}, [canvasRef.current, projectConfig.width, projectConfig.height]); // Adicionado canvasRef.current aqui


const fetchFramesFromRust = async (time: number) => {
  // Garante que topClips existe
  if (!topClips.current) return [];

  const activeClips = topClips.current.reverse()



  const framePromises = activeClips.map(async (clip) => {
    const timelineRelativeTime = time - clip.start;
    const clipTimeMs = (timelineRelativeTime + (clip.beginmoment || 0)) * 1000;
    const path = `${currentProjectPath}/videos/${clip.name}`;

    try {
      const frameBase64 = await invoke('get_video_frame', { path, timeMs: clipTimeMs }) as string;
      return new Promise<{id: string, img: HTMLImageElement, clip: any}>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ id: clip.id, img, clip });
        img.src = frameBase64;
      });
    } catch (e) { return null; }
  });

  const results = await Promise.all(framePromises);
  return results.filter((res): res is {id: string, img: HTMLImageElement, clip: any} => res !== null);
};

const syncClipsToScene = (loadedData: any[], time: number) => {
  const scene = sceneRef.current;
  if (!scene) return;

  const loadedIds = new Set(loadedData.map(d => d.id));
  
  // Limpeza
  groupsRef.current.forEach((group, id) => {
    if (!loadedIds.has(id)) {
      scene.remove(group);
      const mesh = group.children[0] as THREE.Mesh;
      if (mesh.material instanceof THREE.MeshBasicMaterial && mesh.material.map) {
        mesh.material.map.dispose();
      }
      groupsRef.current.delete(id);
    }
  });

  // Renderização/Sincronização
  loadedData.forEach(({ id, img, clip }, index) => {
    let group = groupsRef.current.get(id);
    let mesh: THREE.Mesh;

    if (!group) {
      group = new THREE.Group();
      const geometry = new THREE.PlaneGeometry(1, 1);
      const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      scene.add(group);
      groupsRef.current.set(id, group);
    } else {
      mesh = group.children[0] as THREE.Mesh;
    }

    const texture = new THREE.Texture(img);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (mat.map) mat.map.dispose();
    mat.map = texture;

    // --- CÁLCULO DE KEYFRAMES COM FALLBACKS ---

    // 1. Opacidade (Padrão 1 se não houver keyframe)
    const opacity = getInterpolatedValueWithFades(time, clip, 'opacity') ?? 1.0;

    // 2. Zoom (Padrão 1 se não houver keyframe)
    const zoom = getInterpolatedValueWithFades(time, clip, 'zoom') || 1.0;

    // 3. Posição (Padrão 0,0 se não houver keyframe)
    const pos = getInterpolatedValueWithFades(time, clip, 'position') || { x: 0, y: 0 };

    // 4. Rotação (AQUI ESTÁ O ERRO: Precisamos garantir que rot e rot3d sejam números)
    const rotationRaw = getInterpolatedValueWithFades(time, clip, 'rotation3d');
    const rotation = {
      rot: rotationRaw?.rot ?? 0,
      rot3d: rotationRaw?.rot3d ?? 0
    };

    // --- APLICAÇÃO DAS DIMENSÕES ---
    const w = (clip.dimensions?.x || img.width) * zoom;
    const h = (clip.dimensions?.y || img.height) * zoom;

    // --- APLICAÇÃO NO THREE.JS ---

    // Grupo: Posição e Rotação Z (2D)
    group.position.set(pos.x + w / 2, -(pos.y + h / 2), index * 0.5);
    group.rotation.z = THREE.MathUtils.degToRad(-(rotation.rot || 0));

    // Mesh: Escala e Rotação Y (3D)
    mesh.scale.set(w, h, 1);
    mesh.rotation.y = THREE.MathUtils.degToRad(rotation.rot3d || 0);

    // Material
    mat.transparent = true;
    mat.opacity = opacity;



    // --- TRATAMENTO DE BLEND MODES ---
    
    // 2. Fallback total: se não houver clip.blendmode, usa 'normal'
    const userBlendMode = (clip.blendmode || 'normal').toLowerCase();

    // 3. Mapeamento seguro para constantes do Three.js
    let threeJSBlending: THREE.Blending;
    mat.premultipliedAlpha = true

    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.SrcAlphaFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;

    switch (userBlendMode) {
      case 'screen':
        mat.blendSrc = THREE.OneFactor;
        mat.blendDst = THREE.OneMinusSrcColorFactor;
        mat.blendEquation = THREE.AddEquation;
        break;
      case 'multiply':
        threeJSBlending = THREE.MultiplyBlending;
        break;
      case 'lineardodge':
      case 'add':
        threeJSBlending = THREE.AdditiveBlending;
        break;
      case 'overlay':
        mat.blendSrc = THREE.DstColorFactor;
        mat.blendDst = THREE.SrcColorFactor;
        mat.blendEquation = THREE.AddEquation;
        break;
      case 'normal':
      default:
        threeJSBlending = THREE.NormalBlending;
        break;
    }

    // Só aplica se o valor for diferente do atual (otimização de performance)
   

    // IMPORTANTE: Para o CapCut, o depthWrite como false evita que a "caixa" invisível
    // de um clipe com blend mode corte o vídeo que está atrás.
    mat.depthWrite = false;


  });
};


const drawFrame = async (time: number) => {
  // Agora fazemos o check das Refs aqui
  if (!rendererRef.current || !sceneRef.current || !cameraRef.current) {
      console.warn("⚠️ Engine não inicializado ainda...");
      return;
  }

  try {
    const loadedData = await fetchFramesFromRust(time);
    syncClipsToScene(loadedData, time);
    rendererRef.current.render(sceneRef.current, cameraRef.current);
  } catch (err) {
    console.error("Erro no drawFrame:", err);
  }
};























const drawFrame_old = async (time: number) => {
  if (!canvasRef.current) return;

  const ctx = canvasRef.current.getContext('2d');
  if (!ctx) return;

  // Sincroniza dimensões do Canvas com o Projeto
  if (canvasRef.current.width !== projectConfig.width || canvasRef.current.height !== projectConfig.height) {
    canvasRef.current.width = projectConfig.width;
    canvasRef.current.height = projectConfig.height;
  }

  // Se não houver clipes, limpa a tela e sai
  if (!topClips.current || topClips.current.length === 0) {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    return;
  }

  // Controle de FPS para o Preview
  const now = performance.now();
  if (isPlaying && (now - lastFrameTimeRef.current < (1000 / projectConfig.fps))) return;
  lastFrameTimeRef.current = now;

  const blendModeMap: Record<string, GlobalCompositeOperation> = {
    'normal': 'source-over',
    'screen': 'screen',
    'multiply': 'multiply',
    'overlay': 'overlay',
    'lineardodge': 'lighter',
  };

  try {
    // --- FASE 1: BUSCA DE FRAMES ---
    const framePromises = topClips.current.map(async (clip) => {
      const timelineRelativeTime = time - clip.start;
      let assetRelativeTime = timelineRelativeTime;

      // Cálculo de Speed Ramp (Se houver keyframes de velocidade)
      if (clip.keyframes?.speed && clip.keyframes.speed.length > 0) {
        // assetRelativeTime = calculateSpeedRamp(timelineRelativeTime, clip.keyframes.speed);
      }

      const clipTimeMs = (assetRelativeTime + (clip.beginmoment || 0)) * 1000;
      const path = `${currentProjectPath}/videos/${clip.name}`;

      try {
        const frameBase64 = await invoke('get_video_frame', { path, timeMs: clipTimeMs });
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = frameBase64;
        });
      } catch (e) { return null; }
    });

    const loadedImages = await Promise.all(framePromises);

    // --- FASE 2: RENDERIZAÇÃO ---
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    // Renderiza de baixo para cima (respeitando camadas)
    for (let i = loadedImages.length - 1; i >= 0; i--) {
      const img = loadedImages[i] as HTMLImageElement;
      const clip = topClips.current[i];
      if (!img) continue;

      // 1. Interpolação de Keyframes
      const opacity = getInterpolatedValueWithFades(time, clip, 'opacity');
      const zoom = getInterpolatedValueWithFades(time, clip, 'zoom') || 1.0;
      const pos = getInterpolatedValueWithFades(time, clip, 'position') as { x: number, y: number };
      const rotation = getInterpolatedValueWithFades(time, clip, 'rotation3d') as { rot: number, rot3d: number } 
        || { rot: 0, rot3d: 0 };

      // 2. Definição de Tamanho e Posição
      const clipW = (clip.dimensions?.x || img.width) * zoom;
      const clipH = (clip.dimensions?.y || img.height) * zoom;
      const targetX = pos ? pos.x : (canvasRef.current.width - clipW) / 2;
      const targetY = pos ? pos.y : (canvasRef.current.height - clipH) / 2;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
      ctx.globalCompositeOperation = blendModeMap[clip.blendmode || 'normal'] || 'source-over';

      // --- CONFIGURAÇÃO 3D ---
      const focalLength = 1200; // Intensidade da perspectiva
      const radY = (rotation.rot3d || 0) * Math.PI / 180; // Rotação Y (Giro 3D)
      const radZ = (rotation.rot || 0) * Math.PI / 180;   // Rotação Z (Plano XY)

      // Move para o centro do clip na tela
      ctx.translate(targetX + clipW / 2, targetY + clipH / 2);
      ctx.rotate(radZ);

      // Quantidade de tiras para o efeito (60-80 é o ponto ideal entre performance e qualidade)
      const slices = 60;
      const sliceW = clipW / slices;

      for (let s = 0; s < slices; s++) {
        // Distância X da tira em relação ao centro do clip
        const x = s * sliceW - clipW / 2;
        
        // Cálculo da profundidade Z baseada no Seno do ângulo de rotação
        const z = x * Math.sin(radY);
        
        // Fator de escala da perspectiva (quem está mais perto do Z parece maior)
        const scale = focalLength / (focalLength - z);
        
        // Posição X projetada após a rotação e perspectiva
        const projectedX = x * Math.cos(radY) * scale;

        ctx.save();
        ctx.translate(projectedX, 0);
        ctx.scale(scale, scale);

        // Desenha a fatia vertical correspondente da imagem fonte
        ctx.drawImage(
          img,
          (s * img.width) / slices, 0,     // Fonte X, Y
          img.width / slices, img.height,  // Fonte Largura, Altura
          -sliceW / 2, -clipH / (2 * zoom), // Destino X, Y (Compensando o centro)
          sliceW + 0.5, clipH / zoom       // Destino L, A (+0.5 evita linhas entre fatias)
        );
        ctx.restore();
      }

      ctx.restore();
    }
  } catch (err) {
    console.error("Erro na renderização do frame:", err);
  }
};





const lastDrawTimeRef = useRef<number>(0);
const FPS_target = 10;
const frameInterval = 1000 / FPS_target; // 100ms

useEffect(() => {
  
    updatePreview(currentTime);
    updateAudio();

    const now = performance.now();
    if (now - lastDrawTimeRef.current >= frameInterval) {
      drawFrame(currentTime);
      lastDrawTimeRef.current = now; 
    }
  




}, [currentTime, clips]);



const lastUpdateRef = useRef<number>(0); 

const currentTimeRef = useRef(0);


const animate = (time: number) => {
  if (lastTimeRef.current !== null) {
    const deltaTime = (time - lastTimeRef.current) / 1000;

  
    
   // 1. Update the REF (this is where time really "moves")
    currentTimeRef.current += deltaTime;
    const currentPos = currentTimeRef.current * pixelsPerSecond;

   // 2. Move the needle via DOM.
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${currentPos}px)`;
    }

   
 // 3. Updates the stopwatch status only occasionally.
    if (time - lastUpdateRef.current > 100) {
      setCurrentTime(currentTimeRef.current); 
      lastUpdateRef.current = time;
    }
  }
  lastTimeRef.current = time;
  requestRef.current = requestAnimationFrame(animate);
};


useEffect(() => {
  if (isPlaying) {
    requestRef.current = requestAnimationFrame(animate);
    
  } else {
    //if (requestRef.current) cancelAnimationFrame(requestRef.current);
    lastTimeRef.current = null;
  }
  return () => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };
}, [isPlaying]);







//generate thubnais in timeline


useEffect(() => {
  const generateTimelineThumbs = async () => {
    if (!currentProjectPath) return;

    for (const clip of clips) {
      // It only generates if it's a video and if it's not already in the cache (or if the time has changed).
      const cacheKey = `${clip.id}-${clip.beginmoment}-${clip.duration}`;

      const assetTarget = assets.find( a => a.name === clip.name)
      
      if (assetTarget?.type === 'video' && !timelineThumbs[cacheKey]) {
        try {
          const startPath = await getThumbnail(currentProjectPath, clip.name, clip.beginmoment);
          const endPath = await getThumbnail(currentProjectPath, clip.name, clip.beginmoment + clip.duration);

          setTimelineThumbs(prev => ({
            ...prev,
            [cacheKey]: {
              start: startPath ? startPath : "",
              end: endPath ? endPath : ""
            }
          }));
        } catch (err) {
          console.error("Erro ao gerar thumb da timeline:", err);
        }
      }
    }
  };

  generateTimelineThumbs();
}, [clips, currentProjectPath]);


// Delete clean tracks
useEffect(() => {
  if (!isSetupOpen) {
    // 1. Get the IDs of the tracks that have at least one clip.
    const activeTrackIds = [...new Set(clips.map(c => c.trackId))];

    // 2. We filter the current array of tracks to keep only those that have clips.
    // In other words, we remove those that are not in the list of active IDs.

    const filteredTracks = tracks.filter(t => activeTrackIds.includes(t.id));

    //3. We check if there was an actual change (by comparing IDs) to avoid render loops.
    const hasChanged__ = 
      filteredTracks.length !== tracks.length || 
      tracks.some((t, i) => filteredTracks[i] && t.id !== filteredTracks[i].id);

    if (hasChanged__) {
      setTracks(filteredTracks);
    }
  }
}, [clips, isSetupOpen]); 


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
        setAssets([])
        setClips([])
        setTracks([])
        setProjectToDelete(null);
        loadProjects(); // Reload projects list       
        showNotify("Project deleted", "success");

      } catch (e) {
        showNotify("Error deleting project", "error");
      }
    }
  };


  //avoid double clips


useEffect(() => {
  if (clips.length === 0) return;

  const uniqueClips = clips.reduce((acc: Clip[], current) => {
    // 1. Check if a clip with the same ID already exists
    const duplicateId = acc.find(c => c.id === current.id);
    
    // 2. Check if a clip already exists in the same Track and at the same Start position
    const duplicateSlot = acc.find(c => 
      c.trackId === current.trackId && c.start === current.start
    );

    if (duplicateId || duplicateSlot) {
      // If there is a conflict, we keep the one with the smaller ID (the oldest/original)
      // and discard the one with the larger ID (the most recent/duplicate)
      const existing = duplicateId || duplicateSlot;
      
      if (current.id > existing!.id) {
        return acc; // Ignore the current clip (higher ID)
      } else {
        // If the current ID is smaller (rare case), remove the previous one and add this one
        return [...acc.filter(c => c !== existing), current];
      }
    }

    return [...acc, current];
  }, []);

  // Only update the state if the array length changed (prevents infinite loops)
  if (uniqueClips.length !== clips.length) {
    setClips(uniqueClips);
  }
}, [clips]);

// Function to move playhead
const handlePlayheadMouseDown = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();

  const movePlayhead = (moveEvent: MouseEvent) => {
    if (!timelineContainerRef.current) return;

    const rect = timelineContainerRef.current.getBoundingClientRect();
    const scrollLeft = timelineContainerRef.current.scrollLeft;

    // Calculate the X position relative to the container, including scroll offset.
    // Subtract asidetrackwidth (192 or similar) and padding (8) to align with the start of the tracks.
    const x = moveEvent.clientX - rect.left + scrollLeft - (asidetrackwidth + 15);

    // Set the new position (preventing negative values)
    setPlayheadPos(Math.max(0, x));
  };

  const stopMoving = () => {
    document.removeEventListener('mousemove', movePlayhead);
    document.removeEventListener('mouseup', stopMoving);
  };

  // Register events on the document so dragging continues 
  // even if the mouse leaves the playhead area
  document.addEventListener('mousemove', movePlayhead);
  document.addEventListener('mouseup', stopMoving);
};

// This ref prevents the useEffect from saving history during an Undo/Redo operation
const isUndoRedoAction = useRef(false);

const MAX_HISTORY_STEPS = 100;

/**
 * Adjusts the timeline scale.
 * @param factor - Positive to zoom in, negative to zoom out
 */ 


  const handleZoom = (factor: number) => {
    
    

    setPixelsPerSecond(prev => {
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + factor));


      ///code to make the playhead on the same position (time)
      const pixelsFromLeft = playheadRef.current.offsetLeft  - asidetrackwidth - 8;
     // console.log("Pixels via offsetLeft:", pixelsFromLeft);


      const variation = newZoom / (prev == 0 ? 1 : prev)
      const delta = (newZoom - prev)
     // console.log("var", prev, factor, variation, playheadPos)
     // console.log("delta", delta, factor)

      //playheadRef.current.style.transform = `translateX${pixelsFromLeft * variation}px`;

      //timelineContainerRef.current.scrollLeft = factor < 0 ? 0 : pixelsFromLeft 
      //currentTimeRef.current = currentTimeRef.current * delta

      
      return newZoom;
    });


  };



  useEffect(() => {
  // Whenever the zoom changes, we visually reposition the needle.
  if (playheadRef.current) {
    const currentPos = currentTimeRef.current * pixelsPerSecond;
    playheadRef.current.style.transform = `translateX(${currentPos}px)`;
    timelineContainerRef.current.scrollLeft= currentPos
  }
}, [pixelsPerSecond]);


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

  // Store the preview state
  const previousClips = [...clips];
  const previousAssets = [...assets];

  // Update
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
    // Revert in case of failure in backend
    setClips(previousClips);
    setAssets(previousAssets);
  }
};




const getThumbnail = async (projectPath: string, fileName: string, requestedTime: number) => {
  // 1. Find the asset to determine its type and duration
  const asset = assets.find(a => a.name === fileName);
  if (!asset) return null;

  // 2. Rule: Audio files do not have thumbnails
  if (asset.type === 'audio') {
    return null; 
  }

  // 3. Rule: For images, the thumbnail is the image itself
  if (asset.type === 'image') {
    return asset.path; // Return the original path
  }

  // 4. Rule: Time adjustment (if requestedTime > duration, default to time 0)
  let finalTime = requestedTime;
  if (requestedTime >= asset.duration) {
    finalTime = 0;
  }

  try {
    // 5. Call Rust (Tauri command) to generate or retrieve the thumbnail
    const thumbPath = await invoke<string>('generate_thumbnail', {
      projectPath,
      fileName,
      timeSeconds: finalTime
    });

    // To display the file in HTML/React from the local file system, 
    // we use Tauri's convertFileSrc to get a safe URL
    // TRANSFORMING THE PATH:
    const safeUrl = convertFileSrc(thumbPath); 

    
    return safeUrl
  } catch (error) {
    console.error("Error generating thumbnail:", error);
    return null;
  }
};

// Function to copy and paste clips
const handleCopy = () => {
  if (selectedClipIds.length === 0) return;
  
  const selectedClips = clips.filter(c => selectedClipIds.includes(c.id));
  
  // Update the REF immediately (synchronously)
  clipboardRef.current = selectedClips;
  
  showNotify(`${selectedClips.length} clips copied`, "success");
};

const handlePaste = () => {
  const clipsToPaste = clipboardRef.current;
  
  if (clipsToPaste.length === 0) {
    showNotify("Clipboard is empty", "error");
    return;
  }

  // Use this to measure the actual time, better than playheadPos
  let now_playheadpos = playheadRef.current?.offsetLeft - asidetrackwidth - 8
  
  const playheadTime = now_playheadpos / pixelsPerSecond;
  
  saveHistory(clips, assets, tracks);

  // 2. Find the reference point (the leftmost clip in the copied group)
  const minStart = Math.min(...clipsToPaste.map(c => c.start));

  let newClipsList = [...clips];
  let updatedTracks = [...tracks];
  const pastedIds: string[] = [];

  // 3. Process the pasting operation
  clipsToPaste.forEach(originalClip => {
    // Calculate relative offset to maintain the group's structure when pasted
    const relativeOffset = originalClip.start - minStart;
    
    // Target time must be strictly Playhead + Relative Offset
    const targetStart = playheadTime + relativeOffset;
    
    let targetTrack = originalClip.trackId;

    // Improved collision/occupancy check function
    const isOccupied = (tId: number, start: number, dur: number) => {
      const end = start + dur;
      return newClipsList.some(c => 
        c.trackId === tId && 
        // Small tolerance margin (0.01) to avoid false positives
        start < (c.start + c.duration - 0.01) && 
        end > (c.start + 0.01)
      );
    };

    // 4. Track search logic: 
    // Increment only if there is ACTUALLY something occupying the same time slot and track
    while (isOccupied(targetTrack, targetStart, originalClip.duration)) {
      targetTrack++;
    }

    const newClipId = crypto.randomUUID();
    const pastedClip: Clip = {
      ...originalClip,
      id: newClipId,
      start: targetStart, // Apply the calculated time here
      trackId: targetTrack
    };

    // 5. Ensure the target track exists
    if (!updatedTracks.some(t => t.id === targetTrack)) {
      const clipType = knowTypeByAssetName(pastedClip.name, true);
      updatedTracks.push({
        id: targetTrack,
        type: clipType as 'video' | 'audio' | 'effects'
      });
    }

    newClipsList.push(pastedClip);
    pastedIds.push(newClipId);
  });

  // 6. Final sorting to keep the UI organized
  const sortedTracks = updatedTracks.sort((a, b) => {
    const priority = (type: string) => (type === 'audio' ? 1 : 0);
    return priority(a.type) - priority(b.type) || a.id - b.id;
  });

  setTracks(sortedTracks);
  setClips(newClipsList);
  setSelectedClipIds(pastedIds);
  
  showNotify(`Pasted ${clipsToPaste.length} clips at playhead`, "success");
};


const handleTimelineMouseMove = (e: React.MouseEvent) => {
  if (!isBoxSelecting) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;

  setBoxEnd({ x: currentX, y: currentY });

  // Rect calculation
  const left = Math.min(boxStart.x, currentX);
  const right = Math.max(boxStart.x, currentX);
  const top = Math.min(boxStart.y, currentY);
  const bottom = Math.max(boxStart.y, currentY);

  // Detect clips inside the selection box
  const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;

  // Organize tracks as they are rendered to determine their order
  const tracksid = order_tracks().map((track) => ( track.id)) 

  const collidingClips = clips.filter(clip => {

    const indexofTrack = tracksid.indexOf(clip.trackId)

    const clipLeft = 200 + (clip.start * pixelsPerSecond) - scrollLeft ;
    const clipRight = clipLeft + (clip.duration * pixelsPerSecond);
    const clipTop = ( (indexofTrack+1) * 64) + 30; // 64px track height + ruler margin
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
        order_tracks()
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
  const saveHistory = (currentClips: Clip[], currentAssets: Asset[], tracks: Tracks[]) => {
    setHistory(prev => {
      const newHistory = [...prev, { clips: currentClips, assets: currentAssets, tracks: tracks }];
      return newHistory.length > MAX_HISTORY_STEPS ? newHistory.slice(1) : newHistory;
    });
    setRedoStack([]); // New action invalidates the redo path
  };

const handleUndo = () => {
  if (history.length === 0) return;

  // 1. Bloqueia salvamento automático durante o undo
  isUndoRedoAction.current = true;

  // 2. Encontrar o último estado válido (que contenha tracks)
  let previousState = null;
  let validIndex = -1;

  // Percorre do fim para o início
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] && history[i].tracks) {
      previousState = history[i];
      validIndex = i;
      break; 
    }
  }

  // 3. Se não achou nada válido, aborta ou usa o estado atual
  if (!previousState) {
    console.warn("Nenhum estado válido encontrado no histórico.");
    return;
  }

  // 4. Gerencia Pilha de Redo (Salva o estado atual antes de voltar)
  setRedoStack(prev => [...prev, { clips, assets, tracks }]);

  // 5. Atualiza os estados
  setClips(previousState.clips);
  setAssets(previousState.assets);
  setTracks(previousState.tracks);

  // 6. Remove do histórico tudo após o ponto para onde voltamos
  const newHistory = history.slice(0, validIndex);
  setHistory(newHistory);

  showNotify("Undo", "success");
};


  const handleRedo = () => {
    if (redoStack.length === 0) return;

    // 1. Lock history saving
    isUndoRedoAction.current = true;

    const nextState = redoStack[redoStack.length - 1];
    const newRedoStack = redoStack.slice(0, -1);

    setHistory(prev => [...prev, { clips, assets, tracks }]);

    setClips(nextState.clips);
    setAssets(nextState.assets);
    setTracks(nextState.tracks)
    setRedoStack(newRedoStack);
    
    showNotify("Redo", "success");
  };

//Code to make player needle walk
  const togglePlay = () => {
    setIsPlaying(prev => !prev);
  };






  //undo and redo 

  const lastSavedState = useRef(JSON.stringify({ clips, assets, tracks }));


  useEffect(() => {
  const currentState = JSON.stringify({ clips, assets, tracks });
  
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
  const deltaSeconds = deltaX / PIXELS_PER_SECOND; // Remove 0.2 if you want raw mouse precision

  setClips(prev => prev.map(clip => {
    if (clip.id !== id) return clip;

    const asset = assets.find(a => a.name === clip.name);
    const isImage = asset?.type === 'image';

    const noKeyframesSpeed = (!clip.keyframes?.speed) || (clip.keyframes?.speed?.length == 0)

    if (side === 'right') {
      // If it's an image, the limit is only the next clip. If it's video, it's the end of the file.
      const remainingAssetTime = isImage ? Infinity : (clip.maxduration - (clip.beginmoment + clip.duration));
      
      const maxPossibleExpansion = Math.min(
        remainingAssetTime, 
        maxEndTimestamp - (clip.start + clip.duration)
      );

      // New duration (minimum of 0.1s to prevent the clip from disappearing)
      const addedDuration = Math.max(-clip.duration + 0.1, Math.min(deltaSeconds, maxPossibleExpansion));
      
      return { 
        ...clip, 
        duration: clip.duration + addedDuration,
        originalduration: noKeyframesSpeed ? clip.duration + addedDuration : clip.originalduration

      };

    } else {
      // LEFT SIDE (Trimming start)
      const maxRetractionTimeline = clip.start - minStart;
      // If it's an image, it can expand left infinitely (until the previous clip)
      const maxRetractionAsset = isImage ? Infinity : clip.beginmoment;

      const maxLeftExpansion = Math.min(maxRetractionTimeline, maxRetractionAsset);

      let safeDelta = Math.max(-maxLeftExpansion, deltaSeconds);

      // Prevent shrinking too much (minimum 0.1s duration)
      if (safeDelta > clip.duration - 0.1) safeDelta = clip.duration - 0.1;

      return {
        ...clip,
        start: clip.start + safeDelta,
        duration: clip.duration - safeDelta,
        originalduration: noKeyframesSpeed ? clip.duration - safeDelta : clip.originalduration,
        beginmoment: isImage ? 0 : clip.beginmoment + safeDelta
      };
    }
  }));
};

  // Code to make the clip resizable 

  // Function to help handleResize because standard Drag won't work due to Parent Element's Drag
  const startResizing = (e: React.MouseEvent, clipId: string, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;

    const onMouseMove = (moveEvent: MouseEvent) => {
      // Calculate how much the mouse has moved since the initial click
      const deltaX = moveEvent.clientX - startX;
      
      // Call the resize handler
      handleResize(clipId, deltaX * 0.2, side);
    };

    const onMouseUp = () => {
      // Clean up event listeners when the mouse is released
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    // Register events on the document to allow resizing even if the mouse leaves the handle area
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };


  // Effect to handle automatic saving whenever project data changes
  useEffect(() => {

    
    


    const saveProject = async () => {
      // DO NOT save if the project hasn't finished loading yet
     
      if (!isProjectLoaded || !currentProjectPath) return;

      

     

     const projectData: ProjectFileData = {
        projectName,
        assets,
        clips,
        tracks,
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
  const handleDeleteEverything =  () => {
    // 1. Check if there's anything to delete
    if (selectedClipIds.length === 0 && selectedAssets.length === 0) return;

    // 2. Save snapshot for the 100-step history
    saveHistory(clips, assets, tracks);

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

      selectedAssets.map( async (a) => {
          
          try {
            await invoke('delete_file', { 
              path: `${currentProjectPath}/videos/${a.name}`, 
            });
            showNotify(`Asset ${a.name} deleted`, "success");
          } catch (err) {
            showNotify("Error to delete asset", "error");
            console.log('err to delete asset: ',err )
            
          }
      })


      setSelectedAssets([]);
    }

    //showNotify("Selection purged", "success");
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

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      startExport();
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



        if(!isMouseOverSource && e.code === 'Space')
        {
          e.preventDefault();
          togglePlay();
        }  

      





      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedClipIds, selectedAssets , clips, isSnapEnabled, assets, history, redoStack, isMouseOverSource, sourceAsset, inPoint, outPoint]);





const isMouseOverRef = useRef(false);

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    
    
    
    
    if (!isMouseOverRef.current) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay2();
    }


    const time = audioRef2.current?.currentTime || 0
    if (e.key.toLowerCase() === 'i') setInPoint(time);
    if (e.key.toLowerCase() === 'o') setOutPoint(time);

  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []); 










// Function to synchronize currentTime with currentTimeRef 
const seekTo = (newTime: number) => {
  
    currentTimeRef.current = newTime;
  
    // 2. Update state so React is aware of the current position (for the timer, etc.)
    setCurrentTime(newTime);

    // 3. Move the playhead visually via DOM immediately for better performance
    if (playheadRef.current) {
      const nextPos = newTime * pixelsPerSecond;
      playheadRef.current.style.transform = `translateX(${nextPos}px)`;
    }


    audioPlayersRef.current.forEach((player, id) => {
    const clip = clips.find(c => c.id === id);
    if (clip) {
      const clipTargetTime = (newTime - clip.start) + (clip.beginmoment || 0);
      // Só faz o seek se o tempo for válido para este clipe
      if (clipTargetTime >= 0 && clipTargetTime < (player.duration || Infinity)) {
        player.currentTime = clipTargetTime;
      }
      }
    });
    // 4. If playback is paused, force a frame draw on the Canvas
    if (!isPlaying) {
      drawFrame(newTime);
     
    }
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


  //console.log('playheadtime', playheadTime)

  // 1. Find  clips at playhead
  const clipsAtPlayhead = clips.filter(c => 
    playheadTime > c.start && 
    playheadTime < (c.start + c.duration)
  );

  let targetClip: Clip | undefined;

  // 2. Selection logic
  if (selectedClipIds.length > 0) {
    targetClip = clipsAtPlayhead.find(c => selectedClipIds.includes(c.id));


    
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

  // --- TIME CALCULATION LOGIC ---

  // How much time has passed from the start of the CLIP on the timeline until the needle...

  const timeOffsetFromClipStart = playheadTime - targetClip.start;

  // Part One: maintains the original beginning moment, but shortens the duration.
  const firstClip: Clip = { 
    ...targetClip, 
    duration: timeOffsetFromClipStart 
  };
// Second part:
// - The start point on the timeline is the needle position.
// - The duration is what remained of the original clip.
// - The new begin moment is the original + the time we "travel" within the clip.
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
  ].sort((a, b) => a.start - b.start)); // Keep in order

  //Default behavor: Select Right
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





const lockmuteTrack = (option: number, track: Tracks) => {
  const updatedTrack = { ...track };

  if (option === 0) {
    updatedTrack.lock = !updatedTrack.lock;
  } else if (option === 1) {
    updatedTrack.mute = !updatedTrack.mute;
  }

  setTracks(prevTracks => 
    prevTracks.map(t => t.id === track.id ? updatedTrack : t)
  );
};







  // --- TAURI V2 NATIVE DRAG & DROP LISTENER FOR FILES FROM OS (NOT ASSETS) ---
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupDropListener = async () => {
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

//Play and Pause of Player Source Auxiliar

const [sourceCurrentTime, setSourceCurrentTime] = useState(0);
const [isSourcePlaying, setIsSourcePlaying] = useState(false);


const audioRef2 = useRef<HTMLAudioElement>(null);
const canvasRef2 = useRef<HTMLCanvasElement>(null);


    // Render Video Frame to Auxiliar Monitor
    const renderFrame2 = async (time: number) => {
    if (!canvasRef2.current) return;



       const now = performance.now();
        if (now - lastFrameTimeRef.current < FPS_LIMIT) 
          return;
        lastFrameTimeRef.current = now;
          



      
      if (!sourceAsset || !canvasRef2.current) return;
      
      try {
        // Busca o frame exato via invoke
        const frameBase64: string = await invoke("get_video_frame", { 
          path: sourceAsset.path, 
          timeMs: time * 1000
        });


       
        const ctx = canvasRef2.current.getContext("2d");
        const img = new Image();
        img.onload = () => {
          if (ctx && canvasRef2.current) {

            canvasRef2.current.width = img.width;
            canvasRef2.current.height = img.height
            ctx.drawImage(img, 0, 0);
          }
        };
        img.src = frameBase64;
      } catch (err) {
        console.error("Frame render error:", err);
      }
    };

    //Sync Canvas with Audio
    useEffect(() => {

      
      if(!sourceAsset) return
      if(!audioRef2.current) return

      if (isPlaying2) {

        
        
        const interval = setInterval(() => {
          if (audioRef2.current) {
            const time = audioRef2.current.currentTime;
            setCurrentTime2(time);
            renderFrame2(time);
          }
        }, 1000 / 10); // 30 FPS
        return () => clearInterval(interval);
        
        
      }
    }, [isPlaying2, sourceAsset, currentTime2]);




    const togglePlay2 =  () => {
  if (!audioRef2.current) return;

  console.log('entrou')

  try {
    if (audioRef2.current.paused) {
      audioRef2.current.volume = 1;

      audioRef2.current.play();
      console.log('audio played')
      setIsPlaying2(true);
    } else {
      audioRef2.current.pause();
      setIsPlaying2(false);
    }
  } catch (err) {
    console.error("Erro in Play/Pause:", err);
  }
};


    useEffect( () => {

      if(!sourceAsset) return
      if(!audioRef2.current) return


      const audio = `${sourceAsset.name.split('.').slice(0, -1).join('.')}.mp3`
      const path =  knowTypeByAssetName(sourceAsset.name) === 'video' ? `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/extracted_audios/${audio}`)}` :
      `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/videos/${sourceAsset.name}`)}`



      console.log('path audio', path)
      audioRef2.current.src = path
            


    }, [sourceAsset])








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


const createClipOnNewTrack =  async (assetName: string, dropTime: number, beginmoment: number|null = null, originalduration: number = 10) => {
    
  
  var meta;
  
  const path = `${currentProjectPath}/videos/${assetName}`

  
  
  try
  {
    meta = await invoke<{duration: number}>('get_duration', { path: path });
    
  }
  catch (err)
  {
    meta = {duration: 10}
  }

  const type = knowTypeByAssetName(assetName, true);

  const dimentions = assets.find( a => a.name === assetName)?.dimentions || null

    
    setTracks(  (prev) => 
      {
  
          const newTrackId = prev.length > 0 ? Math.max(...prev.map(t => t.id)) + 1 : 0; 
   
         
          

          const updatedTracks = [...prev, { 
            id: newTrackId, 
            type: type as 'video' | 'audio' | 'effects' 
          }];

          const deleteClip = clips.find(c => c.id === deleteClipId);

        

        
        const duration = meta.duration



          //console.log('maxduration in new trakc set to ', duration )
          
          const newClip: Clip = {
            id: crypto.randomUUID(),
            name: assetName,
            start: dropTime,
            duration: deleteClip ? deleteClip.duration : 10,
            originalduration: originalduration,
            color: getRandomColor(),
            trackId: newTrackId,
            maxduration: duration,
            beginmoment: beginmoment ? beginmoment : deleteClip ? deleteClip.beginmoment : 0,
            dimentions: dimentions,
            scale: 1
          };


          setClips(prevClips => {
            const filtered = deleteClipId !== null 
              ? prevClips.filter(c => c.id !== deleteClipId) 
              : prevClips;
            return [...filtered, newClip];
          });

          return updatedTracks










      }


    )



}

//create new timelines dropping assets close of a track
const handleDropOnEmptyArea = (e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();


  //colect subclip if its dropped
  const data = e.dataTransfer.getData("application/json") || null;
  const droppedClip = data ? JSON.parse(data) : null;


  
  





  
  if (e.dataTransfer.files.length > 0) return;

  const assetName = e.dataTransfer.getData("assetName");
  if (!assetName && !data) return;

  const container = e.currentTarget.getBoundingClientRect();
  const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  
  const relativeY = e.clientY - container.top;
  const x = e.clientX - container.left - 200;

  //last term to calibrate with  zoom
  const dropTime = Math.max(0, x / PIXELS_PER_SECOND) * (2/pixelsPerSecond);

  const TRACK_HEIGHT = 80;
  const totalTracksHeight = tracks.length * TRACK_HEIGHT;
  const margin = 20;

  // If drop above or below, but close a new track is created


  if(droppedClip && droppedClip.beginmoment && droppedClip.beginmoment > 0)
  {
    if (relativeY < -margin) {
       createClipOnNewTrack(droppedClip.name, dropTime, droppedClip.beginmoment)     
    } else if (relativeY > totalTracksHeight + margin) {
       createClipOnNewTrack(droppedClip.name, dropTime, droppedClip.beginmoment) 
    }
  
  return
  }
  
  if (relativeY < -margin) {
    createClipOnNewTrack(assetName, dropTime);
    
  } else if (relativeY > totalTracksHeight + margin) {
    createClipOnNewTrack(assetName, dropTime);
  }

  


};


//function to return order track as the are in the render ui
const order_tracks = () => 
{

  const activeTracksId =  [...new Set(clips.map(c => c.trackId))];

  const tracks_order= tracks.filter(t => activeTracksId.includes(t.id)).sort(

      (a, b) => {
        // We set the weights: Video/Effects = 0 (top), Audio = 1 (bottom)
        const priority = (type: string) => (type === 'audio' ? 1 : 0);

        const pA = priority(a.type);
        const pB = priority(b.type);

        if (pA !== pB) {
          return pA - pB; // If different types, order by type
        }
        return a.id - b.id; // If the type is the same, sort by the original ID.
      })

      //console.log('tracks', tracks)
      //console.log('order tracks', tracks_order)

      return tracks_order





}

  // Function to lead with Drag direct from OS
const handleNativeDrop = async (paths: string[], mouseX: number, mouseY: number) => {
  if (!currentProjectPath) return;

  //console.log('nativedrop')

  const timelineBounds = timelineContainerRef.current.getBoundingClientRect();

  const isOutsideTimeline = !timelineBounds || 
    mouseX < timelineBounds.left || 
    mouseX > timelineBounds.right || 
    mouseY < timelineBounds.top || 
    mouseY > timelineBounds.bottom;





  if (!timelineBounds) return;

  //const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  //const relativeX = mouseX - timelineBounds.left + scrollLeft;
  //const dropTime = Math.max(0, relativeX / PIXELS_PER_SECOND);

  const rect = timelineContainerRef.current.getBoundingClientRect();
  
  // 1. Difference between the click and the beginning of the visible timeline area
  // We use Math.floor to avoid sub-pixels that cause drifts
  const scrollLeft = timelineContainerRef.current.scrollLeft;
  
  
  // 2. Adjustment: If you have a sidebar of tracks (e.g., 200px), subtract here.
  const trackSidebarWidth = 0; // Change this if there is a sidebar inside the timeline.
  const relativeX = mouseX - rect.left - trackSidebarWidth + scrollLeft;
  //3. Calculating the time using the updated value of PIXELS_PER_SECOND
  // last term is to calibrate with newzoom
  const dropTime = Math.max(0, relativeX / PIXELS_PER_SECOND) * (2/pixelsPerSecond);
  
  //console.log(`Mouse X: ${mouseX}, Rect Left: ${rect.left}, Scroll: ${scrollLeft}, Final Time: ${dropTime}`);
  
  if (isOutsideTimeline) {
    for (const path of paths) {
      try {

        const fileName = path.split(/[\\/]/).pop() || "File";
        const extension = fileName.split('.').pop()?.toLowerCase() || '';


        const isImage = imageExtensions.includes(extension);
        const isAudio = audioExtensions.includes(extension);
        const isVideo = videoExtensions.includes(extension);

        if (!isImage && !isAudio && !isVideo) {
          showNotify("Invalid file type: Only video, audio, and images are allowed", "error");
          return;
        }



        
        await invoke('import_asset', { projectPath: currentProjectPath, filePath: path });
      } catch (err) {
        console.error("Import error:", err);
      }
    }
    loadAssets();
    showNotify("Assets imported", "success");
    return;
  }
  
    for (const path of paths) {


        const fileName = path.split(/[\\/]/).pop() || "File";
        const extension = fileName.split('.').pop()?.toLowerCase() || '';


        const isImage = imageExtensions.includes(extension);
        const isAudio = audioExtensions.includes(extension);
        const isVideo = videoExtensions.includes(extension);


        if (!isImage && !isAudio && !isVideo) {
          showNotify("Invalid file type: Only video, audio, and images are allowed", "error");
          return;
        }



      try {
        await invoke('import_asset', { projectPath: currentProjectPath, filePath: path });
        const fileName = path.split(/[\\/]/).pop() || "Asset";

        var meta
        var dimentions: Position | null
        
        try
        {
          meta = await invoke<{duration: number}>('get_duration', { path: path });
          
        }
        catch (err)
        {
          meta = {duration: 10}
        }


        if(isVideo || isImage)
        {
            try
            {
              dimentions = await invoke< Position >('get_asset_dimensions', { path: path });
              
            }
            catch (err)
            {
              dimentions = null
            }
        }
        

        
        const duration = meta.duration

        const TRACK_HEIGHT = 80;
        const relativeY = mouseY - timelineBounds.top;
        const targetTrackIndex = Math.floor(relativeY / TRACK_HEIGHT);

        //Organize tracks as the are in the render to know its order
        const tracks_order = order_tracks()

        



        // If you drop it below the last or above the tracks area, it creates a new one.



        if(!tracks_order[targetTrackIndex])
        {
          await loadAssets();
          createClipOnNewTrack(fileName, dropTime)
          return
        }


        const isBusy = (isSpaceOccupied(tracks_order[targetTrackIndex].id, dropTime, Math.min(duration, 10), null))
        const isNotType = tracks_order[targetTrackIndex].type !== knowTypeByAssetName(fileName,true)

        //console.log('empty var', tracks_order[targetTrackIndex], isBusy, isNotType, targetTrackIndex >= tracks.length , targetTrackIndex)

        //check if drop on a empty place again and if the place is on a track but is busy or is not the clip's type 

        if ((targetTrackIndex >= tracks.length || targetTrackIndex < 0) ||  isBusy  || isNotType) {
          await loadAssets();
          createClipOnNewTrack(fileName, dropTime)
          return
        } else {

            await loadAssets();

            
          
          // Drop em track existente
            const targetTrackId = tracks_order[targetTrackIndex].id;
            
            setClips(prev => [...prev, {
              id: crypto.randomUUID() ,
              name: fileName,
              start: dropTime,
              duration: Math.min(duration, 10),
              originalduration: Math.min(duration, 10),
              color: getRandomColor(),
              trackId: targetTrackId,
              maxduration: duration ? duration : 10,
              beginmoment: 0,
              dimentions: dimentions,
              scale: 1
            }]);


            setTracks( prev =>[... prev, {id: targetTrackId, type: knowTypeByAssetName(fileName, true)}]
            )
          



        }
      } catch (err) {
        console.error("Native Import Error:", err);
      }
    }

  




  //loadAssets();
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

  
  // FADE HANDLE ENGINE


const handleFadeDrag = (e: React.MouseEvent, clipId: string, type: 'in' | 'out', clip_type: string) => {
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const targetClip = clips.find(c => c.id === clipId);
    if (!targetClip) return;

    // 1. Determina quais são as propriedades corretas baseadas no tipo
    const isAudio = clip_type === 'audio';
    const propIn = isAudio ? 'fadeinAudio' : 'fadein';
    const propOut = isAudio ? 'fadeoutAudio' : 'fadeout';
    
    // 2. Pega o valor inicial correto
    const propertyToUpdate = type === 'in' ? propIn : propOut;
    const initialFade = (targetClip[propertyToUpdate as keyof Clip] as number) || 0;

    const onMouseMove = (moveEvent: MouseEvent) => {
        // Converte o movimento do mouse em segundos (delta)
        const deltaX = (moveEvent.clientX - startX) / pixelsPerSecond; 
        
        setClips(prevClips => prevClips.map(clip => {
            if (clip.id !== clipId) return clip;

            let newValue: number;
            
            if (type === 'in') {
                // Fade In: aumenta puxando para a direita
                newValue = Math.max(0, Math.min(clip.duration / 2, initialFade + deltaX));
            } else {
                // Fade Out: aumenta puxando para a esquerda
                newValue = Math.max(0, Math.min(clip.duration / 2, initialFade - deltaX));
            }

            // 3. Retorna o clipe com a propriedade dinâmica atualizada
            return { 
                ...clip, 
                [propertyToUpdate]: newValue 
            };
        }));
    };

    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
};




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
    
    //  .map to take name files in a array of promises
    const assetPromises = list.map(async (filename) => {
      const extension = filename.split('.').pop()?.toLowerCase();
      const filePath = `${currentProjectPath}/videos/${filename}`;
      
      let type: 'video' | 'audio' | 'image' = 'video';
      if (['jpg', 'jpeg', 'png', 'webp'].includes(extension || '')) type = 'image';
      if (['mp3', 'wav', 'ogg'].includes(extension || '')) type = 'audio';

      let duration = 10;
      let dimentions: Position | null = null

      if (type !== 'image') {
        try {
          const meta = await invoke<{duration: number}>('get_duration', { path: filePath });
          duration = meta.duration;
        } catch (err) {
          console.warn(`Não foi possível ler meta de ${filename}`, err);
        }
      }


      if(type == 'video')
      {
         try {
            await invoke('extract_audio', { 
              projectPath: currentProjectPath, 
              fileName: filename 
            });
            
          } catch (e) {
            console.error("Falha na extração automática:", e);
          }
      }


      if((type == 'video') || (type == 'image'))
      {
           try {
            dimentions =  await invoke('get_asset_dimensions', { 
              path: filePath
            });


            
          } catch (e) {
            console.error("Falha na extração automática:", e);
          }
      }






      let thumbPath = "";
      if (type === 'image') {
        thumbPath = convertFileSrc(filePath);
      } else if (type === 'video') {
        thumbPath = await getThumbnail(currentProjectPath, filename, 2);
      }

      
       if((type == 'video') || (type == 'image'))
        return {
          name: filename,
          path: filePath,
          duration: duration,
          type: type,
          thumbnailUrl: thumbPath,
          dimentions: dimentions          
        } as Asset;


        return {
        name: filename,
        path: filePath,
        duration: duration,
        type: type,
        thumbnailUrl: thumbPath
      } as Asset;
    });

    // Wait for all metadata to be read in parallel.
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
      // 1. Chamamos a função Rust enviando o path base, o nome e o objeto de config
      const finalPath = await invoke<string>('create_project_setup', { 
        rootPath, 
        projectName,
        config: projectConfig // O estado que você já está atualizando no onChange
      });

      // 2. Atualizamos o estado do caminho do projeto atual
      setCurrentProjectPath(finalPath);

      // 3. UI Updates
      setIsCreatingNew(false);
      loadProjects();
      showNotify("Project Created!", "success");
      
      console.log("Project initialized at:", finalPath);
    } catch (e) {
      console.error(e);
      showNotify("Error creating project structure", "error");
    }
  }
};

  const handleFinishSetup_old = async () => {
    if (rootPath && projectName) {
      try {
        const finalPath = await invoke('create_project_folder', { rootPath, projectName });
        //localStorage.setItem("current_project_path", finalPath as string);
        setCurrentProjectPath(finalPath as String)

        setIsCreatingNew(false);
        loadProjects();
        showNotify("Project Created!", "success");
      } catch (e) {
        showNotify("Error creating project", "error");
      }
    }
  };

const openProject = async (path: string) => {

  console.log('project path', path)
  //localStorage.setItem("current_project_path", path);
  setCurrentProjectPath(path)
  
  try
  {
    
    const config = await invoke<ProjectSettings>('load_project_config', { path: path });
    setProjectConfig(config);
    setProjectName(config.name || "Unnamed Project" )

    console.log('config', config)
    
    const rawData = await invoke('load_latest_project', { projectPath: path });
    var parsed = JSON.parse(rawData as string);
    //setProjectName(parsed.projectName)



    // Update states first
    setClips(parsed.clips || []);
    setAssets(parsed.assets || []);
    setTracks(parsed.tracks || []);
    //setProjectName(parsed.projectName || "Unnamed Project");

 
    
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
      await loadAssets();
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

  if(tracks.find(t => t.id === trackId)?.lock === true) return


  // If the dragged clip is not in the current selection, we select only that clip.
  if (clipId !== null && !selectedClipIds.includes(clipId)) {
    setSelectedClipIds([clipId]);
  }

  const presentclip = clips.find(c => c.id == clipId )

  var start = presentclip ? presentclip.start : null

  if (isTimelineClip && start !== null) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Calculate how many seconds there are between the start of the clip and where the mouse clicked.
    const clickOffset = (e.clientX - rect.left) / pixelsPerSecond;
    e.dataTransfer.setData("clickOffset", clickOffset.toString());
  } else {
    // For new assets coming from the sidebar, we usually click at the beginning or center
    // // We can set it to 0 or calculate it if desired
    e.dataTransfer.setData("clickOffset", "0");
  }

  // Store clips datas
  e.dataTransfer.setData("assetName", assetName);
  e.dataTransfer.setData("isTimelineClip", isTimelineClip.toString());

  if(trackId)
    e.dataTransfer.setData("previousTrackId", trackId.toString());

  if(color)
    e.dataTransfer.setData("previousColor", color.toString());
  
  if (isTimelineClip && clipId !== null) {
    setDeleteClipId(clipId);
    
    // Store start time of the clip
    const anchorClip = clips.find(c => c.id === clipId);
    if (anchorClip) {
      e.dataTransfer.setData("anchorStart", anchorClip.start.toString());
    }
  }
};


 



  //make function split and selection
 const handleMassSplitAndSelect = (direction: 'left' | 'right') => {
    const playheadTime = Math.floor(playheadPos / pixelsPerSecond);

    
    saveHistory(clips, assets);
    
    let processedClips: Clip[] = [];
    
    clips.forEach(clip => {
        // If chick is in the playhead we divide it
        if (playheadTime > clip.start && playheadTime < (clip.start + clip.duration)) {
            const firstPartDuration = playheadTime - clip.start;
            const secondPartDuration = clip.duration - firstPartDuration;

            const firstClip: Clip = { 
                ...clip, 
                duration: firstPartDuration 
            };

               
            const secondClip: Clip = { 
                ...clip, 
                id: crypto.randomUUID(), 
                start: playheadTime, 
                duration: secondPartDuration,
                beginmoment: clip.beginmoment + firstPartDuration
            };

            processedClips.push(firstClip, secondClip);
        } else {
            // If it is not in playhead, keep the file
            processedClips.push(clip);
        }
    });

    // Order the clips
    processedClips.sort((a, b) => a.start - b.start);

    setClips(processedClips);

    //  Selection Logic:

    // For 'left': we select clips that end before or exactly at the needle
    // For 'right': we select clips that start from the needle
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
  e.stopPropagation();



  if(tracks.find(t => t.id === trackId)?.lock === true) return


 

  
  const previousTrackRaw = e.dataTransfer.getData("previousTrackId");
  const previousTrack = previousTrackRaw ? Number(previousTrackRaw) : null;

  const previousColor = e.dataTransfer.getData("previousColor");

  //const clickOffset = parseFloat(e.dataTransfer.getData("clickOffset") || "0");

  const isTimelineClip = e.dataTransfer.getData("isTimelineClip") === "true";
  const anchorStart = parseFloat(e.dataTransfer.getData("anchorStart") || "0");
  
  // Take offset
  const clickOffset = parseFloat(e.dataTransfer.getData("clickOffset") || "0");
  
  const rect = e.currentTarget.getBoundingClientRect();
  const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  
  // 1. Mouse position convert to time
  const mouseTime = (e.clientX - rect.left + 0) / pixelsPerSecond;
  
  // 2. The actual drop time is the mouse minus where "grabbed" the clip.
  const rawDropTime = mouseTime - clickOffset; 
  
  const dropTime = getSnappedTime(rawDropTime, deleteClipId, trackId);


  const data = e.dataTransfer.getData("application/json") || null;
  
  //if its a subclip

  if (data)
  {

    console.log('data on')

    
      const droppedClip = JSON.parse(data);

      
      // 1. Try to find the corresponding asset.
      const assetNow = assets.find(a => a.name === droppedClip.name);


      console.log('assetNow di', assetNow?.dimentions)
      
      // 2. Set the default duration safely.
      // If assetNow exists and is greater than 10, use 10. Otherwise, use its duration or 5 (total fallback).
      const defaultDuration = assetNow ? Math.min(assetNow.duration, 10) : 10;
      const totalMaxDuration = assetNow ? assetNow.duration : 10;

      const isBusy = (isSpaceOccupied(trackId, dropTime, droppedClip.duration, null))
      const isNotType = tracks.find( t => t.id === trackId)?.type !== knowTypeByAssetName(droppedClip.name ,true)
      
      
      if(!isBusy && !isNotType)
      {
          const newClip: Clip = {
            id: crypto.randomUUID(), 
            name: droppedClip.name,
            start: dropTime,
            duration: droppedClip.duration,
            originalduration: droppedClip.duration,
            color: getRandomColor(),
            trackId: trackId,
            maxduration: totalMaxDuration,
            beginmoment: droppedClip.beginmoment,
            dimentions: assetNow?.dimentions ? assetNow?.dimentions : null,
            scale: 1
          };

          setClips(prev => [...prev, newClip]);
          setDeleteClipId(null);
      }
      else
      {
          createClipOnNewTrack(droppedClip.name, dropTime, droppedClip.beginmoment)
          

      }
      
      
      return
  }

  




  const assetName = e.dataTransfer.getData("assetName");


  saveHistory(clips, assets, tracks);

  if (isTimelineClip && selectedClipIds.length > 0) {
  const timeOffset = dropTime - anchorStart;
  const anchorClip = clips.find(c => c.id === deleteClipId);
  const trackOffset = anchorClip ? trackId - anchorClip.trackId : 0;

  // 1. Clips that are NOT in the selection (remain paused)
  const otherClips = clips.filter(c => !selectedClipIds.includes(c.id));
  
  // 2. We calculate the new position of all selected players.
  const tracksid = tracks.map( t => t.id)
  let maxTrackId = Math.max(...tracksid, trackId);
  
  const finalMovedClips = clips
    .filter(c => selectedClipIds.includes(c.id))
    .map(clip => {
      let targetTrack = Math.max(0, clip.trackId + trackOffset);
      const targetStart = Math.max(0, clip.start + timeOffset);

      const trackChoose = tracks.find( t => t.id === targetTrack)

      //If there is a collision, we move the vehicle to a track above the existing ones.
      if (isSpaceOccupied(targetTrack, targetStart, clip.duration, clip.id) || trackChoose?.type !==  knowTypeByAssetName(clip.name,true)) {
        maxTrackId++;
        targetTrack = maxTrackId;
      }

      return {
        ...clip,
        start: targetStart,
        trackId: targetTrack,
        color: clip.trackId == targetTrack ? clip.color : getRandomColor()
      };
    });

  // 3. ONE-TIME UPDATE: Merges the still clips with the newly moved ones
  setClips([...otherClips, ...finalMovedClips]);
  
  //4. Ensures that the 'tracks' state knows about the new track if it has been created.
  if (maxTrackId > Math.max(...tracksid)) {
    //setTracks(prev => [...new Set([...prev, maxTrackId])].sort((a,b) => a-b)); old logic
    
    const newTracksCreated = finalMovedClips.map(fc => ({
      id: fc.trackId,
      type: knowTypeByAssetName(fc.name, true) as 'video' | 'audio' | 'effects'
    }));

    setTracks(prev => {
      const allTracks = [...prev, ...newTracksCreated];
      // Remove duplicates by comparing the actual ID
      const uniqueTracks = allTracks.filter((track, index, self) =>
        index === self.findIndex((t) => t.id === track.id)
      );
      return uniqueTracks.sort((a, b) => a.id - b.id);
    });
  }
} else {
    // (Asset -> Timeline) 
    const assetName = e.dataTransfer.getData("assetName");
    //if no have space useeffect with comment 'avoid clip over another'
    // 1. Try to find the corresponding asset.
    const assetNow = assets.find(a => a.name === assetName);
    
    // 2. Set the default duration safely.
    // If assetNow exists and is greater than 10, use 10. Otherwise, use its duration or 5 (total fallback).
    const defaultDuration = assetNow ? Math.min(assetNow.duration, 10) : 10;
    const totalMaxDuration = assetNow ? assetNow.duration : 10;

    const isBusy = (isSpaceOccupied(trackId, dropTime, Math.min(defaultDuration, 10), null))
    const isNotType = tracks.find( t => t.id === trackId)?.type !== knowTypeByAssetName(assetName,true)
 
          

    
    if(!isBusy && !isNotType)
    {
       const newClip: Clip = {
          id: crypto.randomUUID(), 
          name: assetName,
          start: dropTime,
          duration: defaultDuration,
          originalduration: defaultDuration,
          color: getRandomColor(),
          trackId: trackId,
          maxduration: totalMaxDuration,
          beginmoment: 0,
          dimentions: assetNow?.dimentions ? assetNow?.dimentions : null,
          scale: 1
        };

        setClips(prev => [...prev, newClip]);
        setDeleteClipId(null);
    }
    else
    {
        createClipOnNewTrack(assetName, dropTime)
        return

    }
  }

  setDeleteClipId(null);
};


const filteredAssets = assets.filter(asset => 
  asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
  asset.type.toLowerCase().includes(searchQuery.toLowerCase())
);



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

    await invoke('import_asset', { projectPath: currentProjectPath, filePath: filePath });
     loadAssets();
    showNotify("Assets imported", "success");


    
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


  //elements for aside of config clips



//speed keyframe system

// sync anothers keyframes to the speed keyframes

const syncKeyframesToSpeedCurve = (clip: Clip) => {
  if (!clip.keyframes?.speed) return;

  // --- CASO: KEYFRAMES DE SPEED FORAM EXCLUÍDOS ---
  if (clip.keyframes.speed.length === 0) {
    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === clip.id) {
          const updatedKfs = { ...c.keyframes };
          const typesToRemap: (keyof NonNullable<Clip['keyframes']>)[] = ['volume', 'opacity', 'rotation3d'];

          typesToRemap.forEach((type) => {
            if (updatedKfs[type]) {
              updatedKfs[type] = updatedKfs[type]!.map((kf) => {
                /**
                 * LÓGICA DE RESET:
                 * Se a velocidade agora é constante (1.0x), o tempo na timeline
                 * deve ser exatamente o "Asset Time" que o keyframe representava.
                 * Usamos a proporção baseada na duração que o clipe tinha antes de resetar.
                 */
                const ratio = kf.time / (c.duration || 1);
                const resetTime = ratio * (c.originalduration || c.maxduration || c.duration);

                return {
                  ...kf,
                  time: resetTime
                };
              });
            }
          });

          return { 
            ...c, 
            duration: c.originalduration || c.maxduration || c.duration,
            keyframes: updatedKfs 
          };
        }
        return c;
      })
    );
    return;
  }

  const speedKfs = [...clip.keyframes.speed].sort((a, b) => a.time - b.time);

  // Esta lógica converte o "Tempo do Arquivo Original" para "Tempo na Timeline"
  const mapAssetTimeToTimeline = (targetAssetTime: number): number => {
    let currentAssetTime = 0;
    let currentTimelineTime = 0;

    for (let i = 0; i < speedKfs.length - 1; i++) {
      const start = speedKfs[i];
      const end = speedKfs[i + 1];
      const segmentTimelineDuration = end.time - start.time;
      const avgSpeed = (start.value + end.value) / 2;
      const segmentAssetDuration = segmentTimelineDuration * avgSpeed;

      if (currentAssetTime + segmentAssetDuration >= targetAssetTime) {
        const remainingAssetTime = targetAssetTime - currentAssetTime;
        return currentTimelineTime + (remainingAssetTime / avgSpeed);
      }
      currentAssetTime += segmentAssetDuration;
      currentTimelineTime += segmentTimelineDuration;
    }
    const lastSpeed = speedKfs[speedKfs.length - 1].value;
    return currentTimelineTime + (targetAssetTime - currentAssetTime) / lastSpeed;
  };

  setClips((prevClips) =>
    prevClips.map((c) => {
      if (c.id === clip.id) {
        const updatedKfs = { ...c.keyframes };
        const typesToRemap: (keyof NonNullable<Clip['keyframes']>)[] = ['volume', 'opacity', 'rotation3d'];

        typesToRemap.forEach((type) => {
          if (updatedKfs[type]) {
            // ATENÇÃO: Se você tiver c.originalKeyframes[type], use ele aqui
            // para evitar erro cumulativo de ponto flutuante.
            updatedKfs[type] = updatedKfs[type]!.map((kf) => ({
              ...kf,
              // O kf.time aqui é tratado como a posição fixa no arquivo original
              time: mapAssetTimeToTimeline(kf.time), 
            }));
          }
        });

        return { ...c, keyframes: updatedKfs };
      }
      return c;
    })
  );
};

const syncKeyframesToSpeedCurve_new = (clip: Clip) => {
  // --- CASO: KEYFRAMES DE SPEED FORAM EXCLUÍDOS ---
  if (!clip.keyframes?.speed || clip.keyframes.speed.length === 0) {
    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === clip.id) {
          const updatedKfs = { ...c.keyframes };
          const typesToRemap: (keyof NonNullable<Clip['keyframes']>)[] = ['volume', 'opacity', 'rotation3d'];

          typesToRemap.forEach((type) => {
            if (updatedKfs[type]) {
              updatedKfs[type] = updatedKfs[type]!.map((kf) => {
                /**
                 * LÓGICA DE RESET:
                 * Se a velocidade agora é constante (1.0x), o tempo na timeline
                 * deve ser exatamente o "Asset Time" que o keyframe representava.
                 * Usamos a proporção baseada na duração que o clipe tinha antes de resetar.
                 */
                const ratio = kf.time / (c.duration || 1);
                const resetTime = ratio * (c.originalduration || c.maxduration || c.duration);

                return {
                  ...kf,
                  time: resetTime
                };
              });
            }
          });

          return { 
            ...c, 
            duration: c.originalduration || c.maxduration || c.duration,
            keyframes: updatedKfs 
          };
        }
        return c;
      })
    );
    return;
  }

  // --- CASO: EXISTEM KEYFRAMES DE SPEED (Sua lógica atual) ---
  const speedKfs = [...clip.keyframes.speed].sort((a, b) => a.time - b.time);

  const mapAssetTimeToTimeline = (targetAssetTime: number): number => {
    let currentAssetTime = 0;
    let currentTimelineTime = 0;

    for (let i = 0; i < speedKfs.length - 1; i++) {
      const start = speedKfs[i];
      const end = speedKfs[i + 1];
      const segmentTimelineDuration = end.time - start.time;
      const avgSpeed = (start.value + end.value) / 2;
      const segmentAssetDuration = segmentTimelineDuration * avgSpeed;

      if (currentAssetTime + segmentAssetDuration >= targetAssetTime) {
        const remainingAssetTime = targetAssetTime - currentAssetTime;
        return currentTimelineTime + (remainingAssetTime / avgSpeed);
      }
      currentAssetTime += segmentAssetDuration;
      currentTimelineTime += segmentTimelineDuration;
    }
    const lastSpeed = speedKfs[speedKfs.length - 1].value;
    return currentTimelineTime + (targetAssetTime - currentAssetTime) / lastSpeed;
  };

  setClips((prevClips) =>
    prevClips.map((c) => {
      if (c.id === clip.id) {
        const updatedKfs = { ...c.keyframes };
        const typesToRemap: (keyof NonNullable<Clip['keyframes']>)[] = ['volume', 'opacity', 'rotation3d'];

        typesToRemap.forEach((type) => {
          if (updatedKfs[type]) {
            updatedKfs[type] = updatedKfs[type]!.map((kf) => {
                // Aqui você deve usar o cálculo de Asset Time que discutimos antes 
                // para evitar que os pontos fiquem "presos"
                const ratio = kf.time / (c.duration || 1);
                const assetTime = ratio * (c.originalduration || c.maxduration);
                
                return {
                  ...kf,
                  time: mapAssetTimeToTimeline(assetTime), 
                }
            });
          }
        });

        return { ...c, keyframes: updatedKfs };
      }
      return c;
    })
  );
};


const updateClipDurationBySpeed = (clip: Clip) => {
  if (!clip.keyframes?.speed || clip.keyframes.speed.length === 0) {
    
    setClips((prev) =>
      prev.map((c) => (c.id === clip.id ? { ...c, duration: c.originalduration || c.maxduration || 10 } : c))
    );
    return;
  }

  const speedKfs = [...clip.keyframes.speed].sort((a, b) => a.time - b.time);
  
  let totalTimelineDuration = 0;
  let remainingAssetMaterial = clip.originalduration || clip.maxduration; 
  let lastSpeed = speedKfs[0].value;

  for (let i = 0; i < speedKfs.length - 1; i++) {
    const start = speedKfs[i];
    const end = speedKfs[i + 1];

    const segmentTimelineDuration = end.time - start.time;
    const avgSpeed = (start.value + end.value) / 2;
    const assetConsumedInSegment = segmentTimelineDuration * avgSpeed;

    if (remainingAssetMaterial <= assetConsumedInSegment) {
      totalTimelineDuration += remainingAssetMaterial / avgSpeed;
      remainingAssetMaterial = 0;
      break;
    }

    remainingAssetMaterial -= assetConsumedInSegment;
    totalTimelineDuration += segmentTimelineDuration;
    lastSpeed = end.value;
  }

  if (remainingAssetMaterial > 0) {
    totalTimelineDuration += remainingAssetMaterial / lastSpeed;
  }

  setClips((prev) =>
    prev.map((c) => (c.id === clip.id ? { ...c, duration: totalTimelineDuration } : c))
  );
};

//convert logic 0-1 to 0.2 - 25 (0.5 is speed 1)
const converterSpeed = (value: number): number => {
  
  if (value === 0.5) return 1.0;

  if (value < 0.5) {
    return 0.2 + ((value / 0.5) * (1.0 - 0.2));
  } else {
    const t = (value - 0.5) / 0.5;
    return 1.0 + (t * (25.0 - 1.0));
  }
};


//undoing converterSpeed
const reverterSpeed = (realSpeed: number): number => {
  
  if (realSpeed === 1.0) return 0.5;

  if (realSpeed < 1.0) {
    const value = ((realSpeed - 0.2) / 0.8) * 0.5;
    return Math.max(0, value); 
  } else {
    const value = ((realSpeed - 1.0) / 24.0) * 0.5 + 0.5;
    return Math.min(1, value); 
  }
};


const relocateSpeedKeyframes = (clip: Clip) => {
  if (!clip.keyframes?.speed) return;

  // --- CASO: KEYFRAMES DE SPEED FORAM EXCLUÍDOS ---
  if (clip.keyframes.speed.length === 0) {
    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === clip.id) {
          const updatedKfs = { ...c.keyframes };
          const typesToRemap: (keyof NonNullable<Clip['keyframes']>)[] = ['speed'];

          typesToRemap.forEach((type) => {
            if (updatedKfs[type]) {
              updatedKfs[type] = updatedKfs[type]!.map((kf) => {
                /**
                 * LÓGICA DE RESET:
                 * Se a velocidade agora é constante (1.0x), o tempo na timeline
                 * deve ser exatamente o "Asset Time" que o keyframe representava.
                 * Usamos a proporção baseada na duração que o clipe tinha antes de resetar.
                 */
                const ratio = kf.time / (c.duration || 1);
                const resetTime = ratio * (c.originalduration || c.maxduration || c.duration);

                return {
                  ...kf,
                  time: resetTime
                };
              });
            }
          });

          return { 
            ...c, 
            duration: c.originalduration || c.maxduration || c.duration,
            keyframes: updatedKfs 
          };
        }
        return c;
      })
    );
    return;
  }

  const speedKfs = [...clip.keyframes.speed].sort((a, b) => a.time - b.time);

  // Esta lógica converte o "Tempo do Arquivo Original" para "Tempo na Timeline"
  const mapAssetTimeToTimeline = (targetAssetTime: number): number => {
    let currentAssetTime = 0;
    let currentTimelineTime = 0;

    for (let i = 0; i < speedKfs.length - 1; i++) {
      const start = speedKfs[i];
      const end = speedKfs[i + 1];
      const segmentTimelineDuration = end.time - start.time;
      const avgSpeed = (start.value + end.value) / 2;
      const segmentAssetDuration = segmentTimelineDuration * avgSpeed;

      if (currentAssetTime + segmentAssetDuration >= targetAssetTime) {
        const remainingAssetTime = targetAssetTime - currentAssetTime;
        return currentTimelineTime + (remainingAssetTime / avgSpeed);
      }
      currentAssetTime += segmentAssetDuration;
      currentTimelineTime += segmentTimelineDuration;
    }
    const lastSpeed = speedKfs[speedKfs.length - 1].value;
    return currentTimelineTime + (targetAssetTime - currentAssetTime) / lastSpeed;
  };

  setClips((prevClips) =>
    prevClips.map((c) => {
      if (c.id === clip.id) {
        const updatedKfs = { ...c.keyframes };
        const typesToRemap: (keyof NonNullable<Clip['keyframes']>)[] = ['volume', 'opacity', 'rotation3d'];

        typesToRemap.forEach((type) => {
          if (updatedKfs[type]) {
            // ATENÇÃO: Se você tiver c.originalKeyframes[type], use ele aqui
            // para evitar erro cumulativo de ponto flutuante.
            updatedKfs[type] = updatedKfs[type]!.map((kf) => ({
              ...kf,
              // O kf.time aqui é tratado como a posição fixa no arquivo original
              time: mapAssetTimeToTimeline(kf.time), 
            }));
          }
        });

        return { ...c, keyframes: updatedKfs };
      }
      return c;
    })
  );
};




const relocateSpeedKeyframes_old = (clip: Clip) => {
  if (!clip.keyframes?.speed || clip.keyframes.speed.length === 0) return;

  const speedKfs = [...clip.keyframes.speed].sort((a, b) => a.time - b.time);

  // 1. Função para converter tempo da Timeline -> Asset (O quanto de vídeo já "passou")
  const getAssetTimeFromTimeline = (tTime: number, kfs: Keyframe[]): number => {
    let aTime = 0;
    let lastT = 0;
    let lastS = kfs[0].value;

    for (let i = 0; i < kfs.length; i++) {
      const kf = kfs[i];
      if (tTime > kf.time) {
        const dt = kf.time - lastT;
        const avgS = (lastS + kf.value) / 2;
        aTime += dt * avgS;
        lastT = kf.time;
        lastS = kf.value;
      } else {
        const dt = tTime - lastT;
        const dist = kf.time - lastT || 1;
        const currentS = lastS + (dt / dist) * (kf.value - lastS);
        aTime += dt * ((lastS + currentS) / 2);
        return aTime;
      }
    }
    return aTime + (tTime - lastT) * lastS;
  };

  // 2. Função para converter Asset -> Nova Timeline (Onde o ponto deve estacionar)
  const getTimelineFromAssetTime = (aTime: number, kfs: Keyframe[]): number => {
    let currentA = 0;
    let currentT = 0;
    for (let i = 0; i < kfs.length - 1; i++) {
      const start = kfs[i];
      const end = kfs[i + 1];
      const dt = end.time - start.time;
      const avgS = (start.value + end.value) / 2;
      const da = dt * avgS;

      if (currentA + da >= aTime) {
        return currentT + (aTime - currentA) / avgS;
      }
      currentA += da;
      currentT += dt;
    }
    const lastS = kfs[kfs.length - 1].value;
    return currentT + (aTime - currentA) / lastS;
  };

  setClips((prevClips) =>
    prevClips.map((c) => {
      if (c.id === clip.id) {
        const updatedKfs = { ...c.keyframes };
        const types: (keyof NonNullable<Clip['keyframes']>)[] = ['speed'];

        types.forEach((type) => {
          if (updatedKfs[type]) {
            updatedKfs[type] = updatedKfs[type]!.map((kf) => {
              // PASSO CRUCIAL:
              // Em vez de usar ratio (estático), usamos a integral.
              // "Em qual frame do vídeo original este keyframe estava?"
              const assetTime = getAssetTimeFromTimeline(kf.time, speedKfs);
              
              // "Com a nova curva, onde esse frame original cai na timeline?"
              const newTime = getTimelineFromAssetTime(assetTime, speedKfs);

              // Evita micro-loops de atualização do React
              if (Math.abs(kf.time - newTime) < 0.001) return kf;

              return { ...kf, time: newTime };
            });
          }
        });

        return { ...c, keyframes: updatedKfs };
      }
      return c;
    })
  );
};



const isSyncingRef = useRef(false);

const handleSpeedKeyframeChange = (clip: Clip) => {
  // Se já estamos sincronizando, ignora para não entrar em loop
  if (isSyncingRef.current) return;

  isSyncingRef.current = true;

  try {
    // A ordem correta para garantir a consistência
    updateClipDurationBySpeed(clip);
    syncKeyframesToSpeedCurve(clip);
    relocateSpeedKeyframes(clip);
  } finally {
    // Usa um pequeno delay para garantir que o ciclo de renderização 
    // do React processou as mudanças antes de liberar a trava
    setTimeout(() => {
      isSyncingRef.current = false;
    }, 100);
  }
};

useEffect(() => {
  if (selectedClipIds.length !== 1) return;

  const selectedClip = clips.find(c => c.id === selectedClipIds[0]);
  if (!selectedClip) return;

  handleSpeedKeyframeChange(selectedClip);

}, [JSON.stringify(clips.find(c => c.id === selectedClipIds[0])?.keyframes?.speed)]);

//JSON.stringify(clips.find(c => c.id === selectedClipIds[0])?.keyframes?.speed)






//Keyframes System

const [hoverKeyframe, setHoverKeyframe] = useState<{
  x: number;
  y: number;
  value: string;
  visible: boolean;
} | null>(null);

const handleClipMouseMove = (e: React.MouseEvent, clip: Clip) => {
  if (!clip.activeKeyframeView) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const clickY = e.clientY - rect.top;
  
  // Valor visual (0 a 1)
  let value = Math.max(0, Math.min(1, 1 - (clickY / rect.height)));
  let displayValue = "";

  // Formatação baseada no tipo de keyframe
  if (clip.activeKeyframeView === 'speed') {
    const realSpeed = converterSpeed(value);
    displayValue = `${realSpeed.toFixed(2)}x`;
  } else if (clip.activeKeyframeView === 'volume') {
    const db = convertDB(value);
    displayValue = `${db} dB`;
  }else if (clip.activeKeyframeView === 'zoom') {
    const zoom = convertZoom(value);
    displayValue = `${zoom}x`;
  }else if ((clip.activeKeyframeView === 'position') || 
  (clip.activeKeyframeView === 'rotation3d')) {
    displayValue = `Use the edit mode on preview player`;
  }
  
  else {
    displayValue = `${Math.round(value * 100)}%`;
  }

  setHoverKeyframe({
    x: e.clientX,
    y: e.clientY,
    value: displayValue,
    visible: true
  });
};


const updateKeyframes = (
  clip: Clip,
  type: 'opacity' | 'volume' | 'speed' | 'position' | 'rotation3d' | 'zoom',
  // Atualizei a tipagem para aceitar as novas chaves
  newValue: number | { x?: number; y?: number; rot?: number; rot3d?: number }
) => {
  const threshold = 0.05;
  const relativeTime = currentTimeRef.current - clip.start;
  const safeKeyframes = clip.keyframes || {};
  const currentTypeArray = [...(safeKeyframes[type] || [])];

  // 1. Define o valor padrão baseado no tipo (Corrigido para rot/rot3d)
  const getDefaultValue = () => {
    switch (type) {
      case 'position': return { x: 0, y: 0 };
      case 'rotation3d': return { rot: 0, rot3d: 0 }; // Alterado de x/y para rot/rot3d
      case 'zoom': return 1.0;
      case 'speed': return 1.0;
      case 'opacity': return 1.0;
      case 'volume': return 0; // volume em dB costuma iniciar em 0
      default: return 0;
    }
  };

  // 2. Função para mesclar valores (Merge Inteligente)
  const getUpdatedValue = (oldValue: any) => {
    // Se o novo valor for um objeto (Position ou Rotation)
    if (typeof newValue === 'object' && newValue !== null) {
      // Se já existe um valor no KF, usa ele como base, senão usa o default
      const base = oldValue !== undefined && oldValue !== null ? oldValue : getDefaultValue();
      
      // Retorna a união do antigo com o novo (ex: mantém rot e muda apenas rot3d)
      return { ...base, ...newValue };
    }
    // Se for um número (opacity, zoom, etc)
    return newValue;
  };

  let updatedTypeArray: Keyframe[];

  // LÓGICA DE ATUALIZAÇÃO DA TRACK (CASOS DE ESTADO)

  // CASO 0: Inicialização (Track vazia e não estamos visualizando a linha de automação)
  if (currentTypeArray.length === 0 && clip.activeKeyframeView !== type) {
    updatedTypeArray = [{
      id: crypto.randomUUID(),
      time: 0,
      value: getUpdatedValue(null) // O null força o uso do getDefaultValue dentro do merge
    }];
  }
  // CASO 1: Ajuste Global (Apenas 1 KF e não estamos no modo de "animação" ativa)
  else if (currentTypeArray.length === 1 && clip.activeKeyframeView !== type) {
    updatedTypeArray = [{
      ...currentTypeArray[0],
      value: getUpdatedValue(currentTypeArray[0].value)
    }];
  }
  // CASO 2: Modo Animação (Múltiplos KFs ou gravando no playhead atual)
  else {
    const existingIndex = currentTypeArray.findIndex(
      (kf) => Math.abs(kf.time - relativeTime) <= threshold
    );

    if (existingIndex !== -1) {
      // Atualiza KF existente no tempo atual
      updatedTypeArray = currentTypeArray.map((kf, index) =>
        index === existingIndex ? { ...kf, value: getUpdatedValue(kf.value) } : kf
      );
    } else {
      // Cria novo KF no tempo atual baseado no valor interpolado ou anterior
      // Para garantir suavidade, o valor inicial do novo KF deve ser o valor que o clipe já tinha naquele momento
      const currentValueAtTime = getInterpolatedValueWithFades(currentTimeRef.current, clip, type);
      
      const newKeyframe = {
        id: crypto.randomUUID(),
        time: relativeTime,
        value: getUpdatedValue(currentValueAtTime),
      };
      
      updatedTypeArray = [...currentTypeArray, newKeyframe].sort((a, b) => a.time - b.time);
    }
  }

  // 3. Persistência no Estado do React
  const updatedKeyframes = { ...safeKeyframes, [type]: updatedTypeArray };

  setClips((prev) =>
    prev.map((c) => (c.id === clip.id ? { ...c, keyframes: updatedKeyframes } : c))
  );

  // 4. Gatilhos de processamento pesado (Ex: Recalcular Speed Ramp no Rust/Backend)
  if (type === 'speed') {
    handleSpeedKeyframeChange({ ...clip, keyframes: updatedKeyframes });
  }
};

const updateKeyframes_old = (
  clip: Clip, 
  type: 'opacity' | 'volume' | 'speed' | 'position' | 'rotation3d' | 'zoom', 
  newValue: number | { x?: number, y?: number, z?: number }
) => {
  const threshold = 0.05;
  const relativeTime = currentTimeRef.current - clip.start;
  const safeKeyframes = clip.keyframes || {};
  const currentTypeArray = [...(safeKeyframes[type] || [])];

  // 1. Define o valor padrão baseado no tipo
  const getDefaultValue = () => {
    switch (type) {
      case 'position': return { x: 0, y: 0 };
      case 'rotation3d': return { x: 0, y: 0 }; // x = rot, y = rot3d
      case 'zoom': return 1.0;
      case 'speed': return 1.0;
      case 'opacity': return 1.0;
      default: return 0;
    }
  };

  // 2. Função para mesclar valores (Merge)
  const getUpdatedValue = (oldValue: any) => {
    if (typeof newValue === 'object' && newValue !== null) {
      const base = oldValue || getDefaultValue();
      return { ...base, ...newValue };
    }
    return newValue;
  };

  let updatedTypeArray: Keyframe[];

  // LÓGICA DE ATUALIZAÇÃO DA TRACK
  
  // CASO 0: Track vazia - Cria o primeiro keyframe no tempo 0
  // CASO 0: Inicialização
  if ((currentTypeArray.length === 0) && (clip.activeKeyframeView !== type)) {
    updatedTypeArray = [{
      id: crypto.randomUUID(),
      time: 0,
      value: getUpdatedValue(type === 'position' ? { x: 0, y: 0 } : type === 'rotation3d' ? { x: 0, y: 0} : 1)
    }];
  }
  // CASO 1: Ajuste Global (Apenas 1 KF e o usuário não está no modo "animação" de KFs)
  else if (currentTypeArray.length === 1 && clip.activeKeyframeView !== type) {
    updatedTypeArray = [{
      ...currentTypeArray[0],
      value: getUpdatedValue(currentTypeArray[0].value)
    }];
  } 
  // CASO 2: Modo Animação (Múltiplos KFs ou gravando no tempo atual)
  else {
    const existingIndex = currentTypeArray.findIndex(
      (kf) => Math.abs(kf.time - relativeTime) <= threshold
    );

    if (existingIndex !== -1) {
      // Atualiza KF existente
      updatedTypeArray = currentTypeArray.map((kf, index) =>
        index === existingIndex ? { ...kf, value: getUpdatedValue(kf.value) } : kf
      );
    } else {
      // Cria novo KF no tempo atual
      const newKeyframe = {
        id: crypto.randomUUID(),
        time: relativeTime,
        value: getUpdatedValue(null),
      };
      updatedTypeArray = [...currentTypeArray, newKeyframe].sort((a, b) => a.time - b.time);
    }
  }

  // 3. Persistência
  const updatedKeyframes = { ...safeKeyframes, [type]: updatedTypeArray };

  setClips((prev) =>
    prev.map((c) => c.id === clip.id ? { ...c, keyframes: updatedKeyframes } : c)
  );

  // Gatilhos específicos
  if (type === 'speed') {
    handleSpeedKeyframeChange({ ...clip, keyframes: updatedKeyframes });
  }
};








const addKeyframe = (e: React.MouseEvent, clipId: string) => {
  const clip = clips.find(c => c.id === clipId);
  if (!clip || !clip.activeKeyframeView) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  const time = clickX / pixelsPerSecond;
  // Valor visual (0 a 1) vindo do clique
  const rawValue = Math.max(0, Math.min(1, 1 - (clickY / rect.height)));

  setClips(prev => {
    return prev.map(c => {
      if (c.id !== clipId) return c;
      
      const view = c.activeKeyframeView as keyof NonNullable<Clip['keyframes']>;
      
      // Calculamos o valor final baseado no tipo de visão
      let finalValue = view === 'speed' ? converterSpeed(rawValue) : 
      view === 'volume' ? convertDB(rawValue) : 
      view === 'zoom' ? convertZoom(rawValue) : rawValue;


      const currentKfs = c.keyframes?.[view] || [];

      // Verifica proximidade para evitar duplicatas
      if (currentKfs.some(k => Math.abs(k.time - time) < 0.05)) return c;

      const newKeyframe: Keyframe = {
        id: crypto.randomUUID(),
        time: time,
        value: finalValue
      };

      const updatedClip = {
        ...c,
        keyframes: {
          ...c.keyframes,
          [view]: [...currentKfs, newKeyframe].sort((a, b) => a.time - b.time)
        }
      };

      // Disparar a lógica de Speed Ramp se necessário
      // Fazemos isso aqui dentro para garantir que estamos usando o objeto atualizado
      if (view === 'speed') {
        // Usamos setTimeout para tirar a execução da thread de renderização do setClips
        setTimeout(() => handleSpeedKeyframeChange(updatedClip), 0);
      }

      return updatedClip;
    });
  });
};

const addKeyframe_old = (e: React.MouseEvent, clipId: string) => {
  const clip = clips.find(c => c.id === clipId);
  // Só adiciona se houver uma visão de keyframe ativa (ex: 'volume')
  if (!clip || !clip.activeKeyframeView) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  const time = clickX / pixelsPerSecond;
  // Inverte o Y: clique no topo = 1.0 (100%), clique na base = 0.0 (0%)
  let value = Math.max(0, Math.min(1, 1 - (clickY / rect.height)));

  console.log(value)

  setClips(prev => prev.map(c => {
    if (c.id !== clipId) return c;
    
    const view = c.activeKeyframeView as keyof NonNullable<Clip['keyframes']>;


   if( view == 'speed')
        value = converterSpeed(value)




    const currentKfs = c.keyframes?.[view] || [];

    // Se já houver um ponto muito perto no tempo, não cria outro
    if (currentKfs.some(k => Math.abs(k.time - time) < 0.05)) return c;

    console.log('valor a ser mandado', value, view)
    const newKeyframe: Keyframe = {
      id: crypto.randomUUID(),
      time: time,
      value: value
    };

    return {
      ...c,
      keyframes: {
        ...c.keyframes,
        [view]: [...currentKfs, newKeyframe].sort((a, b) => a.time - b.time)
      }
    };
  }));


  if( clip.activeKeyframeView == 'speed')
     handleSpeedKeyframeChange(clip)

  

};

{/* Função auxiliar para calcular o Y em pixels baseado na altura do clipe (ex: 40px) */}
const calculateY = (value: number, height: number, type:string = '') => {
  
  if(type == 'speed')
    return (1 - reverterSpeed(value)) * height

  if(type == 'volume')
  {
    console.log('volume on', (1- reverterVolume(value)) * height, value)
    return (1- reverterVolume(value)) * height
  }

  if(type == 'zoom')
    return (1- reverterZoom(value)) * height


  if((type == 'position') || (type == 'rotation3d'))
    return 0.5

  
  
  
  return (1 - value) * height;
};



// No seu código dentro do SVG:



const handleKeyframeDrag = (
  e: React.MouseEvent, 
  clipId: string, 
  kfId: string, 
  view: 'volume' | 'opacity' | 'speed' | 'rotation3d'
) => {

  const onMouseMove = (moveEvent: MouseEvent) => {
    const clipElement = document.getElementById(`clip-${clipId}`);
    if (!clipElement) return;

    const rect = clipElement.getBoundingClientRect();
    
    // Calcula novos valores baseados na posição do mouse
    const newTime = (moveEvent.clientX - rect.left) / pixelsPerSecond;
    let newValue = Math.max(0, Math.min(1, 1 - (moveEvent.clientY - rect.top) / rect.height));

    setClips(prev => prev.map(c => {
      if (c.id !== clipId) return c;

      const kfs = [...(c.keyframes?.[view] || [])];
      const idx = kfs.findIndex(k => k.id === kfId);
      if (idx === -1) return c;

      // --- LOGICA DE RESPEITO AOS VIZINHOS ---
      const minTime = kfs[idx - 1]?.time || 0;
      const maxTime = kfs[idx + 1]?.time || c.duration;


      if( view == 'speed')
        converterSpeed(newValue)

      kfs[idx] = {
        ...kfs[idx],
        time: Math.max(minTime, Math.min(maxTime, newTime)),
        value: newValue
      };

     
      if( view == 'speed')
          handleSpeedKeyframeChange(c)


      return {
        ...c,
        keyframes: { ...c.keyframes, [view]: kfs }
      };
    }));
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);



};

const deleteKeyframe = (clipId: string, kfId: string, view: string) => {
  setClips(prev => prev.map(c => {
    if (c.id !== clipId) return c;
    
    const currentKfs = c.keyframes?.[view as keyof NonNullable<Clip['keyframes']>] || [];
    const filteredKfs = currentKfs.filter(k => k.id !== kfId);

    return {
      ...c,
      keyframes: {
        ...c.keyframes,
        [view]: filteredKfs
      }
    };
  }));
};



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
            <img 
              src="logoFreeCut.png" 
              alt="FreeCut Logo" 
              className="w-10 h-10 object-contain" // Mesmas dimensões do div antigo
            />
            <h1 className="text-lg text-white"> Free<span className='font-bold'>Cut</span> <span className="text-zinc-500 font-light text-sm not-italic">MANAGER</span></h1>
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
              <button 
                className="
                  relative flex items-center gap-2 px-8 py-3 
                  bg-black text-white font-black text-xs rounded-xl
                  transition-all duration-300
                  hover:shadow-[0_0_15px_rgba(34,211,238,0.2)] hover:scale-[1.02]
                  
                  border border-transparent
                  [background:linear-gradient(#000,#000)_padding-box,linear-gradient(to_right,#06b6d4,#d946ef)_border-box]
                "

                onClick={() => setIsCreatingNew(true)} 
              >
                <Plus size={20} strokeWidth={3} className="text-white" />
                <span className="tracking-widest uppercase">New Project</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {projects.map((proj) => (
                <motion.div 
                  key={proj.path} 
                  whileHover={{ scale: 1.02 }} 
                  onClick={() => openProject(proj.path)}
                  className="group bg-[#121212] border border-zinc-800/50 rounded-2xl overflow-hidden cursor-pointer hover:border-fuchsia-400 transition-all relative"
                >
                  <button 
                    onClick={(e) => { e.stopPropagation(); setProjectToDelete(proj); }}
                    className="absolute top-2 right-2 z-50 p-2 bg-black/50 hover:bg-red-600 text-zinc-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X size={14} /> 
                  </button>
                  <div className="aspect-video bg-[#1a1a1a] flex items-center justify-center border-b border-zinc-800">
                    <LayoutGrid size={40} className="text-zinc-800 group-hover:text-fuchsia-800/20" />
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
              className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all active:scale-95 shadow-lg shadow-red-900/20"
            >
              <Youtube size={14} /> Download
            </button>
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400" title='Post in social media'><Share2 size={16}/></button>
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400" title='Settings' onClick={() => setIsSettingsOpen(true)}><Settings size={16}/></button>
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400" title='Export video' onClick={()=> { startExport();}}><Import size={16}/></button>
          </div>
        </header>

        {/* Top Section: Sidebar + Preview */}
        <main className="flex-1 flex overflow-hidden min-h-0">
          
          
          <ItensAside 
            sidebarWidth={sidebarWidth}
            isResizingSidebar={isResizingSidebar}
            handleImportFile={handleImportFile}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            filteredAssets={filteredAssets}
            selectedAssets={selectedAssets}
            toggleAssetSelection={toggleAssetSelection}
            setSourceAsset={setSourceAsset}
            setInPoint={setInPoint}
            setOutPoint={setOutPoint}
            setCurrentTime2={setCurrentTime2}
            handleDragStart={handleDragStart}
            handleRenameAsset={handleRenameAsset}
            formatTime={formatTime}
          />

<div id="twopreview" className="flex-1 flex overflow-hidden min-h-0 bg-[#050505]">


  
    {/* SOURCE MONITOR (Auxiliary) - Now properly aligned and centered */}
      <section 
      style={{ width: `${sourceWidth}px` }}
      className="relative h-full w-72 border-r border-white/5 bg-[#080808] flex flex-col shrink-0"
      onMouseEnter={() => {setIsMouseOverSource(true); isMouseOverRef.current = true;}}
      onMouseLeave={() => {setIsMouseOverSource(false); isMouseOverRef.current = false;}}
      >
      <div 
        className="flex flex-col gap-4 p-4 bg-zinc-900/60 rounded-2xl border border-white/5"
        
      >
  {/* Canvas Monitor */}
  <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-white/10 shadow-2xl">
   

    {sourceAsset ? (

    <div>
        <canvas
          ref={canvasRef2}
          width={1280}
          height={720}
          className="w-full h-full object-contain"
        />
        
        <audio 
          ref={audioRef2}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          hidden
        />

    </div>
      
    ) : (
      <div className="flex items-center justify-center h-full text-zinc-600 text-xs">
        Select an asset to clip.
      </div>
    )}

    {/* Overlay de Status */}
    <div className="absolute bottom-4 left-4 flex items-center gap-2">
       <div className={`w-2 h-2 rounded-full ${isPlaying2 ? 'bg-green-500 animate-pulse' : 'bg-zinc-600'}`} />
       <span className="text-[10px] font-mono text-white/50 tracking-tighter">
         {currentTime2.toFixed(3)}s
       </span>
    </div>
  </div>

  {/* Overlay de Drag and Drop */}
    {sourceAsset && (
      <div
        draggable
        onDragStart={(e) => {
          const subClip = {
            name: sourceAsset.name,
            beginmoment: inPoint,
            duration: outPoint - inPoint,
            id: crypto.randomUUID() // Novo ID para o subclip
          };
          e.dataTransfer.setData("application/json", JSON.stringify(subClip));
          
        }}
        className="absolute inset-0 cursor-grab active:cursor-grabbing flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity"
      >
        <div className="bg-white/10 p-2 rounded-full backdrop-blur-md">
           <Plus size={24} className="text-white" />
        </div>
      </div>
    )}

  {/* Interação: Barra de Progresso e Marcadores I/O */}
  <div className="space-y-4">
    <div 
      className="relative h-3 bg-white/5 rounded-full cursor-pointer overflow-hidden"
      onClick={(e) => {
        if (!audioRef2.current || !sourceAsset) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const newTime = percent * (audioRef2.current.duration || 0);
        
        audioRef2.current.currentTime = newTime;
        setCurrentTime2(newTime);
        renderFrame2(newTime); // Renderiza o frame estático ao clicar
      }}
    >
      {/* Marcador de Range (I -> O) */}
      <div 
        className="absolute h-full bg-indigo-500/30 border-x border-indigo-500/50"
        style={{
          left: `${(inPoint / (audioRef2.current?.duration || 1)) * 100}%`,
          width: `${((outPoint - inPoint) / (audioRef2.current?.duration || 1)) * 100}%`
        }}
      />

      {/* Playhead */}
      <div 
        className="absolute h-full w-0.5 bg-white z-20"
        style={{ left: `${(currentTime2 / (audioRef2.current?.duration || 1)) * 100}%` }}
      />
    </div>

    {/* Controles de Tempo */}
    <div className="flex justify-between text-[10px] font-mono">
       <div className="flex gap-4">
          <span className="text-blue-400">IN: {inPoint.toFixed(2)}s</span>
          <span className="text-red-400">OUT: {outPoint.toFixed(2)}s</span>
       </div>
       <span className="text-zinc-500 italic">Press I / O to Mark</span>
    </div>
  </div>
</div>

        {/* RIGHT RESIZER HANDLE */}
  <div 
    onMouseDown={(e) => {
      isResizingSource.current = true;
      document.body.style.cursor = 'col-resize';
    }}
    className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-[60] hover:bg-blue-500/40 transition-colors"
  />
      </section>


      {showContextMenu && (
                  <div 
                    className="absolute z-[100] bg-[#050505] border border-zinc-800 rounded-lg shadow-2xl p-1 w-52 overflow-hidden"
                    style={{ top: showContextMenu.y, left: showContextMenu.x }}
                    onClick={(e) => e.stopPropagation()} // Impede o fechamento ao clicar no menu
                  >
                    <div className="px-3 py-1.5 text-[9px] font-black text-zinc-600 uppercase tracking-tighter border-b border-zinc-900 mb-1">
                      Clip Actions
                    </div>
                    
                    <button 
                      onClick={() => {
                        setInteractionMode('transform');
                        setShowContextMenu(null);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-cyan-500/10 text-zinc-400 hover:text-cyan-400 text-[10px] font-black uppercase transition-all group"
                    >
                      <Maximize size={14} className="group-hover:scale-110 transition-transform" />
                      Set Position (Transform)
                    </button>

                    <button 
                      onClick={() => {
                        
                        
                        setClips( prev => prev.map( c => 

                            (c.id == selectedClipIdRef.current) ? {...c, activeKeyframeView : null} : c
                        ))
                        
                        setInteractionMode('none')
                        setShowContextMenu(null);
                      
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-red-500/10 text-zinc-400 hover:text-red-500 text-[10px] font-black uppercase transition-all"
                    >
                      <X size={14} /> Clear Mode
                    </button>
                  </div>
         )}



          {/* PREVIEW PLAYER */}
          <section className="flex-1 bg-black flex flex-col items-center justify-center p-8 relative">
            




              
                <div 
                  className="w-full max-w-4xl bg-[#050505] rounded-xl border border-zinc-800 flex items-center justify-center relative group cursor-pointer overflow-hidden shadow-2xl transition-all duration-500 ease-in-out"
                  style={{ 
                    aspectRatio: `${projectConfig.width} / ${projectConfig.height}` 
                  }}
                  onClick={togglePlay}
                >
                  {/* O Canvas agora preenche o contêiner que tem a proporção correta */}
                  <canvas 
                    ref={canvasRef}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      handleCanvasClick(e); // Sua função de Hit Test que define o selectedClipIdRef
                    }}
                    onMouseDown={(e) => {
                      if (interactionMode === 'transform' && selectedClipIdRef.current) {
                        isDraggingRef.current = true;
                        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
                         
                      }
                    }}
                    onMouseMove={(e) => {
                      if (isDraggingRef.current && interactionMode === 'transform' && selectedClipIdRef.current) {
                        const dx = e.clientX - lastMousePosRef.current.x;
                        const dy = e.clientY - lastMousePosRef.current.y;


                        console.log('dx', dx)
                        
                        // Pegamos o clipe atual
                        const clip = clips.find(c => c.id === selectedClipIdRef.current);
                        if (!clip) return;

                        // Pegamos a posição atual interpolada
                        const currentPos = getInterpolatedValueWithFades(currentTime, clip, 'position') as Position;


                        console.log('posX', currentPos.x + dx)
                        
                        
                        updateKeyframes(clip, 'position', { 
                          x: currentPos.x + dx, 
                          y: currentPos.y + dy 
                        });

                        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
                      }
                    }}
                    onMouseUp={() => {
                      isDraggingRef.current = false;
                       
                    }}  
                    style={{ cursor: canvasCursor }}
                    className="absolute inset-0 w-full h-full"
                  />

                  {interactionMode === 'transform' && selectedClipIdRef.current && (
                    <div className="absolute inset-0 pointer-events-none">
                      <svg className="w-full h-full">
                          {/* Desenha o retângulo ao redor do clipe selecionado */}
                          {(() => {
                            const clip = clips.find(c => c.id === selectedClipIdRef.current);
                            const pos = getInterpolatedValueWithFades(currentTime, clip, 'position');
                            // Lógica de projeção de coordenadas Canvas -> Div UI

                            //variaveis temporarias 

                            const scale = getInterpolatedValueWithFades(currentTimeRef.current, clip , 'zoom') || 1
                            const clipWidth = clip?.dimentions?.x || projectConfig.width
                            const clipHeight = clip?.dimentions?.y|| projectConfig.height




                            return (
                              <rect 
                                x={pos.x * scale} 
                                y={pos.y * scale} 
                                width={clipWidth * scale} 
                                height={clipHeight * scale} 
                                fill="none" 
                                stroke="#ff0000" 
                                strokeWidth="2"
                              />
                            )
                          })()}
                      </svg>
                    </div>
                  )}

                  
                  
                  {/* Ícones de Play/Pause centralizados */}
                  <div className="z-10 pointer-events-none">
                    {isPlaying ? (
                      <Pause size={56} className="text-white/5 group-hover:text-white/30 transition-all scale-90 group-hover:scale-100" />
                    ) : (
                      <Play size={56} className="text-white/5 group-hover:text-white/30 transition-all scale-90 group-hover:scale-100" />
                    )}
                  </div>
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



</div>

      <PropertiesAside 
      selectedClipIds={selectedClipIds}
      clips={clips}
      assets={assets}
      currentTime={currentTime}
      currentTimeRef={currentTimeRef}
      setClips={setClips}
      updateKeyframes={updateKeyframes}
      getInterpolatedValueWithFades={getInterpolatedValueWithFades}
      knowTypeByAssetName={knowTypeByAssetName}
      COLOR_MAP={COLOR_MAP}
    />



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
                  {formatTime(currentTimeRef.current)}
                </span>
              </div>


                {/* Buttons of Split and Select */}
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


         
      
{/* --- TIMELINE SECTION --- */}

<div className="flex flex-col bg-black/20 rounded-xl border border-white/5 overflow-hidden relative">
  



  {/* Main Timeline Area (Tracks + Needle) */}
  <div 
    ref={timelineContainerRef}
    onMouseDown={handleTimelineMouseDown} //(e) => { if (e.target === e.currentTarget) setSelectedClipIds([]); 
            onDrop={handleDropOnEmptyArea}
            onDragOver={(e) => e.preventDefault()}
            onMouseMove={handleTimelineMouseMove}
            onMouseUp={handleTimelineMouseUp}
            onMouseLeave={handleTimelineMouseUp}
    className="flex flex-col p-2 gap-1.5 overflow-x-auto custom-scrollbar relative"
  >

     

     {/* Header da Timeline / Ruler */}
  <div className="flex bg-zinc-900/50">
    <div className="w-50 shrink-0 border-r border-white/5" /> 
    
    <div 
      className="flex-1 relative h-8 border-b border-white/5 cursor-pointer overflow-hidden"
      onMouseDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        //const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
        const newPos = e.clientX   - rect.left  - (pixelsPerSecond/20); //calibration
        currentTimeRef.current = playheadPos/pixelsPerSecond
        seekTo(currentTimeRef.current);
        setPlayheadPos(newPos);
        

        
        
      }}

    >
      {[...Array(150)].map((_, i) => {
        const timeInSeconds = i * 5;
        return (
          <div key={i} className="absolute border-l border-zinc-800/50 h-full text-[8px] pl-1 pt-1 text-zinc-500 font-mono pointer-events-none" style={{ left: timeInSeconds * pixelsPerSecond }}>
            {timeInSeconds % 30 === 0 ? formatTime(timeInSeconds) : ''}
            <div className="absolute top-0 left-0 h-2 border-l border-zinc-700" />
          </div>
        );
      })}
    </div>
  </div>

    {/* PLAYHEAD - Now released inside the scroll container. */}
    <div ref={playheadRef}
      className="absolute top-0 bottom-0 w-[2px] bg-sky-600 z-[100] pointer-events-none transition-transform duration-75 ease-out" 
      style={{ left: asidetrackwidth + 15 }} // +8 por causa do padding p-2 do container

    >
        {/* Needle head (Triangle or Circle) */}
        <div onMouseDown={handlePlayheadMouseDown}  className="w-4 h-4 bg-sky-600 rounded-b-full shadow-[0_0_10px_rgba(220,38,38,0.5)] -ml-[7px]" />
    </div>

 

    {/* Track Rendering (Your sort and map code here) */}
    {Array.from(
  // 1. Create a Map using the ID as the key to eliminate duplicates.
  new Map(tracks.map((t) => [t.id, t])).values()
)
  // 2. Sort the unique tracks
  .sort((a, b) => {
    const priority = (type: string) => (type === "audio" ? 1 : 0);
    const pA = priority(a.type);
    const pB = priority(b.type);

    if (pA !== pB) {
      return pA - pB;
    }
    return a.id - b.id;
  })
  // 3. Maps to the component
  .map((track, index) => (
      <div key={track.id} className="flex gap-2 group">
        
        {/* ASIDE: Icons Track and id */}
        <div  ref={asidetrack} className="w-48 shrink-0 bg-zinc-900/40 border border-zinc-800/40 rounded-md flex items-center px-3 gap-3">
          <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center text-zinc-400 group-hover:text-white transition-colors">
            {track.type === 'audio' && <Music size={14} />}
            {track.type === 'video' && <Play size={14} fill="currentColor" />}
            {track.type === 'effects' && <Sparkles size={14} />}
          </div>
          
          <div className="flex flex-col min-w-0">
            <span className="text-[9px] font-black text-white/70 uppercase tracking-tighter truncate">
              {track.type} Track
            </span>
            <span className="text-[7px] font-bold text-zinc-600 uppercase">
              ID: {track.id + 1}
            </span>
          </div>

          <div className="flex flex-row min-w-0">

            <LockIcon size={14}  onClick={() => lockmuteTrack(0, track)} 
              className={`cursor-pointer transition-colors duration-200 ${
                track.lock 
                  ? 'text-violet-500 fill-violet-500/20' // Roxo moderno com um leve preenchimento (opcional)
                  : 'text-gray-400 hover:text-gray-200'  // Cor neutra quando desligado
              }`}/>

            <MicOffIcon size={14} onClick={() => lockmuteTrack(1, track)} 
              className={`cursor-pointer transition-colors duration-200 ${
                track.mute 
                  ? 'text-violet-500 fill-violet-500/20' // Roxo moderno com um leve preenchimento (opcional)
                  : 'text-gray-400 hover:text-gray-200'  // Cor neutra quando desligado
              }`}/>

            {
             (index !== 0 && track.type == 'video') && <ArrowBigUpDash size={14} onClick={()=> transferClipsToNewTrackZero(track.id)}
             className={"cursor-pointer transition-colors duration-200"}/> 
            }

            {
             (index !== 0 && index !==1 && track.type == 'video') && <ArrowUp size={14} onClick={()=> moveTrackDownAndShiftOthers(track.id)}
             className={"cursor-pointer transition-colors duration-200"}/> 
            }



          </div>


        </div>

        {/* DROPS AREA: Where is the Clips stay */}
        <div 
          onDragOver={handleDragOver}
          onDrop={(e) => handleDropOnTimeline(e, track.id)}
          className={`relative flex-1  border 
          rounded-md  
          transition-colors min-w-[10000px]
          ${ track.lock &&
            'text-slate-500 opacity-40 hover:opacity-60 transition-opacity'
          }

          ${track.mute 
          ? 'bg-rose-950/30 border-rose-500/40' // Fundo vinho sutil e borda rosa
          : 'bg-zinc-900/10 border-zinc-800/20 hover:bg-zinc-900/20'
          }`
        
        
          }
          style={{ height: '64px' }}

          

        >
          {/* Clips filtrados por track.id */}
          {clips.filter(c => Number(c.trackId) === Number(track.id)).map((clip) => {
            

            const cacheKey = `${clip.id}-${clip.beginmoment}-${clip.duration}`;
            const thumbs = timelineThumbs[cacheKey];
            const assetTarget = assets.find( a => a.name === clip.name) || null
            if(!assetTarget) return
            const isVideo = (assetTarget?.type  === 'video')
            
            let margintitle = pixelsPerSecond > 30 ? -15 : -15
            const iconSize = pixelsPerSecond > 30 ? 17 : 17


            margintitle = pixelsPerSecond > 50 ? 30 : margintitle
            const isAudioOnly = assetTarget.type === 'audio';
            const currentFadeIn = isAudioOnly ? (clip.fadeinAudio || 0) : (clip.fadein || 0);
            const currentFadeOut = isAudioOnly ? (clip.fadeoutAudio || 0) : (clip.fadeout || 0);




            
            return (
              <motion.div 
              key={clip.id} layoutId={clip.id}
              draggable="true"
              onContextMenu={(e) => handleContextMenu(e, assetTarget?.type, clip)}
              onDragStart={(e) => handleDragStart(e, clip.color, track.id, clip.duration, clip.name, true, clip.id)}
              onClick={(e) => { e.stopPropagation(); toggleClipSelection(clip.id, e.shiftKey || e.ctrlKey); setContextMenu(null); 
                
                
                
              if((clip.activeKeyframeView !== 'position') && (clip.activeKeyframeView !== 'rotation3d'))  
                    addKeyframe(e, clip.id)
              
              
              }}
              className={`absolute  inset-y-1.5 ${clip.color} rounded-md flex items-center shadow-lg cursor-grab active:cursor-grabbing border-2 ${
                selectedClipIds.includes(clip.id) ? 'border-white ring-4 ring-white/10 z-30' : 'border-black/20'
              }`}
              style={{
                left: clip.start * pixelsPerSecond,
                width: clip.duration * pixelsPerSecond,
              }}

              onMouseMove={(e) => handleClipMouseMove(e, clip)}
              onMouseLeave={() => setHoverKeyframe(prev => prev ? { ...prev, visible: false } : null)}

               //onDoubleClick={(e) =>{ e.stopPropagation(); }}
            >

            <AnimatePresence>
              {hoverKeyframe?.visible && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed pointer-events-none z-[9999] px-2 py-1 bg-zinc-900 border border-white/20 rounded shadow-2xl flex items-center gap-2"
                  style={{
                    left: hoverKeyframe.x + 15, // Offset para não ficar embaixo do cursor
                    top: hoverKeyframe.y - 10,
                  }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                  <span className="text-[10px] font-mono font-bold text-white tracking-tighter uppercase">
                    {hoverKeyframe.value}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

              {/* Context Menu (right click mouse) */}

             {contextMenu && (() => {
             
             const menuHeight = 180; 
              const menuWidth = 200;  
              
              const overflowY = contextMenu.y + menuHeight > window.innerHeight;
              
              const overflowX = contextMenu.x + menuWidth > window.innerWidth;

              const adjustedY = overflowY ? contextMenu.y - menuHeight : contextMenu.y;
              const adjustedX = overflowX ? contextMenu.x - menuWidth : contextMenu.x;

              return (
                

                      <div 
                        className="fixed z-50 min-w-[200px] bg-zinc-900/95 backdrop-blur-xl border border-white/10 shadow-2xl rounded-lg py-1.5 animate-in fade-in zoom-in duration-100 "
                        style={{ top: adjustedY, left: adjustedX }}
                      >
                        {/* Opção: Separate/Recover Audio (Apenas Vídeo) */}
                        {contextMenu?.type === 'video' && (
                          <>
                            <button 
                              onClick={() => {
                                separateAudio(contextMenu?.clip);
                                setContextMenu(null);
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-violet-600 hover:text-white transition-colors flex items-center gap-3"
                            >
                              <Music size={14} className="opacity-70" />
                              <span>{contextMenu?.clip.mute ? 'Recover Audio' : 'Separate Audio'}</span>
                            </button>
                            <div className="h-[1px] bg-white/5 my-1 mx-2" />
                          </>
                        )}


                        <button 
                          onClick={() => {
                            setClips(prev => prev.map(c => 
                              c.id === contextMenu.clip.id ? { ...c, activeKeyframeView: null } : c
                            ));
                            setContextMenu(null);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-amber-400 hover:bg-zinc-800 transition-all flex items-center gap-3"
                        >
                          <EyeOff size={14} />
                          <span>Hide Keyframes</span>
                        </button>


                        {/* Opção KEYFRAMABLE com Submenu Lateral */}
                        <div className="relative group">
                          <div 
                            className="w-full text-left px-3 py-2 text-sm text-zinc-200 
                                      group-hover:bg-zinc-800 transition-colors flex items-center justify-between cursor-default"
                          >
                            <div className="flex items-center gap-3">
                              <Diamond size={14} className="text-violet-400 opacity-80" />
                              <span className="font-medium">Keyframable</span>
                            </div>
                            <SkipForward size={12} className="opacity-40" />
                          </div>

                          {/* Submenu Lateral */}
                          <div className="absolute left-[calc(100%-4px)] top-[-6px] invisible group-hover:visible opacity-0 group-hover:opacity-100
                          min-w-[160px] bg-zinc-900 border border-white/10 shadow-2xl rounded-lg py-1.5 
                          transition-all duration-150 transform translate-x-1 group-hover:translate-x-2
                          max-h-[100px] overflow-y-auto scrollbar-thin scrollbar-thumb-cyan-700
                          ">
                            
                            {[
                              { label: 'Volume', value: 'volume', icon: <Volume2 size={14} /> },
                              { label: 'Opacity', value: 'opacity', icon: <Layers size={14} /> },
                              { label: 'Speed', value: 'speed', icon: <Clock size={14} /> },
                              { label: '3D Rotation', value: 'rotation3d', icon: <Rotate3d size={14} /> },
                              { label: 'Position', value: 'position', icon: <Crosshair size={14} /> },
                              { label: 'Zoom', value: 'zoom', icon: <ZoomIn size={14} /> },

                            ].map((sub) => (
                              <button
                                key={sub.value}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  
                                  // View Keyframes
                                  setClips(prev => prev.map(c => 
                                    c.id === contextMenu.clip.id 
                                      ? { ...c, activeKeyframeView: sub.value as any } 
                                      : c
                                  ));
                                  
                                  setContextMenu(null);
                                }}
                                className="w-full text-left px-3 py-2 text-[12px] text-zinc-300 hover:bg-violet-600 hover:text-white transition-colors flex items-center gap-3"
                                >
                                  <span className="opacity-50">{sub.icon}</span>
                                  <span>{sub.label}</span>
                                </button>
                            ))}
                          </div>
                        </div>

                        {/* Outras opções padrão (Exemplo: Delete) */}
                        <div className="h-[1px] bg-white/5 my-1 mx-2" />
                        <button 
                          onClick={() => {
                            setClips(prev => prev.filter(c => c.id !== contextMenu.clip.id));
                            setContextMenu(null);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-600 hover:text-white transition-colors flex items-center gap-3"
                        >
                          <X size={14} className="opacity-70" />
                          <span 
                          
                          onClick={() => {
                            setClips( prev => prev.filter( c => c !== clip))
                          }}
                          
                          
                          >Remove Clip</span>
                        </button>
                      </div>





              );
            })()}
                  

              {/*Keyframes system */}


          {clip.activeKeyframeView && (
            <div className="absolute inset-0 w-full h-full z-50 overflow-visible">
              <svg 
                className="w-full h-full overflow-visible cursor-crosshair pointer-events-auto"
                onDoubleClick={(e) => addKeyframe(e, clip.id)}
              >
                {/* 1. Linha de fundo (Guia) */}
                <line 
                  x1="0" y1="50%" x2="100%" y2="50%" 
                  stroke="white" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.2" 
                />

                {/* 2. A Linha de Keyframes Branca */}
                {clip.keyframes?.[clip.activeKeyframeView] && clip.keyframes[clip.activeKeyframeView]!.length > 0 && (
                  <polyline
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  className="drop-shadow-[0_0_3px_rgba(255,255,255,0.5)]"
                  points={(clip.keyframes?.[clip.activeKeyframeView!] || [])
                    .map(kf => {
                      const x = kf.time * pixelsPerSecond;
                      const y = calculateY(kf.value, 40, clip.activeKeyframeView); // 40 é a altura da sua track
                      return `${x},${y}`;
                    })
                    .join(' ')}
                />
                )}

                {/* 3. Os Pontos Arrastáveis */}
                {(clip.keyframes?.[clip.activeKeyframeView] || []).map((kf) => 
                
                
                {

                  var cyString = ""

                  clip.activeKeyframeView === 'volume' ? 
                     cyString = `${(1 - reverterVolume(kf.value)) * 100}%`  : 
                  clip.activeKeyframeView === 'speed' ? 
                        cyString = `${(1 - reverterSpeed(kf.value)) * 100}%` : 
                  clip.activeKeyframeView === 'zoom' ? 
                        cyString = `${(1 - reverterZoom(kf.value)) * 100}%` :
                  clip.activeKeyframeView === 'position' ? 
                        cyString = '50%':
                  clip.activeKeyframeView === 'rotation3d' ? 
                        cyString = '50%': 
                        cyString = `${(1 - kf.value) * 100}%`
                  
                  
                  var title =  clip.activeKeyframeView === 'position' ? `X: ${kf.value.x},Y: ${kf.value.y}` :
                  clip.activeKeyframeView === 'rotation3d' ? `Rot: ${kf.value.rot},Rot3D: ${kf.value.rot3d}`:
                  clip.activeKeyframeView === 'zoom' ? 
                  `${(1 - reverterZoom(kf.value)) * 100}%` :
                  `${kf.value}`
                  
                  return(
                  <circle
                    key={kf.id}
                    cx={kf.time * pixelsPerSecond}
                    cy={cyString}
                    r="5"
                    fill="white"
                    stroke="#7c3aed"
                    strokeWidth="2"
                    //hover:scale-150 
                    className="cursor-move transition-transform pointer-events-auto"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if((clip.activeKeyframeView !== 'position') && (clip.activeKeyframeView !== 'rotation3d'))
                          handleKeyframeDrag(e, clip.id, kf.id, clip.activeKeyframeView!);
                      
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteKeyframe(clip.id, kf.id, clip.activeKeyframeView!);
                    }}
                    
                  >

                    <title> {title} </title>

                  </circle>  
                )



                }
                
                
                
                
                
                
                
                )}
              </svg>
              
              {/* Badge indicando o que estamos editando */}
              <div className="absolute top-1 left-1 bg-violet-600 text-[8px] px-1 rounded uppercase font-bold text-white opacity-70">
                Editing {clip.activeKeyframeView}
              </div>
              <button 
              onClick={(e) => {
                e.stopPropagation();
                setClips(prev => prev.map(c => c.id === clip.id ? { ...c, activeKeyframeView: null } : c));
              }}
              className="bg-zinc-800 hover:bg-red-600 text-white rounded-full p-0.5 transition-colors"
            >
              <X size={8} />
            </button>
            <button 
            onClick={(e) => {
              e.stopPropagation();
              // Confirmação simples para evitar exclusão acidental
              if(!confirm("Do you want to delete all keyframes for this property?")) return;

              setClips(prev => prev.map(c => {
                if (c.id === clip.id && c.activeKeyframeView) {
                  // Criamos uma cópia segura dos keyframes
                  const updatedKeyframes = { ...c.keyframes };
                  
                  // Limpamos apenas a propriedade que está sendo visualizada (volume, opacity, etc)
                  // @ts-ignore - ou use o tipo correto da chave
                  updatedKeyframes[c.activeKeyframeView] = []; 

                  return { 
                    ...c, 
                    keyframes: updatedKeyframes,
                    activeKeyframeView: null 
                  };
                }
                return c;
              }));
            }}
            className="bg-zinc-800 hover:bg-amber-600 text-white rounded-full p-0.5 transition-colors"
            title="Limpar todos os keyframes desta propriedade"
          >
            <BrushCleaning size={8} />
          </button>
            </div>
          )}



              {/* 1. Waveform - Ocupando o fundo proporcionalmente */}
              {assetTarget?.type === 'audio' && (
                <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
                  <Waveform  
                    path={`${currentProjectPath}/videos/${clip.name}`} 
                    color="rgba(255, 255, 255, 0.3)" // Cor clara e semi-transparente sobre o fundo colorido
                  />
                </div>
              )}

              {/* Thumbnails (Video/Image) */}
              {thumbs?.start && assetTarget?.type === 'video' && (
                <img src={thumbs.start} className="absolute left-0 top-0 h-full w-16 object-cover opacity-80 pointer-events-none border-r border-white/10" alt="" />
              )}
              {assetTarget?.type === 'image' && (
                <img src={convertFileSrc(`${currentProjectPath}/videos/${clip.name}`)} className="absolute left-0 top-0 h-full w-16 object-cover opacity-80 pointer-events-none border-r border-white/10" alt="" />
              )}
              {thumbs?.end && assetTarget?.type === 'video' && (
                <img src={thumbs.end} className="absolute right-0 top-0 h-full w-16 object-cover opacity-80 pointer-events-none border-l border-white/10" alt="" />
              )}

              {/* 2. Container Central do Título */}
              {/* Justify-start com um padding-left coloca o texto centralizado porém "pendendo" para a esquerda */}
              <div className="relative flex items-center justify-start w-full h-full px-4 overflow-hidden pointer-events-none">
                <p 
                  className="text-[9px] font-black text-white uppercase italic leading-none drop-shadow-lg truncate max-w-[80%]"
                  style={{ marginLeft: assetTarget?.type === 'audio' ? '0' : '64px' }} // Ajusta se houver thumbnail
                >
                  {clip.name}
                </p>
              </div>

              {/*FADE HANDLE */}

              {/* Lógica para decidir qual valor ler */}

                {/* Visual do Fade In (Triângulo) */}
                {currentFadeIn > 0 && (
                  <div 
                    className="absolute top-0 left-0 h-full bg-black/40 pointer-events-none"
                    style={{
                      width: currentFadeIn * pixelsPerSecond,
                      clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                    }}
                  />
                )}

                {/* Visual do Fade Out (Triângulo) */}
                {currentFadeOut > 0 && (
                  <div 
                    className="absolute top-0 right-0 h-full bg-black/40 pointer-events-none"
                    style={{
                      width: currentFadeOut * pixelsPerSecond,
                      clipPath: 'polygon(0 0, 100% 100%, 100% 0)',
                    }}
                  />
                )}

                {/* Handle de Fade In */}
                <div
                  className="absolute top-0 left-0 w-3 h-3 bg-white border border-black/50 rounded-bl-full cursor-ew-resize opacity-0 group-hover:opacity-100 z-30 hover:scale-125 transition-transform rotate-90"
                  onMouseDown={(e) => handleFadeDrag(e, clip.id, 'in', assetTarget?.type)}
                />

                {/* Handle de Fade Out */}
                <div
                  className="absolute top-0 right-0 w-3 h-3 bg-white border border-black/50 rounded-br-full cursor-ew-resize opacity-0 group-hover:opacity-100 z-30 hover:scale-125 transition-transform rotate-270"
                  onMouseDown={(e) => handleFadeDrag(e, clip.id, 'out', assetTarget?.type)}
                />

              {/* Handles de Redimensionamento */}
              <div className="absolute left-0 inset-y-0 w-1.5 cursor-ew-resize hover:bg-white/40 z-10" onMouseDown={(e) => startResizing(e, clip.id, 'left')} />
              <div className="absolute right-0 inset-y-0 w-1.5 cursor-ew-resize hover:bg-white/40 z-10" onMouseDown={(e) => startResizing(e, clip.id, 'right')} />
            </motion.div>
          )})}
        </div>
      </div>
    ))}


       {isBoxSelecting && (
          <div 
            className="absolute border border-blue-500 bg-blue-500/20 z-[100] pointer-events-none"
            style={{
              zIndex: 9999,
              left: Math.min(boxStart.x  , boxEnd.x ),
              top: Math.min(boxStart.y  , boxEnd.y),
              width: Math.abs(boxEnd.x - boxStart.x),
              height: Math.abs(boxEnd.y - boxStart.y),
            }}
          />
        )}


    


      <button 
        onClick={() => {
          const nextId = tracks.length > 0 ? Math.max(...tracks.map(t => t.id)) + 1 : 0;
          setTracks(prev => [...prev, { id: nextId, type: 'video' }]);
        }}
        className="mb-[200px] h-8 mt-2 w-fit flex items-center gap-2 text-[9px] font-black text-zinc-700 hover:text-zinc-400 uppercase tracking-widest transition-colors px-3 py-2 border border-dashed border-zinc-800/50 rounded-md"
        
      >
        <Plus size={10} /> Add Track
      </button>



       

  </div>
</div>  




        </footer>
      </div>
    )}

    {/* MODALS  */}

    {/* Modal to create new project */}
<AnimatePresence>
  {isCreatingNew && (
    <div className="fixed inset-0 bg-black/95 z-[300] flex items-center justify-center p-4 backdrop-blur-md">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        className="bg-[#121212] border border-zinc-800 p-8 rounded-3xl w-full max-w-md shadow-2xl"
      >
        <h2 className="text-2xl font-black mb-6 text-white italic tracking-tighter">NEW PROJECT</h2>
        
        <div className="space-y-4">
          {/* Project Title */}
          <div>
            <label className="text-[10px] font-black text-zinc-500 uppercase mb-2 block">Project Name</label>
            <input 
              type="text" 
              placeholder="My Awesome Project" 
              onChange={(e) => {setProjectName(e.target.value)
                setProjectConfig({ ...projectConfig, name: e.target.value})
              }}
              className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-red-600 transition-all text-sm" 
            />
          </div>

          {/* Resolution & FPS Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-zinc-500 uppercase mb-2 block">Resolution</label>
              <select 
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number);
                  setProjectConfig({ ...projectConfig, width: w, height: h });
                }}
                className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-3 text-white font-bold outline-none focus:border-red-600 transition-all text-xs appearance-none"
              >
                <option value="1920x1080">1080p (16:9)</option>
                <option value="1080x1920">TikTok (9:16)</option>
                <option value="3840x2160">4K Ultra HD</option>
                <option value="1080x1080">Square (1:1)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-zinc-500 uppercase mb-2 block">Frame Rate</label>
              <select 
                onChange={(e) => setProjectConfig({ ...projectConfig, fps: Number(e.target.value) })}
                className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-3 text-white font-bold outline-none focus:border-red-600 transition-all text-xs appearance-none"
              >
                <option value="24">24 FPS</option>
                <option value="30">30 FPS</option>
                <option value="60">60 FPS</option>
              </select>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 mt-8">
          <button 
            onClick={() => setIsCreatingNew(false)} 
            className="flex-1 py-4 text-[10px] font-black text-zinc-600 hover:text-white transition-colors uppercase tracking-widest"
          >
            Cancel
          </button>
          <button 
            onClick={handleFinishSetup} 
            className="flex-1 bg-cyan-500 hover:bg-cyan-600 py-4 rounded-2xl font-black text-xs text-white uppercase tracking-widest shadow-lg shadow-red-900/20 transition-all"
          >
            Create Project
          </button>
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
            <input type="text" placeholder="Video URL..." value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)}
              className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-4 text-sm font-bold text-white outline-none focus:border-red-600 mb-6" />
            <button disabled={isDownloading} onClick={handleYoutubeDownload}
              className={`w-full py-4 rounded-xl font-black text-xs text-white ${isDownloading ? 'bg-zinc-800' : 'bg-rose-700 hover:bg-rose-800'}`}>
              {isDownloading ? "DOWNLOADING..." : "FETCH MEDIA"}
            </button>
            <button onClick={() => setIsImportModalOpen(false)} className="w-full mt-4 text-[10px] text-zinc-500 font-bold uppercase"> Close </button>
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

    <AnimatePresence>
  {renderStatus === 'rendering' && (
    <motion.div className="fixed inset-0 z-[600] bg-[#050505]/95 backdrop-blur-2xl flex flex-col items-center justify-center">
      <div className="w-80 space-y-8 text-center">
        
        {/* Progress UI */}
        <div className="space-y-2">
           <div className="relative h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-cyan-600 shadow-[0_0_20px_rgba(220,38,38,0.8)]"
                initial={{ width: "0%" }}
                animate={{ width: `${renderPercent}%` }}
              />
            </div>
            <p className="text-zinc-500 text-[9px] font-mono tracking-widest uppercase">
              Rendering Master: {renderPercent}%
            </p>
        </div>

        {/* Cancel Button Implementation */}
        <button
          onClick={handleCancelExport}
          className="group relative px-6 py-2 overflow-hidden rounded-full border border-white/10 hover:border-red-500/50 transition-all"
        >
          <div className="relative z-10 flex items-center gap-2 text-zinc-400 group-hover:text-white transition-colors">
            <X size={14} />
            <span className="text-[10px] font-black uppercase tracking-widest">Abort Mission</span>
          </div>
          {/* Subtle hover background effect */}
          <div className="absolute inset-0 bg-red-600/10 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

      </div>
    </motion.div>
  )}
</AnimatePresence>


  {/* Project Config */}
  <ProjectSettingsModal 
    isOpen={isSettingsOpen}
    key={projectConfig.name} 
    onClose={() => setIsSettingsOpen(false)} 
    currentSettings={projectConfig}
    onSave={handleSaveSettings}
  />
  </div>
);
}