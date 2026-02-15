const filteredAssets = assets.filter(asset => 
  asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
  asset.type.toLowerCase().includes(searchQuery.toLowerCase())
);

// No seu Grid:
{filteredAssets.length > 0 ? (
  filteredAssets.map((asset, index) => (
    <motion.div
      key={asset.path} // Certifique-se que asset.path seja único
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group relative aspect-video bg-[#1a1a1a] rounded-lg overflow-hidden border border-white/5 hover:border-red-600/50 transition-colors cursor-pointer"
    >
      {/* Thumbnail: Renderiza se não for áudio E se houver URL */}
      {asset.type !== 'audio' && asset.thumbnailUrl && (
        <img 
          src={asset.thumbnailUrl} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          alt={asset.name}
        />
      )}

      {/* Estado para Áudio */}
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

      {/* Badge de Duração (Não mostra para imagens) */}
      {asset.type !== 'image' && asset.duration && (
        <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-mono text-white">
          {formatTime(asset.duration)}
        </div>
      )}

      {/* Ícone de Tipo */}
      <div className="absolute top-2 left-2 p-1 bg-black/50 backdrop-blur-sm rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
        {asset.type === 'video' && <Play size={12} className="text-white" />}
        {asset.type === 'audio' && <Music size={12} className="text-white" />}
        {asset.type === 'image' && <ImageIcon size={12} className="text-white" />}
      </div>

      {/* Nome do Arquivo */}
      <div className="absolute bottom-2 left-2 right-12 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-[10px] text-white truncate font-medium drop-shadow-lg">
          {asset.name}
        </p>
      </div>
    </motion.div>
  )) // Fechamento correto do .map
) : (
  /* Empty State */
  <div className="col-span-full py-20 text-center">
    <Search size={48} className="mx-auto text-zinc-800 mb-4" />
    <p className="text-zinc-500 text-sm italic">No assets match your search...</p>
  </div>
)}