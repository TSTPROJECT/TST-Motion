// Every word on screen, in Thai and English.
import { signal } from "@preact/signals";

export type Lang = "th" | "en";
const saved = (() => { try { return localStorage.getItem("tstm-lang"); } catch { return null; } })();
export const lang = signal<Lang>(saved === "en" ? "en" : "th"); // Thai first; English is one tap away
export function setLang(l: Lang) {
  lang.value = l; document.documentElement.lang = l;
  try { localStorage.setItem("tstm-lang", l); } catch { /* private mode */ }
}
document.documentElement.lang = lang.value;

const th = {
  app_tag: "ทำโมชั่นอนิเมชั่น 2D ฟรี ใช้ได้ทั้งคอมและมือถือ",
  new_project: "งานใหม่", open_file: "เปิดไฟล์โปรเจกต์", recent: "งานล่าสุด", no_recent: "ยังไม่มีงาน เริ่มจากเลือกขนาดจอด้านบน",
  untitled: "งานใหม่", layers_n: "{n} ชิ้น", delete: "ลบ", cancel: "ยกเลิก", close: "ปิด", ok: "ตกลง", save: "บันทึก",
  confirm_delete_project: "ลบงาน \"{name}\" ออกจากเครื่องนี้? ลบแล้วกู้คืนไม่ได้",
  preset_916: "TikTok / Reels", preset_169: "YouTube", preset_11: "โพสต์สี่เหลี่ยม", custom: "กำหนดเอง",
  install: "ติดตั้งแอป", install_ios: "ติดตั้งบน iPhone/iPad: กดปุ่มแชร์ แล้วเลือก \"เพิ่มไปยังหน้าจอโฮม\"",
  saved_local: "บันทึกในเครื่องแล้ว", saving: "กำลังบันทึก...", home: "หน้าแรก",
  import: "นำเข้ารูป", export: "ส่งออก", export_soon: "ส่งออกวิดีโอ (MP4, WebM, MOV, GIF) จะมาในเฟส 2 ตอนนี้บันทึกเป็นไฟล์โปรเจกต์ได้ก่อน",
  save_file: "บันทึกเป็นไฟล์", undo: "ย้อนกลับ", redo: "ทำซ้ำ", settings: "ตั้งค่างาน", theme: "สลับธีมมืด/สว่าง", more: "เพิ่มเติม",
  mode_setup: "จัดท่า", mode_animate: "ขยับ",
  mode_setup_hint: "โหมดจัดท่า: จัดวางชิ้นส่วน ตั้งจุดหมุน และเลือกว่าชิ้นไหนติดกับชิ้นไหน ไม่สร้างคีย์เฟรม",
  mode_animate_hint: "โหมดขยับ: เลื่อนเวลาไปจุดที่ต้องการ แล้วลากชิ้นส่วน ระบบใส่คีย์เฟรมให้เอง",
  t_move: "ย้าย", t_rotate: "หมุน", t_pivot: "จุดหมุน", t_hand: "เลื่อนจอ", fit: "พอดีจอ",
  tip_move: "ลากชิ้นส่วนเพื่อย้าย ลากมุมเพื่อย่อขยาย ลากจุดด้านบนเพื่อหมุน",
  tip_rotate: "ลากที่ชิ้นส่วนเพื่อหมุนรอบจุดหมุน",
  tip_pivot: "ลากเพื่อย้ายจุดหมุน (ข้อต่อ) ภาพไม่ขยับตาม",
  tip_hand: "ลากเพื่อเลื่อนจอ หมุนล้อเมาส์หรือใช้สองนิ้วเพื่อซูม",
  layers: "เลเยอร์", props: "คุณสมบัติ", timeline: "ไทม์ไลน์",
  empty_title: "เริ่มจากนำรูปเข้ามา", empty_body: "ลากรูปมาวางตรงนี้ หรือกดปุ่มด้านล่าง ได้ทีละหลายรูป รองรับ PNG, JPG, WebP, GIF, BMP, AVIF, SVG และ PSD แบบแยกเลเยอร์",
  drop_here: "วางรูปเพื่อนำเข้า",
  imported: "นำเข้า {n} ชิ้นแล้ว", import_failed: "เปิดไฟล์นี้ไม่ได้: {names}", importing: "กำลังนำเข้า...",
  no_layer: "เลือกชิ้นส่วนบนจอหรือในรายการเลเยอร์", follows: "ติดกับ", follows_none: "ไม่ติดกับชิ้นไหน", follows_of: "ติดกับ {name}",
  cycle: "ทำแบบนั้นไม่ได้ เพราะจะติดกันวนเป็นวง",
  g_transform: "การจัดวาง", g_pivot: "จุดหมุน (ข้อต่อ)", g_motion: "การเคลื่อนที่ไปคีย์ถัดไป",
  p_x: "X", p_y: "Y", p_rot: "หมุน", p_sx: "กว้าง", p_sy: "สูง", p_scale: "ขนาด", p_o: "ความทึบ", p_px: "จุดหมุน X", p_py: "จุดหมุน Y",
  link_scale: "ล็อกสัดส่วน", key_add: "ใส่คีย์เฟรม", key_remove: "ลบคีย์เฟรม", key_prev: "คีย์ก่อนหน้า", key_next: "คีย์ถัดไป",
  key_prop: "ใส่/ลบคีย์เฟรมของค่านี้", center_pivot: "จุดหมุนกลางภาพ", reset_pose: "คืนค่าเริ่มต้น",
  e_smooth: "นุ่มนวล", e_linear: "คงที่", e_in: "ค่อยๆ เร่ง", e_out: "ค่อยๆ ผ่อน", e_back: "เด้งกลับ", e_hold: "ค้างแล้วกระโดด",
  ease_need_key: "ใส่คีย์เฟรมที่จุดนี้ก่อน แล้วค่อยเลือกการเคลื่อนที่",
  rename: "เปลี่ยนชื่อ", duplicate: "ทำสำเนา", bring_front: "เลื่อนขึ้นหน้า", send_back: "เลื่อนไปหลัง", show_hide: "ซ่อน/แสดง", lock: "ล็อก/ปลดล็อก",
  confirm_delete_layer: "ลบชิ้น \"{name}\"?",
  play: "เล่น", pause: "หยุด", prev_frame: "ถอยหนึ่งเฟรม", next_frame: "เดินหน้าหนึ่งเฟรม", to_start: "กลับไปเริ่ม", loop: "เล่นวน",
  zoom_tl: "ซูมไทม์ไลน์", frame_n: "เฟรม {n}",
  s_name: "ชื่องาน", s_size: "ขนาดจอ (พิกเซล)", s_fps: "เฟรมต่อวินาที", s_length: "ความยาว (วินาที, สูงสุด {max})", s_bg: "พื้นหลัง",
  bg_alpha: "ใส", bg_green: "เขียว", bg_white: "ขาว", bg_black: "ดำ", width: "กว้าง", height: "สูง",
  file_saved: "บันทึกไฟล์แล้ว", open_failed: "เปิดไฟล์โปรเจกต์ไม่ได้", missing_images: "หารูปบางรูปไม่เจอ: {names}",
  shortcuts: "ทางลัด: Space เล่น/หยุด · ←/→ ทีละเฟรม · K คีย์เฟรม · V ย้าย · R หมุน · P จุดหมุน · H เลื่อนจอ · Ctrl+Z ย้อนกลับ · Ctrl+S บันทึกไฟล์",
  storage_note: "งานทั้งหมดเก็บในเครื่องนี้เท่านั้น ถ้าจะย้ายเครื่อง ให้กด \"บันทึกเป็นไฟล์\"",
  phase_note: "เวอร์ชันทดลอง (เฟส 1)",
};
export type Key = keyof typeof th;
const en: Record<Key, string> = {
  app_tag: "Free 2D motion animation, on computer and phone",
  new_project: "New project", open_file: "Open project file", recent: "Recent", no_recent: "No projects yet. Pick a frame size above to start.",
  untitled: "Untitled", layers_n: "{n} parts", delete: "Delete", cancel: "Cancel", close: "Close", ok: "OK", save: "Save",
  confirm_delete_project: "Delete \"{name}\" from this device? This can't be undone.",
  preset_916: "TikTok / Reels", preset_169: "YouTube", preset_11: "Square post", custom: "Custom",
  install: "Install app", install_ios: "To install on iPhone/iPad: tap Share, then \"Add to Home Screen\"",
  saved_local: "Saved on this device", saving: "Saving...", home: "Home",
  import: "Import images", export: "Export", export_soon: "Video export (MP4, WebM, MOV, GIF) arrives in phase 2. For now you can save a project file.",
  save_file: "Save as file", undo: "Undo", redo: "Redo", settings: "Project settings", theme: "Switch dark/light", more: "More",
  mode_setup: "Setup", mode_animate: "Animate",
  mode_setup_hint: "Setup mode: place parts, set pivots and choose which part follows which. No keyframes are made.",
  mode_animate_hint: "Animate mode: move the time to a frame, then drag a part. Keyframes are added for you.",
  t_move: "Move", t_rotate: "Rotate", t_pivot: "Pivot", t_hand: "Pan", fit: "Fit",
  tip_move: "Drag a part to move it, a corner to resize, the top dot to rotate",
  tip_rotate: "Drag a part to rotate it around its pivot",
  tip_pivot: "Drag to move the pivot (joint). The picture stays put.",
  tip_hand: "Drag to pan. Mouse wheel or two fingers to zoom.",
  layers: "Layers", props: "Properties", timeline: "Timeline",
  empty_title: "Start by bringing in pictures", empty_body: "Drop images here or use the button below, several at once. PNG, JPG, WebP, GIF, BMP, AVIF, SVG and layered PSD.",
  drop_here: "Drop to import",
  imported: "Imported {n} parts", import_failed: "Couldn't open: {names}", importing: "Importing...",
  no_layer: "Select a part on the canvas or in the layer list", follows: "Follows", follows_none: "Nothing", follows_of: "Follows {name}",
  cycle: "Can't do that: the parts would follow each other in a loop",
  g_transform: "Transform", g_pivot: "Pivot (joint)", g_motion: "Motion to the next key",
  p_x: "X", p_y: "Y", p_rot: "Rotate", p_sx: "Width", p_sy: "Height", p_scale: "Size", p_o: "Opacity", p_px: "Pivot X", p_py: "Pivot Y",
  link_scale: "Lock ratio", key_add: "Add keyframe", key_remove: "Remove keyframe", key_prev: "Previous key", key_next: "Next key",
  key_prop: "Add/remove a keyframe for this value", center_pivot: "Centre pivot", reset_pose: "Reset",
  e_smooth: "Smooth", e_linear: "Linear", e_in: "Ease in", e_out: "Ease out", e_back: "Overshoot", e_hold: "Hold",
  ease_need_key: "Add a keyframe here first, then pick the motion",
  rename: "Rename", duplicate: "Duplicate", bring_front: "Bring forward", send_back: "Send backward", show_hide: "Show/hide", lock: "Lock/unlock",
  confirm_delete_layer: "Delete \"{name}\"?",
  play: "Play", pause: "Pause", prev_frame: "Previous frame", next_frame: "Next frame", to_start: "Go to start", loop: "Loop",
  zoom_tl: "Timeline zoom", frame_n: "Frame {n}",
  s_name: "Name", s_size: "Frame size (pixels)", s_fps: "Frames per second", s_length: "Length (seconds, up to {max})", s_bg: "Background",
  bg_alpha: "Clear", bg_green: "Green", bg_white: "White", bg_black: "Black", width: "Width", height: "Height",
  file_saved: "File saved", open_failed: "Couldn't open that project file", missing_images: "Some images are missing: {names}",
  shortcuts: "Shortcuts: Space play/pause · ←/→ step · K keyframe · V move · R rotate · P pivot · H pan · Ctrl+Z undo · Ctrl+S save file",
  storage_note: "Projects stay on this device only. To move to another device, use \"Save as file\".",
  phase_note: "Preview build (phase 1)",
};
const dict = { th, en };
export function t(k: Key, vars?: Record<string, string | number>) {
  let s = dict[lang.value][k] ?? k;
  if (vars) for (const [n, v] of Object.entries(vars)) s = s.replace(`{${n}}`, String(v));
  return s;
}
