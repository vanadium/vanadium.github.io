#
# Script @test from content/installation/step-by-step.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'checkForBash' (1/9 in test) of content/installation/step-by-step.md"
####
set | grep BASH > /dev/null || echo "Vanadium installation requires Bash."
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'define_JIRI_ROOT' (2/9 in test) of content/installation/step-by-step.md"
####
# Uses existing $JIRI_ROOT environment variable, defaults to ${HOME}/vanadium if
# $JIRI_ROOT is not set.
export JIRI_ROOT=${JIRI_ROOT:=${HOME}/vanadium}
#----------------------------------------------------------------------#  End 2

#----------------------------------------------------------------------#  Start 3
echo "Block 'define_VANADIUM_RELEASE' (3/9 in test) of content/installation/step-by-step.md"
####
# Needed for tutorials only.
export VANADIUM_RELEASE=${JIRI_ROOT}/release/go
#----------------------------------------------------------------------#  End 3

 bash -euo pipefail <<'HANDLED_SCRIPT'
function handledTrouble() {
  echo " "
  echo "Unable to continue!"
  exit 1
}
trap handledTrouble INT TERM
#
# Script @test from content/installation/step-by-step.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'checkForBash' (1/9 in test) of content/installation/step-by-step.md"
####
set | grep BASH > /dev/null || echo "Vanadium installation requires Bash."
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'define_JIRI_ROOT' (2/9 in test) of content/installation/step-by-step.md"
####
# Uses existing $JIRI_ROOT environment variable, defaults to ${HOME}/vanadium if
# $JIRI_ROOT is not set.
export JIRI_ROOT=${JIRI_ROOT:=${HOME}/vanadium}
#----------------------------------------------------------------------#  End 2

#----------------------------------------------------------------------#  Start 3
echo "Block 'define_VANADIUM_RELEASE' (3/9 in test) of content/installation/step-by-step.md"
####
# Needed for tutorials only.
export VANADIUM_RELEASE=${JIRI_ROOT}/release/go
#----------------------------------------------------------------------#  End 3

#----------------------------------------------------------------------#  Start 4
echo "Block 'check_JIRI_ROOT' (4/9 in test) of content/installation/step-by-step.md"
####
# Check that the JIRI_ROOT path does not exist.
if [[ -e "${JIRI_ROOT}" ]]; then
  echo ""
  echo "ERROR: The JIRI_ROOT path already exists: ${JIRI_ROOT}"
  echo "To proceed with a fresh install remove the directory and re-run:"
  echo ""
  echo "    rm -rf ${JIRI_ROOT}"
  echo ""
  echo "Or set JIRI_ROOT to a different path."
  exit 1
fi
#----------------------------------------------------------------------#  End 4

#----------------------------------------------------------------------#  Start 5
echo "Block 'runBootstrapScript' (5/9 in test) of content/installation/step-by-step.md"
####
# This can take several minutes.
curl -f https://vanadium.github.io/bootstrap.sh | bash
#----------------------------------------------------------------------#  End 5

#----------------------------------------------------------------------#  Start 6
echo "Block 'addDevtoolsToPath' (6/9 in test) of content/installation/step-by-step.md"
####
export PATH=$JIRI_ROOT/.jiri_root/scripts:$PATH
#----------------------------------------------------------------------#  End 6

#----------------------------------------------------------------------#  Start 7
echo "Block 'packagesBaseProfile' (7/9 in test) of content/installation/step-by-step.md"
####
# Print the package installation command.
jiri profile os-packages v23:base

# Run the package installation command as root.
if [ -n "$(jiri profile os-packages v23:base)" ]; then
  sudo $(jiri profile os-packages v23:base)
fi
#----------------------------------------------------------------------#  End 7

#----------------------------------------------------------------------#  Start 8
echo "Block 'installBaseProfile' (8/9 in test) of content/installation/step-by-step.md"
####
jiri profile install v23:base
#----------------------------------------------------------------------#  End 8

#----------------------------------------------------------------------#  Start 9
echo "Block 'installVanadiumBinaries' (9/9 in test) of content/installation/step-by-step.md"
####
# Install specific tools needed for the tutorials.
jiri go install v.io/x/ref/cmd/... v.io/x/ref/services/agent/... v.io/x/ref/services/mounttable/... v.io/x/ref/services/syncbase/...
#----------------------------------------------------------------------#  End 9

echo " "
echo "All done.  No errors."
HANDLED_SCRIPT
