// ops_sim — Author: Levent Görgü (github.com/Levent-Gr) — (c) 2026
export const ICON_BOLT = '<svg viewBox="0 0 16 16" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;fill:currentColor" aria-hidden="true"><path d="M9 1L2 9h5l-1 6 7-8H8l1-6z"/></svg>';
export const ICON_TREND = '<svg viewBox="0 0 16 16" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round" aria-hidden="true"><polyline points="2,12 6,7 9,9 14,3"/><polyline points="10,3 14,3 14,7"/></svg>';
export const ICON_LIST = '<svg viewBox="0 0 16 16" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round" aria-hidden="true"><line x1="5" y1="4" x2="14" y2="4"/><line x1="5" y1="8" x2="14" y2="8"/><line x1="5" y1="12" x2="14" y2="12"/><circle cx="2.5" cy="4" r="0.8" fill="currentColor"/><circle cx="2.5" cy="8" r="0.8" fill="currentColor"/><circle cx="2.5" cy="12" r="0.8" fill="currentColor"/></svg>';
export const ICON_EDIT = '<svg viewBox="0 0 16 16" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round" aria-hidden="true"><path d="M11 2l3 3-8 8H3v-3l8-8z"/></svg>';
export const ICON_BOX = '<svg viewBox="0 0 16 16" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linejoin:round" aria-hidden="true"><path d="M2 5l6-3 6 3v6l-6 3-6-3V5z"/><path d="M2 5l6 3 6-3"/><line x1="8" y1="8" x2="8" y2="14"/></svg>';
export const ICON_STATUS = '<svg viewBox="0 0 16 16" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/></svg>';
export const ICON_DOWNLOAD = '<svg viewBox="0 0 16 16" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round" aria-hidden="true"><path d="M8 2v9"/><polyline points="4,7 8,11 12,7"/><line x1="2" y1="14" x2="14" y2="14"/></svg>';
export const ICON_GEAR = '<svg viewBox="0 0 16 16" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round" aria-hidden="true"><circle cx="8" cy="8" r="2.3"/><path d="M8 1v2M8 13v2M15 8h-2M3 8H1M12.95 3.05l-1.4 1.4M4.45 11.55l-1.4 1.4M12.95 12.95l-1.4-1.4M4.45 4.45l-1.4-1.4"/></svg>';

export function svgIconBox(color) {
  return `<svg viewBox="0 0 16 16" style="width:13px;height:13px;vertical-align:middle;margin-right:5px;display:inline-block"><path d="M2 5.5L8 2.5L14 5.5L8 8.5Z" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 5.5V11.5L8 14.5V8.5" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/><path d="M14 5.5V11.5L8 14.5" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}
export function svgIconCalendar(color) {
  return `<svg viewBox="0 0 16 16" style="width:13px;height:13px;vertical-align:middle;margin-right:5px;display:inline-block"><rect x="2" y="3.5" width="12" height="10" rx="1.5" fill="none" stroke="${color}" stroke-width="1.4"/><line x1="2" y1="6.5" x2="14" y2="6.5" stroke="${color}" stroke-width="1.4"/><line x1="5" y1="2" x2="5" y2="5" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/><line x1="11" y1="2" x2="11" y2="5" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/></svg>`;
}
export function svgIconFolder(color) {
  return `<svg viewBox="0 0 16 16" style="width:13px;height:13px;vertical-align:middle;margin-right:5px;display:inline-block"><path d="M2 4.5C2 3.95 2.45 3.5 3 3.5H6L7.5 5H13C13.55 5 14 5.45 14 6V12.5C14 13.05 13.55 13.5 13 13.5H3C2.45 13.5 2 13.05 2 12.5V4.5Z" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}
export function grupIconSVG() {
  return `<svg viewBox="0 0 16 16"><path d="M2 4h4l1.5 2H14v7H2z"/><path d="M2 6v5"/></svg>`;
}
