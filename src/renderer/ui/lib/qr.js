/**
 * غلاف QR محلي بالكامل — توليد الرمز يحدث داخل جهازك بدون أي طلب شبكة
 * (خصوصية أولاً: الرابط لا يغادر المتصفح أبداً).
 * المكتبة: qrcode-generator (MIT) مضمّنة في lib/vendor/qrcode.js.
 */
import './vendor/qrcode.js';

const lib = () => window.qrcode;

/** يبني سلسلة SVG لرمز QR من نص (URL عادة). يعيد null إذا فشل التوليد. */
export function qrSvg(text, opts = {}) {
  try {
    const qr = lib()(0, 'M'); /* typeNumber 0 = أصغر حجم مناسب، تصحيح M */
    qr.addData(String(text || ''), 'Byte');
    qr.make();
    return qr.createSvgTag({ cellSize: opts.cellSize || 4, margin: opts.margin == null ? 2 : opts.margin, scalable: true });
  } catch {
    return null;
  }
}
