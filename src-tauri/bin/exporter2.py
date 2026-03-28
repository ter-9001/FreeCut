import json
import sys
import os
import numpy as np
import cv2
from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy import VideoFileClip, CompositeAudioClip
from moviepy.video.VideoClip import VideoClip
from proglog import ProgressBarLogger

# --- LOGGER OTIMIZADO (Reduz I/O de terminal) ---
class RawPercentageLogger(ProgressBarLogger):
    def __init__(self):
        super().__init__()
        self.last_percentage = -1

    def callback(self, **changes):
        bars = self.state.get('bars', {})
        if not bars: return
        bar_list = list(bars.values())
        if not bar_list: return
        current_bar = bar_list[-1]
        
        if current_bar.get('total', 0) > 0 and current_bar.get('title') != 'chunk':
            percent = int((current_bar.get('index', 0) / current_bar.get('total')) * 100)
            if percent != self.last_percentage:
                sys.stderr.write(f"PERCENT:{min(100, percent)}\n")
                sys.stderr.flush()
                self.last_percentage = percent

class FreeCutVideoClip(VideoClip):
    def __init__(self, make_frame, duration, size):
        super().__init__()
        self.make_frame = make_frame
        self.frame_function = make_frame
        self.duration = duration
        self.end = duration
        self.size = size

def get_interpolated_value(keyframes, t, default_value):
    if not keyframes: return default_value
    kf_times = np.array([float(kf['time']) for kf in keyframes])
    if len(kf_times) == 0: return default_value
    
    indices = np.argsort(kf_times)
    kf_times = kf_times[indices]

    if isinstance(keyframes[0]['value'], dict):
        val = keyframes[0]['value']
        if 'x' in val:
            kx = np.array([float(kf['value']['x']) for kf in keyframes])[indices]
            ky = np.array([float(kf['value']['y']) for kf in keyframes])[indices]
            return {"x": np.interp(t, kf_times, kx), "y": np.interp(t, kf_times, ky)}
    
    try:
        kv = np.array([kf['value'] for kf in keyframes], dtype=float)[indices]
        return float(np.interp(t, kf_times, kv, left=kv[0], right=kv[-1]))
    except:
        return default_value

# --- BLEND MODES (Otimizados) ---
def apply_canvas_blend(background, foreground, mode):
    if mode == 'normal': return foreground
    if mode == 'screen': return 1 - (1 - background) * (1 - foreground)
    if mode == 'multiply': return background * foreground
    if mode == 'lighter' or mode == 'lineardodge': return np.minimum(1.0, background + foreground)
    if mode == 'overlay':
        mask = background < 0.5
        res = 2 * background * foreground
        res[~mask] = 1 - 2 * (1 - background[~mask]) * (1 - foreground[~mask])
        return res
    return foreground 

def process_video():
    if len(sys.argv) < 2: return
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        data = json.load(f)

    W, H = data['project_dimensions']['width'], data['project_dimensions']['height']
    
    # Respeita a ordem exata do JSON (0 é o fundo, N é o topo)
    clips_data = data['clips'][::-1]
    
    loaded_clips = []
    for c in clips_data:
        path = os.path.join(data['project_path'], "videos", c['name'])
        if c['type'] == 'video':
            # OTIMIZAÇÃO: fps_source="fps" evita que o MoviePy analise todo o arquivo no início
            v = VideoFileClip(path, audio=not c.get('mute'), fps_source="fps", target_resolution=(H, None))
            v = v.subclipped(c.get('beginmoment', 0), c.get('beginmoment', 0) + c['duration'])
            loaded_clips.append({'data': c, 'video': v})
        else:
            a = AudioFileClip(path).subclipped(c.get('beginmoment', 0), c.get('beginmoment', 0) + c['duration'])
            loaded_clips.append({'data': c, 'audio': a})

    def make_final_frame(t):
        # Inicia canvas com zeros (preto)
        canvas_f = np.zeros((H, W, 3), dtype=float)
        
        for item in loaded_clips:
            if 'video' not in item: continue
            c, v_clip = item['data'], item['video']
            rel_t = t - c['start']
            
            # Pula clips que não pertencem a este tempo
            if rel_t < 0 or rel_t >= c['duration']: continue

            # OTIMIZAÇÃO: Se opacidade é zero, nem decodifica o frame
            op = get_interpolated_value(c.get('keyframes', {}).get('opacity', []), rel_t, 1.0)
            if op <= 0.001: continue 

            zoom = get_interpolated_value(c.get('keyframes', {}).get('zoom', []), rel_t, 1.0)
            def_pos = {"x": (W - v_clip.w)/2, "y": (H - v_clip.h)/2}
            pos = get_interpolated_value(c.get('keyframes', {}).get('position', []), rel_t, def_pos)

            # Decodifica o frame apenas se necessário
            raw = v_clip.get_frame(rel_t) 
            
            # OTIMIZAÇÃO: INTER_NEAREST se zoom for 1 (muito rápido), INTER_LINEAR para o resto
            interp = cv2.INTER_LINEAR if zoom != 1.0 else cv2.INTER_NEAREST
            tw, th = int(v_clip.w * zoom), int(v_clip.h * zoom)
            
            if tw <= 0 or th <= 0: continue
            img = cv2.resize(raw, (tw, th), interpolation=interp)
            
            x1, y1 = int(pos['x']), int(pos['y'])
            x2, y2 = x1 + tw, y1 + th
            ix1, ix2 = max(0, x1), min(W, x2)
            iy1, iy2 = max(0, y1), min(H, y2)
            
            if ix1 >= ix2 or iy1 >= iy2: continue

            fx1, fy1 = ix1 - x1, iy1 - y1
            src = img[fy1:fy1+(iy2-iy1), fx1:fx1+(ix2-ix1)].astype(float) / 255.0
            tgt = canvas_f[iy1:iy2, ix1:ix2]

            mode = c.get('blendmode', 'normal')
            blended = apply_canvas_blend(tgt, src, mode)
            canvas_f[iy1:iy2, ix1:ix2] = (1 - op) * tgt + op * blended

        return (canvas_f * 255).astype('uint8')

    duration = max((c['start'] + c['duration']) for c in clips_data) if clips_data else 0
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

    # --- O PULO DO GATO: PRESET E THREADS ---
    final_video.write_videofile(
        data['export_path'], 
        fps=30, 
        codec="libx264", 
        audio_codec="aac",
        logger=RawPercentageLogger(),
        threads=12,         # Aumente se tiver um processador parrudo
        preset="ultrafast", # Crucial para velocidade
        bitrate="8000k"     # Garante qualidade decente no ultrafast
    )

if __name__ == "__main__":
    process_video()