#!/bin/bash
# Runs inside the virtual Mac as its user, with the password of that user as first argument
# (the public image has user lume, password lume). Sets what loep voiceover needs and says
# per step what it found: one line "DONE <step>: ..." or "TODO <step>: ...". Safe to run again.
# The steps follow @guidepup/setup 0.29.2 (MIT); see docs/voiceover.md for what each is for.
PASSWORD="${1:-lume}"
ME=$(id -un)
done_() { echo "DONE $1: $2"; }
todo() { echo "TODO $1: $2"; }

# sudo without a password: every later step and every shutdown over ssh needs it.
if ! sudo -n true 2>/dev/null; then
  echo "$PASSWORD" | sudo -S -v 2>/dev/null
  echo "$ME ALL=(ALL) NOPASSWD: ALL" | sudo tee "/etc/sudoers.d/$ME" >/dev/null && sudo chmod 440 "/etc/sudoers.d/$ME"
fi
if sudo -n true 2>/dev/null; then done_ sudo "zonder wachtwoord voor $ME"; else todo sudo "het wachtwoord klopt niet; geef het wachtwoord van $ME mee"; exit 1; fi

# No lock, no sleep, no screen saver: the screen of the guest has to stay as it is.
sysadminctl -screenLock off -password "$PASSWORD" >/dev/null 2>&1
sudo pmset -a displaysleep 0 sleep 0 disksleep 0
defaults -currentHost write com.apple.screensaver idleTime -int 0
defaults write com.apple.screensaver askForPassword -int 0
done_ lock "geen vergrendeling, geen slaapstand, geen schermbeveiliging"

# Automatic login. sysadminctl -autologin fails in this image (error 22); the file it would
# write is the password XOR a fixed key, padded to a multiple of 12 bytes.
if [ "$(sudo defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null)" != "$ME" ] || ! sudo test -f /etc/kcpassword; then
  printf '%s' "$PASSWORD" | perl -e '
    my @key = (0x7D, 0x89, 0x52, 0x23, 0xD2, 0xBC, 0xDD, 0xEA, 0xA3, 0xB9, 0x1F);
    my @bytes = unpack("C*", do { local $/; <STDIN> });
    push @bytes, (0) x (12 - @bytes % 12);
    print pack("C*", map { $bytes[$_] ^ $key[$_ % @key] } 0 .. $#bytes);' | sudo tee /etc/kcpassword >/dev/null
  sudo chown root:wheel /etc/kcpassword && sudo chmod 600 /etc/kcpassword
  sudo defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser "$ME"
  done_ autologin "ingesteld voor $ME; geldt vanaf de volgende start"
else
  done_ autologin "stond al aan voor $ME"
fi

# What VoiceOver and Safari must not do by themselves.
defaults write com.apple.VoiceOver4/default SCREnableAppleScript -bool true
defaults write com.apple.VoiceOverTraining doNotShowSplashScreen -bool true
defaults write com.apple.HIToolbox AppleDictationAutoEnable -bool false
defaults write com.apple.loginwindow TALLogoutSavesState -bool false
defaults write com.apple.Safari NSQuitAlwaysKeepsWindows -bool false
defaults write com.apple.universalaccess voiceOverOnOffKey -bool false
done_ defaults "VoiceOver met AppleScript te bedienen, geen welkomstvenster, geen herstelde vensters"

# The two things System Integrity Protection guards: the switch that lets AppleScript drive
# VoiceOver, and the system list of permissions (TCC).
if csrutil status | grep -q enabled; then
  todo sip "System Integrity Protection staat aan; zet het in de herstelmodus van de virtuele Mac uit (csrutil disable) en draai dit opnieuw"
  exit 2
fi
sudo sh -c 'printf a > /private/var/db/Accessibility/.VoiceOverAppleScriptEnabled' && done_ applescript "schakelaar voor AppleScript-bediening van VoiceOver gezet" || todo applescript "kon de schakelaar niet schrijven"

# Permissions for what an ssh session starts: send keys, use the accessibility interface,
# and send Apple events to VoiceOver, System Events, Safari and Finder.
NOW=$(date +%s)
CLIENTS="/usr/sbin/sshd /usr/libexec/sshd-keygen-wrapper /usr/libexec/sshd-session /bin/bash /bin/zsh /usr/bin/osascript"
TARGETS="com.apple.systemevents com.apple.VoiceOver com.apple.VoiceOverUtility com.apple.Safari com.apple.finder"
sql="BEGIN IMMEDIATE;"
row() { sql="$sql INSERT OR REPLACE INTO access (service,client,client_type,auth_value,auth_reason,auth_version,csreq,policy_id,indirect_object_identifier_type,indirect_object_identifier,indirect_object_code_identity,flags,last_modified,pid,pid_version,boot_uuid,last_reminded) VALUES ('$1','$2',1,2,3,1,NULL,NULL,$3,'$4',NULL,0,$NOW,NULL,NULL,'UNUSED',$NOW);"; }
for client in $CLIENTS; do
  row kTCCServicePostEvent "$client" NULL UNUSED
  row kTCCServiceAccessibility "$client" NULL UNUSED
  for target in $TARGETS; do row kTCCServiceAppleEvents "$client" 0 "$target"; done
done
sql="$sql COMMIT;"
sqlite3 -bail "$HOME/Library/Application Support/com.apple.TCC/TCC.db" "$sql" && sudo sqlite3 -bail "/Library/Application Support/com.apple.TCC/TCC.db" "$sql" && done_ permissions "rechten gezet voor sshd, bash, zsh en osascript" || todo permissions "kon de rechten niet schrijven"
