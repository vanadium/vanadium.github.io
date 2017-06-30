#!/bin/bash
# Copyright 2015 The Vanadium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

NATTEMPTS="${NATTEMPTS:-3}"

retry() {
  for attempt in $(seq 1 "${NATTEMPTS}"); do
    "$@" && break
    if [[ "${attempt}" == "${NATTEMPTS}" ]]; then
      echo "\"$@\" failed ${NATTEMPTS} times in a row."
      echo "This can happen if servers are unavailable,"
      echo "and is most likely a temporary problem."
      echo "Please try again later."
      exit 1
    fi
    echo "\"$@\" failed, trying again."
    sleep 1
  done
}

check_environment() {
  # Check that the JIRI_ROOT environment variable is set.
  if [[ -z "${JIRI_ROOT}" ]]; then
    echo "The JIRI_ROOT environment variable is not set."
    echo "Set the environment variable and re-run."
    exit 1
  fi

  # Check that the JIRI_ROOT environment variable does not contain spaces.
  # Note: This limitation is inherited from Autotools.
  local -r PATTERN="[ ']"
  if [[ "${JIRI_ROOT}" =~ "${PATTERN}" ]]; then
    echo "The JIRI_ROOT environment variable cannot contain"
    echo "space characters."
    exit 1
  fi

  # Check that the JIRI_ROOT path does not exist.
  if [[ -e "${JIRI_ROOT}" ]]; then
    echo "The JIRI_ROOT path already exists: ${JIRI_ROOT}"
    echo "Remove it or choose a different path and re-run."
    exit 1
  fi

  # Check that the host OS and package manager is supported.
  case $(uname -s) in
    "Linux")
      apt-get -v &> /dev/null
      if [[ "$?" -ne 0 ]]; then
        echo "Could not find the apt-get package manager."
        exit 1
      fi
      ;;
    "Darwin")
      brew -v &> /dev/null
      if [[ "$?" -ne 0 ]]; then
        echo "Could not find the brew package manager."
        exit 1
      fi
      ;;
    *)
      echo "Operating system $(uname -s) is not supported."
      exit 1
  esac

  # Check that GOPATH does not contain v.io packages.
  local -r VANADIUM_PACKAGES=$(go list v.io/... 2> /dev/null)
  if [[ -n "${VANADIUM_PACKAGES}" ]]; then
    echo "Your GOPATH already contains v.io packages."
    echo "Remove these from your GOPATH and re-run."
    exit 1
  fi

  # Check that git exists on the host.
  local -r GIT_VERSION=$(git version 2> /dev/null)
  if [[ "$?" -ne 0 ]]; then
    echo "The 'git' command does not exist in your PATH."
    echo "Add it to the PATH and re-run."
    exit 1
  fi
}

main() {
  check_environment

  trap "rm -rf ${JIRI_ROOT}" INT TERM EXIT

  # Run the jiri_bootstrap script.
  curl -f -s https://raw.githubusercontent.com/vanadium/go.jiri/master/scripts/bootstrap_jiri | bash -s $JIRI_ROOT

  # Import the Vanadium public manifest.
  pushd $JIRI_ROOT
  $JIRI_ROOT/.jiri_root/bin/jiri import -name=manifest public git@github.com:vanadium-archive/manifest.git

  # Sync the Vanadium projects locally.
  retry $JIRI_ROOT/.jiri_root/bin/jiri update
  popd

  echo "Recommended: Add ${JIRI_ROOT}/.jiri_root/scripts to your PATH."
  trap - EXIT
}

main "$@"
