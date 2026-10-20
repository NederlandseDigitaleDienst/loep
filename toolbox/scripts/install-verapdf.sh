#!/bin/sh
# Install veraPDF, a fixed version, without questions: for the checks on GitHub, where no package
# source has it. The installer is checked against its sha256 before it runs.
#
#   sh toolbox/scripts/install-verapdf.sh [<directory>]   (default /opt/verapdf)
#
# Puts a link to the command in /usr/local/bin when that directory is writable, and says where it is.
set -eu
VERSION=1.30.3
SHA256=b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59
TARGET="${1:-/opt/verapdf}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -sSfL -o "$WORK/installer.zip" "https://software.verapdf.org/releases/${VERSION%.*}/verapdf-greenfield-$VERSION-installer.zip"
echo "$SHA256  $WORK/installer.zip" | sha256sum -c -
unzip -q "$WORK/installer.zip" -d "$WORK"

# The answers the installer would ask for: where to install, and only the command line and the GUI it starts from.
cat > "$WORK/auto-install.xml" <<EOF
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir">
    <installpath>$TARGET</installpath>
  </com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
    <pack index="0" name="veraPDF GUI" selected="true"/>
    <pack index="1" name="veraPDF Batch files" selected="true"/>
    <pack index="2" name="veraPDF Validation model" selected="false"/>
    <pack index="3" name="veraPDF Documentation" selected="false"/>
    <pack index="4" name="veraPDF Sample Plugins" selected="false"/>
  </com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
EOF
java -jar "$WORK/verapdf-greenfield-$VERSION/verapdf-izpack-installer-$VERSION.jar" "$WORK/auto-install.xml"
if [ -w /usr/local/bin ]; then ln -sf "$TARGET/verapdf" /usr/local/bin/verapdf; fi
"$TARGET/verapdf" --version | head -1
