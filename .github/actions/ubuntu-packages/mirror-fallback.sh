#!/bin/sh
# Run a command that installs with apt, and give it a few minutes. The mirror of Ubuntu in the cloud
# of the runner (azure.archive.ubuntu.com, or a regional one such as us-east-2.ec2.archive.ubuntu.com
# on AWS) sometimes delivers a few kB per second (#320, #669); then the command is stopped, the main
# archive of Ubuntu takes that mirror's place, and the command runs again, with the same limit. What
# apt already downloaded stays in its cache directory and is not fetched again.
#
#   mirror-fallback.sh <command> [<argument>...]
set -u
LIMIT="${LOEP_APT_LIMIT:-300}"
timeout --kill-after=30 "$LIMIT" "$@"
status=$?
[ "$status" -eq 124 ] || [ "$status" -eq 137 ] || exit "$status"
echo "::warning::Na $LIMIT seconden nog niet klaar, waarschijnlijk een trage spiegel van Ubuntu; opnieuw via archive.ubuntu.com."
# sudo starts apt-get in a session of its own, out of reach of timeout: stop it, and its downloads, here.
stop_apt() {
  sudo pkill -TERM -x apt-get || true
  for _ in $(seq 60); do pgrep -x apt-get > /dev/null || break; sleep 1; done
  sudo pkill -KILL -x apt-get || true
  sudo pkill -KILL -f '^/usr/lib/apt/methods/' || true
  sudo dpkg --configure -a || true
}
stop_apt
# The runner reads its mirrors from apt-mirrors.txt (or straight from the sources). Every mirror under
# archive.ubuntu.com (azure., us-east-2.ec2. and so on) makes way for the main archive itself.
for file in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/*; do
  [ -f "$file" ] && sudo sed -i 's#https\{0,1\}://[a-z0-9.-]*\.archive\.ubuntu\.com/ubuntu#http://archive.ubuntu.com/ubuntu#g' "$file"
done
# A second slow attempt fails here with its reason, instead of using up the time of the job.
timeout --kill-after=30 "$LIMIT" "$@"
status=$?
[ "$status" -eq 124 ] || [ "$status" -eq 137 ] || exit "$status"
stop_apt
echo "::error::Ook via archive.ubuntu.com na $LIMIT seconden niet klaar; de pakketbron van Ubuntu is nu te traag. Probeer het later opnieuw."
exit "$status"
