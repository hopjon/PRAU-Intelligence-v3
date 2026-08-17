// userDisplay.js — central mapping from account email to a display-safe name.
// Never render a raw email in the UI; render getDisplayName(email) instead.

var EMAIL_DISPLAY_NAMES = {
  "hopjon01@yahoo.com": "Jono",
  "snakeman07@protonmail.com": "Justin",
  "raven@prau.co.za": "Raven",
  "test@prau.local": "Jono"
};

// Legacy records (pre-dating full-email attribution) stored just the email's
// local-part as a short username, e.g. "hopjon01". Derived automatically from
// EMAIL_DISPLAY_NAMES above so there's a single source of truth — no second
// identity map to keep in sync.
var USERNAME_DISPLAY_NAMES = {};
Object.keys(EMAIL_DISPLAY_NAMES).forEach(function(fullEmail){
  var username = fullEmail.split("@")[0];
  USERNAME_DISPLAY_NAMES[username] = EMAIL_DISPLAY_NAMES[fullEmail];
});

export function getDisplayName(email){
  if(!email) return "Unknown user";
  var key = String(email).trim().toLowerCase();
  if(EMAIL_DISPLAY_NAMES[key]) return EMAIL_DISPLAY_NAMES[key];
  if(key.indexOf("@") !== -1) return key.split("@")[0];
  if(USERNAME_DISPLAY_NAMES[key]) return USERNAME_DISPLAY_NAMES[key];
  return String(email);
}
