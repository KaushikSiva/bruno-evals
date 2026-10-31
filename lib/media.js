import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const exec = promisify(execFile);

export async function probe(file) {
  const { stdout } = await exec('ffprobe', ['-v','error','-show_format','-show_streams','-of','json',file], { timeout: 30000 });
  const meta = JSON.parse(stdout), video = meta.streams.find(s => s.codec_type === 'video');
  if (!video) throw new Error('This file has no video track');
  const duration = Number(meta.format.duration || video.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 1200) throw new Error('Use a video between 0 and 1,200 seconds long');
  return { duration, width: video.width, height: video.height, codec: video.codec_name, bytes: (await stat(file)).size };
}

export function sampleTimes(duration, limit = 24) {
  if (!(duration > 0) || !Number.isFinite(duration)) throw new Error('Invalid video duration');
  const count = Math.min(limit, Math.max(2, Math.ceil(duration) + 1));
  const end = Math.max(0, duration - Math.min(0.15, duration / 4));
  return Array.from({ length: count }, (_, i) => Number((end * i / (count - 1)).toFixed(3)));
}

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function prepareMedia(input, dir, progress = () => {}) {
  await mkdir(path.join(dir, 'frames'), { recursive: true });
  // Normalize recordings to a seekable MP4; original bytes are retained separately.
  const video = path.join(dir, 'video.mp4');
  await exec('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',input,'-map','0:v:0','-an',
    '-vf','scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',video],
    { timeout: 240000, maxBuffer: 1024 * 1024 });
  const metadata = await probe(video), originalHash = await sha256(input);
  const times = sampleTimes(metadata.duration);
  const frames = [];
  for (const [i, seconds] of times.entries()) {
    const name = `${String(i).padStart(3, '0')}.jpg`;
    await exec('ffmpeg', ['-hide_banner','-loglevel','error','-y','-ss',String(seconds),'-i',video,
      '-frames:v','1','-vf','scale=960:540:force_original_aspect_ratio=decrease','-q:v','3',path.join(dir,'frames',name)], { timeout: 30000 });
    // ffmpeg can exit successfully without a frame on a corrupt/truncated source.
    if ((await stat(path.join(dir,'frames',name))).size < 100) throw new Error('Could not extract a valid evidence frame');
    frames.push({ index: i, seconds, file: name }); progress(i + 1, times.length);
  }
  const evidence = { ...metadata, originalSha256: originalHash, frames,
    sampling: 'Up to 24 evenly spaced frames, including the beginning and near-final frame. Events between samples may be missed.',
    timebase: 'Seconds in the saved video; source footage may be edited or accelerated.' };
  await writeFile(path.join(dir, 'media.json'), JSON.stringify(evidence, null, 2));
  return evidence;
}
