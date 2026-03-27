import json
import sys
import os
from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy import VideoFileClip, ImageClip, CompositeVideoClip, vfx, afx, CompositeAudioClip
import numpy as np

from moviepy.video.VideoClip import VideoClip
from proglog import ProgressBarLogger
import cv2
from moviepy.video.VideoClip import DataVideoClip

class RawPercentageLogger(ProgressBarLogger):
    def __init__(self):
        super().__init__()
        self.last_percentage = -1
        self.video_started = False

    def callback(self, **changes):
        bars = self.state.get('bars', {})
        if not bars: return
        
        # O MoviePy nomeia as barras. 
        # 'chunk' ou 'audio' costumam ser as rápidas.
        # 't' ou 'video' é a principal.
        
        # Vamos focar na barra que tem o maior 'total' (geralmente os frames do vídeo)
        # ou na última barra ativa se ela for a de renderização.
        bar_list = list(bars.values())
        if not bar_list: return
        
        current_bar = bar_list[-1]
        title = current_bar.get('title', '')
        total = current_bar.get('total', 0)
        index = current_bar.get('index', 0)

        # Filtro: Ignora barras muito pequenas ou com títulos de áudio
        # Se o total de frames for condizente com a duração (ex: > 1), tratamos como vídeo
        if total > 0:
            # Se o MoviePy estiver na fase de áudio, o título geralmente contém 'chunk'
            # Se estiver no vídeo, o título é 't'. 
            # Para ser robusto, vamos ignorar se o total for muito baixo ou se não for a barra de vídeo.
            if title == 'chunk': 
                return

            percent = int((index / total) * 100)
            
            # Garante que não passe de 100 e evita repetições
            if percent > 100: percent = 100
            
            if percent != self.last_percentage:
                # Opcional: só começa a logar quando sair do 0 para evitar o "flash" inicial
                sys.stderr.write(f"PERCENT:{percent}\n")
                sys.stderr.flush()
                self.last_percentage = percent


class FreeCutVideoClip(VideoClip):
    """
    Uma versão robusta do VideoClip que aceita a função de frame
    sem depender de nomes de argumentos instáveis da v2.0.
    """
    def __init__(self, make_frame, duration, size):
        super().__init__()
        self.make_frame = make_frame
        self.frame_function = make_frame # Define os dois nomes por segurança
        self.duration = duration
        self.end = duration
        self.size = size

# --- FUNÇÃO DE INTERPOLAÇÃO ---
def get_interpolated_value(keyframes, t, default_value):
    if not keyframes: return default_value
    kf_times = np.array([kf['time'] for kf in keyframes])
    if len(kf_times) == 0: return default_value
    indices = np.argsort(kf_times)
    kf_times = kf_times[indices]
    if isinstance(keyframes[0]['value'], dict):
        kx = np.array([kf['value']['x'] for kf in keyframes])[indices]
        ky = np.array([kf['value']['y'] for kf in keyframes])[indices]
        return {"x": np.interp(t, kf_times, kx), "y": np.interp(t, kf_times, ky)}
    kv = np.array([kf['value'] for kf in keyframes])[indices]
    return float(np.interp(t, kf_times, kv, left=kv[0], right=kv[-1]))

# --- MATEMÁTICA DE BLEND MODES ---
def apply_canvas_blend(background, foreground, mode):
    if mode == 'screen': return 1 - (1 - background) * (1 - foreground)
    elif mode == 'multiply': return background * foreground
    elif mode == 'lighter' or mode == 'lineardodge': return np.minimum(1.0, background + foreground)
    elif mode == 'overlay':
        mask = background < 0.5
        res = np.empty_like(background)
        res[mask] = 2 * background[mask] * foreground[mask]
        res[~mask] = 1 - 2 * (1 - background[~mask]) * (1 - foreground[~mask])
        return res
    return foreground 

def process_video():
    if len(sys.argv) < 2: return
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        data = json.load(f)

    W, H = data['project_dimensions']['width'], data['project_dimensions']['height']
    clips_data = data['clips']
    
    loaded_clips = []
    # Ordenação por Track: as maiores ficam "por cima" no desenho
    sorted_data = sorted(clips_data, key=lambda x: int(x.get('trackId', 0)), reverse=True)

    for c in sorted_data:
        if c['type'] == 'video':
            v = VideoFileClip(c['path']).subclipped(c.get('beginmoment', 0), c.get('beginmoment', 0) + c['duration'])
            if c.get('mute'): v = v.without_audio()
            loaded_clips.append({'data': c, 'video': v})
        else:
            a = AudioFileClip(c['path']).subclipped(c.get('beginmoment', 0), c.get('beginmoment', 0) + c['duration'])
            loaded_clips.append({'data': c, 'audio': a})

    def make_final_frame(t):
        canvas_f = np.zeros((H, W, 3), dtype=float)
        
        for item in loaded_clips:
            if 'video' not in item: continue
            c, v_clip = item['data'], item['video']
            rel_t = t - c['start']
            
            if rel_t < 0 or rel_t >= c['duration']: continue

            # Opacidade e Fades
            op = get_interpolated_value(c.get('keyframes', {}).get('opacity', []), rel_t, 1.0)
            if c.get('fadein') and rel_t < c['fadein']: op *= (rel_t / c['fadein'])
            if c.get('fadeout') and rel_t > (c['duration'] - c['fadeout']):
                op *= ((c['duration'] - rel_t) / c['fadeout'])
            
            # Zoom e Posição
            zoom = get_interpolated_value(c.get('keyframes', {}).get('zoom', []), rel_t, 1.0)
            def_pos = {"x": (W - v_clip.w)/2, "y": (H - v_clip.h)/2}
            pos = get_interpolated_value(c.get('keyframes', {}).get('position', []), rel_t, def_pos)

            # Frame e Resize
            raw = v_clip.get_frame(rel_t) 
            scale = c.get('scale', 1) * zoom
            tw, th = int(v_clip.w * scale), int(v_clip.h * scale)
            if tw <= 0 or th <= 0: continue
            
            img = cv2.resize(raw, (tw, th), interpolation=cv2.INTER_LANCZOS4)
            
            x1, y1 = int(pos['x']), int(pos['y'])
            x2, y2 = x1 + tw, y1 + th
            ix1, ix2 = max(0, x1), min(W, x2)
            iy1, iy2 = max(0, y1), min(H, y2)
            if ix1 >= ix2 or iy1 >= iy2: continue

            fx1, fy1 = ix1 - x1, iy1 - y1
            src = img[fy1:fy1+(iy2-iy1), fx1:fx1+(ix2-ix1)].astype(float) / 255.0
            tgt = canvas_f[iy1:iy2, ix1:ix2]

            # Blend Mode
            blended = apply_canvas_blend(tgt, src, c.get('blendmode', 'normal'))
            canvas_f[iy1:iy2, ix1:ix2] = (1 - op) * tgt + op * blended

        return (canvas_f * 255).astype('uint8')

    duration = max((c['start'] + c['duration']) for c in clips_data) if clips_data else 0

    # USANDO NOSSA CLASSE CUSTOMIZADA
    final_video = FreeCutVideoClip(make_frame=make_final_frame, duration=duration, size=(W, H))

    # Áudio
    audio_tracks = []
    for item in loaded_clips:
        if 'audio' in item:
            audio_tracks.append(item['audio'].with_start(item['data']['start']))
        elif 'video' in item and item['video'].audio and not item['data'].get('mute'):
            audio_tracks.append(item['video'].audio.with_start(item['data']['start']))
    
    if audio_tracks:
        final_video.audio = CompositeAudioClip(audio_tracks)

    # Export
    final_video.write_videofile(
        data['export_path'], 
        fps=30, 
        codec="libx264", 
        audio_codec="aac",
        logger=RawPercentageLogger()
    )

if __name__ == "__main__":
    process_video()