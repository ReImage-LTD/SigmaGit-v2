/** Apply a Git delta without allocating beyond its validated output budget. */
export function applyDelta(base: Buffer, delta: Buffer, maxOutputBytes: number): Buffer {
  let offset = 0;
  const byte = () => {
    if (offset >= delta.length) throw new Error('Truncated delta');
    return delta[offset++];
  };
  const varint = () => {
    let value = 0;
    let multiplier = 1;
    for (let i = 0; i < 8; i++) {
      const next = byte();
      value += (next & 0x7f) * multiplier;
      if (!Number.isSafeInteger(value)) throw new Error('Invalid delta size');
      if (!(next & 0x80)) return value;
      multiplier *= 128;
    }
    throw new Error('Invalid delta size');
  };
  if (varint() !== base.length) throw new Error('Delta base size mismatch');
  const resultSize = varint();
  if (resultSize > maxOutputBytes) throw new Error('Delta exceeds decompression budget');
  const result = Buffer.alloc(resultSize);
  let written = 0;
  while (offset < delta.length) {
    const command = byte();
    if (command & 0x80) {
      let copyOffset = 0;
      let copySize = 0;
      for (let i = 0; i < 4; i++) {
        if (command & (1 << i)) copyOffset += byte() * 2 ** (8 * i);
      }
      for (let i = 0; i < 3; i++) {
        if (command & (0x10 << i)) copySize += byte() * 2 ** (8 * i);
      }
      if (!copySize) copySize = 0x10000;
      if (copyOffset + copySize > base.length || written + copySize > resultSize) {
        throw new Error('Delta copy out of bounds');
      }
      base.copy(result, written, copyOffset, copyOffset + copySize);
      written += copySize;
    } else {
      if (!command || offset + command > delta.length || written + command > resultSize) {
        throw new Error('Invalid delta literal');
      }
      delta.copy(result, written, offset, offset + command);
      offset += command;
      written += command;
    }
  }
  if (written !== resultSize) throw new Error('Delta result size mismatch');
  return result;
}
