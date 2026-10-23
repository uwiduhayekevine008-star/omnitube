import "expo-sqlite/localStorage/install";

export type DevicePreferences = {
  autoPlayShorts: boolean;
  hapticsEnabled: boolean;
  reduceDataUsage: boolean;
};
export const defaultDevicePreferences: DevicePreferences = {
  autoPlayShorts: true,
  hapticsEnabled: true,
  reduceDataUsage: false,
};
const preferenceKey = (key: keyof DevicePreferences) => "omnitube.preference." + key;

export function readDevicePreferences(): DevicePreferences {
  const next = { ...defaultDevicePreferences };
  for (const key of Object.keys(next) as (keyof DevicePreferences)[]) {
    const raw = globalThis.localStorage?.getItem(preferenceKey(key));
    if (raw === "true") next[key] = true;
    else if (raw === "false") next[key] = false;
  }
  return next;
}
export function setDevicePreference<K extends keyof DevicePreferences>(key: K, value: DevicePreferences[K]): DevicePreferences {
  globalThis.localStorage?.setItem(preferenceKey(key), String(value));
  return readDevicePreferences();
}