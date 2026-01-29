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
  
  
  const currentProjectPath = localStorage.getItem("current_project_path");
  const timelineRef = useRef<HTMLDivElement>(null);

  // --- TAURI V2 NATIVE DRAG & DROP LISTENER ---
// 1. Add this ref to your Timeline container div in the JSX later
const timelineContainerRef = useRef<HTMLDivElement>(null);

// 2. Updated Native Listener
useEffect(() => {
  let unlisten: any;

  const setupDropListener = async () => {
    unlisten = await getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        const { paths, position } = event.payload;
        
        // Buscamos onde a timeline está na tela no momento do drop
        const timelineBounds = timelineContainerRef.current?.getBoundingClientRect();
        
        // Se a posição Y do mouse estiver dentro da área da timeline
        const isTimelineZone = timelineBounds && 
                               position.y >= timelineBounds.top && 
                               position.y <= timelineBounds.bottom;

        console.log("Native Drop - Zone:", isTimelineZone ? "Timeline" : "Assets");
        
        handleNativeDrop(paths, position.x, isTimelineZone, timelineBounds);
      }
    });
  };

  if (!isSetupOpen) setupDropListener();
  
  return () => { if (unlisten) unlisten().then((f: any) => f); };
}, [isSetupOpen, currentProjectPath]);

// Função centralizada para lidar com arquivos do SO
const handleNativeDrop = async (paths: string[], mouseX: number, isTimeline: boolean, bounds?: DOMRect) => {
  if (!currentProjectPath) return;

  for (const path of paths) {
    try {
      // 1. Rust importa o arquivo para a pasta do projeto
      await invoke('import_asset', { projectPath: currentProjectPath, filePath: path });
      const fileName = path.split(/[\\/]/).pop() || "Asset";

      // 2. Se caiu na timeline, adicionamos o clip
      if (isTimeline && bounds) {
        const scrollLeft = timelineContainerRef.current?.scrollLeft || 0;
        const relativeX = mouseX - bounds.left + scrollLeft;
        const dropTime = relativeX / PIXELS_PER_SECOND;

        setClips(prev => [...prev, {
          id: Date.now() + Math.random(),
          name: fileName,
          start: dropTime,
          duration: 10,
          color: 'bg-blue-600' // Clips externos azuis
        }]);
      }
    } catch (err) {
      console.error("Native Import Error:", err);
    }
  }
  loadAssets(); // Atualiza a lista lateral
  showNotify("Media Processed", "success");
};
  
  // Process to prevent WebView from opening the file as a URL
  useEffect(() => {
  const preventDefault = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // This prevents the browser from opening the file as a URL
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

  const openProject = (path: string) => {
    localStorage.setItem("current_project_path", path);
    setIsSetupOpen(false);
  };

  const handleDeleteProject = async () => {
    if (projectToDelete) {
      try {
        await invoke('delete_project', { path: projectToDelete.path });
        setProjectToDelete(null);
        loadProjects();
        showNotify("Project Deleted", "success");
      } catch (e) { showNotify("Delete failed", "error"); }
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

  const handleDragStart = (e: React.DragEvent, assetName: string) => {
    e.dataTransfer.setData("assetName", assetName);
    e.dataTransfer.effectAllowed = "copy";
  };

 
  const handleDropOnTimeline = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    console.log('oi')
    console.log(e.dataTransfer)
    
    const assetName = e.dataTransfer.getData("assetName");
    if (assetName) {
      const rect = e.currentTarget.getBoundingClientRect();
      const scrollLeft = e.currentTarget.closest('.overflow-x-auto')?.scrollLeft || 0;
      const x = e.clientX - rect.left + scrollLeft;

      setClips(prev => [...prev, {
        id: Date.now(),
        name: assetName,
        start: x / PIXELS_PER_SECOND,
        duration: 10,
        color: 'bg-red-600'
      }]);
    }
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

  useEffect(() => { if (rootPath) loadProjects(); }, [rootPath]);
  useEffect(() => { if (!isSetupOpen && currentProjectPath) loadAssets(); }, [isSetupOpen]);

  // --- RENDER ---

  return (
    <div className="flex flex-col h-screen w-screen bg-black text-zinc-300 font-sans overflow-hidden">
      
      {/* Notifications */}
      <AnimatePresence>
        {notification && (
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[500] px-6 py-3 rounded-full font-bold text-xs shadow-2xl flex items-center gap-3 border ${
              notification.type === 'success' ? 'bg-zinc-900 border-green-500/50 text-green-400' : 'bg-zinc-900 border-red-500/50 text-red-400'
            }`}>
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
                  <motion.div key={proj.path} whileHover={{ scale: 1.02 }} onClick={() => openProject(proj.path)}
                    className="group bg-[#121212] border border-zinc-800/50 rounded-2xl overflow-hidden cursor-pointer hover:border-red-600 transition-all relative">
                    <button onClick={(e) => { e.stopPropagation(); setProjectToDelete(proj); }}
                      className="absolute top-2 right-2 z-50 p-2 bg-black/50 hover:bg-red-600 text-zinc-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
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
              <button onClick={() => setIsSetupOpen(true)} className="text-zinc-500 hover:text-white text-[10px] font-bold">BACK</button>
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
                <div onClick={handleImportFile}  className="aspect-video border border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center group cursor-pointer hover:bg-zinc-900/50">
                  <Plus size={20} className="text-zinc-700 group-hover:text-red-500" />
                  <h2 className="text-[10px] font-black text-zinc-500 uppercase"> Import Media </h2>
                </div>
                 {assets.map((asset, index) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={index}
                    className="bg-[#151515] border border-zinc-800 p-2 rounded-lg flex items-center gap-3 group hover:border-zinc-600 transition-all cursor-grab active:cursor-grabbing"
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, asset)}
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

          {/* Timeline Footer */}
          <footer className="h-80 bg-[#0c0c0c] border-t border-zinc-800 flex flex-col z-20">
            <div className="h-10 border-b border-zinc-900 flex items-center px-4 justify-between bg-[#0e0e0e]">
              <div className="flex items-center gap-6">
                <button className="flex items-center gap-2 text-[10px] font-black text-zinc-500 hover:text-red-500 uppercase"><Scissors size={14}/> Split</button>
                <div className="text-[10px] font-mono text-zinc-400">POS: <span className="text-white">{(playheadPos / PIXELS_PER_SECOND).toFixed(2)}s</span></div>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto relative bg-[#080808]" ref={timelineContainerRef}>
              <div className="h-7 border-b border-zinc-900 sticky top-0 bg-[#080808]/80 backdrop-blur-md z-30" onClick={handleRulerClick}>
                {[...Array(60)].map((_, i) => (
                  <div key={i} className="absolute border-l border-zinc-800 h-full text-[8px] pl-2 pt-1.5 text-zinc-700 font-mono" style={{left: i * 20 * PIXELS_PER_SECOND}}>{i * 20}s</div>
                ))}
              </div>

              <div className="p-4 min-w-[6000px] relative h-full">
                 <div className="absolute top-0 bottom-0 w-[1px] bg-red-600 z-40" style={{left: playheadPos + 16}} />
                 <div className="h-16 bg-zinc-900/10 border border-zinc-800/50 rounded-xl mb-3 relative overflow-hidden" 
                   onDrop={handleDropOnTimeline} // This handles SIDEBAR assets
                   >
                    {clips.map((clip) => (
                      <motion.div key={clip.id} drag="x" dragMomentum={false}
                        className={`absolute inset-y-2 ${clip.color} border-x border-white/20 rounded-lg flex items-center px-4 cursor-grab shadow-2xl`}
                        style={{ width: clip.duration * PIXELS_PER_SECOND, left: clip.start * PIXELS_PER_SECOND }}>
                        <span className="text-[10px] font-black text-white truncate uppercase">{clip.name}</span>
                      </motion.div>
                    ))}
                 </div>
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


      {/* --- DELETE CONFIRMATION MODAL --- */}
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