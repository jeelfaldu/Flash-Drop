const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SVG_CONTENT = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0F1115"/>
      <stop offset="1" stop-color="#1A1D24"/>
    </linearGradient>
    <linearGradient id="bolt" x1="250" y1="200" x2="700" y2="800" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#B28DFF"/>
      <stop offset="0.5" stop-color="#7C4DFF"/>
      <stop offset="1" stop-color="#5E35B1"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="24" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <rect width="1024" height="1024" fill="url(#bg)"/>

  <path d="M570 200L350 560H520V824L720 440H580L570 200Z" 
        fill="url(#bolt)" 
        filter="url(#glow)"/>
</svg>
`;

const SVG_ROUND_CONTENT = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0F1115"/>
      <stop offset="1" stop-color="#1A1D24"/>
    </linearGradient>
    <linearGradient id="bolt" x1="250" y1="200" x2="700" y2="800" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#B28DFF"/>
      <stop offset="0.5" stop-color="#7C4DFF"/>
      <stop offset="1" stop-color="#5E35B1"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="24" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <circle cx="512" cy="512" r="512" fill="url(#bg)"/>

  <path d="M570 200L350 560H520V824L720 440H580L570 200Z" 
        fill="url(#bolt)" 
        filter="url(#glow)"/>
</svg>
`;

const SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

async function generate() {
  const baseDir = path.join(__dirname, 'android/app/src/main/res');

  for (const [dir, size] of Object.entries(SIZES)) {
    const targetDir = path.join(baseDir, dir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Standard Icon
    await sharp(Buffer.from(SVG_CONTENT))
      .resize(size, size)
      .toFile(path.join(targetDir, 'ic_launcher.png'));

    // Round Icon
    await sharp(Buffer.from(SVG_ROUND_CONTENT))
      .resize(size, size)
      .toFile(path.join(targetDir, 'ic_launcher_round.png'));

    console.log(`Generated ${size}x${size} in ${dir}`);
  }

  // Generate crisp splash screen logo for different densities
  const SPLASH_SIZES = {
    'drawable-mdpi': 150,
    'drawable-hdpi': 225,
    'drawable-xhdpi': 300,
    'drawable-xxhdpi': 450,
    'drawable-xxxhdpi': 600,
  };

  for (const [dir, size] of Object.entries(SPLASH_SIZES)) {
    const targetDir = path.join(baseDir, dir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    await sharp(Buffer.from(SVG_CONTENT))
      .resize(size, size)
      .toFile(path.join(targetDir, 'splash_icon.png'));
    console.log(`Generated splash_icon.png in ${dir}`);
  }
}

generate().catch(console.error);
