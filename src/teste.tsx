   Faça a lógica da agulha funcionar, pois ela está bulgada. Não consigo move-la ao tocar na rule, e ela não aparece por completo


     {/* Timeline Layout Container */}
<div className="flex flex-col bg-black/20 rounded-xl border border-white/5 overflow-hidden">
  
  {/* Header da Timeline (Opcional, para alinhar com o tempo) */}
  <div className="flex">
    <div className="w-48 shrink-0 border-r border-white/5 bg-zinc-900/50" /> {/* Espaço acima do aside */}
    <div className="flex-1 relative h-6 border-b border-white/5">
       {[...Array(150)].map((_, i) => {
                const timeInSeconds = i * 5;
                return (
                  <div key={i} className="absolute border-l border-zinc-800/50 h-full text-[8px] pl-1 pt-0.5 text-zinc-600 font-mono" style={{ left: timeInSeconds * pixelsPerSecond }}>
                    {timeInSeconds % 30 === 0 ? formatTime(timeInSeconds) : ''}
                    <div className="absolute top-0 left-0 h-1.5 border-l border-zinc-700" />
                  </div>
                );
        })}

        {/* Playhead Vertical Line [Needle] */}
        <div ref={playheadRef} className="absolute top-0 bottom-0 w-[1px] bg-red-600/60 z-[58] pointer-events-none" style={{ left: playheadPos }}>
            <div className="w-3 h-3 bg-red-600 rounded-full -ml-[5.5px] -mt-1.5 shadow-[0_0_10px_rgba(220,38,38,0.8)]" />
        </div>

       
    </div>




   
</div>

  <div className="flex flex-col p-2 gap-1.5 overflow-x-auto custom-scrollbar">

      

    {tracks.sort(

            (a, b) => {
    // Definimos pesos: Video/Effects = 0 (topo), Audio = 1 (baixo)
    const priority = (type: string) => (type === 'audio' ? 1 : 0);

    const pA = priority(a.type);
    const pB = priority(b.type);

    if (pA !== pB) {
      return pA - pB; // Se os tipos forem diferentes, ordena pelo peso
    }
    return a.id - b.id; // Se o tipo for igual, ordena pelo ID original
  }).map((track) => (
      <div key={track.id} className="flex gap-2 group">
        
        {/* ASIDE: Controles da Track */}
        <div className="w-48 shrink-0 bg-zinc-900/40 border border-zinc-800/40 rounded-md flex items-center px-3 gap-3">
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

        {/* ÁREA DE DROPS: Onde os clips ficam */}
        <div 
          onDragOver={handleDragOver}
          onDrop={(e) => handleDropOnTimeline(e, track.id)}
          className="relative flex-1 bg-zinc-900/10 border border-zinc-800/20 rounded-md hover:bg-zinc-900/20 transition-colors min-w-[10000px]"
          style={{ height: '64px' }}
        >
          {/* Clips filtrados por track.id */}
          {clips.filter(c => c.trackId === track.id).map((clip) => (
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
              <div className="px-3 w-full">
                <p className="text-[9px] font-black text-white truncate uppercase italic leading-none drop-shadow-md">
                  {clip.name}
                </p>
              </div>
              <div className="absolute right-0 inset-y-0 w-1.5 cursor-ew-resize hover:bg-white/40 z-10" onMouseDown={(e) => startResizing(e, clip.id, 'right')} />
            </motion.div>
          ))}
        </div>
      </div>
    ))}

    {/* Botão de Adicionar Track adaptado */}
    <div className="flex gap-2">
      <div className="w-48 shrink-0" /> {/* Alinhamento com o aside */}
      <button 
        onClick={() => {
          const nextId = tracks.length > 0 ? Math.max(...tracks.map(t => t.id)) + 1 : 0;
          setTracks(prev => [...prev, { id: nextId, type: 'video' }]);
        }}
        className="mt-2 w-fit flex items-center gap-2 text-[9px] font-black text-zinc-700 hover:text-zinc-400 uppercase tracking-widest transition-colors px-3 py-2 border border-dashed border-zinc-800/50 rounded-md"
      >
        <Plus size={10} /> Add Track
      </button>
    </div>
  </div>
</div>


-------------------------------------------


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
