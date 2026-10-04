#!/usr/bin/env python3
"""
Generate PNG icons for the Intentional YouTube Chrome extension.
Requires: pip install Pillow
"""

from PIL import Image, ImageDraw, ImageFont
import math

def create_icon(size):
    """Create a square icon with the specified size."""
    # Create image with gradient background
    img = Image.new('RGBA', (size, size), (74, 144, 217, 255))
    draw = ImageDraw.Draw(img)
    
    # Create gradient effect (simple version)
    for y in range(size):
        r = int(74 + (53 - 74) * y / size)
        g = int(144 + (122 - 144) * y / size)
        b = int(217 + (189 - 217) * y / size)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))
    
    # Draw rounded rectangle border
    radius = int(size * 0.2)
    draw.rounded_rectangle(
        [(0, 0), (size-1, size-1)],
        radius=radius,
        outline=(255, 255, 255, 100),
        width=2
    )
    
    # Draw play button triangle
    center_x = size // 2
    center_y = size // 2
    triangle_size = int(size * 0.35)
    
    triangle_points = [
        (center_x - int(triangle_size * 0.15), center_y - int(triangle_size * 0.5)),
        (center_x - int(triangle_size * 0.15), center_y + int(triangle_size * 0.5)),
        (center_x + int(triangle_size * 0.866), center_y)
    ]
    
    draw.polygon(triangle_points, fill=(255, 255, 255, 255))
    
    # Draw small reflection dot
    dot_radius = int(size * 0.08)
    dot_x = center_x - int(size * 0.15)
    dot_y = center_y - int(size * 0.15)
    draw.ellipse(
        [(dot_x - dot_radius, dot_y - dot_radius), 
         (dot_x + dot_radius, dot_y + dot_radius)],
        fill=(255, 255, 255, 77)
    )
    
    return img

def main():
    sizes = [16, 48, 128]
    
    for size in sizes:
        icon = create_icon(size)
        filename = f'icon{size}.png'
        icon.save(filename, 'PNG')
        print(f'Created {filename}')
    
    print('\nAll icons generated successfully!')

if __name__ == '__main__':
    try:
        main()
    except ImportError:
        print('Error: Pillow library not found.')
        print('Install it with: pip install Pillow')
