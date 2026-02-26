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
  Search
  
} from 'lucide-react';

import Waveform from "@/components/Waveform";
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { aside, track } from 'framer-motion/client';
import { convertFileSrc } from '@tauri-apps/api/core';



// --- INTERFACES ---

interface Project {
  name: string;
  path: string;
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
  path: string;       
  duration: number;   
  type: 'video' | 'audio' | 'image';
  thumbnailUrl?: string; // URL genarate by FFmpeg
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
  const asidetrack = useRef<HTMLDivElement>(null);

  const asidetrackwidth = asidetrack.current?.offsetWidth || 192;

  
  const playheadRef = useRef<HTMLDivElement>(null);
  //const mainPlayer = useRef<HTMLVideoElement>(null);


  const canvasRef = useRef<HTMLCanvasElement>(null)


  const imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
  const audioExtensions = ['mp3', 'wav', 'ogg'];
  const videoExtensions = ['mp4', 'mkv', 'avi', 'mov'];

  
    // Default zoom: 100 pixels represents 1 second
  const [pixelsPerSecond, setPixelsPerSecond] = useState(10);

  // Limits to prevent the timeline from disappearing or becoming infinite
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 200;






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

  //const to search assets
  const [searchQuery, setSearchQuery] = useState("");


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

  // Wrapper to log setTracks 
  /*
  const setTracks = (newValue: any) => {
  console.group("%c SET_TRACKS DISPARADO ", "background: #222; color: #bada55; font-weight: bold;");
  console.log("Novo Valor/Função:", newValue);
  console.trace("Origem da chamada:"); // Isso vai te dar o arquivo e a linha
  console.groupEnd();

  // Chama a função original para não quebrar o React
  _setTracks(newValue);
};

*/

//const to put thumbnaisl in clip

const [timelineThumbs, setTimelineThumbs] = useState<Record<string, { start: string, end: string }>>({});


//const to preview videos


const [currentTime, setCurrentTime] = useState(0); // Playhead time
const [isPlaying, setIsPlaying] = useState(false); 
const requestRef = useRef <number>(); // for loop animation loop of high precision
const lastTimeRef = useRef<number | null>(null);

const [topClip, setTopClip] = useState<Clip | null>(null);
const [topAudios, setTopAudios] = useState<Clip [] | null>(null);


//State management for rendering feedback
const [renderStatus, setRenderStatus] = useState<'idle' | 'rendering' | 'success'>('idle');
const [renderPercent, setRenderPercent] = useState(0);

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

const startExport = async () => {
  // 1. Trigger the export command
  if(clips.length == 0 || !clips )
  {
    
    showNotify('There is no clips','error')
    return
  } 

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

  // [English Comment] If the user cancels the dialog, targetPath will be null
  if (!targetPath) return;


  setRenderStatus('rendering');

  const clips_format = clips.map( c => { return {...c,path: `${currentProjectPath}/videos/${c.name}` ,trackId: c.trackId.toString(), type: knowTypeByAssetName(c.name)} })
  
  console.log( clips_format.map(c => c.path) )

  try {
    // Call the backend pipeline
    await invoke('export_video', {
      projectPath: currentProjectPath,
      exportPath: targetPath, // Selected via dialog.save()
      clips: clips_format
    });
    
    setRenderStatus('success');
  } catch (err) {
    console.error("Export Error:", err);
    setRenderStatus('idle');
  }
};


//code to video preview


//function to point the track that must be showed in video preview
const updatePreview = (currentTime: number) => {
  // 1. Filter by time of playhead

 

  const currentClips = clips.filter(clip => 
    currentTime >= clip.start  && 
    currentTime <= (clip.start  + clip.duration) && 
    knowTypeByAssetName(clip.name, true) === 'video'
  );

  if (currentClips.length == 0)
  {
    setTopClip(null)
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
  const winner = sortedClips[0] || null;
  setTopClip(winner);

  

};


//show what audios to play in audio preview
const updateAudio = () => {
  
  //filter images cause it don't has audio

  const currentClips = clips.filter(clip => 
    currentTime >= clip.start  && 
    currentTime <= (clip.start  + clip.duration) && 
    knowTypeByAssetName(clip.name) !== 'image'
  );

  if (currentClips.length == 0)
  {
    setTopAudios(null)
    return
  }  
      

  /*
  const sorted_tracks = order_tracks();
  const sortedTracksId = sorted_tracks.map(t => t.id);

  const sortedClips = currentClips.sort((a, b) => {
    const trackA = sortedTracksId.indexOf(a.trackId);
    const trackB = sortedTracksId.indexOf(b.trackId);
    return trackA - trackB;
  });
  
  */
  



  const winner = currentClips || null;

  //console.log('present audios', winner)


  const idsAtuais = topAudios?.map(c => c.id).join(',');
  const idsNovos = winner?.map(c => c.id).join(',');

  if (idsAtuais !== idsNovos) {
    setTopAudios(winner);
  }


  

  

};


// Map of a lot of <audios>
const audioPlayersRef = useRef<Map<string, HTMLAudioElement>>(new Map());

//Render all audios of the current time

/*
const renderAudio = () => {

  //if don't have audios or is paused stop the current players

  ///console.log('use efect audio')

  if (!topAudios || topAudios.length === 0 || !isPlaying) {
    audioPlayersRef.current.forEach(player => player.pause());
    return;
  }

  //play control for current players
  if(isPlaying)
    audioPlayersRef.current.forEach(player => player.play());






  const activeIds = new Set(topAudios.map(clip => clip.id));
  

  // 1. Remove audio files that are no longer on the needle.
  audioPlayersRef.current.forEach((player, id) => {
    if (!activeIds.has(id)) {
      player.pause();
      player.src = "";
      audioPlayersRef.current.delete(id);
    }
  });

  // 2. Add or update audio files that should be playing.
  topAudios.forEach(clip => {

    let player = audioPlayersRef.current.get(clip.id);


    //images are filter in UpdateAudio so all videos are really videos no metter how knowTypeByAssetName is use
    const audio = `${clip.name.split('.').slice(0, -1).join('.')}.mp3`
    const path =  knowTypeByAssetName(clip.name) === 'video' ? `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/extracted_audios/${audio}`)}` :
    `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/videos/${clip.name}`)}`


    //console.log('audio path', path)
// Dentro do seu topAudios.forEach...



    if (!player) {
      console.log('player created')
      player = new Audio(path);
      audioPlayersRef.current.set(clip.id, player);
    }

    // Time Synchronization
    const targetTime = (currentTime - clip.start) + (clip.beginmoment || 0);
    




    // It only synchronizes if the difference is greater than 100ms to avoid glitches.
    if (Math.abs(player.currentTime - targetTime) > 0.15 ) {
      player.currentTime = targetTime;
      
    }

    // Controle de Play/Pause
    if (isPlaying && player.paused) {
      player.load()
      player.play().catch(e => console.warn("Autoplay de áudio bloqueado:", e));
    } else if (!isPlaying && !player.paused) {
      player.pause();
    }

    
      
  })





}
*/


useEffect(() => {
  if (!topAudios || topAudios.length === 0 || !isPlaying) {
    audioPlayersRef.current.forEach(p => p.pause());
    return;
  }

  topAudios.forEach(clip => {
    let player = audioPlayersRef.current.get(clip.id);
    
    //images are filter in UpdateAudio so all videos are really videos no metter how knowTypeByAssetName is use
    const audio = `${clip.name.split('.').slice(0, -1).join('.')}.mp3`
    const path =  knowTypeByAssetName(clip.name) === 'video' ? `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/extracted_audios/${audio}`)}` :
    `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/videos/${clip.name}`)}`

    if (!player) {
      player = new Audio(path);
      audioPlayersRef.current.set(clip.id, player);
    }

    const targetTime = (currentTimeRef.current - clip.start) + (clip.beginmoment || 0);

    const syncAndPlay = () => {
      if (targetTime >= 0 && targetTime < player!.duration) {
        player!.currentTime = targetTime;
      }
      if (isPlaying) player!.play().catch(() => {});
    };

    //If the file header has already been loaded, skip to the correct time; otherwise, wait for the metadata.
    if (player.readyState >= 1) { 
      syncAndPlay();
    } else {
      
      player.addEventListener('loadedmetadata', syncAndPlay, { once: true });
    }
  });
}, [topAudios, isPlaying]);





useEffect(() => {
  setCurrentTime(playheadPos/pixelsPerSecond)
  
}, [playheadPos])




  const drawFrame = async (time: number) => {
    if (!canvasRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');


    if(!topClip)
    {
        if (ctx && canvasRef.current) {
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return
    }

    // time in miliseconds
    const clipTimeMs = ((time - topClip.start) + (topClip.beginmoment || 0)) * 1000;
    const path = `${currentProjectPath}/videos/${topClip.name}`;

//    console.log('current time', currentTime)
  //  console.log('cliptimems', clipTimeMs)

    try {
      // call function in rust to generate frames
      const frameBase64: string = await invoke('get_video_frame', { 
        path, 
        timeMs: clipTimeMs 
      });

      const img = new Image();
      img.onload = () => {
        if (canvasRef.current) {
            canvasRef.current.width = img.width;
            canvasRef.current.height = img.height;
            ctx?.drawImage(img, 0, 0);
        }
      };
      img.src = frameBase64;
         
    } catch (err) {
      console.error("Erro ao buscar frame:", err);
    }
  }



useEffect(() => {
  if (isPlaying) {
    updatePreview(currentTime);
    drawFrame(currentTime)
    updateAudio()

    


   

  }
}, [isPlaying, currentTime, clips]);







const lastUpdateRef = useRef<number>(0); // Acumulador para o controle de 10fps

const currentTimeRef = useRef(0);


const animate = (time: number) => {
  if (lastTimeRef.current !== null) {
    const deltaTime = (time - lastTimeRef.current) / 1000;
    
    // 1. Atualiza a REF (é aqui que o tempo realmente "anda")
    currentTimeRef.current += deltaTime;
    const currentPos = currentTimeRef.current * pixelsPerSecond;

    // 2. Move a agulha via DOM
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${currentPos}px)`;
    }




   
    // 3. Atualiza o estado do cronômetro apenas as vezes
    if (time - lastUpdateRef.current > 100) {
      setCurrentTime(currentTimeRef.current); 
      lastUpdateRef.current = time;
    }
  }
  lastTimeRef.current = time;
  requestRef.current = requestAnimationFrame(animate);
};

/*

const animate = (time: number) => {
  if (lastTimeRef.current !== null) {
    const deltaTime = (time - lastTimeRef.current) / 1000;
    
    // Atualizamos o valor REAL (acumulado) na Ref
    // Isso garante que o cálculo não se perca entre as renderizações
    playheadPosRef.current += deltaTime * PIXELS_PER_SECOND;

    // 3. O "Filtro" de 10 vezes por segundo (Throttling)
    if (time - lastUpdateRef.current > 100) { // 100ms = 10Hz
      
      // Agora sim, atualizamos o estado com o valor da Ref
      setPlayheadPos(playheadPosRef.current);
      
      lastUpdateRef.current = time;

      // Auto-scroll (pode ficar aqui dentro para economizar CPU)
      if (timelineContainerRef.current) {
        const container = timelineContainerRef.current;
        const scrollRight = container.scrollLeft + container.clientWidth;
        if (playheadPosRef.current > scrollRight - 50) {
          container.scrollLeft += 10; 
        }
      }
    }
  }
  
  lastTimeRef.current = time;
  requestRef.current = requestAnimationFrame(animate);
};



*/

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

      playheadRef.current.style.transform = `translateX${pixelsFromLeft * variation}px`;

      timelineContainerRef.current.scrollLeft = factor < 0 ? 0 : pixelsFromLeft

      
      return newZoom;
    });


  };



  useEffect(() => {
  // Whenever the zoom changes, we visually reposition the needle.
  if (playheadRef.current) {
    const currentPos = currentTimeRef.current * pixelsPerSecond;
    playheadRef.current.style.transform = `translateX(${currentPos}px)`;
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
  
  saveHistory(clips, assets);

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






  //undo and redo 

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
        duration: clip.duration + addedDuration 
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
        // Images don't progress in "internal time", so beginmoment only changes for videos
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
      handleResize(clipId, deltaX, side);
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
          e.preventDefault(); // stop o scroll page
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
      
      // 5. Synchronize audio for "Scrubbing" (optional)
      /*
      
      audioPlayersRef.current.forEach((player, id) => {
        const clip = tracks.flatMap(t => t.clips).find(c => c.id === id);
        if (clip) {
          // Calculate the internal audio time relative to the timeline position
          player.currentTime = (newTime - clip.start) + (clip.beginmoment || 0);
        }
      });
      */
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

  // Primeira parte: mantém o beginmoment original, mas encurta a duração
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


//avoid clip over another

/*
useEffect(() => {
  if (clips.length === 0) return;

  // 1. Identifica quais clipes precisamos validar:
  // Se houver selecionados, validamos eles. Se não, validamos apenas o último adicionado.
  const idsToValidate = selectedClipIds.length > 0 
    ? selectedClipIds 
    : [clips[clips.length - 1].id];

  let hasChanges = false;
  let newClips = [...clips];
  let newTracks = [...tracks];

  // 2. Processamos cada clipe da lista de validação
  idsToValidate.forEach(id => {
    const clipIndex = newClips.findIndex(c => c.id === id);
    if (clipIndex === -1) return;

    const clip = newClips[clipIndex];
    const assetType = knowTypeByAssetName(clip.name, true);
    
    // Normalização de tipo (audio asset -> audio track)
    const requiredType = assetType === 'audio' ? 'audio' : (assetType === 'image' ? 'video' : assetType);

    let currentTrackId = clip.trackId;
    let currentTrack = newTracks.find(t => t.id === currentTrackId);

    // 3. Loop de colisão e compatibilidade
    // Importante: isSpaceOccupied deve checar contra o novo estado 'newClips'
    while (isSpaceOccupied(currentTrackId, clip.start, clip.duration, clip.id) || (currentTrack && currentTrack.type !== requiredType)) {
      currentTrackId++;
      currentTrack = newTracks.find(t => t.id === currentTrackId);

      // Se a track não existe, criamos ela virtualmente para o loop continuar
      if (!currentTrack) {
        const newTask = { id: currentTrackId, type: requiredType as 'video' | 'audio' | 'effects' };
        newTracks.push(newTask);
        currentTrack = newTask;
        hasChanges = true;
      }
    }

    // Se o ID da track mudou, atualizamos no nosso array temporário
    if (currentTrackId !== clip.trackId) {
      newClips[clipIndex] = { ...clip, trackId: currentTrackId };
      hasChanges = true;
    }
  });

  // 4. Aplicação atômica do estado
  if (hasChanges) {
    // Ordenação para manter a lógica visual (Video topo, Audio baixo)
    setTracks(newTracks.sort((a, b) => {
      const priority = (t: string) => (t === 'audio' ? 1 : 0);
      return priority(a.type) - priority(b.type) || a.id - b.id;
    }));
    setClips(newClips);
  }
}, [clips.length, selectedClipIds]); */

// Usamos clips.length para disparar na criação e selectedClipIds para disparar no movimento

/*
useEffect(() => {
  if (clips.length === 0) return;

  const lastClip = clips[clips.length - 1];
  const lastClipType = knowTypeByAssetName(lastClip.name, true)

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
}, [clips]); // Importante: monitorar apenas o .length para evitar loop infinito ao mudar o trackId    

*/




/*
useEffect(() => {
  if (clips.length === 0) return;

  let hasChanged = false;
  let tempClips = [...clips];
  let tempTracks = [...tracks];

  // Percorremos todos os clips para garantir integridade total
  tempClips = tempClips.map((currentClip) => {
    const clipType = knowTypeByAssetName(currentClip.name, true);
    // Mapeia 'audio' do asset para 'music' ou 'audio' da track conforme sua interface
    const requiredTrackType = clipType === 'audio' ? 'audio' : 
                             (clipType === 'image' ? 'video' : clipType);

    let targetTrackId = currentClip.trackId;
    let finalTrackId = targetTrackId;

    // Loop de busca de track válida para este clip específico
    while (true) {
      const targetTrack = tempTracks.find(t => t.id === finalTrackId);
      
      // Verifica colisão: passamos o tempClips para o isSpaceOccupied 
      // (se sua função permitir) ou verificamos contra os clips já processados
      const collision = isSpaceOccupied(finalTrackId, currentClip.start, currentClip.duration, currentClip.id);
      
      const typeMismatch = targetTrack && targetTrack.type !== requiredTrackType;

      if (!collision && !typeMismatch) {
        // Se a track não existe, criamos ela virtualmente para o próximo clip saber que ela existe
        if (!targetTrack) {
          tempTracks.push({ 
            id: finalTrackId, 
            type: requiredTrackType as 'video' | 'audio' | 'effects' 
          });
          hasChanged = true;
        }
        break; 
      }

      // Se deu erro, pula para a próxima track
      finalTrackId++;
    }

    if (finalTrackId !== currentClip.trackId) {
      hasChanged = true;
      return { ...currentClip, trackId: finalTrackId };
    }

    return currentClip;
  });

  if (hasChanged) {
    // Ordenamos as tracks para manter a lógica visual (Video/Effects topo, Audio baixo)
    setTracks(tempTracks.sort((a, b) => {
      const priority = (t: string) => (t === 'audio' ? 1 : 0);
      return priority(a.type) - priority(b.type) || a.id - b.id;
    }));
    
    setClips(tempClips);
  }
}, [clips]); // Monitorar length evita loops infinitos de movimentação
*/








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


const createClipOnNewTrack =  async (assetName: string, dropTime: number) => {
    
  
  var meta;

  const path = `${currentProjectPath}/videos/${assetName}`
  
  try
  {
    meta = await invoke<{duration: number}>('get_video_metadata', { path: path });
    
  }
  catch (err)
  {
    meta = {duration: 10}
  }
    
    setTracks(  (prev) => 
      {
  
          const newTrackId = prev.length > 0 ? Math.max(...prev.map(t => t.id)) + 1 : 0; 
   
         
          const type = knowTypeByAssetName(assetName, true);

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
            color: getRandomColor(),
            trackId: newTrackId,
            maxduration: duration,
            beginmoment: deleteClip ? deleteClip.beginmoment : 0
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

  
  if (e.dataTransfer.files.length > 0) return;

  const assetName = e.dataTransfer.getData("assetName");
  if (!assetName) return;

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

  const timelineBounds = timelineContainerRef.current?.getBoundingClientRect();
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
            color: getRandomColor(),
            trackId: targetTrackId,
            maxduration: duration ? duration : 10,
            beginmoment: 0
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

      if (type !== 'image') {
        try {
          const meta = await invoke<{duration: number}>('get_video_metadata', { path: filePath });
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






      let thumbPath = "";
      if (type === 'image') {
        thumbPath = convertFileSrc(filePath);
      } else if (type === 'video') {
        thumbPath = await getThumbnail(currentProjectPath, filename, 2);
      }

      
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

    // 1. Find the maximum track ID securely.
    const maxTrackId = (parsed.clips || []).reduce((max, clip) => 
      clip.trackId > max ? clip.trackId : max, 
      0
    );

    // 2. Generate the array of tracks based on the {id, type} objects.
    const newTracks = Array.from({ length: maxTrackId + 1 }, (_, id) => {
      // Find the first clip of this track to determine the type.
      const firstClip = parsed.clips.find(c => c.trackId === id);

      // If the track has clips, it determines the type. If it's empty, it defaults to 'video'.
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
  
  // Take offset
  const clickOffset = parseFloat(e.dataTransfer.getData("clickOffset") || "0");
  
  const rect = e.currentTarget.getBoundingClientRect();
  const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
  
  // 1. Mouse position convert to time
  const mouseTime = (e.clientX - rect.left + 0) / pixelsPerSecond;
  
  // 2. The actual drop time is the mouse minus where "grabbed" the clip.
  const rawDropTime = mouseTime - clickOffset; 
  
  const dropTime = getSnappedTime(rawDropTime, deleteClipId, trackId);

    


  saveHistory(clips, assets);

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
        trackId: targetTrack
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


    
    if(!isBusy || !isNotType)
    {
       const newClip: Clip = {
          id: crypto.randomUUID(), 
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

    if(type != 'video')
    {
       try {
          const audioName = await invoke('extract_audio', { 
            projectPath: currentProjectPath, 
            fileName: fileName 
          });
          //console.log("Audio extracted", audioName);
        } catch (e) {
          console.error("Falha na extração automática:", e);
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
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400" title='Post in social media'><Share2 size={16}/></button>
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400" title='Settings'><Settings size={16}/></button>
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400" title='Export video' onClick={()=> { startExport();}}><Import size={16}/></button>
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




              {/* Search Bar Container */}
              <div className="relative mb-6 group">
                {/* Ícone de Lupa */}
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  <Search 
                    size={16} 
                    className={`transition-colors duration-300 ${
                      searchQuery ? 'text-red-500' : 'text-zinc-500 group-focus-within:text-red-400'
                    }`} 
                  />
                </div>

                {/* Input Estilizado */}
                <input
                  type="text"
                  placeholder="Search assets (video, audio, images...)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-3 w-full bg-[#161616]/50 backdrop-blur-xl border border-white/5 rounded-2xl py-3 pl-12 pr-12 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-red-600/30 focus:bg-[#1a1a1a] transition-all duration-300"
                />

                {/* Search Query */}
                <AnimatePresence>
                  {searchQuery && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      onClick={() => setSearchQuery("")}
                      className="absolute inset-y-0 right-4 flex items-center text-zinc-500 hover:text-white transition-colors"
                    >
                      <X size={14} />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>

                  {filteredAssets.length > 0 ? (
                    filteredAssets.map((asset, index) => (
                      <motion.div
                        key={asset.path} 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        onClick={(e) => toggleAssetSelection(asset, e.shiftKey || e.ctrlKey)}
                        className={`group relative aspect-video bg-[#1a1a1a] rounded-lg overflow-hidden border border-white/5 hover:border-red-600/50 transition-colors cursor-pointer
                        ${selectedAssets.includes(asset) ? 'bg-red-500/10 border-red-500' : 'bg-[#151515] border-zinc-800 hover:border-zinc-600'}`}
                        draggable="true"
                        onDragStart={(e) => handleDragStart(e, null, null, null, asset.name, false, null)}
                      >
                        {/* Thumbnail: Only for not audio (video and images ) */}
                        {asset.type !== 'audio' && asset.thumbnailUrl && (
                          <img 
                            src={asset.thumbnailUrl} 
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            alt={asset.name}
                          />
                        )}

                        {/* For Audio */}
                        {asset.type === 'audio' && (
                          <div className="absolute inset-0 flex items-center justify-center bg-[#121212]">
                            <Music 
                              size={48} 
                              className="text-gray-600 transition-colors duration-300 group-hover:text-red-600" 
                            />
                          </div>
                        )}

                        {/* Gradient Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 opacity-100" />

                        {/* Duration Badge (Don't show for images) */}
                        {asset.type !== 'image' && asset.duration && (
                          <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-mono text-white">
                            {formatTime(asset.duration)}
                          </div>
                        )}

                        {/* Icon Type */}
                        <div className="absolute top-2 left-2 p-1 bg-black/50 backdrop-blur-sm rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
                          {asset.type === 'video' && <Play size={12} className="text-white" />}
                          {asset.type === 'audio' && <Music size={12} className="text-white" />}
                          {asset.type === 'image' && <ImageIcon size={12} className="text-white" />}
                        </div>

                        {/* File Name */}
                        <div className="absolute bottom-2 left-2 right-12 opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="text-[10px] text-white truncate font-medium drop-shadow-lg" contentEditable
                          suppressContentEditableWarning={true}
                          onDoubleClick={(e) => {
                            // Ensures that text is selected when double-clicking.
                            e.stopPropagation();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              (e.target as HTMLElement).blur(); //  onBlur
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
                          }}>
                            {asset.name}
                          </p>
                        </div>
                      </motion.div>
                    )) 
                  ) : (
                    /* Empty State */
                    <div className="col-span-full py-20 text-center">
                      <Search size={48} className="mx-auto text-zinc-800 mb-4" />
                      <p className="text-zinc-500 text-sm italic">No assets match your search...</p>
                    </div>
                  )}
              
     
            </div>
          </aside>

          {/* PREVIEW PLAYER */}
          <section className="flex-1 bg-black flex flex-col items-center justify-center p-8 relative">
            



              
                <div 
                  className="w-full max-w-4xl aspect-video bg-[#050505] rounded-xl border border-zinc-800 flex items-center justify-center relative group cursor-pointer overflow-hidden shadow-2xl"
                  onClick={togglePlay}
                  >
                   

                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain" />
                   
                    
                    
                    
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
        setPlayheadPos(newPos);
        currentTimeRef.current = playheadPos/pixelsPerSecond
        seekTo(currentTimeRef.current);

        
        
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
      className="absolute top-0 bottom-0 w-[2px] bg-red-600 z-[100] pointer-events-none transition-transform duration-75 ease-out" 
      style={{ left: asidetrackwidth + 15 }} // +8 por causa do padding p-2 do container

    >
        {/* Needle head (Triangle or Circle) */}
        <div onMouseDown={handlePlayheadMouseDown}  className="w-4 h-4 bg-red-600 rounded-b-full shadow-[0_0_10px_rgba(220,38,38,0.5)] -ml-[7px]" />
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
  .map((track) => (
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
        </div>

        {/* DROPS AREA: Where is the Clips stay */}
        <div 
          onDragOver={handleDragOver}
          onDrop={(e) => handleDropOnTimeline(e, track.id)}
          className="relative flex-1 bg-zinc-900/10 border border-zinc-800/20 rounded-md hover:bg-zinc-900/20 transition-colors min-w-[10000px]"
          style={{ height: '64px' }}
        >
          {/* Clips filtrados por track.id */}
          {clips.filter(c => Number(c.trackId) === Number(track.id)).map((clip) => {
            

            const cacheKey = `${clip.id}-${clip.beginmoment}-${clip.duration}`;
            const thumbs = timelineThumbs[cacheKey];
            const assetTarget = assets.find( a => a.name === clip.name)

            let margintitle = pixelsPerSecond > 30 ? -15 : -15
            const iconSize = pixelsPerSecond > 30 ? 17 : 17


            margintitle = pixelsPerSecond > 50 ? 30 : margintitle



            
            return (
              <motion.div 
              key={clip.id} layoutId={clip.id}
              draggable="true"
              onDragStart={(e) => handleDragStart(e, clip.color, track.id, clip.duration, clip.name, true, clip.id)}
              onClick={(e) => { e.stopPropagation(); toggleClipSelection(clip.id, e.shiftKey || e.ctrlKey); }}
              className={`absolute  inset-y-1.5 ${clip.color} rounded-md flex items-center shadow-lg cursor-grab active:cursor-grabbing border-2 ${
                selectedClipIds.includes(clip.id) ? 'border-white ring-4 ring-white/10 z-30' : 'border-black/20'
              }`}
              style={{
                left: clip.start * pixelsPerSecond,
                width: clip.duration * pixelsPerSecond,
              }}
            >
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

    <AnimatePresence>
  {renderStatus === 'rendering' && (
    <motion.div className="fixed inset-0 z-[600] bg-[#050505]/95 backdrop-blur-2xl flex flex-col items-center justify-center">
      <div className="w-80 space-y-8 text-center">
        
        {/* Progress UI */}
        <div className="space-y-2">
           <div className="relative h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-red-600 shadow-[0_0_20px_rgba(220,38,38,0.8)]"
                initial={{ width: "0%" }}
                animate={{ width: `${renderPercent}%` }}
              />
            </div>
            <p className="text-zinc-500 text-[9px] font-mono tracking-widest uppercase">
              Rendering Master: {renderPercent}%
            </p>
        </div>

        {/* [English Comment] Cancel Button Implementation */}
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
  </div>
);
}