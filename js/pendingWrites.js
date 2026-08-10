function storageKey(k){ return "praui_pending_" + k; }

export function markPending(k){
  var n = parseInt(localStorage.getItem(storageKey(k)) || "0", 10) + 1;
  localStorage.setItem(storageKey(k), String(n));
}

export function clearPending(k){
  var n = Math.max(0, parseInt(localStorage.getItem(storageKey(k)) || "0", 10) - 1);
  if(n === 0) localStorage.removeItem(storageKey(k));
  else localStorage.setItem(storageKey(k), String(n));
}

export function isPending(k){
  return parseInt(localStorage.getItem(storageKey(k)) || "0", 10) > 0;
}
