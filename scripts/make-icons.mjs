/**
 * يبني أيقونات التطبيق من resources/icon-source.png بدون أي اعتماديات:
 *   resources/icon.ico   (16/24/32/48 BMP + 64/128/256 PNG داخل ICO)
 *   resources/icon.png   (256)
 *   resources/icons/     (مقاسات لينكس: 16..512)
 *
 * الاستخدام: npm run icons
 */
import { loadPng, resize, writeIco, writePng, encodePng } from './png-tool.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = loadPng(join(root, 'resources/icon-source.png'));
console.log(`المصدر: ${src.width}×${src.height}`);

const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const imgs = sizes.map((s) => (src.width === s ? src : resize(src, s, s)));

writeIco(join(root, 'resources/icon.ico'), imgs.filter((i) => i.width <= 256));
console.log('✓ resources/icon.ico');

writeFileSync(join(root, 'resources/icon.png'), encodePng(256, 256, imgs.find((i) => i.width === 256).data));
console.log('✓ resources/icon.png');

mkdirSync(join(root, 'resources/icons'), { recursive: true });
for (const img of imgs) {
  writeFileSync(join(root, `resources/icons/${img.width}x${img.height}.png`), encodePng(img.width, img.height, img.data));
}
console.log('✓ resources/icons/*.png');
