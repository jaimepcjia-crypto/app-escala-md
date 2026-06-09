"use client";

const TAB_SESSION_KEY = "escala_md_tab_session";

export function getTabSessionToken() {
  return typeof window === "undefined" ? null : window.sessionStorage.getItem(TAB_SESSION_KEY);
}

export function setTabSessionToken(token: string) {
  window.sessionStorage.setItem(TAB_SESSION_KEY, token);
}

export function clearTabSessionToken() {
  window.sessionStorage.removeItem(TAB_SESSION_KEY);
}

export function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = getTabSessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export async function authenticatedDownload(url: string, fileName: string) {
  const response = await authenticatedFetch(url);
  if (!response.ok) throw new Error("Não foi possível baixar o arquivo.");
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
