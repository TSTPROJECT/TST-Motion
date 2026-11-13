// Adding sounds from the user's files, with a short message about what happened.
import { project } from "../model/store";
import { addSoundFile, AUDIO_ACCEPT } from "../audio/sound";
import { t } from "../i18n";
import { toast } from "./shell";
import { pickFile } from "./open";

/** Add a sound file; says so when it could not be read or when the animation grew to fit it. */
export async function addSound(f: File) {
  const r = await addSoundFile(f);
  if (r === "decode") toast(t("sound_failed", { name: f.name }), true);
  else if (r) toast(t("sound_grew", { s: Math.round(r.grew / (project.value?.fps ?? 30)) }));
  else toast(t("sound_added", { name: f.name }));
}
export const pickSound = async () => { for (const f of await pickFile(AUDIO_ACCEPT, true)) await addSound(f); };
