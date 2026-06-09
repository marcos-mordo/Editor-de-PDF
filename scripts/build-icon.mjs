import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build');

// Same SVG used in the React Logo component, simplified for clarity.
// This produces an intuitive PDF editor icon:
//   - Orange rounded square background
//   - White document with folded corner (universal file icon)
//   - Bold "PDF" letters
//   - Pencil tip overlapping the corner (clearly editable)
const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF9900"/>
      <stop offset="100%" stop-color="#E47911"/>
    </linearGradient>
    <linearGradient id="pencil" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFD814"/>
      <stop offset="100%" stop-color="#F7CA00"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="16" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Orange rounded background -->
  <rect x="32" y="32" width="960" height="960" rx="192" fill="url(#bg)"/>

  <!-- Document body with folded top-right corner -->
  <g filter="url(#shadow)">
    <path d="M 224 224 L 640 224 L 800 384 L 800 832 Q 800 864 768 864 L 256 864 Q 224 864 224 832 Z" fill="#FFFFFF"/>
    <path d="M 640 224 L 800 384 L 640 384 Z" fill="#EAEDED"/>
    <path d="M 640 224 L 800 384 L 640 384 Z" fill="none" stroke="#D5D9D9" stroke-width="6"/>
  </g>

  <!-- PDF text -->
  <text x="490" y="640" text-anchor="middle"
        font-family="Inter, Helvetica, Arial, sans-serif"
        font-size="170" font-weight="900" fill="#131A22" letter-spacing="6">PDF</text>

  <!-- Pencil overlapping bottom-right corner -->
  <g transform="translate(700, 700) rotate(-45)">
    <rect x="0" y="0" width="260" height="74" rx="12" fill="url(#pencil)" stroke="#A88734" stroke-width="5"/>
    <rect x="0" y="0" width="36" height="74" fill="#E47911"/>
    <polygon points="260,0 308,37 260,74" fill="#0F1111"/>
  </g>
</svg>`;

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function renderPng(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0, 0, 0, 0)',
  });
  return resvg.render().asPng();
}

async function main() {
  await ensureDir(OUT_DIR);

  // 1) Save SVG source
  await fs.writeFile(path.join(OUT_DIR, 'icon.svg'), SVG, 'utf8');

  // 2) Generate master PNG 1024x1024 for electron-builder + macOS
  const png1024 = renderPng(SVG, 1024);
  await fs.writeFile(path.join(OUT_DIR, 'icon.png'), png1024);
  console.log('✓ build/icon.png (1024x1024)');

  // 3) Multi-resolution ICO for Windows
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = sizes.map((s) => renderPng(SVG, s));
  const ico = await pngToIco(pngBuffers);
  await fs.writeFile(path.join(OUT_DIR, 'icon.ico'), ico);
  console.log(`✓ build/icon.ico (${sizes.join(', ')}px)`);

  // 4) Installer header / sidebar PNGs for NSIS (optional but nice)
  const headerPng = renderPng(SVG, 64);
  await fs.writeFile(path.join(OUT_DIR, 'installerHeaderIcon.png'), headerPng);
  console.log('✓ build/installerHeaderIcon.png');

  console.log('\nIconos generados en build/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
