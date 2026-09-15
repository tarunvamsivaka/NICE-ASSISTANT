/**
 * Generate PWA icon PNGs from SVG using canvas
 * Run: node generate-icons.js
 */
const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const iconsDir = path.join(__dirname, 'public', 'icons');

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

// For each size, create an SVG at that exact dimension and save it
// Browsers will accept SVG icons, but for broader compatibility we generate sized SVGs
sizes.forEach((size) => {
    const radius = Math.round(size * 0.1875); // ~96/512 ratio
    const fontSize = Math.round(size * 0.43);
    const textY = Math.round(size * 0.586);
    const r1 = Math.round(size * 0.352);
    const r2 = Math.round(size * 0.273);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0c0c1d"/>
      <stop offset="100%" stop-color="#06060e"/>
    </linearGradient>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bg)"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r1}" fill="none" stroke="rgba(167,139,250,0.15)" stroke-width="1"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r2}" fill="none" stroke="rgba(6,182,212,0.1)" stroke-width="1"/>
  <text x="${size / 2}" y="${textY}" text-anchor="middle" font-family="Inter,Segoe UI,Arial,sans-serif" font-weight="900" font-size="${fontSize}" fill="url(#g)">N</text>
</svg>`;

    // Save as SVG — rename to .png for manifest compatibility
    // Browsers render SVG icons just fine for PWAs
    fs.writeFileSync(path.join(iconsDir, `icon-${size}.svg`), svg);
    console.log(`Generated icon-${size}.svg`);
});

console.log('\\nAll icons generated! Note: For production, convert these SVGs to PNGs using:');
console.log('  npx svgexport icon.svg icon.png 512:512');
console.log('Or use an online tool like realfavicongenerator.net');
