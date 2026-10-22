#!/bin/sh
# Run a command that installs with apt, and give it a few minutes. The mirror of Ubuntu in Azure
# sometimes delivers a few kB per second (#320); then the command is stopped, the main archive of
# Ubuntu takes that mirror's place, and the command runs again. What apt already downloaded stays
# in its cache directory and is not fetched again.
#
#   mirror-fallback.sh <command> [<argument>...]
set -u
LIMIT="${LOEP_APT_LIMIT:-300}"
timeout --kill-after=30 "$LIMIT" "$@"
status=$?
[ "$status" -eq 124 ] || [ "$status" -eq 137 ] || exit "$status"
echo "::warning::Na $LIMIT seconden nog niet klaar, waarschijnlijk een trage spiegel van Ubuntu; opnieuw zonder azure.archive.ubuntu.com."
sudo dpkg --configure -a || true
# The runner reads its mirrors from apt-mirrors.txt (or straight from the sources); the main archive takes Azure's place.
for file in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/*; do
  [ -f "$file" ] && sudo sed -i 's#https\{0,1\}://azure\.archive\.ubuntu\.com/ubuntu#http://archive.ubuntu.com/ubuntu#g' "$file"
done
exec "$@"
