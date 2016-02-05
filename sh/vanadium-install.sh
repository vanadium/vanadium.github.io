#
# Script @test from content/installation/step-by-step.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'checkForBash' (1/7 in test) of content/installation/step-by-step.md"
####
set | grep BASH > /dev/null || echo "Vanadium installation requires Bash."
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'define_JIRI_ROOT' (2/7 in test) of content/installation/step-by-step.md"
####
# Edit to taste.
export JIRI_ROOT=${HOME}/v23_root
#----------------------------------------------------------------------#  End 2

#----------------------------------------------------------------------#  Start 3
echo "Block 'define_V23_RELEASE' (3/7 in test) of content/installation/step-by-step.md"
####
# Needed for tutorials only.
export V23_RELEASE=${JIRI_ROOT}/release/go
#----------------------------------------------------------------------#  End 3

 bash -e <<'HANDLED_SCRIPT'
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
echo "Block 'checkForBash' (1/7 in test) of content/installation/step-by-step.md"
####
set | grep BASH > /dev/null || echo "Vanadium installation requires Bash."
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'define_JIRI_ROOT' (2/7 in test) of content/installation/step-by-step.md"
####
# Edit to taste.
export JIRI_ROOT=${HOME}/v23_root
#----------------------------------------------------------------------#  End 2

#----------------------------------------------------------------------#  Start 3
echo "Block 'define_V23_RELEASE' (3/7 in test) of content/installation/step-by-step.md"
####
# Needed for tutorials only.
export V23_RELEASE=${JIRI_ROOT}/release/go
#----------------------------------------------------------------------#  End 3

#----------------------------------------------------------------------#  Start 4
echo "Block 'runBootstrapScript' (4/7 in test) of content/installation/step-by-step.md"
####
# This can take several minutes.
curl -f https://vanadium.github.io/bootstrap.sh | bash
#----------------------------------------------------------------------#  End 4

#----------------------------------------------------------------------#  Start 5
echo "Block 'addDevtoolsToPath' (5/7 in test) of content/installation/step-by-step.md"
####
export PATH=$JIRI_ROOT/devtools/bin:$PATH
#----------------------------------------------------------------------#  End 5

#----------------------------------------------------------------------#  Start 6
echo "Block 'installBaseProfile' (6/7 in test) of content/installation/step-by-step.md"
####
jiri v23-profile install base
#----------------------------------------------------------------------#  End 6

#----------------------------------------------------------------------#  Start 7
echo "Block 'installVanadiumBinaries' (7/7 in test) of content/installation/step-by-step.md"
####
# Install specific tools needed for the tutorials.
jiri go install v.io/x/ref/cmd/... v.io/x/ref/services/agent/... v.io/x/ref/services/mounttable/...
#----------------------------------------------------------------------#  End 7

echo " "
echo "All done.  No errors."
HANDLED_SCRIPT
