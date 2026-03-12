import sys
import os
import json
import tempfile
from moviepy import VideoFileClip, ImageClip, CompositeVideoClip, vfx, afx
from proglog import ProgressBarLogger
import numpy as np



class RawPercentageLogger(ProgressBarLogger):
    def __init__(self):
        super().__init__()
        self.last_percentage = -1
        # Substituímos a global por um atributo da classe
        self.rendering_video_finished = False
        self.startzero = False

    def callback(self, **changes):
        bars = self.state.get('bars', {})
        if not bars:
            return
            
        # Pega a barra ativa
        current_bar = list(bars.values())[-1]
        total = current_bar.get('total', 0)
        index = current_bar.get('index', 0)
        
        if total > 0:
            percent = int((index / total) * 100)
            
            if percent >= 100:
                percent = 99

            if percent != self.last_percentage:
                # LÓGICA DE FILTRO:
                # O MoviePy geralmente dispara uma barra rápida de 'logger' antes da renderização real.
                # A renderização real de vídeo é a que costuma demorar.
                
                if not self.rendering_video_finished:
                    if percent == 99:
                        # Quando a primeira barra rápida chega em 99, 
                        # liberamos para a próxima barra ser exibida
                        self.rendering_video_finished = True
                    return # Ignora a primeira contagem rápida
                if not self.startzero:
                    if percent == 0:
                        self.startzero = True
                    return
                # Se já passou da primeira barra, começa a enviar para o Rust
                sys.stderr.write(f"PERCENT:{percent}\n")
                sys.stderr.flush()
                self.last_percentage = percent



def export_video():
    try:
        if len(sys.argv) < 2:
            sys.exit(1)

        config_path = sys.argv[1]
        with open(config_path, 'r', encoding='utf-8') as f:
            payload = json.load(f)
            
        export_path = payload['export_path']
        clips_data = payload['clips']
        target_dir = os.path.dirname(os.path.abspath(export_path))
        tempfile.tempdir = target_dir

        # 1. Definimos a resolução padrão do projeto (ex: Full HD)
        # Você também pode pegar isso do JSON se quiser resoluções dinâmicas
        target_size = (1920, 1080) 

        video_clips = []
        for c in clips_data:
            if c.get('type') == 'image':
                clip = ImageClip(c['path']).with_duration(c['duration'])
            else:
                clip = VideoFileClip(c['path']).subclipped(c['beginmoment'], c['beginmoment'] + c['duration'])
            
            # 2. Redimensiona o clip para caber na tela mantendo o aspecto
            # e centraliza (o MoviePy centraliza por padrão no CompositeVideoClip se definido o size)
            fadein = 0
            fadeout = 0
            
            if(c.get("fadein")):
                fadein = int(c.get("fadein"))

            if(c.get("fadeout")):
                fadeout = int(c.get("fadeout"))


            clip = clip.with_effects([vfx.FadeIn(fadein), vfx.FadeOut(fadeout)])
                

            clip = clip.resized(height=target_size[1]) # Ajusta pela altura
            if clip.w > target_size[0]:
                clip = clip.resized(width=target_size[0]) # Ajusta pela largura se estourar
            
            clip = clip.with_start(c['start']).with_position("center")
            video_clips.append(clip)

        # 3. Forçamos o CompositeVideoClip a ter o tamanho alvo
        final_video = CompositeVideoClip(video_clips, size=target_size)
        
        temp_audio = os.path.join(target_dir, "temp-audio-render.m4a")
        
        final_video.write_videofile(
            export_path,
            fps=24,
            codec="libx264",
            audio_codec="aac",
            temp_audiofile=temp_audio,
            remove_temp=True,
            logger=RawPercentageLogger()
        )
        
        sys.stderr.write("PERCENT:100\n")
        sys.stderr.flush()
        sys.exit(0)

    except Exception as e:
        sys.stderr.write(f"ERRO: {str(e)}\n")
        sys.exit(1)

if __name__ == "__main__":
    export_video()