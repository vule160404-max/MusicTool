export interface LocalAudioHints {
  title?: string;
  artist?: string;
  album?: string;
  lyrics?: string;
  durationSec?: number;
}

function readSyncSafeInt(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

function decodeId3Text(bytes: Uint8Array, encoding: number): string {
  if (bytes.length === 0) return '';
  try {
    if (encoding === 0) {
      return new TextDecoder('latin1').decode(bytes).replace(/\0+$/, '').trim();
    }
    if (encoding === 1) {
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2)).replace(/\0+$/, '').trim();
      }
      if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2)).replace(/\0+$/, '').trim();
      }
      return new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '').trim();
    }
    if (encoding === 2) {
      return new TextDecoder('utf-16be').decode(bytes).replace(/\0+$/, '').trim();
    }
    return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '').trim();
  } catch {
    return '';
  }
}

function findNullTerminator(bytes: Uint8Array, start: number, isUtf16: boolean): number {
  if (!isUtf16) {
    for (let i = start; i < bytes.length; i++) {
      if (bytes[i] === 0) return i;
    }
    return bytes.length;
  }
  for (let i = start; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
  }
  return bytes.length;
}

async function readId3v2Hints(file: File): Promise<Omit<LocalAudioHints, 'durationSec'>> {
  const hints: Omit<LocalAudioHints, 'durationSec'> = {};
  if (!/\.mp3$/i.test(file.name) && file.type !== 'audio/mpeg') {
    return hints;
  }

  try {
    const headBuf = await file.slice(0, 512 * 1024).arrayBuffer();
    if (headBuf.byteLength < 10) return hints;
    const view = new DataView(headBuf);
    const bytes = new Uint8Array(headBuf);

    // Check "ID3" magic header
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
      return hints;
    }

    const majorVersion = bytes[3];
    if (majorVersion < 3 || majorVersion > 4) return hints;

    const flags = bytes[5];
    const tagSize = readSyncSafeInt(view, 6);
    const maxOffset = Math.min(bytes.length, 10 + tagSize);

    let offset = 10;
    // Skip extended header if present
    if ((flags & 0x40) !== 0 && offset + 4 <= maxOffset) {
      const extSize =
        majorVersion === 4 ? readSyncSafeInt(view, offset) : view.getUint32(offset, false);
      offset += majorVersion === 4 ? extSize : extSize + 4;
    }

    while (offset + 10 <= maxOffset) {
      const frameId = String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3]
      );
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      const frameSize =
        majorVersion === 4 ? readSyncSafeInt(view, offset + 4) : view.getUint32(offset + 4, false);
      if (frameSize <= 0 || offset + 10 + frameSize > maxOffset) break;

      const payload = bytes.subarray(offset + 10, offset + 10 + frameSize);
      offset += 10 + frameSize;

      if (frameId === 'TIT2' || frameId === 'TPE1' || frameId === 'TALB') {
        const encoding = payload[0];
        const text = decodeId3Text(payload.subarray(1), encoding);
        if (text) {
          if (frameId === 'TIT2' && !hints.title) hints.title = text;
          if (frameId === 'TPE1' && !hints.artist) hints.artist = text;
          if (frameId === 'TALB' && !hints.album) hints.album = text;
        }
      } else if (frameId === 'USLT' && payload.length > 5 && !hints.lyrics) {
        const encoding = payload[0];
        const isUtf16 = encoding === 1 || encoding === 2;
        const descStart = 4; // 1 byte encoding + 3 bytes language
        const descEnd = findNullTerminator(payload, descStart, isUtf16);
        const textStart = descEnd + (isUtf16 ? 2 : 1);
        if (textStart < payload.length) {
          const text = decodeId3Text(payload.subarray(textStart), encoding);
          if (text && text.length > 20) {
            hints.lyrics = text;
          }
        }
      }
    }
  } catch {
    // Ignore malformed ID3 tags
  }

  return hints;
}

function readAudioDurationSec(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (val?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(val && Number.isFinite(val) && val > 0 ? Math.round(val) : undefined);
    };

    const timer = setTimeout(() => finish(undefined), 800);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(undefined);
    audio.src = url;
  });
}

export async function readLocalAudioHints(file: File): Promise<LocalAudioHints> {
  const [id3, durationSec] = await Promise.all([
    readId3v2Hints(file),
    readAudioDurationSec(file),
  ]);
  return {
    ...id3,
    durationSec,
  };
}
