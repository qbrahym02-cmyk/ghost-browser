/**
 * بيانات الدول/المنصات بصيغة JSON مشتركة بين العملية الرئيسية والواجهة.
 * هذا الغلاف يقدّمها كـ CommonJS للعملية الرئيسية ويبني فهرس PRESETS.
 * الواجهة تستورد countries.json مباشرة (import attribute type=json).
 */
const data = require('./countries.json');
const { COUNTRIES, PLATFORMS, SCREENS } = data;
const PRESETS = Object.fromEntries(COUNTRIES.map((c) => [c.id, c]));
module.exports = { COUNTRIES, PRESETS, PLATFORMS, SCREENS };
