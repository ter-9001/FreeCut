import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Scissors, Plus, Play, SkipBack, Youtube, 
  Settings, Share2, FolderOpen, Save, X 
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { LayoutGrid, List, Clock } from 'lucide-react';

interface Project {
  name: string;
  path: string;
}


/**
 * Interface for Video/Audio clips on the timeline
 */
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
  // Notification state
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  // Dentro do componente App
  const [assets, setAssets] = useState<string[]>([]);
  const currentProjectPath = localStorage.getItem("current_project_path");
  const [isDownloading, setIsDownloading] = useState(false);
  // Fuction activated when you do the drag
  const handleDragStart = (e: React.DragEvent, assetName: string) => {
    e.dataTransfer.setData("assetName", assetName);
  };

  // Function for TImeline accept drop
  const handleDropOnTimeline = (e: React.DragEvent) => {
    e.preventDefault();
    console.log("Drop detectado!");
    const assetName = e.dataTransfer.getData("assetName");
    
    if (assetName) {
      const newClip: Clip = {
        id: Date.now(),
        name: assetName,
        start: playheadPos / PIXELS_PER_SECOND, // Coloca onde a agulha está
        duration: 10, // Duração padrão inicial de 10 segundos
        color: 'bg-red-600'
      };
      
      setClips([...clips, newClip]);
      showNotify("Clip added to timeline", "success");
    }
  };

const handleDragOver = (e: React.DragEvent) => {
  e.preventDefault(); // Necessário para permitir o drop
    console.log("Drag over detectado!");

  e.dataTransfer.dropEffect = "copy"; // Opcional: muda o ícone do mouse para um '+'
};

  //Function to Invoke the Youtube Download function
  const handleYoutubeDownload = async () => {
    if (!youtubeUrl || !currentProjectPath) return;

    setIsDownloading(true);
    showNotify("Starting download...", "success");

    try {
      await invoke('download_youtube_video', { 
        projectPath: currentProjectPath, 
        url: youtubeUrl 
      });
      
      showNotify("Download finished!", "success");
      setIsImportModalOpen(false);
      setYoutubeUrl("");
      loadAssets(); // Atualiza a lista de arquivos automaticamente
    } catch (e) {
      showNotify("Download failed. Check your link. "+e, "error");
      console.error(e);
    } finally {
      setIsDownloading(false);
    }
  };

  // Carregar assets quando abrir o projeto
  useEffect(() => {
    if (!isSetupOpen && currentProjectPath) {
      loadAssets();
    }
  }, [isSetupOpen]);

  const loadAssets = async () => {
    try {
      const list = await invoke('list_assets', { projectPath: currentProjectPath });
      setAssets(list as string[]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleImportFile = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Video/Audio', extensions: ['mp4', 'mov', 'mkv', 'mp3', 'wav'] }]
      });

      if (selected && Array.isArray(selected)) {
        for (const path of selected) {
          await invoke('import_asset', { projectPath: currentProjectPath, filePath: path });
        }
        showNotify("Files imported!", "success");
        loadAssets();
      }
    } catch (e) {
      showNotify("Error importing files", "error");
    }
  };

  // Function to Delete Project
  const handleDeleteProject = async () => {
    if (projectToDelete) {
      try {
        await invoke('delete_project', { path: projectToDelete.path });
        showNotify("Project deleted", "success");
        setProjectToDelete(null);
        loadProjects(); // Recarrega a lista
      } catch (e) {
        showNotify("Error deleting project", "error");
      }
    }
  };

  // Function to trigger a notification that disappears after 3 seconds
  const showNotify = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };
  
  // Example clips for UI testing
  const [clips, setClips] = useState<Clip[]>([
    { id: 1, name: 'Sample_Video.mp4', start: 50, duration: 120, color: 'bg-indigo-600' }
  ]);

  const timelineRef = useRef<HTMLDivElement>(null);

  // --- HANDLERS ---

  /**
   * Opens a native OS dialog to select the root workspace folder
   */
  const handleSelectRoot = async () => {
  
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Projects Workspace"
    });
    
    // In Tauri v2, 'selected' can be null if cancelled, or a string
    if (selected) {
      setRootPath(selected as string);
    }
  
};

  /**
   * Calls Rust to create the physical project structure and saves preferences
   */
 const handleFinishSetup = async () => {
  if (rootPath && projectName) {
    try {
      const finalPath = await invoke('create_project_folder', { 
        rootPath, 
        projectName 
      });
      
      localStorage.setItem("current_project_path", finalPath as string);
      setIsCreatingNew(false);
      loadProjects(); // Refresh the list
      showNotify("Project created successfully!", "success");
    } catch (e: any) {
      if (e === "PROJECT_EXISTS") {
        showNotify("A project with this name already exists!", "error");
      } else {
        showNotify("Failed to create project folders.", "error");
      }
    }
  }
};

  const handleRulerClick = (e: React.MouseEvent) => {
    if (timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setPlayheadPos(x);
    }
  };


  
  // Load projects whenever rootPath changes
  useEffect(() => {
    if (rootPath) {
      loadProjects();
    }
  }, [rootPath]);

  const loadProjects = async () => {
    try {
      const list = await invoke('list_projects', { rootPath });
      setProjects(list as Project[]);
    } catch (e) {
      console.error(e);
    }
  };

  const openProject = (path: string) => {
    localStorage.setItem("current_project_path", path);
    setIsSetupOpen(false);
  };

  return (
  <div className="flex flex-col h-screen w-screen bg-black text-zinc-300 font-sans overflow-hidden">
    
    {/* --- GLOBAL NOTIFICATIONS --- */}
    <AnimatePresence>
      {notification && (
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[500] px-6 py-3 rounded-full font-bold text-xs shadow-2xl flex items-center gap-3 border ${
            notification.type === 'success' 
              ? 'bg-zinc-900 border-green-500/50 text-green-400' 
              : 'bg-zinc-900 border-red-500/50 text-red-400'
          }`}
        >
          <div className={`w-2 h-2 rounded-full ${notification.type === 'success' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          {notification.message.toUpperCase()}
        </motion.div>
      )}
    </AnimatePresence>
    {/* --- PROJECT MANAGER VIEW --- */}
    {isSetupOpen ? (
      <div className="flex flex-col h-full w-full bg-[#0a0a0a]">
        {/* Dashboard Header */}
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-8 bg-[#111]">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center font-black text-white shadow-lg shadow-red-900/20">FC</div>
            <h1 className="text-lg font-bold tracking-tighter italic text-white">FREECUT <span className="text-zinc-500 font-light text-sm not-italic">MANAGER</span></h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-all">
              <Settings size={20} />
            </button>
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <aside className="w-64 border-r border-zinc-800 p-6 space-y-2 bg-[#0d0d0d]">
            <button className="w-full flex items-center gap-3 px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-bold shadow-sm">
              <Clock size={18} /> Recent Projects
            </button>
            <button 
              onClick={handleSelectRoot}
              className="w-full flex items-center gap-3 px-4 py-2 hover:bg-zinc-900 text-zinc-500 hover:text-zinc-300 rounded-lg text-sm transition-colors"
            >
              <FolderOpen size={18} /> Change Workspace
            </button>
          </aside>

          {/* Projects List Section */}
          <section className="flex-1 p-10 overflow-y-auto bg-gradient-to-br from-[#0a0a0a] to-[#0f0f0f]">
            <div className="flex justify-between items-end mb-10">
              <div>
                <h2 className="text-3xl font-black text-white tracking-tight mb-1">Your Productions</h2>
                <p className="text-zinc-600 text-[10px] font-mono uppercase tracking-[0.3em]">{rootPath || 'Please select a workspace folder'}</p>
              </div>
              <button 
                onClick={() => setIsCreatingNew(true)}
                className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-xl font-black text-xs flex items-center gap-2 transition-all shadow-xl shadow-red-900/40 active:scale-95"
              >
                <Plus size={20} strokeWidth={3} /> NEW PROJECT
              </button>
            </div>

            {/* Grid display */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {projects.length > 0 ? (
                projects.map((proj) => (
                  <motion.div 
                    key={proj.path}
                    whileHover={{ scale: 1.02, y: -4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => openProject(proj.path)}
                    className="group bg-[#121212] border border-zinc-800/50 rounded-2xl overflow-hidden cursor-pointer hover:border-red-600 transition-all shadow-lg"
                  >
                    {/* BOTÃO EXCLUIR (Aparece no hover) */}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation(); // Impede de abrir o projeto ao clicar na lixeira
                        setProjectToDelete(proj);
                      }}
                      className="absolute top-2 right-2 z-50 p-2 bg-black/50 hover:bg-red-600 text-zinc-400 hover:text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <X size={14} /> {/* Ou use Trash2 da lucide-react */}
                    </button>
                    <div className="aspect-video bg-[#1a1a1a] flex items-center justify-center border-b border-zinc-800 group-hover:bg-zinc-900 transition-colors relative">
                      <LayoutGrid size={40} className="text-zinc-800 group-hover:text-red-600/20 transition-all" />
                      <div className="absolute inset-0 bg-red-600/0 group-hover:bg-red-600/5 transition-colors" />
                    </div>
                    <div className="p-5">
                      <h3 className="font-bold text-zinc-100 truncate text-sm uppercase tracking-tight group-hover:text-white">{proj.name}</h3>
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-[9px] text-zinc-600 font-black uppercase tracking-widest">Local Project</span>
                        <div className="text-[10px] text-zinc-500 font-mono italic">v1.0</div>
                      </div>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="col-span-full py-32 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800/50 rounded-[2.5rem] bg-zinc-900/10">
                  <div className="p-4 bg-zinc-900/50 rounded-full mb-4">
                    <FolderOpen size={32} className="text-zinc-700" />
                  </div>
                  <p className="text-zinc-600 font-bold uppercase tracking-widest text-xs">No projects found in this directory</p>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    ) : (
      /* --- EDITOR VIEW (Active Project) --- */
      <div className="flex flex-col h-full animate-in fade-in duration-500">
        <header className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 bg-[#111] z-10 shadow-md">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSetupOpen(true)} 
              className="group flex items-center gap-2 text-zinc-500 hover:text-white transition-all text-[10px] font-bold"
            >
              <SkipBack size={16} className="group-hover:-translate-x-1 transition-transform" /> 
              <span>BACK TO HOME</span>
            </button>
            <div className="h-4 w-[1px] bg-zinc-800" />
            <h1 className="text-[11px] font-black tracking-widest uppercase text-white">{projectName}</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all active:scale-95 shadow-lg shadow-red-900/20"
            >
              <Youtube size={14} /> IMPORT
            </button>
            <button className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400"><Share2 size={16}/></button>
          </div>
        </header>

        {/* Media Center */}
        <main className="flex-1 flex overflow-hidden">
          <aside className="w-64 border-r border-zinc-800 bg-[#0c0c0c] flex flex-col hidden lg:flex">
            <div className="p-4 border-b border-zinc-900 flex justify-between items-center">
              <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Project Assets</h2>
              <span className="text-[10px] text-zinc-700 font-mono">{assets.length} items</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-zinc-900">
              <div className="grid grid-cols-1 gap-3">
                {/* Botão DROP MEDIA */}
                <div 
                  onClick={handleImportFile}
                  className="aspect-video bg-zinc-900/30 border border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center group cursor-pointer hover:bg-zinc-900/50 hover:border-red-600/50 transition-all"
                >
                  <Plus size={20} className="text-zinc-700 group-hover:text-red-500 mb-2 transition-colors" />
                  <span className="text-[9px] font-black text-zinc-700 group-hover:text-zinc-400 uppercase tracking-tighter">Import Media</span>
                </div>

                {/* Lista Dinâmica de Assets */}
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
            </div>
          </aside>

          <section className="flex-1 bg-black flex flex-col items-center justify-center p-8">
            <div className="w-full max-w-4xl aspect-video bg-[#050505] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-zinc-800 flex items-center justify-center group relative overflow-hidden">
               <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
               <Play size={56} className="text-white/5 group-hover:text-white/30 transition-all cursor-pointer hover:scale-110 drop-shadow-2xl" />
            </div>
            
            <div className="mt-8 flex items-center gap-8 bg-[#111] px-8 py-3 rounded-full border border-zinc-800/50 shadow-xl">
               <button className="text-zinc-600 hover:text-white transition-colors"><SkipBack size={24}/></button>
               <button className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 transition-all shadow-white/10 shadow-2xl active:scale-95"><Play fill="black" size={24}/></button>
               <button className="text-zinc-600 hover:text-white transition-colors rotate-180"><SkipBack size={24}/></button>
            </div>
          </section>
        </main>

        {/* Pre- Timeline */}
        <footer className="h-80 bg-[#0c0c0c] border-t border-zinc-800 flex flex-col z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.3)]">
          <div className="h-10 border-b border-zinc-900 flex items-center px-4 justify-between bg-[#0e0e0e]">
            <div className="flex items-center gap-6">
              <button className="flex items-center gap-2 text-[10px] font-black text-zinc-500 hover:text-red-500 transition-colors uppercase tracking-widest"><Scissors size={14}/> Split</button>
              <div className="h-4 w-[1px] bg-zinc-800" />
              <div className="text-[10px] font-mono text-zinc-400">POS: <span className="text-white">{(playheadPos / PIXELS_PER_SECOND).toFixed(2)}s</span></div>
            </div>
            <div className="text-[11px] font-mono text-red-500 font-black bg-red-500/5 px-4 py-1 rounded-full border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]" >
              00:00:{Math.floor(playheadPos / PIXELS_PER_SECOND).toString().padStart(2, '0')}
            </div>
          </div>

          {/*Timeline*/}

          <div className="flex-1 overflow-x-auto relative bg-[#080808] scrollbar-thin scrollbar-thumb-zinc-800" >
            <div className="h-7 border-b border-zinc-900 sticky top-0 bg-[#080808]/80 backdrop-blur-md z-30 cursor-crosshair" onClick={handleRulerClick} >
              {[...Array(60)].map((_, i) => (
                <div key={i} className="absolute border-l border-zinc-800 h-full text-[8px] pl-2 pt-1.5 text-zinc-700 font-mono font-bold" style={{left: i * 20 * PIXELS_PER_SECOND}}>
                  {i * 20}s
                </div>
              ))}
            </div>

            <div className="p-4 min-w-[6000px] relative h-full" >
               {/* Playhead Indicator */}
               <div className="absolute top-0 bottom-0 w-[1px] bg-red-600 z-40 shadow-[0_0_10px_red] pointer-events-none" style={{left: playheadPos + 16}}>
                 <div className="w-2.5 h-2.5 bg-red-600 rounded-full -ml-[4.5px] -mt-0.5 shadow-lg pointer-events-none" />
               </div>

               <div className="h-16 bg-zinc-900/10 border border-zinc-800/50 rounded-xl mb-3 relative overflow-hidden group" onDragOver={handleDragOver}
  onDrop={handleDropOnTimeline}>
                  {clips.map((clip) => (
                    <motion.div 
                      key={clip.id} drag="x" dragMomentum={false}
                      className={`absolute inset-y-2 ${clip.color} border-x border-white/20 rounded-lg flex items-center px-4 cursor-grab active:cursor-grabbing shadow-2xl active:brightness-125 transition-all`}
                      style={{ width: clip.duration * PIXELS_PER_SECOND, left: clip.start * PIXELS_PER_SECOND }}
                    >
                      <span className="text-[10px] font-black text-white truncate uppercase italic tracking-tighter">{clip.name}</span>
                    </motion.div>
                  ))}
               </div>
               
               <div className="h-12 bg-zinc-900/5 border border-dashed border-zinc-800/30 rounded-xl flex items-center px-6 group hover:bg-zinc-900/10 transition-colors">
                  <Plus size={14} className="text-zinc-800 group-hover:text-zinc-600" />
                  <span className="text-[10px] text-zinc-800 group-hover:text-zinc-600 ml-4 font-black uppercase tracking-[0.2em]">Add Audio Layer</span>
               </div>
            </div>
          </div>
        </footer>
      </div>
    )}
{/* --- NEW PROJECT MODAL --- */}
    <AnimatePresence>
      {isCreatingNew && (
        <div className="fixed inset-0 bg-black/95 z-[300] flex items-center justify-center p-4 backdrop-blur-xl">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }} 
            animate={{ scale: 1, opacity: 1 }} 
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-[#121212] border border-zinc-800 p-10 rounded-3xl w-full max-w-sm shadow-2xl"
          >
            <h2 className="text-2xl font-black mb-2 text-white italic tracking-tighter">NEW PROJECT</h2>
            <p className="text-zinc-500 text-[10px] uppercase tracking-widest mb-8">Define your production name</p>
            <div className="space-y-6">
              <input 
                type="text" 
                placeholder="Project Title" 
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-4 text-white font-bold outline-none focus:border-red-600 transition-all shadow-inner"
              />
              <div className="flex gap-4">
                <button 
                  onClick={() => setIsCreatingNew(false)} 
                  className="flex-1 py-4 text-[10px] font-black text-zinc-500 hover:text-white transition-all uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleFinishSetup}
                  className="flex-1 bg-red-600 hover:bg-red-700 py-4 rounded-2xl font-black text-xs text-white shadow-lg shadow-red-900/20 transition-all uppercase"
                >
                  Create
                </button>
              </div>
            </div>
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

    {/* --- IMPORT YT MODAL --- */}
      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 bg-black/90 z-[400] flex items-center justify-center p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ y: 20, opacity: 0 }} 
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="bg-[#18181b] border border-zinc-800 p-8 rounded-3xl w-full max-w-md"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black flex items-center gap-3 italic text-white">
                  <Youtube className="text-red-600" /> IMPORT
                </h2>
                <button onClick={() => setIsImportModalOpen(false)} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-500">
                  <X size={18}/>
                </button>
              </div>
              <input 
                type="text" 
                placeholder="https://youtube.com/..." 
                value={youtubeUrl} 
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-4 text-sm font-bold outline-none focus:border-red-600 mb-6 text-white"
              />
              <button 
                disabled={isDownloading}
                onClick={handleYoutubeDownload}
                className={`w-full py-4 rounded-xl font-black text-xs transition-all shadow-xl uppercase tracking-widest text-white ${
                  isDownloading ? 'bg-zinc-800 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 shadow-red-900/20'
                }`}
              >
                {isDownloading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    DOWNLOADING...
                  </div>
                ) : (
                  "Fetch Media"
                )}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
  </div>
);
}