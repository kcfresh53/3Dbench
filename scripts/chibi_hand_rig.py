"""Hand controls fitted to the purchased pack's original vertex loops.

Indices refer to the unmodified Blender mesh, before face triangulation. The
right hand is matched by mirrored positions, not by assumptions about its IDs.
"""
from math import dist

LAYOUTS = {
    'Male': {
        'vertices': 637,
        'fingers': ([128, 138, 143, 155, 137], [148, 153, 154, 158, 161]),
        'thumb': ([133, 141, 159, 132], [164, 160, 132, 133], [166, 163, 165, 167]),
        'finger_weights': [(0.25, [128, 138, 143, 155, 137]), (0.7, [140, 145, 150, 139, 147]), (1.0, [142, 144, 156, 148, 149, 153, 154, 158, 161])],
        'thumb_weights': [(0.25, 0, [141]), (0.15, 0, [159]), (0.35, 0, [132, 133]), (0.7, 0.3, [164, 160]), (0, 1.0, [166, 163, 165, 167])],
    },
    'Female': {
        'vertices': 673,
        'fingers': ([73, 101, 95, 86, 80, 74], [100, 96, 94, 99, 105, 103]),
        'thumb': ([77, 82, 76, 112, 115, 117], [106, 108, 114, 110], [109, 111, 113, 116]),
        'finger_weights': [(0.25, [73, 101, 95, 86, 80, 74]), (0.7, [79, 102, 97, 90, 91, 84]), (1.0, [83, 89, 104, 88, 105, 100, 96, 94, 99, 103])],
        'thumb_weights': [(0.2, 0, [77, 82, 76, 112, 115, 117]), (0.7, 0.3, [106, 108, 114, 110]), (0, 1.0, [109, 111, 113, 116]), (0.45, 0, [78, 107])],
    },
}


def add_hand_controls(sex, vertices, bones, weights):
    layout = LAYOUTS[sex]
    if len(vertices) != layout['vertices']:
        raise ValueError('Unexpected source mesh version: hand landmarks must be checked')
    def center(indices):
        return [sum(vertices[i][axis] for i in indices) / len(indices) for axis in range(3)]
    for side in ['L', 'R']:
        sign = 1 if side == 'L' else -1
        def point(indices):
            p = center(indices)
            return [p[0] * sign, p[1], p[2]]
        def vertex(index):
            p = vertices[index]
            if side == 'L': return index
            target = [-p[0], p[1], p[2]]
            match = min(range(len(vertices)), key=lambda i: dist(vertices[i], target))
            if dist(vertices[match], target) > 1e-5:
                raise ValueError('Source hands are not mirrored')
            return match
        hand, fingers, thumb1, thumb2 = [f'{name}.{side}' for name in ['hand', 'fingers', 'thumb_1', 'thumb_2']]
        start, end = layout['fingers']
        root, joint, tip = layout['thumb']
        bones.extend([
            dict(id=fingers, parent=hand, head=point(start), tail=point(end), connected=False),
            dict(id=thumb1, parent=hand, head=point(root), tail=point(joint), connected=False),
            dict(id=thumb2, parent=thumb1, head=point(joint), tail=point(tip), connected=True),
        ])
        def transfer(indices, portions):
            for index in indices:
                w = weights[vertex(index)]
                source = w.get(hand, 0)
                if source <= 0: raise ValueError('Hand landmark has no source hand weight')
                remainder = 1 - sum(portions.values())
                if remainder > 1e-8: w[hand] = source * remainder
                else: del w[hand]
                for bone, fraction in portions.items():
                    if fraction: w[bone] = source * fraction
        for amount, indices in layout['finger_weights']:
            transfer(indices, {fingers: amount})
        for proximal, distal, indices in layout['thumb_weights']:
            transfer(indices, {thumb1: proximal, thumb2: distal})
