"""Decode the saved RGB composite of an 8-bit PSD using only Python's standard library."""
import struct
import zlib

def psd_to_png(data):
    signature, version, _, channels, height, width, depth, mode = struct.unpack('>4sH6sHIIHH', data[:26])
    if (signature, version, depth, mode) != (b'8BPS', 1, 8, 3) or channels not in (3, 4):
        raise ValueError('Expected an 8-bit RGB/RGBA PSD composite')
    offset = 26
    for _ in range(3):
        size = struct.unpack_from('>I', data, offset)[0]
        offset += 4 + size
    compression = struct.unpack_from('>H', data, offset)[0]
    offset += 2
    if compression == 0:
        pixels = data[offset:offset + channels * height * width]
    elif compression == 1:
        lengths = struct.unpack_from('>' + 'H' * (height * channels), data, offset)
        offset += 2 * height * channels
        pixels = bytearray()
        for size in lengths:
            row = data[offset:offset + size]
            offset += size
            decoded = bytearray()
            i = 0
            while i < len(row):
                n = row[i]; i += 1
                if n < 128:
                    decoded.extend(row[i:i + n + 1]); i += n + 1
                elif n > 128:
                    decoded.extend([row[i]] * (257 - n)); i += 1
            if len(decoded) != width:
                raise ValueError('Invalid PSD row')
            pixels.extend(decoded)
    else:
        raise ValueError('Unsupported PSD compression')
    stride = width * height
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            for c in range(channels):
                raw.append(pixels[c * stride + y * width + x])
    def chunk(tag, value):
        return struct.pack('>I', len(value)) + tag + value + struct.pack('>I', zlib.crc32(tag + value))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6 if channels == 4 else 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
