// Makes a QR code of the site's secret link, to scan with the iPhone camera:  node setup/link.mjs
// The picture is saved in out/ (never uploaded anywhere). The link itself is not printed.
import path from 'node:path';
import QRCode from 'qrcode';
import { ROOT } from '../pipeline/data.js'; // also loads ~/.markets-briefing/.env

const { SITE_URL, SITE_KEY } = process.env;
if (!SITE_URL || !SITE_KEY) throw new Error('Run node setup/hosting.mjs first.');
const file = path.join(ROOT, 'out', 'open-on-iphone.png');
await QRCode.toFile(file, `${SITE_URL.replace(/\/+$/, '')}/${SITE_KEY}/`, { width: 720, margin: 3, errorCorrectionLevel: 'M', color: { dark: '#2B1B17', light: '#FFFFFF' } });
console.log(`QR code saved: ${file}`);
