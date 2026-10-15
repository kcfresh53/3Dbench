"""Losslessly pack the source RGB/RGBA PNGs without resampling."""
import struct
import zlib


def read_png(data):
    offset, compressed = 8, bytearray()
    while offset < len(data):
        size = struct.unpack_from('>I', data, offset)[0]
        tag, value = data[offset + 4:offset + 8], data[offset + 8:offset + 8 + size]
        if tag == b'IHDR':
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', value)
            if depth != 8 or color not in (2, 6) or interlace:
                raise ValueError('Expected non-interlaced RGB/RGBA PNG')
            channels = 3 if color == 2 else 4
        elif tag == b'IDAT':
            compressed.extend(value)
        offset += size + 12
    raw = zlib.decompress(compressed)
    stride, rows, previous = width * channels, [], bytearray(width * channels)
    for y in range(height):
        start = y * (stride + 1)
        kind, row = raw[start], bytearray(raw[start + 1:start + 1 + stride])
        if kind not in range(5):
            raise ValueError('Invalid PNG filter')
        if kind:
            for i in range(stride):
                a = row[i - channels] if i >= channels else 0
                b = previous[i]
                c = previous[i - channels] if i >= channels else 0
                if kind == 1: predictor = a
                elif kind == 2: predictor = b
                elif kind == 3: predictor = (a + b) // 2
                else:
                    p = a + b - c
                    distances = (abs(p-a), abs(p-b), abs(p-c))
                    predictor = (a, b, c)[distances.index(min(distances))]
                row[i] = (row[i] + predictor) & 255
        previous = row
        if channels == 3:
            rgba = bytearray(width * 4)
            rgba[0::4], rgba[1::4], rgba[2::4], rgba[3::4] = row[0::3], row[1::3], row[2::3], b'\xff' * width
            row = rgba
        rows.append(row)
    return width, height, rows


def make_atlas(face_png, body_png):
    face = read_png(face_png)
    body = read_png(body_png)
    # Preserve every source texel and leave a padded gap between UV regions.
    fw, fh, face_rows = face
    bw, bh, body_rows = body
    width = 1 << (bw + fw + 64 - 1).bit_length()
    height = 1 << (max(bh, fh + 64) - 1).bit_length()
    fx, fy = bw + 32, 32
    rows = [bytearray(width * 4) for _ in range(height)]
    for source, x, y in [(body, 0, 0), (face, fx, fy)]:
        sw, sh, pixels = source
        # Extrude edges into the unused atlas space for texture filtering.
        for dy in range(max(0, y - 16), min(height, y + sh + 16)):
            src = pixels[min(sh - 1, max(0, dy - y))]
            left, right = max(0, x - 16), min(width, x + sw + 16)
            rows[dy][left * 4:right * 4] = src[:4] * (x-left) + src + src[-4:] * (right-x-sw)
    def chunk(tag, value):
        return struct.pack('>I', len(value)) + tag + value + struct.pack('>I', zlib.crc32(tag + value))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(b''.join(b'\0' + row for row in rows))) + chunk(b'IEND', b'')
    # PNG rows run down; source UV coordinates run up.
    def remap(uv, material):
        sw, sh, x, y = (fw, fh, fx, fy) if material == 0 else (bw, bh, 0, 0)
        return [(x + uv[0] * sw) / width, 1 - (y + (1 - uv[1]) * sh) / height]
    return png, remap
