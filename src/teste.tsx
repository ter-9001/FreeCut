{/* Container do Monitor */}
<div className="relative w-full aspect-video bg-[#050505] rounded-2xl overflow-hidden border border-white/5 shadow-2xl"
onClick={togglePlay} >
  
  {/* Renderizamos apenas os clipes necessários (ou um pool fixo) */}
  {clips.filter(c => knowTypeByAssetName(c.name, true) === 'video').map(clip => (
    <video
      key={clip.id}
      ref={el => { if(el) videoRefs.current[clip.id] = el }}
      src={convertFileSrc(`${currentProjectPath}/videos/${clip.name}`)}
      className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-200 ${
        topClip?.id === clip.id ? 'opacity-100 z-10' : 'opacity-0 z-0'
      }`}
      muted // Recomendado mutar o vídeo e tratar áudio em separado para evitar ecos
      preload="auto"
    />

    {isPlaying ? (
    <Pause size={56} className="text-white/5 group-hover:text-white/30 transition-all scale-90 group-hover:scale-100" />
    ) : (
    <Play size={56} className="text-white/5 group-hover:text-white/30 transition-all scale-90 group-hover:scale-100" />
    )}
  ))}

  {/* Overlay de Informações (Opcional) */}
  <div className="absolute bottom-4 left-4 z-20 pointer-events-none">
    <p className="text-[10px] font-mono text-red-500 bg-black/80 px-2 py-1 rounded border border-red-500/20">
      {formatDuration(currentTime)}
    </p>
  </div>

</div>