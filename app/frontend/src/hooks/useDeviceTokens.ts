"use client";

import { Capacitor } from "@capacitor/core";
import { apiFetch } from "@/lib/api";

export type DeviceTokenPlatform = "ios" | "android" | "web";

export type NewDeviceTokenInput = {
  push_token: string;
  platform: DeviceTokenPlatform;
};

/** POST /device-tokens — el backend hace upsert por `push_token` (ver
 * domain/device-token.md → Notas de implementación), así que llamarla de
 * más (ej. en cada arranque de la app) no duplica filas. */
export function registerDeviceToken(input: NewDeviceTokenInput) {
  return apiFetch<{ id: number }>("/device-tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** id del DeviceToken registrado por ESTE dispositivo — se guarda para poder
 * borrarlo al cerrar sesión (ver domain/device-token.md: el token se elimina
 * cuando el usuario cierra sesión en ese dispositivo; si no, seguiría
 * recibiendo los recordatorios de la cuenta que ya salió). */
const DEVICE_TOKEN_ID_KEY = "habit_tracker_device_token_id";

/** Borra el token push de este dispositivo, si hay uno. Nunca lanza: debe
 * llamarse ANTES de revocar el token de sesión y no bloquear el logout. */
export async function unregisterCurrentDeviceToken(): Promise<void> {
  if (typeof window === "undefined") return;
  const id = localStorage.getItem(DEVICE_TOKEN_ID_KEY);
  if (!id) return;

  try {
    await apiFetch<null>(`/device-tokens/${id}`, { method: "DELETE" });
  } catch (error) {
    console.warn("No se pudo eliminar el token de push.", error);
  } finally {
    localStorage.removeItem(DEVICE_TOKEN_ID_KEY);
  }
}

/**
 * Registro real del token de push nativo (ver domain/device-token.md →
 * Notas de implementación): pide permiso de notificaciones, obtiene el
 * token FCM del dispositivo y lo postea a `/device-tokens` con
 * `platform: "android"` (única plataforma mobile empaquetada en este MVP
 * — ver decisions/stack.md → Empaquetado Android).
 *
 * No-op fuera de un shell nativo de Capacitor. Nunca lanza — un permiso
 * denegado, un fallo de FCM o un fallo de red no deben bloquear el resto
 * de la app (login/uso normal siguen funcionando igual).
 */
export async function registerNativePushToken(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    // Import dinámico a propósito: el SDK web de este plugin trae
    // `firebase/messaging` como dependencia estática (no es un no-op
    // liviano en web), así que si se importara arriba a nivel de módulo
    // terminaría empaquetado también en el build web aunque nunca se
    // ejecute (el `if` de arriba es un chequeo en runtime, no algo que
    // un bundler pueda usar para excluir código del bundle). El import()
    // dinámico permite que Next lo separe en un chunk aparte que el
    // build web nunca llega a pedir.
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");

    const { receive } = await FirebaseMessaging.requestPermissions();
    if (receive !== "granted") {
      // El usuario no dio permiso de notificaciones — no es un error,
      // simplemente no habrá reminders push en este dispositivo.
      return;
    }

    const { token } = await FirebaseMessaging.getToken();
    const registered = await registerDeviceToken({ push_token: token, platform: "android" });
    localStorage.setItem(DEVICE_TOKEN_ID_KEY, String(registered.id));
  } catch (error) {
    // Falla silenciosa a propósito: registrar el push token nunca debe
    // impedir que el usuario siga usando la app.
    console.warn("No se pudo registrar el token de push.", error);
  }
}
