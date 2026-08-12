// userDisplay.js — central mapping from account email to a display-safe name.
// Never render a raw email in the UI; render getDisplayName(email) instead.

var EMAIL_DISPLAY_NAMES = {
  "hopjon01@yahoo.com": "Jono",
  "snakeman07@protonmail.com": "Justin",
  "raven@prau.co.za": "Raven"
};

export function getDisplayName(email){
  if(!email) return "Unknown user";
  var key = String(email).trim().toLowerCase();
  if(EMAIL_DISPLAY_NAMES[key]) return EMAIL_DISPLAY_NAMES[key];
  if(key.indexOf("@") !== -1) return key.split("@")[0];
  return String(email);
}
